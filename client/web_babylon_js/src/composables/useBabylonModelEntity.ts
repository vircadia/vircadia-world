import { ref, watch, inject, computed, type Ref } from "vue";
import { useDebounceFn } from "@vueuse/core";
import {
    useEntity,
    useVircadiaInstance,
} from "@vircadia/world-sdk/browser/vue";
import type { ZodSchema } from "zod";

// Manages Vircadia entity metadata for a 3D model: retrieval, creation, and debounced updates.
export function useBabylonModelEntity<M>(
    entityNameRef: Ref<string>,
    throttleInterval: number,
    metaDataSchema: ZodSchema<M>,
    getInitialMeta: () => M,
    getCurrentMeta: () => M,
) {
    const vircadia = inject(useVircadiaInstance());
    if (!vircadia) {
        throw new Error("Vircadia instance not found");
    }

    // Initialize useEntity for metadata sync
    const entity = useEntity({
        entityName: entityNameRef,
        selectClause: "general__entity_name, meta__data",
        insertClause:
            "(general__entity_name, meta__data) VALUES ($1, $2) RETURNING general__entity_name",
        insertParams: [entityNameRef.value, JSON.stringify(getInitialMeta())],
        metaDataSchema,
        defaultMetaData: getInitialMeta(),
    });

    // Separate loading states for entity operations
    const isRetrieving = computed(() => entity.retrieving.value);
    const isCreating = computed(() => entity.creating.value);
    const isUpdating = computed(() => entity.updating.value);

    // Debounced update of metadata - simplified since useEntity now handles concurrency
    const debouncedUpdate = useDebounceFn(() => {
        if (!entity.entityData.value?.general__entity_name) {
            console.warn("Cannot update entity: No entity name available");
            return;
        }
        const updatedMeta = getCurrentMeta();
        entity
            .executeUpdate("meta__data = $1", [JSON.stringify(updatedMeta)])
            .catch((e: unknown) => {
                console.error("Entity update failed:", e);
            });
    }, throttleInterval);

    // Watch local metadata and push updates
    watch(getCurrentMeta, () => debouncedUpdate(), { deep: true });

    return {
        entityName: entityNameRef,
        entity,
        debouncedUpdate,
        isRetrieving,
        isCreating,
        isUpdating,
    };
}
