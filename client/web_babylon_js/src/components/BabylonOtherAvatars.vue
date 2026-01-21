<template>
    <slot :other-avatar-session-ids="otherAvatarSessionIds" :avatar-data-map="avatarDataMap"
        :position-data-map="positionDataMap" :rotation-data-map="rotationDataMap" :joint-data-map="jointDataMap"
        :chat-data-map="chatDataMap" />
</template>

<script setup lang="ts">
import type {
    AvatarBaseData,
    AvatarJointMetadata,
    AvatarPositionData,
    AvatarRotationData,
} from "@schemas";
import {
    parseAvatarFrameMessage,
    parseAvatarJoint,
    parseAvatarPosition,
    parseAvatarRotation,
    ChatEntityMetadataSchema,
    type ChatMessage,
} from "@/schemas";
import { useInterval } from "@vueuse/core";
import { computed, onMounted, onUnmounted, ref, toRefs, watch } from "vue";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";

const props = defineProps({
    scene: { type: Object, required: true },
    vircadiaWorld: {
        type: Object as () => VircadiaWorldInstance,
        required: true,
    },
    reflectSyncGroup: { type: String, required: true },
    reflectChannel: { type: String, required: true },
    entitySyncGroup: { type: String, required: true },
});
const { scene } = toRefs(props);
void scene;

function ensure<T = unknown>(value: unknown, message: string): T {
    if (value == null) throw new Error(message);
    return value as T;
}

const vircadiaWorld = ensure<VircadiaWorldInstance>(
    props.vircadiaWorld,
    "Vircadia instance not found in BabylonOtherAvatars",
);

const otherAvatarSessionIds = ref<string[]>([]);

const avatarDataMap = ref<Record<string, AvatarBaseData>>({});
const positionDataMap = ref<Record<string, AvatarPositionData>>({});
const rotationDataMap = ref<Record<string, AvatarRotationData>>({});

const jointDataMap = ref<Record<string, Map<string, AvatarJointMetadata>>>({});
const chatDataMap = ref<Record<string, ChatMessage[]>>({});

// Delivery timestamps for debug
const lastPollTimestamps = ref<Record<string, Date | null>>({});
const lastBasePollTimestamps = ref<Record<string, Date | null>>({});
const lastCameraPollTimestamps = ref<Record<string, Date | null>>({});

const discoveryStats = ref({
    lastDurationMs: 0,
    rows: 0,
    timeouts: 0,
    errors: 0,
    lastError: null as string | null,
    lastErrorAt: null as Date | null,
});

// Reflect stats for tracking frame reception
const reflectStats = ref({
    totalFrames: 0,
    badFrames: 0,
    lastFrameAt: null as Date | null,
    lastBadFrameAt: null as Date | null,
    lastBadFrameError: null as string | null,
    recentFrameTimes: [] as number[],
    avgFrameIntervalMs: 0,
});

let gameStateUnsubscribe: (() => void) | null = null;

const loadingBySession = ref<Record<string, boolean>>({});

const areOtherAvatarsLoading = computed(() => {
    return Object.values(loadingBySession.value).some((value) => value);
});

function markLoaded(sessionId: string): void {
    loadingBySession.value[sessionId] = false;
}

function markDisposed(sessionId: string): void {
    delete loadingBySession.value[sessionId];
}

function initializeSessionDefaults(sessionId: string): void {
    if (!avatarDataMap.value[sessionId])
        avatarDataMap.value[sessionId] = {
            type: "avatar",
            sessionId,
            cameraOrientation: { alpha: 0, beta: 0, radius: 0 },
            modelFileName: "babylon.avatar.glb",
        } as AvatarBaseData;
    if (!positionDataMap.value[sessionId])
        positionDataMap.value[sessionId] = {
            x: 0,
            y: 0,
            z: 0,
        } as AvatarPositionData;
    if (!rotationDataMap.value[sessionId])
        rotationDataMap.value[sessionId] = {
            x: 0,
            y: 0,
            z: 0,
            w: 1,
        } as AvatarRotationData;
    if (!jointDataMap.value[sessionId])
        jointDataMap.value[sessionId] = new Map<string, AvatarJointMetadata>();
    if (!chatDataMap.value[sessionId])
        chatDataMap.value[sessionId] = [];
    if (!lastPollTimestamps.value[sessionId])
        lastPollTimestamps.value[sessionId] = null;
    if (!lastBasePollTimestamps.value[sessionId])
        lastBasePollTimestamps.value[sessionId] = null;
    if (!lastCameraPollTimestamps.value[sessionId])
        lastCameraPollTimestamps.value[sessionId] = null;
}

function subscribeGameState(): void {
    if (gameStateUnsubscribe) gameStateUnsubscribe();
    console.log("[Discovery] Subscribing to Game State Updates");
    // Cast to any to access subscribeGameState until types are fully propagated
    gameStateUnsubscribe = (vircadiaWorld.client.connection as any).subscribeGameState(
        (message: any) => {
            // Filter by sync group
            if (message.syncGroup !== props.entitySyncGroup) return;

            if (message.updateType !== "FULL_SNAPSHOT" && message.updateType !== "DELTA") return;

            // TODO: Use imported type when availability is confirmed
            const entities = message.data as Array<{
                id: string;
                position: { x: number; y: number; z: number };
                rotation: { x: number; y: number; z: number; w: number };
                avatar?: {
                    avatar__url?: string;
                    joints?: Record<string, any>;
                    avatar__data?: any;
                };
            }>;

            const foundFullSessionIds: string[] = [];

            for (const entity of entities) {
                const sessionId = entity.id;
                // Skip self
                const info = vircadiaWorld.connectionInfo.value;
                const selfAgentId = info.agentId;
                const selfSessionId = info.sessionId;

                // entity.id is agentId from server
                if (sessionId === selfAgentId || sessionId === selfSessionId) continue;

                foundFullSessionIds.push(sessionId);
                initializeSessionDefaults(sessionId);

                // Position & Rotation
                if (entity.position) positionDataMap.value[sessionId] = entity.position;
                if (entity.rotation) rotationDataMap.value[sessionId] = entity.rotation;

                // Avatar Data (if present)
                if (entity.avatar) {
                    const existingBase = avatarDataMap.value[sessionId];
                    const modelFileName = entity.avatar.avatar__url || existingBase?.modelFileName || "babylon.avatar.glb";

                    // Extract camera orientation from avatar__data
                    let cameraOrientation = existingBase?.cameraOrientation;
                    if (entity.avatar.avatar__data && typeof entity.avatar.avatar__data === 'object') {
                        const ad = entity.avatar.avatar__data as any;
                        if (ad.cameraOrientation) {
                            cameraOrientation = ad.cameraOrientation;
                        }
                    }

                    avatarDataMap.value[sessionId] = {
                        ...existingBase,
                        modelFileName,
                        sessionId,
                        type: "avatar",
                        cameraOrientation: cameraOrientation || { alpha: 0, beta: 0, radius: 0 }
                    };

                    // Joints
                    if (entity.avatar.joints) {
                        const targetJoints = jointDataMap.value[sessionId];
                        for (const [jointName, jointData] of Object.entries(entity.avatar.joints)) {
                            // Assuming jointData matches parseAvatarJoint expectation or is close enough
                            // The server sends { position, rotation, scale }
                            const parsed = parseAvatarJoint({ ...jointData as any, jointName, sessionId, type: "avatarJoint" });
                            if (parsed) {
                                targetJoints.set(jointName, parsed as AvatarJointMetadata);
                            }
                        }
                    }
                }

                lastPollTimestamps.value[sessionId] = new Date();
            }

            otherAvatarSessionIds.value = foundFullSessionIds;

            // Update stats (reusing reflectStats for now to avoid breaking exposed API)
            reflectStats.value.totalFrames++;
            reflectStats.value.lastFrameAt = new Date();
        }
    );
}

onMounted(() => {
    console.log("[Discovery] Component mounted, listening for Game State...");
    // Wait for connection to be ready before subscribing
    let unwatch: (() => void) | null = null;
    unwatch = watch(
        () => vircadiaWorld.connectionInfo.value.status,
        (s) => {
            if (s === "connected") {
                subscribeGameState();
                if (unwatch) {
                    const stop = unwatch;
                    unwatch = null;
                    stop();
                }
            }
        },
        { immediate: true },
    );
});

onUnmounted(() => {
    console.log("[Discovery] Component unmounting, stopping discovery...");
    if (gameStateUnsubscribe) gameStateUnsubscribe();
});

defineExpose({
    otherAvatarSessionIds,
    avatarDataMap,
    positionDataMap,
    rotationDataMap,
    jointDataMap,
    chatDataMap,
    discoveryStats,
    reflectStats,
    lastPollTimestamps,
    lastBasePollTimestamps,
    lastCameraPollTimestamps,
    loadingBySession,
    areOtherAvatarsLoading,
    markLoaded,
    markDisposed,
    // Sync configuration
    reflectSyncGroup: computed(() => props.reflectSyncGroup),
    entitySyncGroup: computed(() => props.entitySyncGroup),
    reflectChannel: computed(() => props.reflectChannel),
});
</script>
