<template>
    <slot
        v-for="otherFullSessionId in otherAvatarSessionIds"
        :key="otherFullSessionId"
        :session-id="otherFullSessionId"
        :scene="scene"
        :vircadia-world="vircadiaWorld"
        :on-ready="() => markLoaded(otherFullSessionId)"
        :on-dispose="() => markDisposed(otherFullSessionId)"
        :on-avatar-metadata="(e: { sessionId: string; metadata: AvatarMetadata }) => { otherAvatarsMetadataLocal[e.sessionId] = e.metadata; emitMetadataUpdate(); }"
        :on-avatar-removed="(e: { sessionId: string }) => { delete otherAvatarsMetadataLocal[e.sessionId]; emitMetadataUpdate(); }"
    />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, toRefs } from "vue";

import type { AvatarMetadata } from "@/composables/schemas";
import type { useVircadia } from "@vircadia/world-sdk/browser/vue";

// Emits and Props
const emit = defineEmits<{
    "update:otherAvatarsMetadata": [Record<string, AvatarMetadata>];
}>();

const props = defineProps({
    scene: { type: Object, required: true },
    vircadiaWorld: {
        type: Object as () => ReturnType<typeof useVircadia>,
        required: true,
    },
    otherAvatarsMetadata: {
        type: Object as () => Record<string, AvatarMetadata>,
        required: false,
        default: () => ({}),
    },
    currentFullSessionId: {
        type: String,
        required: false,
        default: null,
    },
    pollingInterval: {
        type: Number,
        required: false,
        default: 2000,
    },
});
const { scene } = toRefs(props);
// Mark as used in template
void scene;

// Vircadia context

function ensure<T = unknown>(value: unknown, message: string): T {
    if (value == null) throw new Error(message);
    return value as T;
}

const vircadiaWorld = ensure<ReturnType<typeof useVircadia>>(
    props.vircadiaWorld,
    "Vircadia instance not found in BabylonOtherAvatars",
);

// Discovered other avatar full session IDs (sessionId-instanceId format)
const otherAvatarSessionIds = ref<string[]>([]);

// Local metadata map mirrored to parent via v-model
const otherAvatarsMetadataLocal = ref<Record<string, AvatarMetadata>>({
    ...props.otherAvatarsMetadata,
});

watch(
    () => props.otherAvatarsMetadata,
    (val) => {
        otherAvatarsMetadataLocal.value = { ...val };
    },
    { deep: true },
);

function emitMetadataUpdate() {
    emit("update:otherAvatarsMetadata", { ...otherAvatarsMetadataLocal.value });
}

// Track loading state per discovered session
const loadingBySession = ref<Record<string, boolean>>({});

function markLoaded(sessionId: string): void {
    loadingBySession.value[sessionId] = false;
}

function markDisposed(sessionId: string): void {
    delete loadingBySession.value[sessionId];
}

// Avoid unused warnings in templates-only usage
void markLoaded;
void markDisposed;

// Polling interval id
let avatarDiscoveryInterval: number | null = null;

// Discover other avatars present in the world
async function pollForOtherAvatars(): Promise<void> {
    if (vircadiaWorld.connectionInfo.value.status !== "connected") {
        return;
    }

    try {
        const query =
            "SELECT general__entity_name FROM entity.entities WHERE general__entity_name LIKE 'avatar:%'";

        const result = await vircadiaWorld.client.Utilities.Connection.query({
            query,
            timeoutMs: 30000,
        });

        if (result.result && Array.isArray(result.result)) {
            const currentFullSessionId = props.currentFullSessionId;
            const foundFullSessionIds: string[] = [];
            const entities = result.result as Array<{
                general__entity_name: string;
            }>;

            console.log(
                "[OtherAvatars] Current full session ID:",
                currentFullSessionId,
                "Found entities:",
                entities.length,
            );
            for (const entity of entities) {
                const match =
                    entity.general__entity_name.match(/^avatar:(.+)$/);
                if (match) {
                    // match[1] contains the full sessionId-instanceId
                    const isOurs = match[1] === currentFullSessionId;
                    console.log(
                        "[OtherAvatars] Found avatar:",
                        entity.general__entity_name,
                        "Session ID:",
                        match[1],
                        "Is ours:",
                        isOurs,
                        "Is other:",
                        !isOurs,
                    );
                }
                if (match && match[1] !== currentFullSessionId) {
                    foundFullSessionIds.push(match[1]);
                    // Initialize loading state for new sessions
                    if (!(match[1] in loadingBySession.value)) {
                        loadingBySession.value[match[1]] = true;
                    }
                    if (!otherAvatarsMetadataLocal.value[match[1]]) {
                        otherAvatarsMetadataLocal.value[match[1]] = {
                            type: "avatar",
                            sessionId: match[1],
                            position: { x: 0, y: 0, z: 0 },
                            rotation: { x: 0, y: 0, z: 0, w: 1 },
                            cameraOrientation: { alpha: 0, beta: 0, radius: 5 },
                            modelFileName: "",
                        } as AvatarMetadata;
                        emitMetadataUpdate();
                    }
                }
            }

            // Update list with found full session IDs
            otherAvatarSessionIds.value = foundFullSessionIds;

            // Remove avatars that are no longer present
            for (const fullSessionId of Object.keys(
                otherAvatarsMetadataLocal.value,
            )) {
                if (!foundFullSessionIds.includes(fullSessionId)) {
                    delete otherAvatarsMetadataLocal.value[fullSessionId];
                    delete loadingBySession.value[fullSessionId];
                }
            }
            emitMetadataUpdate();
        }
    } catch (error) {
        if (error instanceof Error && error.message.includes("timeout")) {
            console.debug(
                "[OtherAvatars] Discovery query timed out, will retry",
            );
        } else {
            console.warn(
                "[OtherAvatars] Error polling for other avatars:",
                error,
            );
        }
    }
}

function startAvatarDiscovery(): void {
    if (avatarDiscoveryInterval) return;
    // Poll immediately, then at configured interval
    pollForOtherAvatars();
    avatarDiscoveryInterval = setInterval(
        pollForOtherAvatars,
        props.pollingInterval,
    );
}

function stopAvatarDiscovery(): void {
    if (avatarDiscoveryInterval) {
        clearInterval(avatarDiscoveryInterval);
        avatarDiscoveryInterval = null;
    }
}

// Manage lifecycle via connection status
watch(
    () => vircadiaWorld.connectionInfo.value.status,
    (status) => {
        if (status === "connected") {
            startAvatarDiscovery();
        } else if (status === "disconnected") {
            stopAvatarDiscovery();
            otherAvatarSessionIds.value = [];
            otherAvatarsMetadataLocal.value = {};
            loadingBySession.value = {};
            emitMetadataUpdate();
        }
    },
    { immediate: true },
);

onMounted(() => {
    if (vircadiaWorld.connectionInfo.value.status === "connected") {
        startAvatarDiscovery();
    }
});

onUnmounted(() => {
    stopAvatarDiscovery();
});

// Expose loading state for parent (true if any discovered session still loading)
const isLoading = computed<boolean>(() => {
    for (const sessionId of otherAvatarSessionIds.value) {
        if (loadingBySession.value[sessionId] !== false) return true;
    }
    return false;
});

defineExpose({
    isLoading,
    otherAvatarSessionIds,
    otherAvatarsMetadata: otherAvatarsMetadataLocal,
});
</script>

