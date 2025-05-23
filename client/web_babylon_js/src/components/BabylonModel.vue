<template>
  <!-- BabylonModel is a renderless component -->
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted, inject, computed, toRefs } from "vue";
import type { Scene } from "@babylonjs/core";
import type {
    BabylonModelDefinition,
    ModelMetadata,
} from "../composables/schemas";
import { ModelMetadataSchema } from "../composables/schemas";
import { useVircadiaInstance } from "@vircadia/world-sdk/browser/vue";
import { useEntity } from "@vircadia/world-sdk/browser/vue";
import { useDebounceFn } from "@vueuse/core";
import { useBabylonModelLoader } from "../composables/useBabylonModelLoader";
import { useBabylonModelPhysics } from "../composables/useBabylonModelPhysics";
import { useAppStore } from "@/stores/appStore";

const props = defineProps<{
    def: BabylonModelDefinition;
    scene: Scene | null;
}>();

// --- Set up Babylon model pipelines ---

// 1. Asset loader is now managed by useBabylonModelLoader
// 2. Entity synchronization (generic metadata)
// Define metadata schema & type

// Initialize generic entity sync
const entityNameRef = ref(props.def.entityName || props.def.fileName);

// Vircadia connection manager
const vircadia = inject(useVircadiaInstance());
if (!vircadia) {
    throw new Error("Vircadia instance not found");
}

// Get current sessionId from app store
const appStore = useAppStore();
const { sessionId } = toRefs(appStore);

// Setup model entity inline (similar to BabylonAvatar.vue)
const getInitialMeta: () => ModelMetadata = () => ({
    type: "Model" as const,
    modelFileName: props.def.fileName,
    position: props.def.position ?? { x: 0, y: 0, z: 0 },
    rotation: props.def.rotation ?? { x: 0, y: 0, z: 0, w: 1 },
    ownerSessionId: props.def.ownerSessionId ?? null,
});

const entity = useEntity({
    entityName: entityNameRef,
    selectClause: "general__entity_name, meta__data",
    insertClause:
        "(general__entity_name, meta__data) VALUES ($1, $2) RETURNING general__entity_name",
    insertParams: [entityNameRef.value, getInitialMeta()],
    metaDataSchema: ModelMetadataSchema,
    defaultMetaData: getInitialMeta(),
});

// Debounced update function using JSON path operations for granular updates
const debouncedUpdate = useDebounceFn(async () => {
    if (!entity.entityData.value?.general__entity_name) {
        console.warn("Cannot update entity: No entity name available");
        return;
    }

    const currentMeta = entity.entityData.value.meta__data;
    const newPos = props.def.position ?? { x: 0, y: 0, z: 0 };
    const newRot = props.def.rotation ?? { x: 0, y: 0, z: 0, w: 1 };

    try {
        // Update position using JSON path operation
        if (
            currentMeta?.position &&
            (currentMeta.position.x !== newPos.x ||
                currentMeta.position.y !== newPos.y ||
                currentMeta.position.z !== newPos.z)
        ) {
            await entity.executeUpdate(
                "meta__data = jsonb_set(meta__data, '{position}', $1)",
                [newPos],
            );
        }

        // Update rotation using JSON path operation
        if (
            currentMeta?.rotation &&
            (currentMeta.rotation.x !== newRot.x ||
                currentMeta.rotation.y !== newRot.y ||
                currentMeta.rotation.z !== newRot.z ||
                currentMeta.rotation.w !== newRot.w)
        ) {
            await entity.executeUpdate(
                "meta__data = jsonb_set(meta__data, '{rotation}', $1)",
                [JSON.stringify(newRot)],
            );
        }

        // Update type if changed
        if (currentMeta?.type !== "Model") {
            await entity.executeUpdate(
                "meta__data = jsonb_set(meta__data, '{type}', $1)",
                ["Model"],
            );
        }

        // Update modelFileName if changed
        if (currentMeta?.modelFileName !== props.def.fileName) {
            await entity.executeUpdate(
                "meta__data = jsonb_set(meta__data, '{modelFileName}', $1)",
                [props.def.fileName],
            );
        }

        // Update ownerSessionId if changed
        const currentOwnerSessionId = props.def.ownerSessionId ?? null;
        if (currentMeta?.ownerSessionId !== currentOwnerSessionId) {
            await entity.executeUpdate(
                "meta__data = jsonb_set(meta__data, '{ownerSessionId}', $1)",
                [currentOwnerSessionId],
            );
        }
    } catch (e: unknown) {
        console.error("Entity update failed:", e);
    }
}, props.def.throttleInterval ?? 1000);

// 3. Model loader and asset management
const { meshes, loadModel, asset } = useBabylonModelLoader(props.def);

// 4. Physics application
const { applyPhysics, removePhysics } = useBabylonModelPhysics(
    meshes,
    props.def,
);

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

// Computed properties to access metadata values
const isPusher = computed(() => {
    return (
        entity.entityData.value?.meta__data?.ownerSessionId === sessionId.value
    );
});

// Ensure entity exists: if retrieve completes with no data, create then retrieve again (push mode only)
watch(
    [
        isPusher,
        () => entity.retrieving.value,
        () => entity.error.value,
        () => entity.entityData.value,
    ],
    ([isPush, retrieving, error, data], [wasPush, wasRetrieving]) => {
        if (isPush && wasRetrieving && !retrieving) {
            if (!data && !error) {
                entity.executeCreate().then(() => entity.executeRetrieve());
            }
        }
    },
    { immediate: false },
);

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
watch(
    [isPusher, () => props.def.position, () => props.def.rotation],
    ([isPush, pos, rot]) => {
        if (isPush && pos && rot && entity.entityData.value) {
            debouncedUpdate();
        }
    },
    { deep: true },
);

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
    isEntityRetrieving: entity.retrieving,
    isEntityCreating: entity.creating,
    isEntityUpdating: entity.updating,
});
</script>
