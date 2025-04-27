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
        <template v-if="scene">
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
    Engine,
    Vector3,
    HemisphericLight,
    WebGPUEngine,
    HDRCubeTexture,
    CubeTexture,
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

// BabylonJS Setup
const renderCanvas = ref<HTMLCanvasElement | null>(null);
const engine = ref<WebGPUEngine | null>(null);
const scene = ref<Scene | null>(null);

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
    {
        fileName: "telekom.skybox.Room.image.2k.png",
        type: "skybox",
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
    if (!scene.value || environmentLoading.value) return;

    environmentLoading.value = true;

    try {
        for (const asset of environmentAssets.value) {
            try {
                const assetResult = await useVircadiaAsset({
                    fileName: ref(asset.fileName),
                    instance: vircadiaWorld,
                });

                // Call executeLoad() explicitly to load the asset
                await assetResult.executeLoad();

                if (!assetResult.assetData.value?.blobUrl) {
                    console.error(
                        `Failed to load environment asset: ${asset.fileName}`,
                    );
                    continue;
                }

                const blobUrl = assetResult.assetData.value.blobUrl;

                if (asset.type === "hdr") {
                    // Create an HDR environment
                    const hdrTexture = new HDRCubeTexture(
                        blobUrl,
                        scene.value,
                        128,
                        false, // noMipmap
                        true, // generateHarmonics
                        true, // gammaSpace
                        true, // prefilterOnLoad
                    );

                    // Wait for texture to load
                    await new Promise<void>((resolve, reject) => {
                        hdrTexture.onLoadObservable.addOnce(() => {
                            if (scene.value) {
                                scene.value.environmentTexture = hdrTexture;
                                scene.value.environmentIntensity = 0.7;
                            }
                            console.log(
                                `HDR environment texture loaded: ${asset.fileName}`,
                            );
                            resolve();
                        });

                        hdrTexture.onLoadErrorObservable.addOnce((error) => {
                            console.error(
                                `Error loading HDR texture: ${error}`,
                            );
                            reject(error);
                        });
                    });
                } else if (asset.type === "skybox") {
                    // Create a skybox using cube texture
                    const skyboxTexture = new CubeTexture(blobUrl, scene.value);

                    // Wait for texture to load
                    await new Promise<void>((resolve, reject) => {
                        skyboxTexture.onLoadObservable.addOnce(() => {
                            // Create a default skybox with the texture
                            if (scene.value) {
                                const skybox = scene.value.createDefaultSkybox(
                                    skyboxTexture,
                                    true, // pbr
                                    1000, // size
                                    0.3, // blur level
                                );
                            }
                            console.log(
                                `Skybox texture loaded: ${asset.fileName}`,
                            );
                            resolve();
                        });

                        skyboxTexture.onLoadErrorObservable.addOnce((error) => {
                            console.error(
                                `Error loading skybox texture: ${error}`,
                            );
                            reject(error);
                        });
                    });
                }
            } catch (error) {
                console.error(
                    `Error loading environment asset ${asset.fileName}:`,
                    error,
                );
            }
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
        engine.value = new WebGPUEngine(renderCanvas.value, {
            antialias: false,
            adaptToDeviceRatio: true,
        });

        await engine.value.initAsync();

        scene.value = new Scene(engine.value);

        const camera = new ArcRotateCamera(
            "camera",
            -Math.PI / 2,
            Math.PI / 2.5,
            10,
            Vector3.Zero(),
            scene.value,
        );
        camera.attachControl(renderCanvas.value, true);

        // Create light with properly typed scene
        const babylonScene = scene.value;
        new HemisphericLight("light", new Vector3(1, 1, 0), babylonScene);

        engine.value.runRenderLoop(() => scene.value?.render());
        window.addEventListener("resize", handleResize);
        console.log("BabylonJS initialized successfully.");
        return true;
    } catch (error) {
        console.error("Error initializing BabylonJS:", error);
        return false;
    }
};

const handleResize = () => engine.value?.resize();

onMounted(async () => {
    await initializeBabylon();

    // Initialize model refs array
    modelRefs.value = Array(modelDefinitions.value.length).fill(null);
});

onUnmounted(() => {
    window.removeEventListener("resize", handleResize);
    console.log("Disposing BabylonJS scene and engine...");
    scene.value?.dispose();
    engine.value?.dispose();
    scene.value = null;
    engine.value = null;
});

watch(
    () => connectionStatus.value,
    (newStatus) => {
        if (newStatus === "connected") {
            console.log("Connected to Vircadia server");
            // Load environments when connection is established
            if (scene.value) {
                // loadEnvironments();
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
    () => scene.value,
    (newScene) => {
        if (newScene && connectionStatus.value === "connected") {
            // loadEnvironments();
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
