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

function markLoaded(sessionId: string): void {
    loadingBySession.value[sessionId] = false;
}

function markDisposed(sessionId: string): void {
    delete loadingBySession.value[sessionId];
}

void markLoaded;
void markDisposed;

let avatarDiscoveryInterval: number | null = null;

async function pollForOtherAvatars(): Promise<void> {
    try {
        const startTime = Date.now();
        const result = await vircadiaWorld.client.Utilities.Connection.query({
            query: "SELECT general__entity_name FROM entity.entities WHERE group__sync = $1 AND general__entity_name LIKE 'avatar:%'",
            parameters: ["public.NORMAL"],
            timeoutMs: 5000,
        });

        if (result.result && Array.isArray(result.result)) {
            const currentFullSessionId = currentFullSessionIdComputed.value;
            const foundFullSessionIds: string[] = [];
            const entities = result.result as Array<{
                general__entity_name: string;
            }>;

            for (const entity of entities) {
                const match =
                    entity.general__entity_name.match(/^avatar:(.+)$/);
                if (match) {
                    if (match && match[1] !== currentFullSessionId) {
                        foundFullSessionIds.push(match[1]);
                        if (loadingBySession.value[match[1]] == null) {
                            loadingBySession.value[match[1]] = true;
                        }
                    }
                }
            }

            otherAvatarSessionIds.value = foundFullSessionIds;
            discoveryStats.value.rows = entities.length;
        }

        discoveryStats.value.lastDurationMs = Date.now() - startTime;
        discoveryStats.value.timeouts = 0;
    } catch (error) {
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
                    const target = (payload as { sessionId?: string })
                        .sessionId;
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

onMounted(() => {
    subscribeReflect();
    if (avatarDiscoveryInterval) window.clearInterval(avatarDiscoveryInterval);
    avatarDiscoveryInterval = window.setInterval(
        pollForOtherAvatars,
        props.discoveryPollingInterval,
    );
    void pollForOtherAvatars();
});

onUnmounted(() => {
    if (reflectUnsubscribe) reflectUnsubscribe();
    if (avatarDiscoveryInterval) window.clearInterval(avatarDiscoveryInterval);
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
});
</script>

