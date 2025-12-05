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
    discoveryPollingInterval: {
        type: Number,
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

let reflectUnsubscribe: (() => void) | null = null;

const loadingBySession = ref<Record<string, boolean>>({});

const areOtherAvatarsLoading = computed(() => {
    return Object.values(loadingBySession.value).some((value) => value);
});

// Track metadata loads per session to avoid repeated queries
const metadataLoadedSessions = new Set<string>();
const metadataLoadingSessions = new Set<string>();

function markLoaded(sessionId: string): void {
    loadingBySession.value[sessionId] = false;
}

function markDisposed(sessionId: string): void {
    delete loadingBySession.value[sessionId];
}

// removed unused void references; methods are exposed via defineExpose

async function pollForOtherAvatars(): Promise<void> {
    try {
        const startTime = Date.now();

        const result = await vircadiaWorld.client.connection.query({
            query: "SELECT general__entity_name FROM entity.entities WHERE group__sync = $1 AND general__entity_name LIKE 'avatar:%'",
            parameters: [props.entitySyncGroup],
            timeoutMs: 5000,
        });

        if (result.result && Array.isArray(result.result)) {
            const foundFullSessionIds: string[] = [];
            const entities = result.result as Array<{
                general__entity_name: string;
            }>;

            for (const entity of entities) {
                const match =
                    entity.general__entity_name.match(/^avatar:(.+)$/);
                if (match) {
                    if (match && match[1] !== vircadiaWorld.connectionInfo.value.fullSessionId) {
                        foundFullSessionIds.push(match[1]);
                        if (loadingBySession.value[match[1]] == null) {
                            loadingBySession.value[match[1]] = true;
                        }
                        // Initialize data holders immediately to avoid undefineds downstream
                        initializeSessionDefaults(match[1]);
                        // Attempt metadata backfill for this session
                        void backfillSessionFromMetadata(match[1]);
                    }
                }
            }

            otherAvatarSessionIds.value = foundFullSessionIds;
            discoveryStats.value.rows = entities.length;
        }

        discoveryStats.value.lastDurationMs = Date.now() - startTime;
        discoveryStats.value.timeouts = 0;
    } catch (error) {
        console.error("[Discovery] Poll error:", error);
        discoveryStats.value.errors += 1;
        discoveryStats.value.lastError =
            error instanceof Error ? error.message : String(error);
        discoveryStats.value.lastErrorAt = new Date();
    }
}

function subscribeReflect(): void {
    if (reflectUnsubscribe) reflectUnsubscribe();
    reflectUnsubscribe = vircadiaWorld.client.connection.subscribeReflect(
        props.reflectSyncGroup,
        props.reflectChannel,
        (message) => {
            const frameStartTime = Date.now();
            try {
                const payload = message.payload as unknown;
                const frame = parseAvatarFrameMessage(payload);
                if (!frame) {
                    // Log bad frames for debugging
                    reflectStats.value.badFrames += 1;
                    reflectStats.value.lastBadFrameAt = new Date();
                    reflectStats.value.lastBadFrameError = "Failed to parse avatar frame message";
                    console.warn("[Reflect] Bad frame received - could not parse:", payload);
                    return;
                }

                let target: string | null = frame.sessionId ?? null;
                if (!target && frame.entityName?.startsWith("avatar:")) {
                    target = frame.entityName.replace(/^avatar:/, "");
                }
                if (!target) {
                    reflectStats.value.badFrames += 1;
                    reflectStats.value.lastBadFrameAt = new Date();
                    reflectStats.value.lastBadFrameError = "No valid target session ID";
                    console.warn("[Reflect] Bad frame received - no valid target:", frame);
                    return;
                }
                if (target === vircadiaWorld.connectionInfo.value.fullSessionId) {
                    // Skip our own frames
                    return;
                }

                // Track frame timing
                reflectStats.value.totalFrames += 1;
                reflectStats.value.lastFrameAt = new Date();

                // Track recent frame intervals for average calculation
                const now = Date.now();
                reflectStats.value.recentFrameTimes.push(now);
                if (reflectStats.value.recentFrameTimes.length > 100) {
                    reflectStats.value.recentFrameTimes.shift(); // Keep only last 100 frames
                }

                // Calculate average frame interval if we have enough data
                if (reflectStats.value.recentFrameTimes.length >= 2) {
                    const intervals = [];
                    for (let i = 1; i < reflectStats.value.recentFrameTimes.length; i++) {
                        intervals.push(reflectStats.value.recentFrameTimes[i] - reflectStats.value.recentFrameTimes[i - 1]);
                    }
                    reflectStats.value.avgFrameIntervalMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
                }

                // Ensure data structures exist
                initializeSessionDefaults(target);

                const existingBase = avatarDataMap.value[target];
                const modelFileName =
                    frame.modelFileName ||
                    existingBase?.modelFileName;
                const cameraOrientation = frame.cameraOrientation ||
                    existingBase?.cameraOrientation || {
                    alpha: 0,
                    beta: 0,
                    radius: 0,
                };
                avatarDataMap.value[target] = {
                    type: "avatar",
                    sessionId: target,
                    modelFileName,
                    cameraOrientation,
                } as AvatarBaseData;

                if (frame.position)
                    positionDataMap.value[target] = frame.position;
                if (frame.rotation)
                    rotationDataMap.value[target] = frame.rotation;
                if (frame.position || frame.rotation)
                    lastBasePollTimestamps.value[target] = new Date();

                if (frame.joints && jointDataMap.value[target]) {
                    for (const [jointName, jointPayload] of Object.entries(
                        frame.joints,
                    )) {
                        const parsed = parseAvatarJoint({
                            ...(jointPayload as Record<string, unknown>),
                            jointName,
                            sessionId: target,
                            type: "avatarJoint",
                        }) as AvatarJointMetadata | null;
                        if (parsed) {
                            jointDataMap.value[target].set(jointName, parsed);
                        }
                    }
                }

                if (frame.chat_messages) {
                    chatDataMap.value[target] = frame.chat_messages;
                }

                // Update base (camera) and generic timestamps
                if (frame.cameraOrientation)
                    lastCameraPollTimestamps.value[target] = new Date();
                lastPollTimestamps.value[target] = new Date();
            } catch (error) {
                // Log parse errors for debugging
                reflectStats.value.badFrames += 1;
                reflectStats.value.lastBadFrameAt = new Date();
                reflectStats.value.lastBadFrameError = error instanceof Error ? error.message : String(error);
                console.error("[Reflect] Frame processing error:", error, "for payload:", message.payload);
            }
        },
    );
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

async function backfillSessionFromMetadata(sessionId: string): Promise<void> {
    if (
        metadataLoadedSessions.has(sessionId) ||
        metadataLoadingSessions.has(sessionId)
    )
        return;
    metadataLoadingSessions.add(sessionId);
    try {
        const entityName = `avatar:${sessionId}`;
        const result = await vircadiaWorld.client.connection.query({
            query: "SELECT m.metadata__key, m.metadata__jsonb FROM entity.entity_metadata AS m JOIN entity.entities AS e ON e.general__entity_name = m.general__entity_name WHERE m.general__entity_name = $1 AND e.group__sync = $2 AND m.metadata__key IN ('type','sessionId','modelFileName','position','rotation','scale','cameraOrientation','joints','avatar_snapshot','chat_messages')",
            parameters: [entityName, props.entitySyncGroup],
            timeoutMs: 5000,
        });
        if (!result || !Array.isArray(result.result)) return;

        initializeSessionDefaults(sessionId);

        // Apply individual keys first
        const rows = result.result as Array<{
            metadata__key: string;
            metadata__jsonb: unknown;
        }>;
        const keyToValue = new Map(
            rows.map((r) => [r.metadata__key, r.metadata__jsonb]),
        );

        const base = avatarDataMap.value[sessionId];
        const modelFileName =
            (keyToValue.get("modelFileName") as string) ||
            base.modelFileName ||
            "babylon.avatar.glb";
        const cameraOrientation = (keyToValue.get("cameraOrientation") as {
            alpha: number;
            beta: number;
            radius: number;
        }) ||
            base.cameraOrientation || { alpha: 0, beta: 0, radius: 0 };
        avatarDataMap.value[sessionId] = {
            type: "avatar",
            sessionId,
            modelFileName,
            cameraOrientation,
        } as AvatarBaseData;

        const posPayload = keyToValue.get("position");
        if (posPayload) {
            const parsed = parseAvatarPosition(posPayload);
            if (parsed) positionDataMap.value[sessionId] = parsed;
        }
        const rotPayload = keyToValue.get("rotation");
        if (rotPayload) {
            const parsed = parseAvatarRotation(rotPayload);
            if (parsed) rotationDataMap.value[sessionId] = parsed;
        }
        const jointsPayload = keyToValue.get("joints");
        if (jointsPayload && typeof jointsPayload === "object") {
            for (const [jointName, jointPayload] of Object.entries(
                jointsPayload as Record<string, unknown>,
            )) {
                const parsed = parseAvatarJoint(jointPayload) as
                    | (AvatarJointMetadata & { type: "avatarJoint" })
                    | null;
                if (parsed)
                    jointDataMap.value[sessionId].set(jointName, parsed);
            }
        }

        const chatPayload = keyToValue.get("chat_messages");
        if (chatPayload) {
            const parsed = ChatEntityMetadataSchema.safeParse({ messages: chatPayload });
            if (parsed.success) {
                chatDataMap.value[sessionId] = parsed.data.messages;
            }
        }

        // If aggregated snapshot exists, apply any missing aspects
        const snapshot = keyToValue.get("avatar_snapshot") as
            | {
                position?: unknown;
                rotation?: unknown;
                scale?: unknown;
                cameraOrientation?: {
                    alpha: number;
                    beta: number;
                    radius: number;
                };
                joints?: Record<string, unknown>;
            }
            | undefined;
        if (snapshot) {
            if (snapshot.position && !posPayload) {
                const parsed = parseAvatarPosition(snapshot.position);
                if (parsed) positionDataMap.value[sessionId] = parsed;
            }
            if (snapshot.rotation && !rotPayload) {
                const parsed = parseAvatarRotation(snapshot.rotation);
                if (parsed) rotationDataMap.value[sessionId] = parsed;
            }
            if (
                snapshot.cameraOrientation &&
                !keyToValue.get("cameraOrientation")
            ) {
                avatarDataMap.value[sessionId] = {
                    ...avatarDataMap.value[sessionId],
                    cameraOrientation: snapshot.cameraOrientation,
                } as AvatarBaseData;
            }
            if (snapshot.joints && !jointsPayload) {
                for (const [jointName, jointPayload] of Object.entries(
                    snapshot.joints as Record<string, unknown>,
                )) {
                    const parsed = parseAvatarJoint(jointPayload) as
                        | (AvatarJointMetadata & { type: "avatarJoint" })
                        | null;
                    if (parsed)
                        jointDataMap.value[sessionId].set(jointName, parsed);
                }
            }
        }

        metadataLoadedSessions.add(sessionId);
    } catch (e) {
        console.warn("[OtherAvatars] metadata backfill failed", e);
    } finally {
        metadataLoadingSessions.delete(sessionId);
    }
}

// Use useInterval for polling other avatars
const { pause: pauseDiscovery, resume: resumeDiscovery } = useInterval(
    computed(() => {
        const interval = props.discoveryPollingInterval;
        console.log(`[Discovery] Polling interval: ${interval}ms`);
        return interval;
    }),
    {
        controls: true,
        immediate: true,
        callback: pollForOtherAvatars,
    },
);

onMounted(() => {
    console.log("[Discovery] Component mounted, starting discovery...");
    // Wait for connection to be ready before subscribing
    let unwatch: (() => void) | null = null;
    unwatch = watch(
        () => vircadiaWorld.connectionInfo.value.status,
        (s) => {
            if (s === "connected") {
                subscribeReflect();
                resumeDiscovery();
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
    if (reflectUnsubscribe) reflectUnsubscribe();
    pauseDiscovery();
});

watch(
    () => [props.reflectSyncGroup, props.reflectChannel],
    () => subscribeReflect(),
);

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
