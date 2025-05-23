<template>
  <!-- BabylonModel is a renderless component -->
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted, inject, computed } from "vue";
import { z } from "zod";
import type { Scene } from "@babylonjs/core";
import type { BabylonModelDefinition } from "../composables/schemas";
import { useVircadiaInstance } from "@vircadia/world-sdk/browser/vue";
import { useBabylonModelEntity } from "../composables/useBabylonModelEntity";
import { useBabylonModelLoader } from "../composables/useBabylonModelLoader";
import { useBabylonModelPhysics } from "../composables/useBabylonModelPhysics";

const props = defineProps<{
    def: BabylonModelDefinition;
    scene: Scene | null;
    syncMode: "push" | "pull";
}>();
// Sync mode: 'push' (default) or 'pull'
const isPusher = props.def.syncMode !== "pull";

// --- Set up Babylon model pipelines ---
// Reactive local transform state
const position = ref(props.def.position ?? { x: 0, y: 0, z: 0 });
const rotation = ref(props.def.rotation ?? { x: 0, y: 0, z: 0, w: 1 });

// 1. Asset loader is now managed by useBabylonModelLoader
// 2. Entity synchronization (generic metadata)
// Define metadata schema & type
const ModelMetadataSchema = z.object({
    type: z.literal("Model"),
    modelURL: z.string(),
    position: z.object({ x: z.number(), y: z.number(), z: z.number() }),
    rotation: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
        w: z.number(),
    }),
});
type ModelMetadata = z.infer<typeof ModelMetadataSchema>;

// Initialize generic entity sync
const entityNameRef = ref(props.def.entityName || props.def.fileName);
const {
    entityName,
    entity,
    debouncedUpdate,
    isRetrieving,
    isCreating,
    isUpdating,
} = useBabylonModelEntity<ModelMetadata>(
    entityNameRef,
    props.def.throttleInterval ?? 1000,
    ModelMetadataSchema,
    () => ({
        type: "Model",
        modelURL: props.def.fileName,
        position: position.value,
        rotation: rotation.value,
    }),
    () => ({
        type: "Model",
        modelURL: props.def.fileName,
        position: position.value,
        rotation: rotation.value,
    }),
);

// 3. Model loader and asset management
const { meshes, loadModel, asset } = useBabylonModelLoader(props.def);

// 4. Physics application
const { applyPhysics, removePhysics } = useBabylonModelPhysics(
    meshes,
    props.def,
);

// Vircadia connection manager
const vircadia = inject(useVircadiaInstance());
if (!vircadia) {
    throw new Error("Vircadia instance not found");
}

// --- Orchestration ---
// When scene becomes available, load asset and retrieve entity metadata
watch(
    () => props.scene,
    async (s) => {
        if (s) {
            await loadModel(s);
            // Always attempt to retrieve existing entity
            entity.executeRetrieve();
            // Apply physics if enabled after model load
            if (props.def.enablePhysics) {
                applyPhysics(s);
            }
        }
    },
    { immediate: true },
);

// Ensure entity exists: if retrieve completes with no data, create then retrieve again (push mode only)
if (isPusher) {
    const stopWatchCreate = watch(
        [
            () => entity.retrieving.value,
            () => entity.error.value,
            () => entity.entityData.value,
        ],
        ([retrieving, error, data], [wasRetrieving]) => {
            if (wasRetrieving && !retrieving) {
                if (!data && !error) {
                    entity.executeCreate().then(() => entity.executeRetrieve());
                }
                stopWatchCreate();
            }
        },
        { immediate: false },
    );
}

// When asset blob URL is ready, load the 3D model and apply physics if enabled
// Asset loading and model loading is handled inside useBabylonModelLoader

// React to enablePhysics toggles at runtime
watch(
    () => props.def.enablePhysics,
    (enabled) => {
        if (enabled) {
            if (props.scene) {
                applyPhysics(props.scene);
            } else {
                console.warn("No scene to apply physics to");
            }
        } else {
            removePhysics();
        }
    },
);

// Connection status: clear meshes on disconnect
watch(
    () => vircadia.connectionInfo.value.status,
    (status) => {
        if (status !== "connected") {
            for (const m of meshes.value) {
                m.dispose();
            }
            meshes.value = [];
        }
    },
);

// When transforms change, update entity metadata (push mode only)
if (isPusher) {
    watch(position, debouncedUpdate, { deep: true });
    watch(rotation, debouncedUpdate, { deep: true });
}

// Clean up on unmount
onUnmounted(() => {
    entity.cleanup();
    asset.cleanup();
    removePhysics();
    for (const m of meshes.value) {
        m.dispose();
    }
});

// Expose loading state for parent tracking
// isLoading combines asset loading and initial entity retrieval/creation only
defineExpose({
    isAssetLoading: asset.loading,
    isEntityRetrieving: isRetrieving,
    isEntityCreating: isCreating,
    isEntityUpdating: isUpdating,
});
</script>
