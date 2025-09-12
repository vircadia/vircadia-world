<template>
  <canvas ref="canvasRef" id="renderCanvas"></canvas>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, toRef, nextTick } from "vue";
import {
    Scene,
    Vector3,
    HemisphericLight,
    WebGPUEngine,
    DirectionalLight,
    ArcRotateCamera,
    MeshBuilder,
    StandardMaterial,
    Color3,
    PhysicsAggregate,
    PhysicsShapeType,
    HavokPlugin,
} from "@babylonjs/core";

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

// Physics
let havokInstance = null;
let physicsPlugin = null;

async function initializePhysics(targetScene, gravityVector) {
    try {
        if (!havokInstance) {
            const HavokPhysics = (await import("@babylonjs/havok")).default;
            havokInstance = await HavokPhysics();
        }
        physicsPlugin = new HavokPlugin(true, havokInstance);
        const enabled = targetScene.enablePhysics(gravityVector, physicsPlugin);
        return enabled;
    } catch (error) {
        console.error("Error initializing physics engine:", error);
        return false;
    }
}

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
                emit("update:fps", currentFps);
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
                    emit("update:fps", currentFps);
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

        // Basic camera and lighting
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

        // Basic lighting
        new HemisphericLight("light", new Vector3(1, 1, 0), scene);
        const directionalLight = new DirectionalLight(
            "directionalLight",
            new Vector3(-1, -2, -1),
            scene,
        );
        directionalLight.position = new Vector3(10, 10, 10);
        directionalLight.intensity = 1.0;

        // Physics and ground
        const gravityVector = new Vector3(0, -9.81, 0);
        const physicsEnabled = await initializePhysics(scene, gravityVector);
        if (physicsEnabled) {
            const ground = MeshBuilder.CreateGround(
                "ground",
                { width: 1000, height: 1000 },
                scene,
            );
            ground.position = new Vector3(0, -1, 0);

            const groundMaterial = new StandardMaterial(
                "groundMaterial",
                scene,
            );
            groundMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2);
            groundMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
            ground.material = groundMaterial;

            new PhysicsAggregate(
                ground,
                PhysicsShapeType.BOX,
                { mass: 0, friction: 0.5, restitution: 0.3 },
                scene,
            );
        }

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


