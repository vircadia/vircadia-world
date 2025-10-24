<template>
    <canvas ref="canvasRef" id="renderCanvas"></canvas>
    <slot :scene="readyScene" :canvas="canvasRef">
    </slot>
</template>

<script setup lang="ts">
import { ArcRotateCamera, Engine, Scene, Vector3, WebGPUEngine } from "@babylonjs/core";
import { computed, onMounted, onUnmounted, ref, toRef, watch } from "vue";

// Define models for two-way binding
const performanceMode = defineModel<"normal" | "low">("performanceMode", { default: "low" });
const renderLoopEnabled = defineModel<boolean>("renderLoopEnabled", { default: true });

// Props for read-only values
const props = defineProps({
    targetFps: { type: Number, default: 30 },
    engineType: { type: String as () => "webgl" | "webgpu", default: "webgpu" },
});

// Internal refs
const canvasRef = ref<HTMLCanvasElement | null>(null);
let webGlEngine: Engine | null = null;
let webGpuEngine: WebGPUEngine | null = null;
let scene: Scene | null = null;
let resizeRaf = 0;
const sceneReady = ref(false);
const readyScene = computed(() => sceneReady.value ? scene : null);

// Physics is initialized and managed by BabylonEnvironment.vue

function handleResize() {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
        if (webGlEngine) {
            webGlEngine.resize();
            resizeRaf = 0;
        } else if (webGpuEngine) {
            webGpuEngine.resize();
            resizeRaf = 0;
        } else {
            throw new Error("Engine not found");
        }
    });
}

// Render loop control
let isRenderLoopRunning = false;
let lastFrameTime = 0;

function getCurrentPerformanceMode() {
    return performanceMode.value ?? "low";
}

function getCurrentTargetFps() {
    return props.targetFps ?? 30;
}

function startRenderLoop() {
    if (!scene) throw new Error("Scene not found");
    const engine = webGlEngine ?? webGpuEngine;
    if (!engine) throw new Error("Engine not found");
    if (isRenderLoopRunning) {
        // restart to apply any changes
        engine.stopRenderLoop();
    }
    const mode = getCurrentPerformanceMode();
    if (mode === "normal") {
        engine.runRenderLoop(() => {
            scene?.render();
        });
    } else {
        const frameInterval = 1000 / Math.max(1, getCurrentTargetFps());
        lastFrameTime = 0;
        engine.runRenderLoop(() => {
            if (!engine) throw new Error("Engine not found");
            const currentTime = performance.now();
            const deltaTime = currentTime - lastFrameTime;
            if (deltaTime >= frameInterval) {
                scene?.render();
                lastFrameTime = currentTime - (deltaTime % frameInterval);
            }
        });
    }

    isRenderLoopRunning = true;
}

function stopRenderLoop() {
    const engine = webGlEngine ?? webGpuEngine;
    if (!engine) throw new Error("Engine not found");
    engine.stopRenderLoop();
    isRenderLoopRunning = false;
}

// React to external performance mode changes
watch(performanceMode, () => {
    if (isRenderLoopRunning) {
        stopRenderLoop();
        startRenderLoop();
    }
});

// React to render loop enabled changes
watch(renderLoopEnabled, (enabled) => {
    if (enabled && !isRenderLoopRunning) {
        startRenderLoop();
    } else if (!enabled && isRenderLoopRunning) {
        stopRenderLoop();
    }
});

watch(toRef(props, "targetFps"), () => {
    if (getCurrentPerformanceMode() === "low" && isRenderLoopRunning) {
        stopRenderLoop();
        startRenderLoop();
    }
});

onMounted(async () => {
    if (!canvasRef.value) {
        throw new Error("Canvas not found.");
    }

    try {
        // Use engine type from prop (passed from MainScene based on autonomous agent state)
        if (props.engineType === "webgl") {
            webGlEngine = new Engine(canvasRef.value, true, {
                antialias: true,
                adaptToDeviceRatio: true,
                preserveDrawingBuffer: false,
                stencil: true,
            });
        } else {
            // Try WebGPU first
            const adapter = await navigator.gpu?.requestAdapter();
            if (adapter) {
                const webgpu = new WebGPUEngine(canvasRef.value, {
                    antialias: true,
                    adaptToDeviceRatio: true,
                });
                await webgpu.initAsync();
                webGpuEngine = webgpu;
            } else {
                // Fallback to WebGL if WebGPU is not available
                webGlEngine = new Engine(canvasRef.value, true, {
                    antialias: true,
                    adaptToDeviceRatio: true,
                    preserveDrawingBuffer: false,
                    stencil: true,
                });
            }
        }

        if (!webGlEngine && !webGpuEngine) throw new Error("Engine not created");
        const engine = webGlEngine ?? webGpuEngine;
        if (!engine) throw new Error("Engine not found");

        scene = new Scene(engine);
        // Track scene readiness reactively
        scene.executeWhenReady(() => {
            sceneReady.value = true;
        });

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
    } catch (error) {
        console.error(
            "BabylonCanvas initialization failed.",
            error,
        );
    }
});

defineExpose({
    get scene() { return readyScene.value ?? null },
    get canvas() { return canvasRef.value ?? null },
})

onUnmounted(() => {
    window.removeEventListener("resize", handleResize);
    stopRenderLoop();
    scene?.dispose();
    webGlEngine?.dispose();
    webGpuEngine?.dispose();
    scene = null;
    webGlEngine = null;
    webGpuEngine = null;
    sceneReady.value = false;
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
