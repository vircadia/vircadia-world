<template>
    <BabylonOtherAvatar
        v-for="otherSessionId in otherAvatarSessionIds"
        :key="otherSessionId"
        :scene="scene"
        :vircadia-world="vircadiaWorld"
        :session-id="otherSessionId"
        ref="otherAvatarRefs"
        @avatar-metadata="(e: { sessionId: string; metadata: AvatarMetadata }) => { otherAvatarsMetadataLocal[e.sessionId] = e.metadata; emitMetadataUpdate(); }"
        @avatar-removed="(e: { sessionId: string }) => { delete otherAvatarsMetadataLocal[e.sessionId]; emitMetadataUpdate(); }"
    />
</template>

<script setup lang="ts">
import {
    ref,
    computed,
    watch,
    inject,
    onMounted,
    onUnmounted,
    toRefs,
} from "vue";

import { useAppStore } from "@/stores/appStore";
import BabylonOtherAvatar from "./BabylonOtherAvatar.vue";
import type { AvatarMetadata } from "@/composables/schemas";

// Emits and Props
const emit = defineEmits<{
    "update:otherAvatarsMetadata": [Record<string, AvatarMetadata>];
}>();

const props = defineProps({
    scene: { type: Object, required: true },
    vircadiaWorld: { type: Object as () => any, required: true },
    otherAvatarsMetadata: {
        type: Object as () => Record<string, AvatarMetadata>,
        required: false,
        default: () => ({}),
    },
});
const { scene } = toRefs(props);
// Mark as used in template
void scene;

// Store and Vircadia context
const appStore = useAppStore();

function ensure<T = unknown>(value: unknown, message: string): T {
    if (value == null) throw new Error(message);
    return value as T;
}

type VircadiaWorld = {
    connectionInfo: { value: { status: string } };
    client: {
        Utilities: {
            Connection: {
                query: (args: {
                    query: string;
                    parameters?: unknown[];
                    timeoutMs?: number;
                }) => Promise<{
                    result?: Array<{ general__entity_name: string }>;
                }>;
            };
        };
    };
};

const vircadiaWorld = ensure<VircadiaWorld>(
    props.vircadiaWorld,
    "Vircadia instance not found in BabylonOtherAvatars",
);

// Discovered other avatar session IDs
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

// Refs to child components for loading state
const otherAvatarRefs = ref<(InstanceType<typeof BabylonOtherAvatar> | null)[]>(
    [],
);

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

        if (result.result) {
            const currentFullSessionId = appStore.fullSessionId;
            const foundSessionIds: string[] = [];

            for (const entity of result.result) {
                const match =
                    entity.general__entity_name.match(/^avatar:(.+)$/);
                if (match && match[1] !== currentFullSessionId) {
                    foundSessionIds.push(match[1]);
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

            // Update list
            otherAvatarSessionIds.value = foundSessionIds;

            // Remove avatars that are no longer present
            for (const sessionId of Object.keys(
                otherAvatarsMetadataLocal.value,
            )) {
                if (!foundSessionIds.includes(sessionId)) {
                    delete otherAvatarsMetadataLocal.value[sessionId];
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
        appStore.pollingIntervals.avatarDiscovery,
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

// Expose loading state for parent
const isLoading = computed<boolean>(() => {
    for (const avatar of otherAvatarRefs.value) {
        if (avatar && !avatar.isModelLoaded) return true;
    }
    return false;
});

defineExpose({
    isLoading,
    otherAvatarSessionIds,
    otherAvatarsMetadata: otherAvatarsMetadataLocal,
});
</script>

