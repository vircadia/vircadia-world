<template>
    <canvas v-if="props.engineType !== 'nullengine'" ref="canvasRef" id="renderCanvas"></canvas>

    <!-- Engine Info Overlay -->
    <div v-if="readyScene" class="engine-info-overlay" aria-label="Engine info">
        <span class="engine-info-overlay__text">{{ engineTypeDisplay }} • Havok • {{ drawCalls }} calls • {{ vertexCount
        }} verts • {{ currentFps }} FPS</span>
    </div>

    <slot :scene="readyScene" :canvas="canvasRef" :physicsEnabled="physicsEnabled"
        :physicsPluginName="physicsPluginName" :physicsError="physicsError" :gravity="gravityRef"
        :physicsEngineType="physicsEngineType" :physicsInitialized="physicsInitialized"
        :havokInstanceLoaded="havokInstanceLoaded" :physicsPluginCreated="physicsPluginCreated">
    </slot>
</template>

<script setup lang="ts">
import { ArcRotateCamera, Engine, NullEngine, Scene, Vector3, WebGPUEngine } from "@babylonjs/core";
import { DracoDecoder } from "@babylonjs/core/Meshes/Compression/dracoDecoder.js"
import { computed, onMounted, onUnmounted, ref, toRef, watch, type PropType } from "vue";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import HavokPhysics from "@babylonjs/havok";
import "@babylonjs/core/Physics/v2/physicsEngineComponent";

import DRACO_DECODER_GLTF_JS_URL from "@/assets/babylon_js/draco_decoder_gltf.js?url";
import DRACO_DECODER_GLTF_WASM_URL from "@/assets/babylon_js/draco_decoder_gltf.wasm?url";
import DRACO_WASM_WRAPPER_GLTF_JS_URL from "@/assets/babylon_js/draco_wasm_wrapper_gltf.js?url";

// Define models for two-way binding
const performanceMode = defineModel<"normal" | "low">("performanceMode", { default: "normal" });
const renderLoopEnabled = defineModel<boolean>("renderLoopEnabled", { default: true });

// Props for read-only values
const props = defineProps({
    targetFps: { type: Number, default: 30 },
    engineType: { type: String as () => "webgl" | "webgpu" | "nullengine", default: "webgpu" },
    gravity: { type: Array as unknown as PropType<[number, number, number]>, default: () => [0, -9.81, 0] },
    enablePhysics: { type: Boolean, default: true },
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

// Physics is initialized and managed by BabylonEnvironment.vue -> Moved here
let havokInstance: unknown | null = null;
let physicsPlugin: HavokPlugin | null = null;

const physicsError = ref<string | null>(null);
const physicsInitialized = ref(false);

const gravityRef = toRef(props, "gravity");

async function initializePhysicsIfNeeded(targetScene: Scene) {
    if (props.enablePhysics === false) return;

    if (targetScene.getPhysicsEngine?.()) {
        physicsInitialized.value = true;
        return;
    }

    try {
        physicsError.value = null;

        if (!havokInstance) {
            havokInstance = await HavokPhysics();
        }

        if (!physicsPlugin) {
            physicsPlugin = new HavokPlugin(true, havokInstance);
        }

        const g = gravityRef.value;
        const gravityVector = new Vector3(g[0], g[1], g[2]);
        targetScene.enablePhysics(gravityVector, physicsPlugin);

        // Wait briefly for the engine to attach before flagging initialized
        let tries = 0;
        while (!targetScene.getPhysicsEngine?.() && tries < 20) {
            await new Promise((r) => setTimeout(r, 50));
            tries++;
        }
        const engine = targetScene.getPhysicsEngine?.();
        if (engine) {
            physicsInitialized.value = true;
        } else {
            physicsError.value = "Physics engine not available after enable";
            physicsInitialized.value = false;
        }
    } catch (error: unknown) {
        try {
            const err = error as { message?: string } | string;
            physicsError.value =
                (typeof err === "string" ? err : err?.message) || "";
        } catch {
            physicsError.value = "Unknown physics init error";
        }
    }
}

const physicsEnabled = computed<boolean>(() => {
    // Force recomputation when initialization flag changes (engine is non-reactive)
    const initialized = physicsInitialized.value;
    const s = scene; // Use local scene ref
    if (!s) return false;
    const sceneWithPhysics = s as Scene & {
        getPhysicsEngine?: () => unknown | null;
        isPhysicsEnabled?: () => boolean;
    };
    const engine = sceneWithPhysics.getPhysicsEngine?.() ?? null;
    const isEnabled = sceneWithPhysics.isPhysicsEnabled?.() ?? false;
    return !!engine || isEnabled;
});

const physicsPluginName = computed<string>(() => {
    const initialized = physicsInitialized.value;
    const s = scene as unknown as {
        getPhysicsEngine?: () => unknown;
    } | null;
    const engineAny = (s?.getPhysicsEngine?.() ?? null) as unknown as {
        getPhysicsPluginName?: () => string | undefined;
    } | null;
    return engineAny?.getPhysicsPluginName?.() || (engineAny ? "Havok" : "");
});

const physicsEngineType = computed<string>(() => {
    const initialized = physicsInitialized.value;
    const s = scene as unknown as {
        getPhysicsEngine?: () => unknown;
    } | null;
    const engine = s?.getPhysicsEngine?.();
    return engine &&
        (engine as { constructor?: { name?: string } }).constructor?.name
        ? (engine as { constructor: { name: string } }).constructor.name
        : "";
});

const havokInstanceLoaded = computed<boolean>(() => !!havokInstance);
const physicsPluginCreated = computed<boolean>(() => !!physicsPlugin);

// Note: Physics is initialized in onMounted after scene creation

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

        // Initialize physics BEFORE setting scene as ready
        // This ensures child components have access to physics engine
        if (props.enablePhysics) {
            await initializePhysicsIfNeeded(scene);
        }

        // Track scene readiness reactively - only after physics is ready
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
            // Initial size
            engine.resize();

            // Replace window resize listener with ResizeObserver on the canvas parent
            // This handles internal layout changes (like drawers) and prevents infinite loops
            if (canvasRef.value && canvasRef.value.parentElement) {
                const resizeObserver = new ResizeObserver(() => {
                    handleResize();
                });
                resizeObserver.observe(canvasRef.value.parentElement);

                // Store observer to disconnect on unmount
                (canvasRef.value as any)._resizeObserver = resizeObserver;
            } else {
                window.addEventListener("resize", handleResize);
            }
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
    physicsError,
    physicsEnabled,
    physicsPluginName,
    physicsEngineType,
    physicsInitialized,
    havokInstanceLoaded,
    physicsPluginCreated,
    gravity: gravityRef,
})

onUnmounted(() => {
    if (props.engineType !== "nullengine") {
        if (canvasRef.value && (canvasRef.value as any)._resizeObserver) {
            (canvasRef.value as any)._resizeObserver.disconnect();
        } else {
            window.removeEventListener("resize", handleResize);
        }
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
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
    outline: none;
}
</style>
