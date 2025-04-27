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
        <template v-if="sceneInitialized">
            <StaticBabylonModel
                v-for="(model, index) in modelDefinitions"
                :key="model.fileName"
                :scene="scene"
                :fileName="model.fileName"
                :position="model.position"
                :ref="el => modelRefs[index] = el"
            />
        </template>
    </main>
</template>

<script setup lang="ts">
import { inject, computed, watch, ref, onMounted, onUnmounted } from "vue";
import { getInstanceKey } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/provider/useVircadia";
import StaticBabylonModel from "./components/StaticBabylonModel.vue";
import {
    Scene,
    ArcRotateCamera,
    Vector3,
    HemisphericLight,
    WebGPUEngine,
    HDRCubeTexture,
    CubeTexture,
    MeshBuilder,
    Texture,
    StandardMaterial,
    Color3,
} from "@babylonjs/core";
// Make sure the importers are included
import "@babylonjs/loaders/glTF";
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

interface ModelDefinition {
    fileName: string;
    position?: { x: number; y: number; z: number };
    // Add other properties as needed
}

const modelDefinitions = ref<ModelDefinition[]>([
    {
        fileName: "telekom.model.Room.glb",
        position: { x: 0, y: 0, z: 0 },
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
const modelRefs = ref<(InstanceType<typeof StaticBabylonModel> | null)[]>([]);

// Simplified loading state from all model components and environment loading
const isLoading = computed(() => {
    return (
        modelRefs.value.some((ref) => ref?.isLoading) ||
        environmentLoading.value
    );
});

// Load environment assets
const loadEnvironments = async () => {
    if (!scene || environmentLoading.value) return;

    environmentLoading.value = true;

    try {
        // First try to load the HDR environment for PBR lighting
        const hdrFileName = "telekom.skybox.Room.hdr.1k.hdr";

        try {
            const hdrAssetResult = useVircadiaAsset({
                fileName: ref(hdrFileName),
                instance: vircadiaWorld,
            });

            // Call executeLoad() explicitly to load the asset
            await hdrAssetResult.executeLoad();

            if (!hdrAssetResult.assetData.value?.blobUrl) {
                console.error(`Failed to load HDR environment: ${hdrFileName}`);
            } else {
                const hdrBlobUrl = hdrAssetResult.assetData.value.blobUrl;

                // Create an HDR environment
                const hdrTexture = new HDRCubeTexture(
                    hdrBlobUrl,
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
                        scene.environmentIntensity = 0.7;
                    }
                    console.log(
                        `HDR environment texture loaded: ${hdrFileName}`,
                    );
                });
            }
        } catch (error) {
            console.error(`Error loading HDR asset ${hdrFileName}:`, error);
        }

        // // Now load the PNG skybox for the visual background using MeshBuilder
        // const skyboxFileName = "telekom.skybox.Room.image.2k.png";

        // try {
        //     const skyboxAssetResult = useVircadiaAsset({
        //         fileName: ref(skyboxFileName),
        //         instance: vircadiaWorld,
        //     });

        //     console.info(
        //         `Loading skybox asset: ${skyboxFileName}`,
        //         skyboxAssetResult,
        //     );

        //     // Execute the load explicitly
        //     await skyboxAssetResult.executeLoad();

        //     console.info(
        //         `Skybox asset loaded: ${skyboxFileName}`,
        //         skyboxAssetResult,
        //     );

        //     if (!skyboxAssetResult.assetData.value?.blobUrl) {
        //         console.error(`Failed to load skybox: ${skyboxFileName}`);
        //     } else {
        //         const skyboxBlobUrl = skyboxAssetResult.assetData.value.blobUrl;

        //         console.info(
        //             `Skybox blob URL: ${skyboxBlobUrl}`,
        //             skyboxAssetResult,
        //         );

        //         if (scene) {
        //             console.info(
        //                 `Creating skybox with blob URL: ${skyboxBlobUrl}`,
        //             );
        //             // Create a skybox using MeshBuilder
        //             const skybox = MeshBuilder.CreateBox(
        //                 "skyBox",
        //                 { size: 10000.0 },
        //                 scene,
        //             );

        //             skybox.infiniteDistance = true;
        //             skybox.isPickable = false;
        //             skybox.isNearGrabbable = false;
        //             skybox.isNearPickable = false;
        //             skybox.renderingGroupId = 0; // Ensure it's rendered first
        //             // Attach the skybox directly to the scene, not to the camera
        //             skybox.parent = null;

        //             // Create skybox material
        //             const skyboxMaterial = new StandardMaterial(
        //                 "skyBoxMaterial",
        //                 scene,
        //             );
        //             skyboxMaterial.backFaceCulling = false;

        //             // Create cube texture from the blob URL
        //             const skyboxTexture = new CubeTexture(skyboxBlobUrl, scene);
        //             skyboxMaterial.reflectionTexture = skyboxTexture;
        //             skyboxMaterial.reflectionTexture.coordinatesMode =
        //                 Texture.SKYBOX_MODE;
        //             skyboxMaterial.diffuseColor = new Color3(0, 0, 0);
        //             skyboxMaterial.specularColor = new Color3(0, 0, 0);

        //             // Apply the material to the skybox mesh
        //             skybox.material = skyboxMaterial;

        //             // Set the rendering group to ensure the skybox renders behind everything else
        //             skybox.renderingGroupId = 0;

        //             console.log(
        //                 `Skybox loaded successfully: ${skyboxFileName}`,
        //             );
        //         }
        //     }
        // } catch (error) {
        //     console.error(`Error loading skybox ${skyboxFileName}:`, error);
        // }
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

        const camera = new ArcRotateCamera(
            "camera",
            -Math.PI / 2,
            Math.PI / 2.5,
            10,
            Vector3.Zero(),
            scene,
        );
        camera.attachControl(renderCanvas.value, true);

        // Create light
        new HemisphericLight("light", new Vector3(1, 1, 0), scene);

        engine.runRenderLoop(() => scene?.render());
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
});

onUnmounted(() => {
    window.removeEventListener("resize", handleResize);
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
