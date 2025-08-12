<template>
    <BabylonOtherAvatar
        v-for="otherSessionId in otherAvatarSessionIds"
        :key="otherSessionId"
        :scene="scene"
        :session-id="otherSessionId"
        ref="otherAvatarRefs"
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
import { useVircadiaInstance } from "@vircadia/world-sdk/browser/vue";
import { useAppStore } from "@/stores/appStore";
import BabylonOtherAvatar from "./BabylonOtherAvatar.vue";

// Props
const props = defineProps({
    scene: { type: Object, required: true },
});
const { scene } = toRefs(props);

// Store and Vircadia context
const appStore = useAppStore();

function ensure(value: unknown, message: string) {
    if (value == null) throw new Error(message);
    return value as any;
}

const vircadiaWorld = ensure(
    inject(useVircadiaInstance()),
    "Vircadia instance not found in BabylonOtherAvatars",
);

// Discovered other avatar session IDs
const otherAvatarSessionIds = ref<string[]>([]);

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

                    if (!appStore.getOtherAvatarMetadata(match[1])) {
                        appStore.setOtherAvatarMetadata(match[1], {
                            type: "avatar",
                            sessionId: match[1],
                            position: { x: 0, y: 0, z: 0 },
                            rotation: { x: 0, y: 0, z: 0, w: 1 },
                            cameraOrientation: { alpha: 0, beta: 0, radius: 5 },
                            modelFileName: "",
                        });
                    }
                }
            }

            // Update list
            otherAvatarSessionIds.value = foundSessionIds;

            // Remove avatars that are no longer present
            for (const sessionId in appStore.otherAvatarsMetadata) {
                if (!foundSessionIds.includes(sessionId)) {
                    appStore.removeOtherAvatarMetadata(sessionId);
                }
            }
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
            appStore.clearOtherAvatarsMetadata();
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
});
</script>

