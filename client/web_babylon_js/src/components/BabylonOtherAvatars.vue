<template>
    <slot
        :other-avatar-session-ids="otherAvatarSessionIds"
        :avatar-data-map="avatarDataMap"
        :position-data-map="positionDataMap"
        :rotation-data-map="rotationDataMap"
        :joint-data-map="jointDataMap"
    />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, toRefs } from "vue";
import { useInterval } from "@vueuse/core";

import type {
    AvatarJointMetadata,
    AvatarBaseData,
    AvatarPositionData,
    AvatarRotationData,
} from "@schemas";
import {
    parseAvatarPosition,
    parseAvatarRotation,
    parseAvatarJoint,
} from "@schemas";
import type { useVircadia } from "@vircadia/world-sdk/browser/vue";

const props = defineProps({
    scene: { type: Object, required: true },
    vircadiaWorld: {
        type: Object as () => ReturnType<typeof useVircadia>,
        required: true,
    },
    currentFullSessionId: {
        type: String,
        required: false,
        default: null,
    },
    discoveryPollingInterval: {
        type: Number,
        required: true,
    },
    reflectSyncGroup: { type: String, required: true },
    reflectChannel: { type: String, required: true },
});
const { scene } = toRefs(props);
void scene;

function ensure<T = unknown>(value: unknown, message: string): T {
    if (value == null) throw new Error(message);
    return value as T;
}

const vircadiaWorld = ensure<ReturnType<typeof useVircadia>>(
    props.vircadiaWorld,
    "Vircadia instance not found in BabylonOtherAvatars",
);

const currentFullSessionIdComputed = computed(() => {
    return (
        props.currentFullSessionId ||
        vircadiaWorld.connectionInfo.value.fullSessionId ||
        null
    );
});

const otherAvatarSessionIds = ref<string[]>([]);

const avatarDataMap = ref<Record<string, AvatarBaseData>>({});
const positionDataMap = ref<Record<string, AvatarPositionData>>({});
const rotationDataMap = ref<Record<string, AvatarRotationData>>({});
const jointDataMap = ref<Record<string, Map<string, AvatarJointMetadata>>>({});

const discoveryStats = ref({
    lastDurationMs: 0,
    rows: 0,
    timeouts: 0,
    errors: 0,
    lastError: null as string | null,
    lastErrorAt: null as Date | null,
});

let reflectUnsubscribe: (() => void) | null = null;

const loadingBySession = ref<Record<string, boolean>>({});

// Track metadata loads per session to avoid repeated queries
const metadataLoadedSessions = new Set<string>();
const metadataLoadingSessions = new Set<string>();

function markLoaded(sessionId: string): void {
    loadingBySession.value[sessionId] = false;
}

function markDisposed(sessionId: string): void {
    delete loadingBySession.value[sessionId];
}

void markLoaded;
void markDisposed;

async function pollForOtherAvatars(): Promise<void> {
    try {
        const startTime = Date.now();
        console.log("[Discovery] Starting poll for other avatars...");

        const result = await vircadiaWorld.client.Utilities.Connection.query({
            query: "SELECT general__entity_name FROM entity.entities WHERE group__sync = $1 AND general__entity_name LIKE 'avatar:%'",
            parameters: ["public.NORMAL"],
            timeoutMs: 5000,
        });

        console.log("[Discovery] Query result:", result);

        if (result.result && Array.isArray(result.result)) {
            const currentFullSessionId = currentFullSessionIdComputed.value;
            const foundFullSessionIds: string[] = [];
            const entities = result.result as Array<{
                general__entity_name: string;
            }>;

            console.log(
                `[Discovery] Found ${entities.length} entities, current session: ${currentFullSessionId}`,
            );

            for (const entity of entities) {
                const match =
                    entity.general__entity_name.match(/^avatar:(.+)$/);
                if (match) {
                    if (match && match[1] !== currentFullSessionId) {
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
            console.log(
                `[Discovery] Found ${foundFullSessionIds.length} other avatars:`,
                foundFullSessionIds,
            );
        }

        discoveryStats.value.lastDurationMs = Date.now() - startTime;
        discoveryStats.value.timeouts = 0;
        console.log(
            `[Discovery] Poll completed in ${discoveryStats.value.lastDurationMs}ms`,
        );
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
    reflectUnsubscribe =
        vircadiaWorld.client.Utilities.Connection.subscribeReflect(
            props.reflectSyncGroup,
            props.reflectChannel,
            (message) => {
                try {
                    const payload = message.payload as unknown;
                    if (!payload || typeof payload !== "object") return;
                    // Support both old per-type payloads and new aggregated avatar_frame
                    let target = (payload as { sessionId?: string }).sessionId;
                    if (!target) {
                        const entityName = (
                            payload as {
                                entityName?: string;
                            }
                        ).entityName;
                        if (entityName && entityName.startsWith("avatar:")) {
                            target = entityName.replace(/^avatar:/, "");
                        }
                    }
                    if (!target) return;
                    if (target === currentFullSessionIdComputed.value) return;

                    if (!avatarDataMap.value[target])
                        avatarDataMap.value[target] = {
                            type: "avatar",
                            sessionId: target,
                            cameraOrientation: { alpha: 0, beta: 0, radius: 0 },
                            modelFileName: "",
                        } as AvatarBaseData;
                    if (!positionDataMap.value[target])
                        positionDataMap.value[target] = {
                            x: 0,
                            y: 0,
                            z: 0,
                        } as AvatarPositionData;
                    if (!rotationDataMap.value[target])
                        rotationDataMap.value[target] = {
                            x: 0,
                            y: 0,
                            z: 0,
                            w: 1,
                        } as AvatarRotationData;
                    if (!jointDataMap.value[target])
                        jointDataMap.value[target] = new Map<
                            string,
                            AvatarJointMetadata
                        >();

                    const typeField = (payload as { type?: string }).type;
                    if (typeField === "avatar_frame") {
                        // Populate base data if present
                        const frame = payload as {
                            modelFileName?: string;
                            cameraOrientation?: {
                                alpha: number;
                                beta: number;
                                radius: number;
                            };
                            position?: unknown;
                            rotation?: unknown;
                            joints?: Record<string, unknown>;
                        };
                        const existingBase = avatarDataMap.value[target];
                        const modelFileName =
                            frame.modelFileName ||
                            existingBase?.modelFileName ||
                            "babylon.avatar.glb";
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
                        } as unknown as (typeof avatarDataMap.value)[string];

                        // Position / rotation
                        if (frame.position) {
                            const parsed = parseAvatarPosition(frame.position);
                            if (parsed) positionDataMap.value[target] = parsed;
                        }
                        if (frame.rotation) {
                            const parsed = parseAvatarRotation(frame.rotation);
                            if (parsed) rotationDataMap.value[target] = parsed;
                        }

                        // Joints map
                        if (
                            frame.joints &&
                            typeof frame.joints === "object" &&
                            jointDataMap.value[target]
                        ) {
                            for (const [
                                jointName,
                                jointPayload,
                            ] of Object.entries(frame.joints)) {
                                const parsed = parseAvatarJoint(jointPayload) as
                                    | (AvatarJointMetadata & {
                                          type: "avatarJoint";
                                      })
                                    | null;
                                if (parsed) {
                                    jointDataMap.value[target].set(
                                        jointName,
                                        parsed,
                                    );
                                }
                            }
                        }
                        return;
                    }
                    if (typeField === "avatar") {
                        const parsed = payload as AvatarBaseData;
                        avatarDataMap.value[target] = parsed;
                    } else if (typeField === "position") {
                        const parsed = parseAvatarPosition(payload);
                        if (parsed) positionDataMap.value[target] = parsed;
                    } else if (typeField === "rotation") {
                        const parsed = parseAvatarRotation(payload);
                        if (parsed) rotationDataMap.value[target] = parsed;
                    } else if (typeField === "avatarJoint") {
                        const parsed = parseAvatarJoint(payload) as
                            | (AvatarJointMetadata & { type: "avatarJoint" })
                            | null;
                        if (parsed)
                            jointDataMap.value[target].set(
                                parsed.jointName,
                                parsed,
                            );
                    }
                } catch {
                    // ignore parse errors
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
        positionDataMap.value[sessionId] = { x: 0, y: 0, z: 0 } as AvatarPositionData;
    if (!rotationDataMap.value[sessionId])
        rotationDataMap.value[sessionId] = { x: 0, y: 0, z: 0, w: 1 } as AvatarRotationData;
    if (!jointDataMap.value[sessionId])
        jointDataMap.value[sessionId] = new Map<string, AvatarJointMetadata>();
}

async function backfillSessionFromMetadata(sessionId: string): Promise<void> {
    if (metadataLoadedSessions.has(sessionId) || metadataLoadingSessions.has(sessionId)) return;
    metadataLoadingSessions.add(sessionId);
    try {
        const entityName = `avatar:${sessionId}`;
        const result = await vircadiaWorld.client.Utilities.Connection.query({
            query:
                "SELECT metadata__key, metadata__value FROM entity.entity_metadata WHERE general__entity_name = $1 AND group__sync = $2 AND metadata__key IN ('type','sessionId','modelFileName','position','rotation','scale','cameraOrientation','joints','avatar_snapshot')",
            parameters: [entityName, "public.NORMAL"],
            timeoutMs: 5000,
        });
        if (!result || !Array.isArray(result.result)) return;

        initializeSessionDefaults(sessionId);

        // Apply individual keys first
        const rows = result.result as Array<{ metadata__key: string; metadata__value: unknown }>;
        const keyToValue = new Map(rows.map((r) => [r.metadata__key, r.metadata__value]));

        const base = avatarDataMap.value[sessionId];
        const modelFileName = (keyToValue.get("modelFileName") as string) || base.modelFileName || "babylon.avatar.glb";
        const cameraOrientation =
            (keyToValue.get("cameraOrientation") as { alpha: number; beta: number; radius: number }) ||
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
                if (parsed) jointDataMap.value[sessionId].set(jointName, parsed);
            }
        }

        // If aggregated snapshot exists, apply any missing aspects
        const snapshot = keyToValue.get("avatar_snapshot") as
            | {
                  position?: unknown;
                  rotation?: unknown;
                  scale?: unknown;
                  cameraOrientation?: { alpha: number; beta: number; radius: number };
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
            if (snapshot.cameraOrientation && !keyToValue.get("cameraOrientation")) {
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
                    if (parsed) jointDataMap.value[sessionId].set(jointName, parsed);
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
    discoveryStats,
});
</script>

