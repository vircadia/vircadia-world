<template>
    <!-- Renderless component: handles entity creation and metadata updates -->
</template>

<script setup lang="ts">
import {
    computed,
    onMounted,
    onUnmounted,
    ref,
    watch,
    type Ref,
    type PropType,
} from "vue";
import type {
    Scene,
    TransformNode,
    Skeleton,
    Vector3,
    Quaternion,
    Camera,
    ArcRotateCamera,
} from "@babylonjs/core";
import { Vector3 as V3, Quaternion as Q4 } from "@babylonjs/core";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";
import type { AvatarDefinition } from "@/components/BabylonMyAvatar.vue";
import { useThrottleFn } from "@vueuse/core";

type PositionObj = { x: number; y: number; z: number };
type RotationObj = { x: number; y: number; z: number; w: number };

export type AvatarSyncMetrics = {
    entityName: string | null;
    queuedKeys: number;
    lastBatchCount: number;
    totalPushed: number;
    lastPushedAt: string | null;
    pushIntervalMs: number | null;
    avgPushesPerMinute: number;
    lastKeys: string[];
    lastBatchSizeKb: number;
    avgBatchSizeKb: number;
    avgBatchProcessTimeMs: number;
    // Error metrics
    errorCount: number;
    lastErrorAt: string | null;
    lastErrorMessage: string | null;
    lastErrorSource: string | null;
    // Detailed last entries with full values and per-entry sizes (bytes)
    lastEntries: { key: string; value: unknown; sizeBytes: number }[];
};

// Types imported from BabylonMyAvatar.vue

// Removed inline default avatar definition; must be provided from DB

type EntityData = {
    general__entity_name: string;
    metadata: Map<string, unknown>;
};

const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
    vircadiaWorld: {
        type: Object as () => VircadiaWorldInstance,
        required: true,
    },
    avatarNode: {
        type: Object as () => TransformNode | null,
        required: false,
        default: null,
    },
    targetSkeleton: {
        type: Object as () => Skeleton | null,
        required: false,
        default: null,
    },
    camera: {
        type: Object as () => Camera | null,
        required: false,
        default: null,
    },
    modelFileName: { type: String, required: false, default: "" },
    instanceId: { type: String, required: false, default: null },
    avatarDefinition: {
        type: Object as PropType<AvatarDefinition>,
        required: true,
    },
    positionThrottleInterval: { type: Number, required: true },
    rotationThrottleInterval: { type: Number, required: true },
    cameraOrientationThrottleInterval: { type: Number, required: true },
    jointThrottleInterval: { type: Number, required: true },
    // Precision controls (required; passed from MainScene)
    jointPositionDecimals: { type: Number, required: true },
    jointRotationDecimals: { type: Number, required: true },
    jointScaleDecimals: { type: Number, required: true },
    // Update thresholds (required; passed from MainScene). If the change is within these decimals, skip pushing an update after the first push.
    jointPositionUpdateDecimals: { type: Number, required: true },
    jointRotationUpdateDecimals: { type: Number, required: true },
    jointScaleUpdateDecimals: { type: Number, required: true },
});

const emit = defineEmits<{
    "avatar-definition-loaded": [def: AvatarDefinition];
    "entity-data-loaded": [data: EntityData];
    "sync-stats": [data: AvatarSyncMetrics];
}>();

// Local state
const isCreating = ref(false);
const isRetrieving = ref(false);
const entityData: Ref<EntityData | null> = ref(null);

const sessionId = computed(
    () => props.vircadiaWorld.connectionInfo.value.sessionId ?? null,
);
const fullSessionId = computed(() => {
    if (!sessionId.value || !props.instanceId) return null;
    return `${sessionId.value}-${props.instanceId}`;
});
const entityName = computed(() =>
    fullSessionId.value ? `avatar:${fullSessionId.value}` : null,
);

// Track previous states to minimize writes
const previousMainStates = new Map<string, string>();
const previousJointStates = new Map<string, string>();
// Per-aspect gating snapshots (using update-threshold decimals)
const previousJointPositionGate = new Map<string, string>();
const previousJointRotationGate = new Map<string, string>();
const previousJointScaleGate = new Map<string, string>();

function vectorToObj(v: Vector3): PositionObj {
    return { x: v.x, y: v.y, z: v.z };
}
function quatToObj(q: Quaternion): RotationObj {
    return { x: q.x, y: q.y, z: q.z, w: q.w };
}

// Quantization helpers
function roundToDecimals(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}
function quantizePosition(pos: PositionObj, decimals: number): PositionObj {
    return {
        x: roundToDecimals(pos.x, decimals),
        y: roundToDecimals(pos.y, decimals),
        z: roundToDecimals(pos.z, decimals),
    };
}
function quantizeScale(scale: PositionObj, decimals: number): PositionObj {
    return {
        x: roundToDecimals(scale.x, decimals),
        y: roundToDecimals(scale.y, decimals),
        z: roundToDecimals(scale.z, decimals),
    };
}
function quantizeRotation(rot: RotationObj, decimals: number): RotationObj {
    // Round components
    let qx = roundToDecimals(rot.x, decimals);
    let qy = roundToDecimals(rot.y, decimals);
    let qz = roundToDecimals(rot.z, decimals);
    let qw = roundToDecimals(rot.w, decimals);
    // Renormalize to maintain unit quaternion, then round again to keep stable payload size
    const len = Math.hypot(qx, qy, qz, qw);
    if (len > 0) {
        qx = qx / len;
        qy = qy / len;
        qz = qz / len;
        qw = qw / len;
        qx = roundToDecimals(qx, decimals);
        qy = roundToDecimals(qy, decimals);
        qz = roundToDecimals(qz, decimals);
        qw = roundToDecimals(qw, decimals);
    }
    return { x: qx, y: qy, z: qz, w: qw };
}

// Helper to upsert multiple metadata entries in a single batched query
async function upsertMetadataEntries(
    entity: string,
    entries: Array<[string, unknown]>,
    timeoutMs?: number,
): Promise<void> {
    if (entries.length === 0) {
        return;
    }

    const valuesClause = entries
        .map(
            (_, i) =>
                `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}::jsonb, $${i * 4 + 4})`,
        )
        .join(", ");

    const parameters = entries.flatMap(([key, value]) => [
        entity,
        key,
        JSON.stringify(value),
        "public.NORMAL",
    ]);

    await props.vircadiaWorld.client.Utilities.Connection.query({
        query:
            "INSERT INTO entity.entity_metadata (general__entity_name, metadata__key, metadata__value, group__sync)" +
            `VALUES ${valuesClause}` +
            "ON CONFLICT (general__entity_name, metadata__key) DO UPDATE SET metadata__value = EXCLUDED.metadata__value",
        parameters,
        timeoutMs,
    });
}

// Batching logic
const batchedUpdates = new Map<string, unknown>();
// Stats
const syncStats = {
    lastPushedAtMs: 0,
    lastBatchCount: 0,
    totalPushed: 0,
    lastKeys: [] as string[],
    lastEntries: [] as { key: string; value: unknown; sizeBytes: number }[],
    recentPushTimestamps: [] as number[],
    lastBatchSizeKb: 0,
    totalBatchSizeKb: 0,
    batchCount: 0,
    recentBatchProcessTimes: [] as number[],
    // Error tracking
    totalErrors: 0,
    lastErrorAtMs: 0,
    lastErrorMessage: null as string | null,
    lastErrorSource: null as string | null,
};

function recordError(source: string, error: unknown) {
    syncStats.totalErrors += 1;
    syncStats.lastErrorAtMs = Date.now();
    syncStats.lastErrorMessage =
        error instanceof Error ? error.message : String(error);
    syncStats.lastErrorSource = source;
}

function computePushesPerMinute(now: number): number {
    const cutoff = now - 60000;
    const recent = syncStats.recentPushTimestamps.filter((t) => t >= cutoff);
    if (recent.length === 0) return 0;
    const oldestTimestamp = Math.min(...recent);
    const actualWindowMs = now - oldestTimestamp;
    return actualWindowMs > 0
        ? Math.round((recent.length / actualWindowMs) * 60000)
        : recent.length;
}

function emitStats(interval: number | null) {
    const now = Date.now();
    const pushesPerMinute = computePushesPerMinute(now);
    const avgBatchSizeKb =
        syncStats.batchCount > 0
            ? Math.round(
                  (syncStats.totalBatchSizeKb / syncStats.batchCount) * 100,
              ) / 100
            : 0;
    const avgBatchProcessTimeMs =
        syncStats.recentBatchProcessTimes.length > 0
            ? Math.round(
                  syncStats.recentBatchProcessTimes.reduce((a, b) => a + b, 0) /
                      syncStats.recentBatchProcessTimes.length,
              )
            : 0;

    emit("sync-stats", {
        entityName: entityName.value,
        queuedKeys: batchedUpdates.size,
        lastBatchCount: syncStats.lastBatchCount,
        totalPushed: syncStats.totalPushed,
        lastPushedAt:
            syncStats.lastPushedAtMs > 0
                ? new Date(syncStats.lastPushedAtMs).toISOString()
                : null,
        pushIntervalMs: interval,
        avgPushesPerMinute: pushesPerMinute,
        lastKeys: syncStats.lastKeys,
        lastEntries: syncStats.lastEntries,
        lastBatchSizeKb: syncStats.lastBatchSizeKb,
        avgBatchSizeKb: avgBatchSizeKb,
        avgBatchProcessTimeMs: avgBatchProcessTimeMs,
        errorCount: syncStats.totalErrors,
        lastErrorAt:
            syncStats.lastErrorAtMs > 0
                ? new Date(syncStats.lastErrorAtMs).toISOString()
                : null,
        lastErrorMessage: syncStats.lastErrorMessage,
        lastErrorSource: syncStats.lastErrorSource,
    });
}

const pushBatchedUpdates = useThrottleFn(async () => {
    const name = entityName.value;
    if (!name || !name.includes(":") || batchedUpdates.size === 0) return;

    const batchStartTime = Date.now();
    const updates = Array.from(batchedUpdates.entries());
    batchedUpdates.clear();

    updates.push(["last_seen", new Date().toISOString()]);

    // Calculate batch size in KB
    const batchDataString = JSON.stringify(updates);
    const batchSizeKb =
        Math.round((new Blob([batchDataString]).size / 1024) * 100) / 100;
    // Compute per-entry sizes for detailed stats
    const entriesInfo = updates.map(([k, v]) => {
        let sizeBytes = 0;
        try {
            sizeBytes = new Blob([JSON.stringify(v)]).size;
        } catch {
            // Fallback to rough length if stringify fails
            sizeBytes = String(v).length;
        }
        return { key: k, value: v, sizeBytes };
    });

    try {
        // Belt-and-suspenders: ensure entity exists before metadata upsert
        try {
            await props.vircadiaWorld.client.Utilities.Connection.query({
                query: "INSERT INTO entity.entities (general__entity_name, group__sync, general__expiry__delete_since_updated_at_ms) VALUES ($1, $2, $3) ON CONFLICT (general__entity_name) DO NOTHING",
                parameters: [name, "public.NORMAL", 120000],
                timeoutMs: 3000,
            });
        } catch (ensureErr) {
            // Non-fatal; proceed to upsert metadata and let errors bubble if any
            console.debug(
                "[BabylonMyAvatarEntity] ensure entity failed (non-fatal)",
                ensureErr,
            );
        }

        await upsertMetadataEntries(name, updates, 5000);
        const now = Date.now();
        const batchProcessTime = now - batchStartTime;
        const lastAt = syncStats.lastPushedAtMs;
        const interval = lastAt > 0 ? now - lastAt : null;
        syncStats.lastPushedAtMs = now;
        syncStats.lastBatchCount = updates.length;
        syncStats.totalPushed += updates.length;
        syncStats.lastKeys = updates.map(([k]) => k);
        syncStats.lastEntries = entriesInfo;
        syncStats.lastBatchSizeKb = batchSizeKb;
        syncStats.totalBatchSizeKb += batchSizeKb;
        syncStats.batchCount += 1;

        // Track recent batch processing times (last 60 seconds)
        syncStats.recentBatchProcessTimes.push(batchProcessTime);
        const cutoff = now - 60000;
        // Filter out old process times - keep same number as push timestamps
        syncStats.recentBatchProcessTimes =
            syncStats.recentBatchProcessTimes.slice(
                -syncStats.recentPushTimestamps.length,
            );

        // Maintain recent pushes window (last 60 seconds)
        syncStats.recentPushTimestamps.push(now);
        syncStats.recentPushTimestamps = syncStats.recentPushTimestamps.filter(
            (t) => t >= cutoff,
        );
        emitStats(interval);
    } catch (e) {
        console.error("[BabylonMyAvatarEntity] pushBatchedUpdates failed", e);
        recordError("pushBatchedUpdates", e);
        emitStats(null);
    }
}, props.positionThrottleInterval);

function queueUpdate(key: string, value: unknown) {
    batchedUpdates.set(key, value);
    void pushBatchedUpdates();
}

// Position & Rotation are high frequency
function updateTransform() {
    if (!props.avatarNode) return;
    // Position
    const pos = props.avatarNode.position ?? new V3(0, 0, 0);
    const posObj = vectorToObj(pos);
    const posState = JSON.stringify(posObj);
    if (previousMainStates.get("position") !== posState) {
        queueUpdate("position", posObj);
        previousMainStates.set("position", posState);
    }
    // Rotation
    const rot = props.avatarNode.rotationQuaternion ?? new Q4(0, 0, 0, 1);
    const rotObj = quatToObj(rot);
    const rotState = JSON.stringify(rotObj);
    if (previousMainStates.get("rotation") !== rotState) {
        queueUpdate("rotation", rotObj);
        previousMainStates.set("rotation", rotState);
    }
}

// Camera is medium frequency
const updateCamera = useThrottleFn(() => {
    if (!props.camera) return;
    const arcCamera = props.camera as ArcRotateCamera;
    if (
        arcCamera.alpha !== undefined &&
        arcCamera.beta !== undefined &&
        arcCamera.radius !== undefined
    ) {
        const cameraOrientation = {
            alpha: arcCamera.alpha,
            beta: arcCamera.beta,
            radius: arcCamera.radius,
        };
        const cameraState = JSON.stringify(cameraOrientation);
        if (previousMainStates.get("cameraOrientation") !== cameraState) {
            queueUpdate("cameraOrientation", cameraOrientation);
            previousMainStates.set("cameraOrientation", cameraState);
        }
    }
}, props.cameraOrientationThrottleInterval);

// Joints are low frequency
const updateJoints = useThrottleFn(() => {
    if (!props.targetSkeleton) return;
    const name = entityName.value;
    if (!name) return;
    const bones = props.targetSkeleton.bones || [];
    for (const bone of bones) {
        const localMat = bone.getLocalMatrix();
        const pos = new V3();
        const rot = new Q4();
        const scale = new V3();
        localMat.decompose(scale, rot, pos);
        // Gating: compare quantized values using update-threshold decimals; skip if all unchanged since last send
        const gatePos = quantizePosition(
            vectorToObj(pos),
            props.jointPositionUpdateDecimals,
        );
        const gateRot = quantizeRotation(
            quatToObj(rot),
            props.jointRotationUpdateDecimals,
        );
        const gateScale = quantizeScale(
            vectorToObj(scale),
            props.jointScaleUpdateDecimals,
        );
        const jointNameKey = bone.name;
        const gatePosStr = JSON.stringify(gatePos);
        const gateRotStr = JSON.stringify(gateRot);
        const gateScaleStr = JSON.stringify(gateScale);
        const posChanged =
            previousJointPositionGate.get(jointNameKey) !== gatePosStr;
        const rotChanged =
            previousJointRotationGate.get(jointNameKey) !== gateRotStr;
        const scaleChanged =
            previousJointScaleGate.get(jointNameKey) !== gateScaleStr;
        if (!(posChanged || rotChanged || scaleChanged)) {
            continue; // No significant change beyond thresholds
        }
        // Update gating snapshots
        previousJointPositionGate.set(jointNameKey, gatePosStr);
        previousJointRotationGate.set(jointNameKey, gateRotStr);
        previousJointScaleGate.set(jointNameKey, gateScaleStr);
        const jointMetadata = {
            type: "avatarJoint",
            sessionId: name.replace(/^avatar:/, ""),
            jointName: bone.name,
            position: quantizePosition(
                vectorToObj(pos),
                props.jointPositionDecimals,
            ),
            rotation: quantizeRotation(
                quatToObj(rot),
                props.jointRotationDecimals,
            ),
            scale: quantizeScale(vectorToObj(scale), props.jointScaleDecimals),
        };
        const jointKey = `joint:${bone.name}`;
        const state = JSON.stringify(jointMetadata);
        if (previousJointStates.get(jointKey) !== state) {
            queueUpdate(jointKey, jointMetadata);
            previousJointStates.set(jointKey, state);
        }
    }
}, props.jointThrottleInterval);

// Logic moved from BabylonMyAvatar.vue
async function retrieveEntityMetadata(
    requestedEntityName: string,
): Promise<Map<string, unknown> | null> {
    try {
        const metadataResult =
            await props.vircadiaWorld.client.Utilities.Connection.query({
                query: "SELECT metadata__key, metadata__value FROM entity.entity_metadata WHERE general__entity_name = $1",
                parameters: [requestedEntityName],
            });

        if (Array.isArray(metadataResult.result)) {
            const metadataMap = new Map<string, unknown>();
            for (const row of metadataResult.result) {
                metadataMap.set(row.metadata__key, row.metadata__value);
            }
            return metadataMap;
        }
    } catch (e) {
        console.error("Failed to retrieve metadata:", e);
        recordError("retrieveEntityMetadata", e);
        emitStats(null);
    }
    return null;
}

// Definition now provided by props; no DB load

async function initializeEntity() {
    if (
        !sessionId.value ||
        !props.instanceId ||
        !fullSessionId.value ||
        !entityName.value
    ) {
        console.error("[AVATAR ENTITY] Missing required IDs, cannot proceed");
        return;
    }

    // Provide avatar definition from props
    emit("avatar-definition-loaded", props.avatarDefinition);

    // Check if entity exists
    let exists = false;
    try {
        const existsResult =
            await props.vircadiaWorld.client.Utilities.Connection.query({
                query: "SELECT 1 FROM entity.entities WHERE general__entity_name = $1",
                parameters: [entityName.value],
            });

        exists =
            Array.isArray(existsResult.result) &&
            existsResult.result.length > 0;
    } catch (e) {
        console.error("Failed to check if avatar entity exists:", e);
        recordError("checkEntityExists", e);
        emitStats(null);
        return;
    }

    if (!exists) {
        isCreating.value = true;
        try {
            await props.vircadiaWorld.client.Utilities.Connection.query({
                query: "INSERT INTO entity.entities (general__entity_name, group__sync, general__expiry__delete_since_updated_at_ms, general__expiry__delete_since_created_at_ms) VALUES ($1, $2, $3, NULL)",
                parameters: [entityName.value, "public.NORMAL", 120000],
            });
            const seed: Array<[string, unknown]> = [
                ["type", "avatar"],
                ["sessionId", fullSessionId.value],
            ];
            await upsertMetadataEntries(entityName.value, seed);
        } catch (e) {
            console.error("Failed to create avatar entity:", e);
            recordError("createEntity", e);
            emitStats(null);
        } finally {
            isCreating.value = false;
        }
    }

    // Retrieve entity data
    isRetrieving.value = true;
    try {
        const name = entityName.value;
        const currentFullSessionId = fullSessionId.value;

        const entityResult =
            await props.vircadiaWorld.client.Utilities.Connection.query({
                query: "SELECT general__entity_name FROM entity.entities WHERE general__entity_name = $1",
                parameters: [name],
            });

        if (
            Array.isArray(entityResult.result) &&
            entityResult.result.length > 0
        ) {
            const metadata = await retrieveEntityMetadata(name);
            if (metadata) {
                const retrievedSessionId = metadata.get("sessionId") as
                    | string
                    | undefined;
                if (retrievedSessionId !== currentFullSessionId) {
                    console.error(
                        "[AVATAR ENTITY] Retrieved wrong entity! Ignoring.",
                        {
                            retrievedSessionId,
                            expectedSessionId: currentFullSessionId,
                        },
                    );
                    entityData.value = null;
                    return;
                }

                entityData.value = {
                    general__entity_name: name,
                    metadata: metadata,
                };
                emit("entity-data-loaded", entityData.value);
            }
        }
    } catch (e) {
        console.error("Failed to retrieve avatar entity:", e);
        recordError("retrieveEntity", e);
        emitStats(null);
    } finally {
        isRetrieving.value = false;
    }
}

// Frame hooks
let afterPhysicsObserver: import("@babylonjs/core").Observer<Scene> | null =
    null;

onMounted(async () => {
    const stop = watch(
        () => props.vircadiaWorld.connectionInfo.value.status,
        async (s) => {
            if (s === "connected") {
                await initializeEntity();
                stop();
            }
        },
        { immediate: true },
    );

    afterPhysicsObserver = props.scene.onAfterRenderObservable.add(() => {
        if (!props.avatarNode) return;
        updateTransform();
        if (props.camera) updateCamera();
        if (props.targetSkeleton) updateJoints();
    });
});

onUnmounted(() => {
    if (afterPhysicsObserver)
        props.scene.onAfterRenderObservable.remove(afterPhysicsObserver);
});

defineExpose({ isCreating, isRetrieving });
</script>