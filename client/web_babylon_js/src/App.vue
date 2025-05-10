<template>
    <main>
        <div v-if="connectionStatus === 'connecting'" class="connection-status">
            Connecting to Vircadia server...
        </div>
        <div v-if="connectionStatus === 'disconnected'" class="connection-status">
            Disconnected from Vircadia server. Will attempt to reconnect...
        </div>
        <canvas ref="renderCanvas" id="renderCanvas"></canvas>
        
        <!-- Entities loading indicator -->
        <div v-if="isLoading" class="overlay loading-indicator">
            Loading assets or creating entities...
        </div>
        
        <!-- Only render entities when scene is available -->
        <template v-if="sceneInitialized && scene && connectionStatus === 'connected'">
            <!-- Add PhysicsAvatar component -->
            <PhysicsAvatar
                :scene="scene"
                entity-name="physics.avatar.entity"
                :initial-position="{ x: 0, y: 1, z: 4 }"
                :initial-rotation="{ x: 0, y: 0, z: 0, w: 1 }"
                :initial-camera-orientation="{ alpha: -Math.PI/2, beta: Math.PI/3, radius: 5 }"
                @ready="startRenderLoop"
                ref="avatarRef"
            />
            
            <BabylonModel
                v-for="(model, index) in modelDefinitions"
                :key="model.fileName"
                :scene="scene"
                :fileName="model.fileName"
                :position="model.position"
                :rotation="model.rotation"
                :throttle-interval="model.throttleInterval"
                :enable-physics="model.enablePhysics"
                :physics-type="model.physicsType"
                :physics-options="model.physicsOptions"
                :ref="(el: any) => modelRefs[index] = el"
            />
        </template>
    </main>
</template>

<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-unused-vars */
import { inject, computed, watch, ref, onMounted, onUnmounted } from "vue";
import BabylonModel from "./components/BabylonModel.vue";
import PhysicsAvatar from "./components/PhysicsAvatar.vue";
import type { BabylonModelDefinition } from "./components/BabylonModel.vue";
import {
    Scene,
    Vector3,
    HemisphericLight,
    WebGPUEngine,
    DirectionalLight,
    MeshBuilder,
    StandardMaterial,
    Color3,
    PhysicsAggregate,
    PhysicsShapeType,
    HavokPlugin,
} from "@babylonjs/core";
import { useVircadiaContext } from "@/composables/useVircadiaContext";
import { useEnvironmentLoader } from "./composables/useEnvironmentLoader";

const { connectionStatus } = useVircadiaContext();

// BabylonJS Setup - use variables instead of refs
const renderCanvas = ref<HTMLCanvasElement | null>(null);
// Using regular variables instead of refs for non-reactive engine and scene
let engine: WebGPUEngine | null = null;
let scene: Scene | null = null;
// Track if scene is initialized for template rendering
const sceneInitialized = ref(false);
// Track inspector state
const isInspectorVisible = ref(false);
// Track if avatar is ready
const avatarRef = ref<InstanceType<typeof PhysicsAvatar> | null>(null);

// Inline physics initialization and inspector helpers
let havokInstance: unknown = null;
let physicsPlugin: HavokPlugin | null = null;

const initializePhysics = async (
    scene: Scene,
    gravityVector: Vector3,
): Promise<boolean> => {
    try {
        if (!havokInstance) {
            const HavokPhysics = (await import("@babylonjs/havok")).default;
            havokInstance = await HavokPhysics();
        }
        physicsPlugin = new HavokPlugin(true, havokInstance);
        const enabled = scene.enablePhysics(gravityVector, physicsPlugin);
        console.log("Physics engine initialized:", enabled);
        return enabled;
    } catch (error) {
        console.error("Error initializing physics engine:", error);
        return false;
    }
};

const loadInspector = async (scene: Scene): Promise<void> => {
    if (import.meta.env.DEV) {
        await import("@babylonjs/inspector");
        scene.debugLayer.show({ embedMode: true });
        return;
    }
    console.warn("Inspector is only available in development mode");
};

const hideInspector = (scene: Scene): void => {
    scene.debugLayer.hide();
};

// Add function to toggle the inspector
const toggleInspector = async (): Promise<void> => {
    if (!scene) return;
    if (!isInspectorVisible.value) {
        await loadInspector(scene);
        isInspectorVisible.value = true;
    } else {
        hideInspector(scene);
        isInspectorVisible.value = false;
    }
};

// Start the render loop after avatar is ready
const startRenderLoop = () => {
    if (!engine || !scene) return;

    console.log("Starting render loop after avatar is ready");
    engine.runRenderLoop(() => scene?.render());
};

// Keyboard event handler for inspector toggle
const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "t" && scene) {
        toggleInspector();
    }
};

const { loadAll: loadEnvironments, isLoading: environmentLoading } =
    useEnvironmentLoader(["babylon.level.test.hdr.1k.hdr"]);

const modelDefinitions = ref<BabylonModelDefinition[]>([
    {
        fileName: "babylon.level.test.glb",
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        throttleInterval: 10,
        enablePhysics: true,
        physicsType: "mesh",
        physicsOptions: {
            mass: 0,
            friction: 0.5,
            restitution: 0.3,
        },
    },
]);

// Store references to model components
const modelRefs = ref<(InstanceType<typeof BabylonModel> | null)[]>([]);

// Simplified loading state from all model components and environment loading
const isLoading = computed(() => {
    return (
        modelRefs.value.some((ref) => ref?.isLoading) ||
        environmentLoading.value
    );
});

// Initialize BabylonJS
const initializeBabylon = async () => {
    if (!(await navigator.gpu?.requestAdapter())) {
        console.error("WebGPU not supported.");
        return false;
    }

    if (!renderCanvas.value) {
        console.error("Canvas not found.");
        return false;
    }

    console.log("Initializing BabylonJS with WebGPU...");
    try {
        engine = new WebGPUEngine(renderCanvas.value, {
            antialias: true,
            adaptToDeviceRatio: true,
        });

        await engine.initAsync();

        scene = new Scene(engine);

        // Create light
        new HemisphericLight("light", new Vector3(1, 1, 0), scene);

        // Create a directional light for shadows
        const directionalLight = new DirectionalLight(
            "directionalLight",
            new Vector3(-1, -2, -1),
            scene,
        );
        directionalLight.position = new Vector3(10, 10, 10);
        directionalLight.intensity = 1.0;

        // Initialize physics first
        const gravityVector = new Vector3(0, -9.81, 0);
        const physicsEnabled = await initializePhysics(scene, gravityVector);

        if (physicsEnabled) {
            // Create a large ground plane after physics is initialized
            const ground = MeshBuilder.CreateGround(
                "ground",
                { width: 1000, height: 1000 },
                scene,
            );
            ground.position = new Vector3(0, -1, 0);

            // Add material to the ground
            const groundMaterial = new StandardMaterial(
                "groundMaterial",
                scene,
            );
            groundMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2);
            groundMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
            ground.material = groundMaterial;

            // Create a physics aggregate for the ground instead of using impostor
            new PhysicsAggregate(
                ground,
                PhysicsShapeType.BOX,
                { mass: 0, friction: 0.5, restitution: 0.3 },
                scene,
            );

            console.log("Ground plane created with physics");
        }

        // Note: We no longer start the render loop here
        // The render loop will be started when PhysicsAvatar is ready
        window.addEventListener("resize", handleResize);

        // Set scene initialized flag to true
        sceneInitialized.value = true;

        console.log("BabylonJS initialized successfully.");
        return true;
    } catch (error) {
        console.error("Error initializing BabylonJS:", error);
        return false;
    }
};

const handleResize = () => engine?.resize();

onMounted(async () => {
    await initializeBabylon();

    // Initialize model refs array
    modelRefs.value = Array(modelDefinitions.value.length).fill(null);

    // Add keyboard event listener for inspector toggle
    window.addEventListener("keydown", handleKeyDown);
});

onUnmounted(() => {
    window.removeEventListener("resize", handleResize);
    // Remove keyboard event listener
    window.removeEventListener("keydown", handleKeyDown);
    console.log("Disposing BabylonJS scene and engine...");
    scene?.dispose();
    engine?.dispose();
    scene = null;
    engine = null;
    sceneInitialized.value = false;
});

// Combined watcher for connection status and scene initialization
watch(
    [() => connectionStatus.value, () => sceneInitialized.value],
    ([status, initialized], [prevStatus, prevInitialized]) => {
        // Log connection status changes
        if (status !== prevStatus) {
            if (status === "connected") {
                console.log("Connected to Vircadia server");
            } else if (status === "disconnected") {
                console.log("Disconnected from Vircadia server");
            } else if (status === "connecting") {
                console.log("Connecting to Vircadia server...");
            }
        }
        // Load environments when scene is initialized and connected
        if (initialized && status === "connected" && scene) {
            loadEnvironments(scene);
        }
    },
);
</script>

<style>
html, body {
    margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background-color: #202020;
}
main {
    padding: 0; margin: 0; width: 100vw; height: 100vh; overflow: hidden; display: flex; position: relative;
}
#renderCanvas {
    width: 100%; height: 100%; display: block; touch-action: none; outline: none;
}
.connection-status {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background-color: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 20px;
    border-radius: 5px;
    font-family: sans-serif;
    text-align: center;
}
.connection-status.error {
    background-color: rgba(120, 0, 0, 0.7);
}
.overlay {
    position: absolute; left: 10px; color: white; background: rgba(0,0,0,0.7); padding: 8px; border-radius: 4px; font-family: sans-serif; font-size: 14px; z-index: 10; /* Ensure overlay is on top */
}
.loading-indicator {
    top: 10px;
}
</style>
