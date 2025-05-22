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

    // Helper to retry updates when the entity is busy
    function safeExecuteUpdate(
        query: string,
        params: unknown[],
        retryInterval: number = throttleInterval,
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

    // Debounced update of metadata
    const debouncedUpdate = useDebounceFn(() => {
        if (!entity.entityData.value?.general__entity_name) {
            console.warn("Cannot update entity: No entity name available");
            return;
        }
        const updatedMeta = getCurrentMeta();
        safeExecuteUpdate("meta__data = $2", [JSON.stringify(updatedMeta)]);
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
