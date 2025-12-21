<template>
    <canvas v-if="props.engineType !== 'nullengine'" ref="canvasRef" id="renderCanvas"></canvas>

    <!-- Engine Info Overlay -->
    <div v-if="readyScene" class="engine-info-overlay" aria-label="Engine info">
        <span class="engine-info-overlay__text">{{ engineTypeDisplay }} • Havok • {{ drawCalls }} calls • {{ vertexCount
            }} verts • {{ currentFps }} FPS</span>
    </div>

    <slot :scene="readyScene" :canvas="canvasRef">
    </slot>
</template>

<script setup lang="ts">
import { ArcRotateCamera, Engine, NullEngine, Scene, Vector3, WebGPUEngine, Constants } from "@babylonjs/core";
import { DracoDecoder } from "@babylonjs/core/Meshes/Compression/dracoDecoder.js"
import { computed, onMounted, onUnmounted, ref, toRef, watch } from "vue";

import DRACO_DECODER_GLTF_JS_URL from "@/assets/babylon_js/draco_decoder_gltf.js?url";
import DRACO_DECODER_GLTF_WASM_URL from "@/assets/babylon_js/draco_decoder_gltf.wasm?url";
import DRACO_WASM_WRAPPER_GLTF_JS_URL from "@/assets/babylon_js/draco_wasm_wrapper_gltf.js?url";

// Define models for two-way binding
const performanceMode = defineModel<"normal" | "low">("performanceMode", { default: "low" });
const renderLoopEnabled = defineModel<boolean>("renderLoopEnabled", { default: true });

// Props for read-only values
const props = defineProps({
    targetFps: { type: Number, default: 30 },
    engineType: { type: String as () => "webgl" | "webgpu" | "nullengine", default: "webgpu" },
});

// Internal refs
const canvasRef = ref<HTMLCanvasElement | null>(null);
let webGlEngine: Engine | null = null;
let webGpuEngine: WebGPUEngine | null = null;
let nullEngine: NullEngine | null = null;
let scene: Scene | null = null;
let resizeRaf = 0;
const sceneReady = ref(false);
const readyScene = computed(() => sceneReady.value ? scene : null);

// Engine stats refs
const drawCalls = ref(0);
const vertexCount = ref(0);
const currentFps = ref(0);

// Computed properties for engine info
const engineTypeDisplay = computed(() => {
    if (webGpuEngine) return "WebGPU";
    if (webGlEngine) return "WebGL";
    if (nullEngine) return "Null";
    return "Unknown";
});

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
        } else if (nullEngine) {
            nullEngine.resize();
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

function updateEngineStats() {
    if (!scene) return;

    const engine = webGlEngine ?? webGpuEngine ?? nullEngine;
    if (!engine) return;

    // Update FPS
    currentFps.value = Math.round(engine.getFps());

    // Update draw calls and vertex count
    let totalDrawCalls = 0;
    let totalVertices = 0;

    scene.meshes.forEach(mesh => {
        if (mesh.isVisible && mesh.isEnabled()) {
            // Count submeshes as draw calls
            if (mesh.subMeshes) {
                totalDrawCalls += mesh.subMeshes.length;
            } else {
                totalDrawCalls += 1;
            }

            // Count vertices
            if (mesh.getTotalVertices) {
                totalVertices += mesh.getTotalVertices();
            }
        }
    });

    drawCalls.value = totalDrawCalls;
    vertexCount.value = totalVertices;
}

function startRenderLoop() {
    if (!scene) throw new Error("Scene not found");
    const engine = webGlEngine ?? webGpuEngine ?? nullEngine;
    if (!engine) throw new Error("Engine not found");
    if (isRenderLoopRunning) {
        // restart to apply any changes
        engine.stopRenderLoop();
    }
    const mode = getCurrentPerformanceMode();
    if (mode === "normal") {
        engine.runRenderLoop(() => {
            scene?.render();
            updateEngineStats();
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
                updateEngineStats();
                lastFrameTime = currentTime - (deltaTime % frameInterval);
            }
        });
    }

    isRenderLoopRunning = true;
}

function stopRenderLoop() {
    const engine = webGlEngine ?? webGpuEngine ?? nullEngine;
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
    try {
        DracoDecoder.DefaultConfiguration.wasmUrl = DRACO_WASM_WRAPPER_GLTF_JS_URL
        DracoDecoder.DefaultConfiguration.wasmBinaryUrl = DRACO_DECODER_GLTF_WASM_URL
        DracoDecoder.DefaultConfiguration.fallbackUrl = DRACO_DECODER_GLTF_JS_URL

        // Use engine type from prop (passed from MainScene based on autonomous agent state)
        if (props.engineType === "nullengine") {
            // NullEngine doesn't need a canvas element - perfect for headless/automated agents
            nullEngine = new NullEngine();
        } else {
            // For webgl and webgpu, we need a canvas element
            if (!canvasRef.value) {
                throw new Error("Canvas not found.");
            }

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
        }

        if (!webGlEngine && !webGpuEngine && !nullEngine) throw new Error("Engine not created");
        const engine = webGlEngine ?? webGpuEngine ?? nullEngine;
        if (!engine) throw new Error("Engine not found");

        scene = new Scene(engine);
        // Track scene readiness reactively
        scene.executeWhenReady(() => {
            sceneReady.value = true;
        });

        // WebGPU Compatibility Fix: Enforce NEAREST sampling for float textures
        // This is critical for Global Illumination (RSM) and other WebGPU features that use Float32 textures.
        // WebGPU throws validation errors if Float32 textures are sampled with filtering (LINEAR)
        // unless specific features are enabled/supported, which BabylonJS's GI implementation might not fully handle by default yet.
        scene.onNewTextureAddedObservable.add((texture) => {
            // Apply this fix specifically for WebGPU engine, or generally if we want to be safe.
            // Since we know the user is targeting WebGPU and experiencing "UnfilterableFloat" errors,
            // we force NEAREST sampling on new textures.
            // This catches RSM buffers (Flux, Normal, Position) before they cause validation errors.
            texture.updateSamplingMode(Constants.TEXTURE_NEAREST_SAMPLINGMODE);
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
        // Only attach camera controls if we have a canvas
        if (canvasRef.value) {
            defaultCamera.attachControl(canvasRef.value, true);
        }
        scene.activeCamera = defaultCamera;

        // Ensure all meshes receive lighting by default
        // Watch for new meshes added to the scene and ensure they receive lighting
        scene.onNewMeshAddedObservable.add((mesh) => {
            // Ensure mesh layer mask allows it to receive lighting (default is 0xFFFFFFFF, but ensure it's set)
            // Layer mask 0 means no layers, which would exclude from lighting
            if (mesh.layerMask === 0) {
                mesh.layerMask = 0xFFFFFFFF; // All layers - ensures mesh receives all lights
            }
        });

        // Sizing (only needed for visual engines)
        if (props.engineType !== "nullengine") {
            window.addEventListener("resize", handleResize);
            // Initial size
            engine.resize();
        }

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
    if (props.engineType !== "nullengine") {
        window.removeEventListener("resize", handleResize);
    }
    stopRenderLoop();
    scene?.dispose();
    webGlEngine?.dispose();
    webGpuEngine?.dispose();
    nullEngine?.dispose();
    scene = null;
    webGlEngine = null;
    webGpuEngine = null;
    nullEngine = null;
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
