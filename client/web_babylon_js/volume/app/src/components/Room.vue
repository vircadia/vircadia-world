<template>
    <canvas ref="renderCanvas" id="renderCanvas"></canvas>

    <div v-if="isLoading" class="overlay loading-indicator">
        Loading assets or creating entities...
    </div>
    <div v-if="hasErrors" class="overlay error-display">
        <p v-for="(error, key) in activeErrors" :key="key">
            {{ key }}: {{ error.message }}
        </p>
    </div>
</template>

<script setup lang="ts">
import {
    ref,
    onMounted,
    onUnmounted,
    watch,
    watchEffect,
    computed,
    reactive,
    inject,
} from "vue";
import {
    Scene,
    ArcRotateCamera,
    Vector3,
    HemisphericLight,
    WebGPUEngine,
    ImportMeshAsync,
    type AbstractMesh,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF"; // Import the GLTF loader

import {
    useVircadiaAsset,
    type VircadiaAssetData,
} from "../../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/composable/useVircadiaAsset";
import { useVircadiaEntity } from "../../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/composable/useVircadiaEntity";
import { getInstanceKey } from "../../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/provider/useVircadia";

interface AssetDefinition {
    fileName: string;
}
const assetDefinitions = ref<AssetDefinition[]>([
    {
        fileName: "telekom.model.LandscapeWalkwayLOD.glb",
    },
]);

const vircadia = inject(getInstanceKey("vircadiaWorld"));
if (!vircadia) {
    throw new Error("Vircadia instance not found.");
}

const renderCanvas = ref<HTMLCanvasElement | null>(null);
let engine: WebGPUEngine | null = null;
let scene: Scene | null = null;
const loadedAssetMeshes = ref(new Map<string, AbstractMesh[]>());

// --- Reactive States for Composables ---
// Use simpler structures to hold composable results directly
const assetStates = reactive<
    Record<string, ReturnType<typeof useVircadiaAsset>>
>({});
const entityStates = reactive<
    Record<string, ReturnType<typeof useVircadiaEntity>>
>({});
const activeErrors = reactive<Record<string, Error>>({});

// --- Computed States ---
const isLoading = computed(
    () =>
        Object.values(assetStates).some((state) => state.loading.value) ||
        Object.values(entityStates).some((state) => state.creating.value),
);
const hasErrors = computed(() => Object.keys(activeErrors).length > 0);

// --- BabylonJS Model Loading ---
const loadModel = async (assetData: VircadiaAssetData, fileName: string) => {
    if (!scene || !assetData.arrayBuffer) {
        console.warn(
            `Cannot load model '${fileName}': Scene not ready or asset data missing.`,
        );
        return;
    }
    if (loadedAssetMeshes.value.has(fileName)) {
        console.log(
            `Model '${fileName}' load triggered, but already loaded. Skipping.`,
        );
        return;
    }

    try {
        const pluginExtension =
            assetData.mimeType === "model/gltf-binary" ? ".glb" : ".gltf";
        console.log(
            `Loading model '${fileName}' (size: ${assetData.arrayBuffer.byteLength} bytes) using blob URL...`,
        );

        // Using ImportMeshAsync with correct parameter order: url, scene, options
        const result = await ImportMeshAsync(
            assetData.blobUrl, // URL parameter
            scene, // Scene parameter
            {
                pluginExtension, // Plugin extension to use
            },
        );

        loadedAssetMeshes.value.set(fileName, result.meshes);
        console.log(
            `Model '${fileName}' loaded successfully (${result.meshes.length} meshes).`,
        );

        // Optional: Position root meshes if needed
        for (const mesh of result.meshes) {
            if (!mesh.parent) {
                // Position logic if needed
                // mesh.position = new Vector3(0, 0, 0);
            }
        }
    } catch (error) {
        console.error(`Error loading model '${fileName}':`, error);
        activeErrors[`ModelLoad-${fileName}`] = error as Error;
    }
};

// --- Vircadia Asset/Entity Management ---
watchEffect((onCleanup) => {
    // Clear previous states and errors
    for (const key of Object.keys(assetStates)) {
        delete assetStates[key];
    }
    for (const key of Object.keys(entityStates)) {
        delete entityStates[key];
    }
    for (const key of Object.keys(activeErrors)) {
        delete activeErrors[key];
    }

    const isConnected = vircadia.connectionInfo.value.status === "connected";
    console.log("Asset/Entity WatchEffect:", {
        isConnected,
        assetCount: assetDefinitions.value.length,
    });

    if (isConnected && assetDefinitions.value.length > 0) {
        const cleanupFunctions: (() => void)[] = [];

        for (const assetInfo of assetDefinitions.value) {
            const assetKey = `Asset-${assetInfo.fileName}`;
            const entityKey = `Entity-${assetInfo.fileName}`; // Now using fileName for entity key

            // --- Asset Handling ---
            const assetComposable = useVircadiaAsset({
                fileName: ref(assetInfo.fileName),
                instance: vircadia,
            });
            assetStates[assetKey] = assetComposable;

            const stopAssetWatch = watch(
                [assetComposable.assetData, assetComposable.error],
                ([newAssetData, err]) => {
                    if (err) {
                        console.error(
                            `Asset Error (${assetInfo.fileName}):`,
                            err,
                        );
                        activeErrors[assetKey] = err;
                    } else {
                        delete activeErrors[assetKey];
                        if (newAssetData) {
                            console.log(
                                `Asset data ready for ${assetInfo.fileName}, loading model.`,
                            );
                            loadModel(newAssetData, assetInfo.fileName);
                        }
                    }
                },
                { immediate: false }, // Don't run immediately for data, but catch initial errors
            );
            cleanupFunctions.push(stopAssetWatch);

            // --- Entity Handling ---
            const entityComposable = useVircadiaEntity({
                entityName: ref(assetInfo.fileName), // Using fileName as entityName
                insertIfNotExist: true,
                insertClause:
                    "(general__entity_name, meta__data) VALUES ($1, $2) RETURNING general__entity_id",
                insertParams: [
                    assetInfo.fileName, // Using fileName as entityName
                    JSON.stringify({
                        type: { value: "Model" },
                        modelURL: { value: assetInfo.fileName },
                    }),
                ],
                selectClause:
                    "general__entity_id, general__entity_name, meta__data",
                instance: vircadia,
            });

            const stopEntityWatch = watch(
                [entityComposable.entityData, entityComposable.error],
                ([data, err]) => {
                    if (err) {
                        console.error(
                            `Entity Error (${assetInfo.fileName}):`, // Using fileName in logs
                            err,
                        );
                        activeErrors[entityKey] = err;
                    } else {
                        delete activeErrors[entityKey];
                        if (data) {
                            console.log(
                                `Entity data updated for ${assetInfo.fileName}:`, // Using fileName in logs
                                data,
                            );
                            // Optional: Update mesh position based on entity data
                        }
                    }
                },
                { immediate: false }, // Don't run immediately for data
            );
            cleanupFunctions.push(stopEntityWatch);
        }

        onCleanup(() => {
            console.log("Cleaning up asset/entity watchers.");
            for (const cleanup of cleanupFunctions) {
                cleanup();
            }
            // Composables handle their own internal cleanup
        });
    } else if (!isConnected) {
        console.log("Not connected, clearing loaded meshes.");
        loadedAssetMeshes.value.clear(); // Clear meshes on disconnect
    }
});

// --- BabylonJS Initialization & Lifecycle ---
const initializeBabylon = async () => {
    if (!renderCanvas.value || !navigator.gpu) {
        console.error("WebGPU not supported or canvas not found.");
        activeErrors["BabylonInit"] = new Error(
            "WebGPU not supported or canvas element missing.",
        );
        return;
    }

    console.log("Initializing BabylonJS with WebGPU...");
    try {
        engine = new WebGPUEngine(renderCanvas.value, {
            antialias: true,
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
        new HemisphericLight("light", new Vector3(1, 1, 0), scene);

        engine.runRenderLoop(() => scene?.render());
        window.addEventListener("resize", handleResize);
        console.log("BabylonJS initialized successfully.");
    } catch (error) {
        console.error("Error initializing BabylonJS:", error);
        activeErrors["BabylonInit"] =
            error instanceof Error ? error : new Error(String(error));
    }
};

const handleResize = () => engine?.resize();

onMounted(async () => {
    await initializeBabylon();
});

onUnmounted(() => {
    console.log("Room component unmounting. Cleaning up...");

    // Clean up each entity
    for (const [key, entityState] of Object.entries(entityStates)) {
        console.log(`Cleaning up entity: ${key}`);
        entityState.cleanup();
    }

    // Clean up each asset
    for (const [key, assetState] of Object.entries(assetStates)) {
        console.log(`Cleaning up asset: ${key}`);
        assetState.cleanup();
    }

    // Clean up BabylonJS resources
    window.removeEventListener("resize", handleResize);
    loadedAssetMeshes.value.clear();
    scene?.dispose();
    engine?.dispose();
    scene = null;
    engine = null;
    // watchEffect cleanup handles watchers.
});
</script>

<style>
#renderCanvas {
    width: 100%; height: 100%; display: block; touch-action: none; outline: none;
}
.overlay {
    position: absolute; left: 10px; color: white; background: rgba(0,0,0,0.7); padding: 8px; border-radius: 4px; font-family: sans-serif; font-size: 14px;
}
.loading-indicator {
    top: 10px;
}
.error-display {
    top: 50px; color: #ffcccc; background: rgba(100,0,0,0.7); max-height: 150px; overflow-y: auto;
}
.error-display p {
    margin: 0 0 5px 0;
}
</style>