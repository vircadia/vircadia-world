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
        <template v-if="sceneInitialized && scene">
            <!-- Add PhysicsAvatar component -->
            <PhysicsAvatar
                :scene="scene"
                :position="{ x: 0, y: 2, z: 0 }"
                :capsule-height="1.8"
                :capsule-radius="0.3"
                :step-offset="0.4"
                :slope-limit="45"
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
                :physics-type="model.physicsType"
                :physics-options="model.physicsOptions"
                :ref="(el: any) => modelRefs[index] = el"
            />
        </template>
    </main>
</template>

<script setup lang="ts">
import { inject, computed, watch, ref, onMounted, onUnmounted } from "vue";
import { getInstanceKey } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/provider/useVircadia";
import BabylonModel from "./components/BabylonModel.vue";
import PhysicsAvatar from "./components/PhysicsAvatar.vue";
import type { BabylonModelDefinition } from "./components/BabylonModel.vue";
import {
    Scene,
    Vector3,
    HemisphericLight,
    WebGPUEngine,
    HDRCubeTexture,
    DirectionalLight,
    HavokPlugin,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import "@babylonjs/inspector";
import HavokPhysics from "@babylonjs/havok";
import { useVircadiaAsset } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/composable/useVircadiaAsset";

// Get the existing Vircadia connection from main.ts with proper typing
const vircadiaWorld = inject(getInstanceKey("vircadiaWorld"));
if (!vircadiaWorld) {
    throw new Error("Vircadia instance not found.");
}

// Safely compute the connection status with a fallback
const connectionStatus = computed(
    () => vircadiaWorld?.connectionInfo?.value?.status || "disconnected",
);

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

// Add function to toggle the inspector
const toggleInspector = () => {
    if (!scene) return;

    if (!isInspectorVisible.value) {
        scene.debugLayer.show({
            embedMode: true,
        });
        isInspectorVisible.value = true;
    } else {
        scene.debugLayer.hide();
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

const modelDefinitions = ref<BabylonModelDefinition[]>([
    {
        fileName: "telekom.model.Room.glb",
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        throttleInterval: 1000,
        physicsType: "mesh",
        physicsOptions: {
            mass: 0, // 0 mass makes it static
            friction: 0.5,
            restitution: 0.3,
        },
    },
    // Add more assets here
]);

interface EnvironmentAsset {
    fileName: string;
    type: "hdr" | "skybox";
}

const environmentAssets = ref<EnvironmentAsset[]>([
    {
        fileName: "telekom.skybox.Room.hdr.1k.hdr",
        type: "hdr",
    },
]);

// Loading state for environment assets
const environmentLoading = ref(false);

// Store references to model components
const modelRefs = ref<(InstanceType<typeof BabylonModel> | null)[]>([]);

// Simplified loading state from all model components and environment loading
const isLoading = computed(() => {
    return (
        modelRefs.value.some((ref) => ref?.isLoading) ||
        environmentLoading.value
    );
});

// Initialize physics engine
const initPhysics = async (scene: Scene) => {
    try {
        const havokInstance = await HavokPhysics();
        // pass the engine to the plugin
        const hk = new HavokPlugin(true, havokInstance);
        const gravityVector = new Vector3(0, -9.81, 0);
        scene.enablePhysics(gravityVector, hk);

        console.log("Physics engine initialized successfully");
        return true;
    } catch (error) {
        console.error("Error initializing physics engine:", error);
        return false;
    }
};

// Load environment assets
const loadEnvironments = async () => {
    if (!scene || environmentLoading.value) return;

    environmentLoading.value = true;

    try {
        // Directly use hardcoded HDR filename
        const hdrFileName = "telekom.skybox.Room.hdr.1k.hdr";

        try {
            const assetResult = await useVircadiaAsset({
                fileName: ref(hdrFileName),
                instance: vircadiaWorld,
            });

            // Call executeLoad() explicitly to load the asset
            await assetResult.executeLoad();

            if (!assetResult.assetData.value?.blobUrl) {
                console.error(
                    `Failed to load environment asset: ${hdrFileName}`,
                );
                return;
            }

            const blobUrl = assetResult.assetData.value.blobUrl;

            // Create an HDR environment
            const hdrTexture = new HDRCubeTexture(
                blobUrl,
                scene,
                512,
                false,
                true,
                false,
                true,
            );

            // Wait for texture to be ready before setting as environment
            hdrTexture.onLoadObservable.addOnce(() => {
                if (scene) {
                    // Set as environment texture for PBR lighting
                    scene.environmentTexture = hdrTexture;
                    scene.environmentIntensity = 1.2;

                    // Use same texture for the skybox (visual background)
                    scene.createDefaultSkybox(hdrTexture, true, 1000);
                }
                console.log(
                    `HDR environment texture loaded and set as skybox: ${hdrFileName}`,
                );
            });
        } catch (error) {
            console.error(
                `Error loading environment asset ${hdrFileName}:`,
                error,
            );
        }
    } finally {
        environmentLoading.value = false;
    }
};

// Initialize BabylonJS
const initializeBabylon = async () => {
    if (!renderCanvas.value || !navigator.gpu) {
        console.error("WebGPU not supported or canvas not found.");
        return false;
    }

    console.log("Initializing BabylonJS with WebGPU...");
    try {
        engine = new WebGPUEngine(renderCanvas.value, {
            antialias: false,
            adaptToDeviceRatio: true,
        });

        await engine.initAsync();

        scene = new Scene(engine);

        // Initialize the physics engine
        await initPhysics(scene);

        // Create light
        new HemisphericLight("light", new Vector3(1, 1, 0), scene);

        // Create a directional light for shadows
        const directionalLight = new DirectionalLight(
            "directionalLight",
            new Vector3(-1, -2, -1),
            scene,
        );
        directionalLight.position = new Vector3(10, 10, 10);
        directionalLight.intensity = 11.0;

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

watch(
    () => connectionStatus.value,
    (newStatus) => {
        if (newStatus === "connected") {
            console.log("Connected to Vircadia server");
            // Load environments when connection is established
            if (scene) {
                loadEnvironments();
            }
        } else if (newStatus === "disconnected") {
            console.log("Disconnected from Vircadia server");
        } else if (newStatus === "connecting") {
            console.log("Connecting to Vircadia server...");
        }
    },
);

// Also watch for scene creation to load environments if connection is already established
watch(
    () => sceneInitialized.value,
    (initialized) => {
        if (initialized && connectionStatus.value === "connected") {
            loadEnvironments();
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
