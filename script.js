
document.addEventListener('DOMContentLoaded', () => {
    // We need to wrap canvas-wrapper in a scroll area for proper centering + scrolling
    const workspace = document.querySelector('.workspace');

    // Create scroll area dynamically or just use workspace directly?
    // Let's inject a scroll container if not present, but CSS change suggests .workspace-scroll-area
    // Let's modify the HTML structure strictly via JS for the scroll wrapper
    // Actually, easier to just treat specific elements.
    // The CSS assumed a structure change. I should inject it.

    let scrollArea = document.querySelector('.workspace-scroll-area');
    const canvasWrapper = document.getElementById('canvas-wrapper');
    const layersList = document.getElementById('layers-list');

    if (!scrollArea) {
        scrollArea = document.createElement('div');
        scrollArea.className = 'workspace-scroll-area';
        // Move wrapper inside
        canvasWrapper.parentNode.insertBefore(scrollArea, canvasWrapper);
        scrollArea.appendChild(canvasWrapper);
    }

    // Tools

    // Tools
    const toolBtns = document.querySelectorAll('.tool-btn');
    const colorPicker = document.getElementById('color-picker');
    const sizeSlider = document.getElementById('size-slider');
    const sizeDisplay = document.getElementById('size-display');
    const brushShape = document.getElementById('brush-shape');
    const btnUndo = document.getElementById('btn-undo');
    const btnClear = document.getElementById('btn-clear');
    const btnGenerate = document.getElementById('btn-generate');
    const btnAddLayer = document.getElementById('btn-add-layer');

    const btnSave = document.getElementById('btn-save');
    const btnLoad = document.getElementById('btn-load');
    const fileInput = document.getElementById('file-input');

    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');
    const btnZoomFit = document.getElementById('btn-zoom-fit');
    const zoomDisplay = document.getElementById('zoom-display');

    // Modal
    const modal = document.getElementById('code-modal');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnCopy = document.getElementById('btn-copy');
    const codeOutput = document.getElementById('code-output');

    // State
    const CONFIG = {
        width: 540,
        height: 540,
        bgColor: '#ffffff'
    };

    let state = {
        isDrawing: false,
        currentTool: 'pen', // pen, eraser, pipette
        color: '#000000',
        size: 5,
        shape: 'round', // round, square
        zoom: 1.0,
        lastX: 0,
        lastY: 0,

        // Layers
        layers: [], // { id, canvas, ctx, visible, name }
        activeLayerId: null,
        nextLayerId: 1,

        // History for Undo (Simplified: Snapshots of active layer)
        // Note: Global Undo in multi-layer system usually tracks {layerId, imageData}
        history: [],
        historyStep: -1,
        maxHistory: 20
    };

    // Initialize
    function init() {
        // Create initial background layer
        addLayer("Background");

        // Setup Tools
        toolBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                toolBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (btn.id === 'tool-pen') state.currentTool = 'pen';
                if (btn.id === 'tool-eraser') state.currentTool = 'eraser';
                if (btn.id === 'tool-pipette') state.currentTool = 'pipette';
            });
        });

        // Properties
        colorPicker.addEventListener('input', (e) => {
            state.color = e.target.value;
            if (state.currentTool === 'eraser') switchToTool('pen');
        });

        sizeSlider.addEventListener('input', (e) => {
            state.size = parseInt(e.target.value);
            sizeDisplay.textContent = state.size;
        });

        brushShape.addEventListener('change', (e) => {
            state.shape = e.target.value;
        });

        // Layer Action
        btnAddLayer.addEventListener('click', () => addLayer(`Layer ${state.nextLayerId}`));

        // File Actions
        btnSave.addEventListener('click', saveProject);
        btnLoad.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', loadProject);

        // Zoom Actions
        btnZoomIn.addEventListener('click', () => updateZoom(state.zoom + 0.1));
        btnZoomOut.addEventListener('click', () => updateZoom(state.zoom - 0.1));
        btnZoomFit.addEventListener('click', () => updateZoom(1.0));

        // Wheel Zoom (Direct, no ctrl)
        workspace.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            updateZoom(state.zoom + delta);
        }, { passive: false });

        // Actions
        btnUndo.addEventListener('click', undo);
        btnClear.addEventListener('click', clearCurrentLayer);
        btnGenerate.addEventListener('click', generateCode);

        // Modal Actions
        btnCloseModal.addEventListener('click', () => modal.classList.add('hidden'));
        btnCopy.addEventListener('click', copyCode);

        // Shortcuts
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                undo();
            }
            if (e.key === 'p') switchToTool('pen');
            if (e.key === 'e') switchToTool('eraser');
            if (e.key === 'i') switchToTool('pipette');
        });

        // Canvas Wrapper Events (delegated to active layer logic) using Pointer Events for Pen support
        canvasWrapper.addEventListener('pointerdown', startDrawing);
        window.addEventListener('pointermove', draw);
        window.addEventListener('pointerup', stopDrawing);
        // Prevent default touch gestures
        canvasWrapper.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    }

    // --- Layer Management ---
    function addLayer(name) {
        const id = state.nextLayerId++;
        const canvas = document.createElement('canvas');
        canvas.width = CONFIG.width;
        canvas.height = CONFIG.height;
        canvas.id = `layer-${id}`;
        canvas.style.zIndex = id; // Simple z-index matching creation order for now

        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        // If it's the very first layer, fill white
        if (state.layers.length === 0) {
            ctx.fillStyle = CONFIG.bgColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        canvasWrapper.appendChild(canvas);

        const layerObj = { id, canvas, ctx, visible: true, name };
        state.layers.push(layerObj);

        setActiveLayer(id);
        renderLayerList();
        saveHistoryState(id); // Initial state
    }

    function setActiveLayer(id) {
        state.activeLayerId = id;
        renderLayerList();
    }

    function toggleLayerVisibility(id) {
        const layer = state.layers.find(l => l.id === id);
        if (layer) {
            layer.visible = !layer.visible;
            layer.canvas.style.display = layer.visible ? 'block' : 'none';
            renderLayerList();
        }
    }

    function deleteLayer(id) {
        if (state.layers.length <= 1) return; // Don't delete last layer

        const idx = state.layers.findIndex(l => l.id === id);
        if (idx !== -1) {
            const layer = state.layers[idx];
            layer.canvas.remove();
            state.layers.splice(idx, 1);

            // If we deleted active layer, pick a neighbor
            if (state.activeLayerId === id) {
                const newIdx = Math.max(0, idx - 1);
                setActiveLayer(state.layers[newIdx].id);
            } else {
                renderLayerList();
            }
        }
    }

    function renderLayerList() {
        layersList.innerHTML = '';
        // Render in reverse order (top layer at top of list)
        [...state.layers].reverse().forEach(layer => {
            const el = document.createElement('div');
            el.className = `layer-item ${layer.id === state.activeLayerId ? 'active' : ''}`;
            el.onclick = () => setActiveLayer(layer.id);

            const nameSpan = document.createElement('span');
            nameSpan.className = 'layer-name';
            nameSpan.textContent = layer.name;

            const controls = document.createElement('div');
            controls.className = 'layer-controls';

            const visBtn = document.createElement('button');
            visBtn.className = 'icon-btn';
            visBtn.innerHTML = layer.visible ? '<i class="fa-solid fa-eye"></i>' : '<i class="fa-solid fa-eye-slash"></i>';
            visBtn.onclick = (e) => {
                e.stopPropagation();
                toggleLayerVisibility(layer.id);
            };

            const delBtn = document.createElement('button');
            delBtn.className = 'icon-btn';
            delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                deleteLayer(layer.id);
            };

            controls.appendChild(visBtn);
            controls.appendChild(delBtn);

            el.appendChild(nameSpan);
            el.appendChild(controls);
            layersList.appendChild(el);
        });
    }

    function getActiveCtx() {
        const layer = state.layers.find(l => l.id === state.activeLayerId);
        return layer ? layer.ctx : null;
    }

    // --- Tool Logic ---

    function switchToTool(toolName) {
        state.currentTool = toolName;
        toolBtns.forEach(b => b.classList.remove('active'));
        if (toolName === 'pen') document.getElementById('tool-pen').classList.add('active');
        if (toolName === 'eraser') document.getElementById('tool-eraser').classList.add('active');
        if (toolName === 'pipette') document.getElementById('tool-pipette').classList.add('active');
    }

    function startDrawing(e) {
        // Pointer events: check for primary button (left click/pen tip)
        if (e.isPrimary === false || e.button !== 0) return;

        // Prevent default scrolling/selection behavior
        e.preventDefault();

        const ctx = getActiveCtx();
        if (!ctx) return;

        // Find if layer is visible?
        const layer = state.layers.find(l => l.id === state.activeLayerId);
        if (!layer.visible) return;

        // Use pressure if available (future proofing), for now just position
        // canvasWrapper.setPointerCapture(e.pointerId); // Keeps events on canvas even if moving out

        const { x, y } = getPos(e);
        state.isDrawing = true;
        state.lastX = x;
        state.lastY = y;

        // If pen supports pressure, we could modify size effectively here:
        // if (e.pressure && e.pointerType === 'pen') { ... }

        if (state.currentTool === 'pipette') {
            pickColorGlobal(x, y);
            state.isDrawing = false;
            return;
        }

        draw(e);
    }

    function draw(e) {
        if (!state.isDrawing) return;
        e.preventDefault();

        const ctx = getActiveCtx();
        if (!ctx) return;

        const { x, y } = getPos(e);

        ctx.beginPath();

        // Dynamic size with pressure?
        let size = state.size;
        if (e.pointerType === 'pen' && e.pressure > 0) {
            // Simple pressure sensitivity: 50% to 150% of size?
            // Or just 0 to 100%? User might prefer consistent lines if not requested.
            // User specifically asked for "pen tab support" usually implies pressure, 
            // BUT the request was "fix screen moving". I'll stick to fixed size for now to avoid surprises, 
            // OR add a toggle later. Let's keep it simple for now.
        }

        ctx.lineWidth = size;
        ctx.lineCap = state.shape === 'square' ? 'square' : 'round';
        ctx.lineJoin = state.shape === 'square' ? 'miter' : 'round';

        if (state.currentTool === 'eraser') {
            // "Eraser" in layered mode means clearing pixels to transparency
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = "rgba(0,0,0,1)";
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = state.color;
        }

        ctx.moveTo(state.lastX, state.lastY);
        ctx.lineTo(x, y);
        ctx.stroke();

        // Reset
        ctx.globalCompositeOperation = 'source-over';

        state.lastX = x;
        state.lastY = y;
    }

    function stopDrawing() {
        if (state.isDrawing) {
            state.isDrawing = false;
            saveHistoryState(state.activeLayerId);
        }
    }

    function getPos(e) {
        const rect = canvasWrapper.getBoundingClientRect();
        const scaleX = CONFIG.width / rect.width;
        const scaleY = CONFIG.height / rect.height;

        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    function updateZoom(newZoom) {
        // Clamp zoom
        state.zoom = Math.max(0.1, Math.min(newZoom, 5.0));
        state.zoom = Math.round(state.zoom * 10) / 10; // Round to 1 decimal

        // Apply
        canvasWrapper.style.width = `${CONFIG.width * state.zoom}px`;
        canvasWrapper.style.height = `${CONFIG.height * state.zoom}px`;

        zoomDisplay.textContent = `${Math.round(state.zoom * 100)}%`;
    }

    function pickColorGlobal(x, y) {
        // Need to flatten layers to pick color?
        // Or just pick from top-most visible non-transparent pixel.
        // For performance, let's just create a temporary canvas 1x1
        const tempC = document.createElement('canvas');
        tempC.width = 1;
        tempC.height = 1;
        const tCtx = tempC.getContext('2d');

        // Draw layers in order
        state.layers.forEach(l => {
            if (l.visible) {
                tCtx.drawImage(l.canvas, x, y, 1, 1, 0, 0, 1, 1);
            }
        });

        const data = tCtx.getImageData(0, 0, 1, 1).data;
        const hex = rgbToHex(data[0], data[1], data[2]);
        state.color = hex;
        colorPicker.value = hex;
        switchToTool('pen');
    }

    function rgbToHex(r, g, b) {
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    // --- History (Undo) ---
    // Storing { layerId, imgData }
    function saveHistoryState(layerId) {
        const idx = state.layers.findIndex(l => l.id === layerId);
        if (idx === -1) return;
        const layer = state.layers[idx];

        // Trim history if we branched
        if (state.historyStep < state.history.length - 1) {
            state.history = state.history.slice(0, state.historyStep + 1);
        }

        state.history.push({
            layerId: layerId,
            dataURL: layer.canvas.toDataURL()
        });

        state.historyStep++;
        if (state.history.length > state.maxHistory) {
            state.history.shift();
            state.historyStep--;
        }
    }

    function undo() {
        if (state.historyStep > 0) {
            // Current state is at historyStep. We need to go back to previous.
            // But wait, undo usually means "revert the last action".
            // The item at 'historyStep' is the STATE AFTER the action.
            // We need to restore the state BEFORE the action.
            // Simplified approach: just pop the stack?

            // Actually, better pattern:
            // 1. Pop current state (it's what we want to undo).
            // 2. Restore the previous state for that specific layer.

            const actionToUndo = state.history[state.historyStep];
            state.historyStep--;

            // Find the previous state for THIS layer
            let prevData = null;
            // Iterate backwards from current step
            for (let i = state.historyStep; i >= 0; i--) {
                if (state.history[i].layerId === actionToUndo.layerId) {
                    prevData = state.history[i].dataURL;
                    break;
                }
            }

            const layer = state.layers.find(l => l.id === actionToUndo.layerId);
            if (layer) {
                const img = new Image();
                if (prevData) {
                    img.src = prevData;
                    img.onload = () => {
                        layer.ctx.clearRect(0, 0, CONFIG.width, CONFIG.height);
                        layer.ctx.drawImage(img, 0, 0);
                    };
                } else {
                    // No previous history for this layer? Clear it?
                    // Or maybe it was the initial state.
                    // If it was creation, maybe we should've stored valid initial state.
                    // In init() we saved state. So there should be something.
                }
            }
        }
    }

    function clearCurrentLayer() {
        const ctx = getActiveCtx();
        if (ctx) {
            ctx.clearRect(0, 0, CONFIG.width, CONFIG.height);
            // If it's the bottom background layer, maybe fill white again?
            // Usually bottom layer is just a layer.
            // But if user wants transparent, clearRect is correct.
            saveHistoryState(state.activeLayerId);
        }
    }

    // --- Code Generation ---
    function generateCode() {
        const modal = document.getElementById('code-modal');
        const output = document.getElementById('code-output');

        modal.classList.remove('hidden');
        output.textContent = "Generating code... Merging layers...";

        setTimeout(() => {
            const code = processAllLayers();
            output.textContent = code;
        }, 100);
    }

    function processAllLayers() {
        // Flatten all visible layers onto a temp canvas
        const tempC = document.createElement('canvas');
        tempC.width = CONFIG.width;
        tempC.height = CONFIG.height;
        const tCtx = tempC.getContext('2d');

        // Fill white base first?
        tCtx.fillStyle = '#ffffff';
        tCtx.fillRect(0, 0, CONFIG.width, CONFIG.height);

        state.layers.forEach(l => {
            if (l.visible) {
                tCtx.drawImage(l.canvas, 0, 0);
            }
        });

        const imageData = tCtx.getImageData(0, 0, CONFIG.width, CONFIG.height);
        const data = imageData.data;

        let lines = [];
        lines.push(`function setup() {`);
        lines.push(`  createCanvas(${CONFIG.width}, ${CONFIG.height});`);
        lines.push(`}`);
        lines.push(``);
        lines.push(`function draw() {`);
        lines.push(`  background(280);`);
        lines.push(`  noStroke();`);
        lines.push(``);

        let lastR = -1, lastG = -1, lastB = -1;
        let rects = [];

        for (let y = 0; y < CONFIG.height; y++) {
            for (let x = 0; x < CONFIG.width; x++) {
                const i = (y * CONFIG.width + x) * 4;
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];

                // Assuming white background check
                if (r < 250 || g < 250 || b < 250) {
                    if (r !== lastR || g !== lastG || b !== lastB) {
                        rects.push(`  fill(${r}, ${g}, ${b});`);
                        lastR = r;
                        lastG = g;
                        lastB = b;
                    }
                    rects.push(`  rect(${x}, ${y}, 1);`);
                }
            }
        }

        lines = lines.concat(rects);
        lines.push(`}`);

        return lines.join('\n');
    }

    function copyCode() {
        const output = document.getElementById('code-output');
        navigator.clipboard.writeText(output.textContent).then(() => {
            const btn = document.getElementById('btn-copy');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-check"></i> きょぴぃぃぃぃぃ';
            setTimeout(() => {
                btn.innerHTML = originalText;
            }, 2000);
        });
    }

    // --- Save / Load System ---
    function saveProject() {
        const projectData = {
            version: 1,
            width: CONFIG.width,
            height: CONFIG.height,
            nextLayerId: state.nextLayerId,
            layers: state.layers.map(l => ({
                id: l.id,
                name: l.name,
                visible: l.visible,
                data: l.canvas.toDataURL()
            }))
        };

        const blob = new Blob([JSON.stringify(projectData)], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `paint_project_${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
    }

    function loadProject(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const project = JSON.parse(event.target.result);
                restoreProject(project);
            } catch (err) {
                alert("Failed to load project file.");
                console.error(err);
            }
        };
        reader.readAsText(file);
        // Reset input
        e.target.value = '';
    }

    function restoreProject(project) {
        // Clear all existing layers
        state.layers.forEach(l => l.canvas.remove());
        state.layers = [];
        layersList.innerHTML = '';
        state.nextLayerId = project.nextLayerId || 1;

        // Restore layers
        // We need to process sequentially because Image loading is async
        let loadedCount = 0;

        project.layers.forEach(lData => {
            const canvas = document.createElement('canvas');
            canvas.width = CONFIG.width;
            canvas.height = CONFIG.height;
            canvas.id = `layer-${lData.id}`;
            canvas.style.zIndex = lData.id;

            const ctx = canvas.getContext('2d', { willReadFrequently: true });

            const layerObj = {
                id: lData.id,
                canvas,
                ctx,
                visible: lData.visible,
                name: lData.name
            };

            if (!lData.visible) {
                canvas.style.display = 'none';
            }

            canvasWrapper.appendChild(canvas);
            state.layers.push(layerObj);

            // Load Image
            const img = new Image();
            img.src = lData.data;
            img.onload = () => {
                ctx.drawImage(img, 0, 0);
                loadedCount++;
                if (loadedCount === project.layers.length) {
                    // All loaded
                    // Sort layers by ID or render list based on saved order?
                    // The save logic saved them in order (Background 0 -> Top).
                    // Correct implementation should respect zIndex behavior.
                    renderLayerList();
                    // Set active to last layer
                    if (state.layers.length > 0) {
                        setActiveLayer(state.layers[state.layers.length - 1].id);
                    }
                }
            };
        });
    }

    init();
});
