<template>
    <canvas ref="canvasRef" id="renderCanvas"></canvas>
</template>

<script setup>
import { ArcRotateCamera, Scene, Vector3, WebGPUEngine } from "@babylonjs/core";
import { nextTick, onMounted, onUnmounted, ref, toRef, watch } from "vue";

const props = defineProps({
    performanceMode: { type: String, default: "low" },
    targetFps: { type: Number, default: 30 },
    // for v-model:fps from parent
    fps: { type: Number, default: 0 },
});

const emit = defineEmits(["update:performanceMode", "update:fps", "ready"]);

// Internal refs
const canvasRef = ref(null);
let engine = null;
let scene = null;
const isReady = ref(false);
let resizeRaf = 0;

// Physics is initialized and managed by BabylonEnvironment.vue

function handleResize() {
    if (!engine) return;
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        // Avoid resizing while commands for the previous frame may still reference old swapchain
        engine.resize();
    });
}

// Render loop control
let isRenderLoopRunning = false;
let lastFrameTime = 0;
let lastFpsEmitTime = 0;

function getCurrentPerformanceMode() {
    return props.performanceMode ?? "low";
}

function getCurrentTargetFps() {
    return props.targetFps ?? 30;
}

function startRenderLoop() {
    if (!engine || !scene) return;
    if (isRenderLoopRunning) {
        // restart to apply any changes
        engine.stopRenderLoop();
    }

    // Resize is handled on mount and via rAF-throttled window resize

    const mode = getCurrentPerformanceMode();
    if (mode === "normal") {
        engine.runRenderLoop(() => {
            scene?.render();
            // throttle FPS emit to ~2Hz
            const now = performance.now();
            if (now - lastFpsEmitTime >= 500) {
                const currentFps = Math.round(engine.getFps());
                // Defer FPS update to avoid recursive updates
                nextTick(() => {
                    emit("update:fps", currentFps);
                });
                lastFpsEmitTime = now;
            }
        });
    } else {
        const frameInterval = 1000 / Math.max(1, getCurrentTargetFps());
        lastFrameTime = 0;
        engine.runRenderLoop(() => {
            const currentTime = performance.now();
            const deltaTime = currentTime - lastFrameTime;
            if (deltaTime >= frameInterval) {
                scene?.render();
                lastFrameTime = currentTime - (deltaTime % frameInterval);
                // throttle FPS emit to ~2Hz
                if (currentTime - lastFpsEmitTime >= 500) {
                    const currentFps = Math.round(engine.getFps());
                    // Defer FPS update to avoid recursive updates
                    nextTick(() => {
                        emit("update:fps", currentFps);
                    });
                    lastFpsEmitTime = currentTime;
                }
            }
        });
    }

    isRenderLoopRunning = true;
}

function stopRenderLoop() {
    if (!engine) return;
    engine.stopRenderLoop();
    isRenderLoopRunning = false;
}

function setPerformanceMode(mode) {
    emit("update:performanceMode", mode);
    if (isRenderLoopRunning) {
        // restart loop with new settings
        stopRenderLoop();
        startRenderLoop();
    }
}

function togglePerformanceMode() {
    const next = getCurrentPerformanceMode() === "normal" ? "low" : "normal";
    setPerformanceMode(next);
}

// React to external performance prop changes
watch(toRef(props, "performanceMode"), () => {
    if (isRenderLoopRunning) {
        stopRenderLoop();
        startRenderLoop();
    }
});

watch(toRef(props, "targetFps"), () => {
    if (getCurrentPerformanceMode() === "low" && isRenderLoopRunning) {
        stopRenderLoop();
        startRenderLoop();
    }
});

// Exposed API to parent/components via ref
const api = {
    getScene: () => scene,
    getEngine: () => engine,
    getCanvas: () => canvasRef.value,
    getFps: () => (engine ? engine.getFps() : 0),
    getPerformanceMode: () => getCurrentPerformanceMode(),
    getIsReady: () => isReady.value,
    startRenderLoop,
    stopRenderLoop,
    togglePerformanceMode,
    setPerformanceMode,
};

defineExpose(api);

onMounted(async () => {
    await nextTick();

    if (!canvasRef.value) {
        console.error("Canvas not found.");
        return;
    }

    try {
        // Try WebGPU first
        const adapter = await navigator.gpu?.requestAdapter();
        if (adapter) {
            engine = new WebGPUEngine(canvasRef.value, {
                antialias: true,
                adaptToDeviceRatio: true,
            });
            await engine.initAsync();
        } else {
            throw new Error("WebGPU adapter not available");
        }

        scene = new Scene(engine);

        // Basic camera
        const defaultCamera = new ArcRotateCamera(
            "defaultCamera",
            -Math.PI / 2,
            Math.PI / 3,
            8,
            new Vector3(0, 1, 0),
            scene,
        );
        defaultCamera.attachControl(canvasRef.value, true);
        scene.activeCamera = defaultCamera;

        // Sizing
        window.addEventListener("resize", handleResize);
        // Initial size
        engine.resize();

        // Start rendering immediately so scene is visible without waiting for parent
        startRenderLoop();

        // Mark ready and notify parent for backward compatibility
        isReady.value = true;
        emit("ready", { scene, engine, canvas: canvasRef.value, api });
    } catch (error) {
        console.error(
            "WebGPU initialization failed; fallback is disabled.",
            error,
        );
    }
});

onUnmounted(() => {
    window.removeEventListener("resize", handleResize);
    stopRenderLoop();
    scene?.dispose();
    engine?.dispose();
    scene = null;
    engine = null;
    isReady.value = false;
});
</script>

<style scoped>
#renderCanvas {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
    outline: none;
}
</style>
