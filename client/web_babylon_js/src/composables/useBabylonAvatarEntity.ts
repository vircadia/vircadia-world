import { ref, watch, computed, type Ref } from "vue";
import { useThrottleFn } from "@vueuse/core";
import { useEntity } from "@vircadia/world-sdk/browser/vue";
import type { ZodSchema } from "zod";

// ───────── Avatar entity composable ─────────
// Manages retrieval, creation, and metadata updates for an avatar entity in Vircadia World.
// - Retrieves or creates the entity with initial metadata validated by Zod.
// - Exposes loading and error states.
// - Provides a throttled update function for metadata changes.
export function useBabylonAvatarEntity<M>(
    entityNameRef: Ref<string>,
    throttleInterval: number,
    metaDataSchema: ZodSchema<M>,
    getInitialMeta: () => M,
    getCurrentMeta: () => M,
) {
    const avatarEntity = useEntity({
        // A reactive ref holding the avatar's unique name; triggers re-fetch/create on change.
        entityName: entityNameRef,
        // SQL SELECT fragment; load any columns needed for usage.
        selectClause: "general__entity_name, meta__data",
        // SQL INSERT snippet; sets the entity with the given values if needed.
        insertClause:
            "(general__entity_name, meta__data) VALUES ($1, $2) RETURNING general__entity_name",
        // Values for INSERT: the values to insert into the entity.
        insertParams: [entityNameRef.value, JSON.stringify(getInitialMeta())],
        // Zod schema for parsing and typing the metadata on retrieval.
        metaDataSchema,
        // Fallback metadata used if parsing fails or before creation.
        defaultMetaData: getInitialMeta(),
    });

    // Separate loading states into retrieving, creating, and updating
    const isRetrieving = computed(() => avatarEntity.retrieving.value);
    const isCreating = computed(() => avatarEntity.creating.value);
    const isUpdating = computed(() => avatarEntity.updating.value);

    const hasError = ref(false);
    const errorMessage = ref<string>("");

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

    return {
        avatarEntity,
        isRetrieving,
        isCreating,
        isUpdating,
        hasError,
        errorMessage,
        throttledUpdate,
    };
}
