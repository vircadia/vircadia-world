import { ref, watch, type Ref } from "vue";
import { useThrottleFn } from "@vueuse/core";
import { useEntity } from "@vircadia/world-sdk/browser/vue";
import type { ZodSchema } from "zod";

export function useAvatarEntity<M>(
    entityNameRef: Ref<string>,
    throttleInterval: number,
    metaDataSchema: ZodSchema<M>,
    getInitialMeta: () => M,
    getCurrentMeta: () => M,
) {
    const avatarEntity = useEntity({
        entityName: entityNameRef,
        selectClause: "general__entity_name, meta__data",
        insertClause:
            "(general__entity_name, meta__data) VALUES ($1, $2) RETURNING general__entity_name",
        insertParams: [entityNameRef.value, JSON.stringify(getInitialMeta())],
        metaDataSchema,
        defaultMetaData: getInitialMeta(),
    });

    const isLoading = ref(false);
    const hasError = ref(false);
    const errorMessage = ref<string>("");

    // Reflect retrieving/creating/updating state
    watch(
        [
            () => avatarEntity.retrieving.value,
            () => avatarEntity.creating.value,
            () => avatarEntity.updating.value,
        ],
        ([retrieving, creating, updating]) => {
            isLoading.value = retrieving || creating || updating;
        },
        { immediate: true },
    );

    // Reflect errors
    watch(
        () => avatarEntity.error.value,
        (error) => {
            hasError.value = !!error;
            errorMessage.value = error ? `Entity error: ${error}` : "";
        },
    );

    // Throttled update
    const throttledUpdate = useThrottleFn(async () => {
        if (!avatarEntity.entityData.value?.general__entity_name) {
            return;
        }
        const updatedMeta = getCurrentMeta();
        await avatarEntity.executeUpdate("meta__data = $1", [
            JSON.stringify(updatedMeta),
        ]);
    }, throttleInterval);

    return { avatarEntity, isLoading, hasError, errorMessage, throttledUpdate };
}
