import { ref, watch, inject, computed, type Ref } from "vue";
import { useDebounceFn } from "@vueuse/core";
import {
    useEntity,
    useVircadiaInstance,
} from "@vircadia/world-sdk/browser/vue";
import type { BabylonModelDefinition } from "./types";

// Manages Vircadia entity metadata for a 3D model: retrieval, creation, and debounced updates.
export function useBabylonModelEntity(
    def: BabylonModelDefinition,
    position: Ref<{ x: number; y: number; z: number }>,
    rotation: Ref<{ x: number; y: number; z: number; w: number }>,
) {
    const vircadia = inject(useVircadiaInstance());
    if (!vircadia) {
        throw new Error("Vircadia instance not found");
    }

    // Reactive entity name, defaulting to fileName
    const entityName = ref(def.entityName || def.fileName);

    // Initialize useEntity for metadata sync
    const entity = useEntity({
        entityName,
        selectClause: "general__entity_name, meta__data",
        insertClause:
            "(general__entity_name, meta__data) VALUES ($1, $2) RETURNING general__entity_name",
        insertParams: [
            entityName.value,
            JSON.stringify({
                type: { value: "Model" },
                modelURL: { value: def.fileName },
                position: def.position ? { value: def.position } : undefined,
                rotation: def.rotation ? { value: def.rotation } : undefined,
            }),
        ],
    });

    // Separate loading states for entity operations
    const isRetrieving = computed(() => entity.retrieving.value);
    const isCreating = computed(() => entity.creating.value);
    const isUpdating = computed(() => entity.updating.value);

    // Helper to retry updates when the entity is busy
    function safeExecuteUpdate(
        query: string,
        params: unknown[],
        retryInterval: number = def.throttleInterval ?? 1000,
    ): void {
        if (
            entity.retrieving.value ||
            entity.creating.value ||
            entity.updating.value
        ) {
            console.warn(`Entity busy, retrying update in ${retryInterval}ms`);
            setTimeout(
                () => safeExecuteUpdate(query, params, retryInterval),
                retryInterval,
            );
            return;
        }
        entity.executeUpdate(query, params).catch((e: unknown) => {
            console.error("Entity update failed:", e);
            if (e instanceof Error && e.message.includes("Another operation")) {
                console.warn(
                    `Retrying update after failure in ${retryInterval}ms`,
                );
                setTimeout(
                    () => safeExecuteUpdate(query, params, retryInterval),
                    retryInterval,
                );
            }
        });
    }

    // Debounced update of position/rotation metadata
    const debouncedUpdate = useDebounceFn(() => {
        if (!entity.entityData.value?.general__entity_name) {
            console.warn("Cannot update entity: No entity name available");
            return;
        }
        const metaData = entity.entityData.value.meta__data || {};
        const updatedMeta = {
            ...metaData,
            position: { value: position.value },
            rotation: { value: rotation.value },
        };
        console.log("Updating entity position and rotation:", updatedMeta);
        safeExecuteUpdate("meta__data = $2", [JSON.stringify(updatedMeta)]);
    }, def.throttleInterval ?? 1000);

    // Watch local transforms and push updates
    watch(position, () => debouncedUpdate(), { deep: true });
    watch(rotation, () => debouncedUpdate(), { deep: true });

    return {
        entityName,
        entity,
        debouncedUpdate,
        isRetrieving,
        isCreating,
        isUpdating,
    };
}
