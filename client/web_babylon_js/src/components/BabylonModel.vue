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

// Entity state management
const entityMetadata = ref<ModelMetadata | null>(null);
const isRetrieving = ref(false);
const isCreating = ref(false);
const isUpdating = ref(false);

// Setup model entity inline (similar to BabylonMyAvatar.vue)
const getInitialMeta: () => ModelMetadata = () => ({
    type: "Model" as const,
    modelFileName: props.def.fileName,
    position: props.def.position ?? { x: 0, y: 0, z: 0 },
    rotation: props.def.rotation ?? { x: 0, y: 0, z: 0, w: 1 },
    ownerSessionId: props.def.ownerSessionId ?? null,
});

// Debounced update function using JSON path operations for granular updates
const debouncedUpdate = useDebounceFn(async () => {
    if (!entityMetadata.value || !entityNameRef.value) {
        console.warn("Cannot update entity: No entity data available");
        return;
    }

    const currentMeta = entityMetadata.value;
    const newPos = props.def.position ?? { x: 0, y: 0, z: 0 };
    const newRot = props.def.rotation ?? { x: 0, y: 0, z: 0, w: 1 };

    try {
        isUpdating.value = true;

        // Update position using JSON path operation
        if (
            currentMeta.position &&
            (currentMeta.position.x !== newPos.x ||
                currentMeta.position.y !== newPos.y ||
                currentMeta.position.z !== newPos.z)
        ) {
            await vircadia.client.Utilities.Connection.query({
                query: "UPDATE entity.entities SET meta__data = jsonb_set(meta__data, '{position}', $1) WHERE general__entity_name = $2",
                parameters: [newPos, entityNameRef.value],
            });
        }

        // Update rotation using JSON path operation
        if (
            currentMeta.rotation &&
            (currentMeta.rotation.x !== newRot.x ||
                currentMeta.rotation.y !== newRot.y ||
                currentMeta.rotation.z !== newRot.z ||
                currentMeta.rotation.w !== newRot.w)
        ) {
            await vircadia.client.Utilities.Connection.query({
                query: "UPDATE entity.entities SET meta__data = jsonb_set(meta__data, '{rotation}', $1) WHERE general__entity_name = $2",
                parameters: [JSON.stringify(newRot), entityNameRef.value],
            });
        }

        // Update type if changed
        if (currentMeta.type !== "Model") {
            await vircadia.client.Utilities.Connection.query({
                query: "UPDATE entity.entities SET meta__data = jsonb_set(meta__data, '{type}', $1) WHERE general__entity_name = $2",
                parameters: ["Model", entityNameRef.value],
            });
        }

        // Update modelFileName if changed
        if (currentMeta.modelFileName !== props.def.fileName) {
            await vircadia.client.Utilities.Connection.query({
                query: "UPDATE entity.entities SET meta__data = jsonb_set(meta__data, '{modelFileName}', $1) WHERE general__entity_name = $2",
                parameters: [props.def.fileName, entityNameRef.value],
            });
        }

        // Update ownerSessionId if changed
        const currentOwnerSessionId = props.def.ownerSessionId ?? null;
        if (currentMeta.ownerSessionId !== currentOwnerSessionId) {
            await vircadia.client.Utilities.Connection.query({
                query: "UPDATE entity.entities SET meta__data = jsonb_set(meta__data, '{ownerSessionId}', $1) WHERE general__entity_name = $2",
                parameters: [currentOwnerSessionId, entityNameRef.value],
            });
        }
    } catch (e: unknown) {
        console.error("Entity update failed:", e);
    } finally {
        isUpdating.value = false;
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
            isRetrieving.value = true;
            try {
                const result = await vircadia.client.Utilities.Connection.query(
                    {
                        query: "SELECT general__entity_name, meta__data FROM entity.entities WHERE general__entity_name = $1",
                        parameters: [entityNameRef.value],
                    },
                );

                if (Array.isArray(result.result) && result.result.length > 0) {
                    const data = result.result[0];
                    // Validate with schema
                    const parsed = ModelMetadataSchema.safeParse(
                        data.meta__data,
                    );
                    if (parsed.success) {
                        entityMetadata.value = parsed.data;
                    } else {
                        console.warn("Invalid model metadata:", parsed.error);
                        entityMetadata.value = null;
                    }
                } else {
                    entityMetadata.value = null;
                }
            } catch (e) {
                console.error("Entity retrieve failed:", e);
            } finally {
                isRetrieving.value = false;
            }

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
    return entityMetadata.value?.ownerSessionId === sessionId.value;
});

// Ensure entity exists: if retrieve completes with no data, create then retrieve again (push mode only)
watch(
    [isPusher, () => isRetrieving.value, () => entityMetadata.value],
    async ([isPush, retrieving, metadata], [wasPush, wasRetrieving]) => {
        if (isPush && wasRetrieving && !retrieving) {
            if (!metadata) {
                // Create entity
                isCreating.value = true;
                try {
                    const result =
                        await vircadia.client.Utilities.Connection.query({
                            query: "INSERT INTO entity.entities (general__entity_name, meta__data) VALUES ($1, $2) RETURNING general__entity_name, meta__data",
                            parameters: [entityNameRef.value, getInitialMeta()],
                        });

                    // Retrieve again to get the created entity
                    if (
                        Array.isArray(result.result) &&
                        result.result.length > 0
                    ) {
                        const data = result.result[0];
                        const parsed = ModelMetadataSchema.safeParse(
                            data.meta__data,
                        );
                        if (parsed.success) {
                            entityMetadata.value = parsed.data;
                        }
                    }
                } catch (e) {
                    console.error("Entity create failed:", e);
                } finally {
                    isCreating.value = false;
                }
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
        if (isPush && pos && rot && entityMetadata.value) {
            debouncedUpdate();
        }
    },
    { deep: true },
);

// Clean up on unmount
onUnmounted(() => {
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
