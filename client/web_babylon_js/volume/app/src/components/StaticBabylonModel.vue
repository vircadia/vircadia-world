<template>
    <!-- No visual output needed for this component -->
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, inject, type Ref } from "vue";
import {
    type Scene,
    ImportMeshAsync,
    type AbstractMesh,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF"; // Import the GLTF loader

import { useVircadiaAsset } from "../../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/composable/useVircadiaAsset";
import { useVircadiaEntity } from "../../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/composable/useVircadiaEntity";
import { getInstanceKey } from "../../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/provider/useVircadia";

// Update props to allow a possible null scene
const props = defineProps<{
    scene: Scene; // Changed from Ref<Scene | null> to Scene
    fileName: string;
    position?: { x: number; y: number; z: number };
}>();

// Expose loading state to parent
const isLoading = ref(false);
const hasError = ref(false);
const errorMessage = ref("");

defineExpose({
    isLoading,
    hasError,
    errorMessage,
});

// Get Vircadia instance
const vircadia = inject(getInstanceKey("vircadiaWorld"));
if (!vircadia) {
    throw new Error("Vircadia instance not found.");
}

// Entity management
const meshes = ref<AbstractMesh[]>([]);

// Initialize asset and entity composables
const asset = useVircadiaAsset({
    fileName: ref(props.fileName),
    instance: vircadia,
});

const entity = useVircadiaEntity({
    entityName: ref(props.fileName),
    selectClause: "general__entity_id, general__entity_name, meta__data",
    insertClause:
        "(general__entity_name, meta__data) VALUES ($1, $2) RETURNING general__entity_id",
    insertParams: [
        props.fileName,
        JSON.stringify({
            type: { value: "Model" },
            modelURL: { value: props.fileName },
            position: props.position
                ? {
                      value: props.position,
                  }
                : undefined,
        }),
    ],
    instance: vircadia,
});

// Update loading state based on asset and entity status
watch(
    [
        () => asset.loading.value,
        () => entity.retrieving.value,
        () => entity.creating.value,
        () => entity.updating.value,
    ],
    ([assetLoading, entityRetrieving, entityCreating, entityUpdating]) => {
        isLoading.value =
            assetLoading ||
            entityRetrieving ||
            entityCreating ||
            entityUpdating;
    },
    { immediate: true },
);

// Load model when asset data is available
const loadModel = async () => {
    if (!asset.assetData.value || !props.scene) {
        console.warn(
            `Asset: ${asset.assetData.value ? "Ready" : "Not ready"}.`,
        );
        console.warn(`Scene: ${props.scene ? "Ready" : "Not ready"}.`);
        return;
    }

    const assetData = asset.assetData.value;

    if (!assetData.blobUrl) {
        console.warn("Asset blob URL not available.");
        return;
    }

    if (meshes.value.length > 0) {
        console.log(`Model '${props.fileName}' already loaded. Skipping.`);
        return;
    }

    try {
        const pluginExtension =
            assetData.mimeType === "model/gltf-binary" ? ".glb" : ".gltf";
        console.log(`Loading model '${props.fileName}' using blob URL...`);

        // Using ImportMeshAsync with correct parameter usage
        const result = await ImportMeshAsync(assetData.blobUrl, props.scene, {
            pluginExtension,
        });

        meshes.value = result.meshes;

        // Position the root meshes based on entity data
        if (entity.entityData.value?.meta__data) {
            const entityMetaData = entity.entityData.value.meta__data;
            if (
                typeof entityMetaData === "object" &&
                entityMetaData.position?.value
            ) {
                const positionData = entityMetaData.position.value;
                for (const mesh of result.meshes) {
                    if (!mesh.parent) {
                        mesh.position.set(
                            positionData.x,
                            positionData.y,
                            positionData.z,
                        );
                    }
                }
            }
        } else if (props.position) {
            // Apply default position from props
            for (const mesh of result.meshes) {
                if (!mesh.parent) {
                    mesh.position.set(
                        props.position.x,
                        props.position.y,
                        props.position.z,
                    );
                }
            }
        }

        console.log(
            `Model '${props.fileName}' loaded successfully (${result.meshes.length} meshes).`,
        );
    } catch (error) {
        console.error(`Error loading model '${props.fileName}':`, error);
        hasError.value = true;
        errorMessage.value = `Error loading model: ${error}`;
    }
};

// Watch for asset data to load model
watch(
    () => asset.assetData.value,
    (assetData) => {
        if (assetData?.blobUrl && meshes.value.length === 0) {
            console.log(
                `Asset data ready for ${props.fileName}, loading model.`,
            );
            loadModel();
        }
    },
);

// Watch for asset errors
watch(
    () => asset.error.value,
    (error) => {
        if (error) {
            console.error(`Asset Error (${props.fileName}):`, error);
            hasError.value = true;
            errorMessage.value = `Asset error: ${error}`;
        }
    },
);

// Watch for entity data changes
watch(
    [
        () => entity.entityData.value,
        () => entity.creating.value,
        () => entity.error.value,
    ],
    ([entityData, creating, error], [oldEntityData, wasCreating]) => {
        if (error) {
            console.error(`Entity Error (${props.fileName}):`, error);
            hasError.value = true;
            errorMessage.value = `Entity error: ${error}`;
        } else if (wasCreating && !creating && entityData) {
            console.log(
                `Entity created successfully for ${props.fileName}:`,
                entityData,
            );
        } else if (entityData && entityData !== oldEntityData) {
            console.log(
                `Entity data available for ${props.fileName}:`,
                entityData,
            );
        }
    },
);

// Manage asset and entity based on connection status
const manageAssetAndEntity = () => {
    console.log(`Managing asset and entity for ${props.fileName}...`);

    // 1. Load asset
    asset.executeLoad();

    // 2. Retrieve entity, create if not found
    entity.executeRetrieve();

    // Watch for retrieve completion to create if needed
    const stopWatch = watch(
        [() => entity.retrieving.value, () => entity.error.value],
        ([retrieving, error], [wasRetrieving]) => {
            if (wasRetrieving && !retrieving) {
                if (!entity.entityData.value && !error) {
                    console.log(
                        `Entity ${props.fileName} not found, creating...`,
                    );
                    entity.executeCreate();
                }
                stopWatch(); // Stop watching after entity retrieval completes
            }
        },
        { immediate: false },
    );
};

onMounted(() => {
    watch(
        () => vircadia.connectionInfo.value.status,
        (newStatus, oldStatus) => {
            if (newStatus === "connected" && oldStatus !== "connected") {
                console.log(
                    `Vircadia connected, managing asset and entity for ${props.fileName}.`,
                );
                manageAssetAndEntity();
            } else if (newStatus !== "connected") {
                console.log(
                    `Vircadia disconnected, clearing meshes for ${props.fileName}.`,
                );
                for (const mesh of meshes.value) {
                    mesh.dispose();
                }
                meshes.value = [];
            }
        },
        { immediate: true },
    );
});

onUnmounted(() => {
    console.log(
        `StaticBabylonEntity component for ${props.fileName} unmounting. Cleaning up...`,
    );

    entity.cleanup();
    asset.cleanup();
    for (const mesh of meshes.value) {
        mesh.dispose();
    }
    meshes.value = [];

    console.log(`Cleanup complete for ${props.fileName}.`);
});
</script>