<template>
    <slot
        v-for="otherFullSessionId in otherAvatarSessionIds"
        :key="otherFullSessionId"
        :session-id="otherFullSessionId"
        :avatar-data="avatarDataMap[otherFullSessionId]"
        :position-data="positionDataMap[otherFullSessionId]"
        :rotation-data="rotationDataMap[otherFullSessionId]"
        :joint-data="jointDataMap[otherFullSessionId]"
        :on-ready="() => markLoaded(otherFullSessionId)"
        :on-dispose="() => markDisposed(otherFullSessionId)"
    />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, toRefs } from "vue";

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
import { Communication } from "@vircadia/world-sdk/browser/vue";
import type { useVircadia } from "@vircadia/world-sdk/browser/vue";

// No external emits needed

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

// Legacy combined metadata removed

// Separated data maps for all discovered avatars
const avatarDataMap = ref<Record<string, AvatarBaseData>>({});
const positionDataMap = ref<Record<string, AvatarPositionData>>({});
const rotationDataMap = ref<Record<string, AvatarRotationData>>({});
const jointDataMap = ref<Record<string, Map<string, AvatarJointMetadata>>>({});

// Track last poll timestamps for incremental updates
const lastPollTimestamps = ref<Record<string, Date | null>>({});

// Discovery tracking
const discoveryStats = ref({
    lastDurationMs: 0,
    rows: 0,
    timeouts: 0,
    errors: 0,
    lastError: null as string | null,
    lastErrorAt: null as Date | null,
});

// All data is received via reflection subscription

// Reflection subscription
let reflectUnsubscribe: (() => void) | null = null;

// Removed v-model sync for combined metadata

// Track loading state per discovered session
const loadingBySession = ref<Record<string, boolean>>({});

function markLoaded(sessionId: string): void {
    loadingBySession.value[sessionId] = false;
}

function markDisposed(sessionId: string): void {
    delete loadingBySession.value[sessionId];
}

// All avatar data (position, rotation, camera, joints) is received via reflect subscription; no DB polling

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
        const t0 = performance.now();
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

                    // Initialize data structures for new avatars
                    if (!avatarDataMap.value[match[1]]) {
                        // Initialize with default values - data will come via reflection
                        avatarDataMap.value[match[1]] = {
                            type: "avatar",
                            sessionId: match[1],
                            cameraOrientation: {
                                alpha: -Math.PI / 2,
                                beta: Math.PI / 3,
                                radius: 5,
                            },
                            modelFileName: "babylon.avatar.glb",
                        } as AvatarBaseData;

                        // Initialize position and rotation with defaults
                        positionDataMap.value[match[1]] = {
                            x: 0,
                            y: 0,
                            z: -5,
                        };
                        rotationDataMap.value[match[1]] = {
                            x: 0,
                            y: 0,
                            z: 0,
                            w: 1,
                        };
                    }
                    if (!jointDataMap.value[match[1]]) {
                        jointDataMap.value[match[1]] = new Map<
                            string,
                            AvatarJointMetadata
                        >();
                    }
                }
            }

            // Update list with found full session IDs
            otherAvatarSessionIds.value = foundFullSessionIds;
            // Update discovery stats
            discoveryStats.value.lastDurationMs = Math.round(
                performance.now() - t0,
            );
            discoveryStats.value.rows += entities.length;

            // Remove avatars that are no longer present
            for (const fullSessionId of Object.keys(avatarDataMap.value)) {
                if (!foundFullSessionIds.includes(fullSessionId)) {
                    delete loadingBySession.value[fullSessionId];
                    delete avatarDataMap.value[fullSessionId];
                    delete positionDataMap.value[fullSessionId];
                    delete rotationDataMap.value[fullSessionId];
                    delete jointDataMap.value[fullSessionId];
                    delete lastPollTimestamps.value[fullSessionId];
                }
            }
        }
    } catch (error) {
        if (error instanceof Error && error.message.includes("timeout")) {
            discoveryStats.value.timeouts += 1;
            console.debug(
                "[OtherAvatars] Discovery query timed out, will retry",
            );
        } else {
            discoveryStats.value.errors += 1;
            discoveryStats.value.lastError = String(error);
            discoveryStats.value.lastErrorAt = new Date();
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
        props.discoveryPollingInterval,
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
            avatarDataMap.value = {};
            positionDataMap.value = {};
            rotationDataMap.value = {};
            jointDataMap.value = {};
            lastPollTimestamps.value = {};
            loadingBySession.value = {};
        }
    },
    { immediate: true },
);

onMounted(() => {
    if (vircadiaWorld.connectionInfo.value.status === "connected") {
        startAvatarDiscovery();
        // Start reflect subscription for all avatar data
        type ReflectDelivery = Communication.WebSocket.ReflectDeliveryMessage;
        reflectUnsubscribe = (
            vircadiaWorld.client.Utilities.Connection as {
                subscribeReflect: (
                    syncGroup: string,
                    channel: string,
                    callback: (msg: ReflectDelivery) => void,
                ) => () => void;
            }
        ).subscribeReflect(
            props.reflectSyncGroup,
            props.reflectChannel,
            (msg: ReflectDelivery) => {
                const payload = msg.payload as {
                    type?: string;
                    entityName?: string;
                    position?: unknown;
                    rotation?: unknown;
                    scale?: unknown;
                    cameraOrientation?: unknown;
                    joints?: Record<string, unknown>;
                };
                if (payload?.type !== "avatar_frame") return;
                const entityName = payload.entityName || "";
                const m = entityName.match(/^avatar:(.+)$/);
                if (!m) return;
                const fullSessionId = m[1];

                // Update position data
                if (payload.position) {
                    const parsed = parseAvatarPosition(payload.position);
                    if (parsed) {
                        positionDataMap.value[fullSessionId] = parsed;
                    }
                }

                // Update rotation data
                if (payload.rotation) {
                    const parsed = parseAvatarRotation(payload.rotation);
                    if (parsed) {
                        rotationDataMap.value[fullSessionId] = parsed;
                    }
                }

                // Update camera orientation
                if (payload.cameraOrientation) {
                    const base = avatarDataMap.value[fullSessionId];
                    if (base) {
                        avatarDataMap.value[fullSessionId] = {
                            ...base,
                            cameraOrientation: payload.cameraOrientation as {
                                alpha: number;
                                beta: number;
                                radius: number;
                            },
                        };
                    }
                }

                // Update joint data
                if (payload.joints) {
                    const joints = payload.joints;
                    const map = jointDataMap.value[fullSessionId] || new Map();
                    for (const [jointName, value] of Object.entries(joints)) {
                        const raw =
                            (typeof value === "object" && value
                                ? (value as Record<string, unknown>)
                                : {}) || {};
                        const candidate: unknown = {
                            type: "avatarJoint",
                            sessionId: fullSessionId,
                            jointName,
                            position: raw["position"],
                            rotation: raw["rotation"],
                            scale: raw["scale"],
                        };
                        const parsed = parseAvatarJoint(
                            candidate,
                        ) as AvatarJointMetadata | null;
                        if (parsed) map.set(parsed.jointName, parsed);
                    }
                    jointDataMap.value[fullSessionId] = map;
                }
            },
        );
    }
});

onUnmounted(() => {
    stopAvatarDiscovery();
    if (reflectUnsubscribe) {
        reflectUnsubscribe();
        reflectUnsubscribe = null;
    }
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
    avatarDataMap,
    positionDataMap,
    rotationDataMap,
    jointDataMap,
});
</script>

