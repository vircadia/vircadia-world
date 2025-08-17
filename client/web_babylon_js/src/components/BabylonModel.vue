<template>
  <!-- BabylonModel is a renderless component -->
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted, computed, toRefs } from "vue";
import type { Scene } from "@babylonjs/core";
import type {
    BabylonModelDefinition,
    ModelMetadata,
} from "../composables/schemas";
import { ModelMetadataSchema } from "../composables/schemas";

import { useDebounceFn } from "@vueuse/core";
import { useBabylonModelLoader } from "../composables/useBabylonModelLoader";
import { useBabylonModelPhysics } from "../composables/useBabylonModelPhysics";
import type { useVircadia } from "@vircadia/world-sdk/browser/vue";

const props = defineProps<{
    def: BabylonModelDefinition;
    scene: Scene | null;
    vircadiaWorld: ReturnType<typeof useVircadia>;
}>();

// --- Set up Babylon model pipelines ---

// 1. Asset loader is now managed by useBabylonModelLoader
// 2. Entity synchronization (generic metadata)
// Define metadata schema & type

// Initialize generic entity sync
const entityNameRef = ref(props.def.entityName || props.def.fileName);

// Vircadia connection manager
const vircadia = props.vircadiaWorld;

// Get current sessionId from vircadia connection
const sessionId = computed(
    () => vircadia.connectionInfo.value.sessionId ?? null,
);

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

// Helper function to retrieve metadata for an entity
async function retrieveEntityMetadata(
    entityName: string,
): Promise<Map<string, unknown> | null> {
    if (!vircadia) {
        console.error("Vircadia instance not found");
        return null;
    }

    try {
        // Fetch all metadata for this entity
        const metadataResult = await vircadia.client.Utilities.Connection.query(
            {
                query: "SELECT metadata__key, metadata__value FROM entity.entity_metadata WHERE general__entity_name = $1",
                parameters: [entityName],
            },
        );

        if (Array.isArray(metadataResult.result)) {
            // Reconstruct metadata map from rows
            const metadataMap = new Map<string, unknown>();
            for (const row of metadataResult.result) {
                metadataMap.set(row.metadata__key, row.metadata__value);
            }
            return metadataMap;
        }
    } catch (e) {
        console.error("Failed to retrieve metadata:", e);
    }
    return null;
}

// Debounced update function using metadata table for granular updates
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

        // Helper function to update metadata
        const updateMetadata = async (key: string, value: unknown) => {
            await vircadia.client.Utilities.Connection.query({
                query: `INSERT INTO entity.entity_metadata (general__entity_name, metadata__key, metadata__value, group__sync)
                        VALUES ($1, $2, $3, $4)
                        ON CONFLICT (general__entity_name, metadata__key) 
                        DO UPDATE SET metadata__value = EXCLUDED.metadata__value`,
                parameters: [entityNameRef.value, key, value, "public.NORMAL"],
            });
        };

        // Update position if changed
        if (
            currentMeta.position &&
            (currentMeta.position.x !== newPos.x ||
                currentMeta.position.y !== newPos.y ||
                currentMeta.position.z !== newPos.z)
        ) {
            await updateMetadata("position", newPos);
        }

        // Update rotation if changed
        if (
            currentMeta.rotation &&
            (currentMeta.rotation.x !== newRot.x ||
                currentMeta.rotation.y !== newRot.y ||
                currentMeta.rotation.z !== newRot.z ||
                currentMeta.rotation.w !== newRot.w)
        ) {
            await updateMetadata("rotation", newRot);
        }

        // Update type if changed
        if (currentMeta.type !== "Model") {
            await updateMetadata("type", "Model");
        }

        // Update modelFileName if changed
        if (currentMeta.modelFileName !== props.def.fileName) {
            await updateMetadata("modelFileName", props.def.fileName);
        }

        // Update ownerSessionId if changed
        const currentOwnerSessionId = props.def.ownerSessionId ?? null;
        if (currentMeta.ownerSessionId !== currentOwnerSessionId) {
            await updateMetadata("ownerSessionId", currentOwnerSessionId);
        }
    } catch (e: unknown) {
        console.error("Entity update failed:", e);
    } finally {
        isUpdating.value = false;
    }
}, props.def.throttleInterval ?? 1000);

// 3. Model loader and asset management
const { meshes, loadModel, asset } = useBabylonModelLoader(props.def, vircadia);

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
            // Wait for stable connection before loading assets
            if (vircadia.connectionInfo.value.status !== "connected") {
                console.log(
                    "Waiting for connection before loading model:",
                    props.def.fileName,
                );
                return;
            }

            await loadModel(s);

            // Always attempt to retrieve existing entity
            isRetrieving.value = true;
            try {
                // First check if entity exists
                const entityResult =
                    await vircadia.client.Utilities.Connection.query({
                        query: "SELECT general__entity_name FROM entity.entities WHERE general__entity_name = $1",
                        parameters: [entityNameRef.value],
                    });

                if (
                    Array.isArray(entityResult.result) &&
                    entityResult.result.length > 0
                ) {
                    // Fetch all metadata for this entity
                    const metadata = await retrieveEntityMetadata(
                        entityNameRef.value,
                    );
                    if (metadata) {
                        // Convert Map to object for validation
                        const metaObj = Object.fromEntries(metadata);
                        // Validate with schema
                        const parsed = ModelMetadataSchema.safeParse(metaObj);
                        if (parsed.success) {
                            entityMetadata.value = parsed.data;
                        } else {
                            console.warn(
                                "Invalid model metadata:",
                                parsed.error,
                            );
                            entityMetadata.value = null;
                        }
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

// Watch for connection status changes and load model when connected
watch(
    () => vircadia.connectionInfo.value.status,
    async (status) => {
        if (status === "connected" && props.scene) {
            // Retry loading model when connection becomes available
            console.log(
                "Connection established, loading model:",
                props.def.fileName,
            );
            await loadModel(props.scene);

            // Apply physics if enabled after model load
            if (props.def.enablePhysics) {
                applyPhysics(props.scene);
            }
        }
    },
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
                    // First create the entity
                    await vircadia.client.Utilities.Connection.query({
                        query: "INSERT INTO entity.entities (general__entity_name, group__sync, general__expiry__delete_since_updated_at_ms) VALUES ($1, $2, $3) RETURNING general__entity_name",
                        parameters: [
                            entityNameRef.value,
                            "public.NORMAL",
                            120000, // 120 seconds timeout for inactivity
                        ],
                    });

                    // Then insert metadata rows
                    const initialMeta = getInitialMeta();
                    const metadataInserts = [
                        { key: "type", value: initialMeta.type },
                        {
                            key: "modelFileName",
                            value: initialMeta.modelFileName,
                        },
                        { key: "position", value: initialMeta.position },
                        { key: "rotation", value: initialMeta.rotation },
                        {
                            key: "ownerSessionId",
                            value: initialMeta.ownerSessionId,
                        },
                    ];

                    for (const { key, value } of metadataInserts) {
                        await vircadia.client.Utilities.Connection.query({
                            query: `INSERT INTO entity.entity_metadata (general__entity_name, metadata__key, metadata__value, group__sync)
                                    VALUES ($1, $2, $3, $4)`,
                            parameters: [
                                entityNameRef.value,
                                key,
                                value,
                                "public.NORMAL",
                            ],
                        });
                    }

                    // Retrieve again to get the created entity
                    const metadata = await retrieveEntityMetadata(
                        entityNameRef.value,
                    );
                    if (metadata) {
                        const metaObj = Object.fromEntries(metadata);
                        const parsed = ModelMetadataSchema.safeParse(metaObj);
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
