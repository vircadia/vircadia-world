<template>
    <!-- Renderless component: handles entity creation and metadata updates -->
</template>

<script setup lang="ts">
import type {
    ArcRotateCamera,
    Camera,
    Quaternion,
    Scene,
    Skeleton,
    TransformNode,
    Vector3,
} from "@babylonjs/core";
import { Quaternion as Q4, Vector3 as V3 } from "@babylonjs/core";
import { useThrottleFn } from "@vueuse/core";
import {
    computed,
    onMounted,
    onUnmounted,
    type PropType,
    type Ref,
    ref,
    watch,
} from "vue";
import type { AvatarDefinition } from "@/components/BabylonMyAvatar.vue";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";

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
    avatarDefinition: {
        type: Object as PropType<AvatarDefinition>,
        required: true,
    },
    entitySyncGroup: { type: String, required: true },
    persistPoseSnapshotInterval: { type: Number, required: true },
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
    // Reflector
    reflectSyncGroup: { type: String, required: true },
    reflectChannel: { type: String, required: true },
    // Main transform precision controls (required; passed from MainScene)
    positionDecimals: { type: Number, required: true },
    rotationDecimals: { type: Number, required: true },
    scaleDecimals: { type: Number, required: true },
    // Main transform update thresholds (required; passed from MainScene)
    positionUpdateDecimals: { type: Number, required: true },
    rotationUpdateDecimals: { type: Number, required: true },
    scaleUpdateDecimals: { type: Number, required: true },
});

const emit = defineEmits<{
    "entity-data-loaded": [data: EntityData];
    "sync-stats": [data: AvatarSyncMetrics];
}>();

// Local state
const isCreating = ref(false);
const isRetrieving = ref(false);
const entityData: Ref<EntityData | null> = ref(null);

const entityName = computed(() =>
    props.vircadiaWorld.connectionInfo.value.fullSessionId ? `avatar:${props.vircadiaWorld.connectionInfo.value.fullSessionId}` : null,
);

// Track previous states to minimize writes
const previousMainStates = new Map<string, string>();
const previousJointStates = new Map<string, string>();
// Per-aspect gating snapshots (using update-threshold decimals)
const previousJointPositionGate = new Map<string, string>();
const previousJointRotationGate = new Map<string, string>();
const previousJointScaleGate = new Map<string, string>();
// Main transform gating snapshots
let previousMainPositionGate: string | null = null;
let previousMainRotationGate: string | null = null;
let previousMainScaleGate: string | null = null;

function vectorToObj(v: Vector3): PositionObj {
    return { x: v.x, y: v.y, z: v.z };
}
function quatToObj(q: Quaternion): RotationObj {
    return { x: q.x, y: q.y, z: q.z, w: q.w };
}

// Quantization helpers
function roundToDecimals(value: number, decimals: number): number {
    const factor = 10 ** decimals;
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





// Periodically persist a compact pose snapshot for late joiners
let poseSnapshotInterval: number | null = null;
async function persistPoseSnapshot(): Promise<void> {
    const name = entityName.value;
    if (!name) return;

    // Position
    let positionValue: PositionObj | null = null;
    if (props.avatarNode) {
        const pos = props.avatarNode.position ?? new V3(0, 0, 0);
        positionValue = quantizePosition(
            vectorToObj(pos),
            props.positionDecimals,
        );
    }

    // Rotation
    let rotationValue: RotationObj | null = null;
    if (props.avatarNode) {
        const rot = props.avatarNode.rotationQuaternion ?? new Q4(0, 0, 0, 1);
        rotationValue = quantizeRotation(
            quatToObj(rot),
            props.rotationDecimals,
        );
    }

    // Scale
    let scaleValue: PositionObj | null = null;
    if (props.avatarNode) {
        const scl = props.avatarNode.scaling ?? new V3(1, 1, 1);
        scaleValue = quantizeScale(vectorToObj(scl), props.scaleDecimals);
    }

    // Camera orientation
    let cameraOrientationValue: {
        alpha: number;
        beta: number;
        radius: number;
    } | null = null;
    if (props.camera) {
        const cam = props.camera as unknown as {
            alpha?: number;
            beta?: number;
            radius?: number;
        };
        if (
            cam.alpha !== undefined &&
            cam.beta !== undefined &&
            cam.radius !== undefined
        ) {
            cameraOrientationValue = {
                alpha: cam.alpha,
                beta: cam.beta,
                radius: cam.radius,
            };
        }
    }

    // Joints snapshot as a single object (reduces DB rows)
    let jointsValue: Record<string, unknown> | null = null;
    if (props.targetSkeleton) {
        jointsValue = {};
        const bones = props.targetSkeleton.bones || [];
        for (const bone of bones) {
            const localMat = bone.getLocalMatrix();
            const pos = new V3();
            const rot = new Q4();
            const scale = new V3();
            localMat.decompose(scale, rot, pos);
            jointsValue[bone.name] = {
                type: "avatarJoint",
                jointName: bone.name,
                position: quantizePosition(
                    vectorToObj(pos),
                    props.jointPositionDecimals,
                ),
                rotation: quantizeRotation(
                    quatToObj(rot),
                    props.jointRotationDecimals,
                ),
                scale: quantizeScale(
                    vectorToObj(scale),
                    props.jointScaleDecimals,
                ),
            };
        }
    }

    // Aggregate snapshot for convenience consumers
    const snapshot: Record<string, unknown> = { type: "avatar_snapshot" };
    if (positionValue) snapshot.position = positionValue;
    if (rotationValue) snapshot.rotation = rotationValue;
    if (scaleValue) snapshot.scale = scaleValue;
    if (cameraOrientationValue)
        snapshot.cameraOrientation = cameraOrientationValue;
    if (jointsValue && Object.keys(jointsValue).length > 0)
        snapshot.joints = jointsValue;

    try {
        await props.vircadiaWorld.client.connection.setAvatar({
            syncGroup: props.entitySyncGroup,
            avatarData: {
                avatar__url: props.modelFileName || "babylon.avatar.glb",
                avatar__data: snapshot,
                joints: jointsValue as any,
            } as any,
        });
    } catch (e) {
        recordError("persistPoseSnapshot", e);
    }
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
    const fullSessionId = props.vircadiaWorld.connectionInfo.value.fullSessionId;
    if (!fullSessionId) return;

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
        // Construct payload compatible with Avatar.I_AvatarData and our server-side merge logic
        // We pack position/rotation into avatar__data as well for legacy/snapshot compatibility
        // The server will extract these to update the entity.
        const avatarDataPayload: Record<string, unknown> = {
            avatar__url: props.modelFileName || "babylon.avatar.glb",
            avatar__data: {},
            joints: {},
        };

        const avatarInnerData: Record<string, unknown> = {};
        const joints: Record<string, unknown> = {};

        for (const [key, value] of updates) {
            if (key === "position" || key === "rotation") {
                // Add to avatar__data so server extractions find it
                avatarInnerData[key] = value;
            } else if (key === "cameraOrientation") {
                avatarInnerData[key] = value;
            } else if (key.startsWith("joint:")) {
                const jointName = key.substring("joint:".length);
                joints[jointName] = value;
            }
        }

        // Assign constructed objects
        (avatarDataPayload as any).avatar__data = avatarInnerData;
        if (Object.keys(joints).length > 0) {
            (avatarDataPayload as any).joints = joints;
        }

        // Send via setAvatar (RPC to Game Loop Manager) 
        // We use fire-and-forget style by not awaiting strict completion if we want speed,
        // but setAvatar returns a Promise. pushBatchedUpdates is async throttled.
        try {
            await props.vircadiaWorld.client.connection.setAvatar({
                syncGroup: props.entitySyncGroup,
                avatarData: avatarDataPayload as any,
                // Short timeout to avoid blocking queue too long if server is slow?
                // But this is throttled anyway.
            });
        } catch (error) {
            console.warn("[BabylonMyAvatarEntity] setAvatar failed", error);
            recordError("pushBatchedUpdates_setAvatar", error);
        }

        // No DB persistence - data kept only in reflection
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
    // Position (gate using update decimals; send using quantization decimals)
    const pos = props.avatarNode.position ?? new V3(0, 0, 0);
    const posGate = quantizePosition(
        vectorToObj(pos),
        props.positionUpdateDecimals,
    );
    const posGateStr = JSON.stringify(posGate);
    if (previousMainPositionGate !== posGateStr) {
        previousMainPositionGate = posGateStr;
        const posSend = quantizePosition(
            vectorToObj(pos),
            props.positionDecimals,
        );
        const posState = JSON.stringify(posSend);
        if (previousMainStates.get("position") !== posState) {
            queueUpdate("position", posSend);
            previousMainStates.set("position", posState);
        }
    }
    // Rotation (gate and send)
    const rot = props.avatarNode.rotationQuaternion ?? new Q4(0, 0, 0, 1);
    const rotGate = quantizeRotation(
        quatToObj(rot),
        props.rotationUpdateDecimals,
    );
    const rotGateStr = JSON.stringify(rotGate);
    if (previousMainRotationGate !== rotGateStr) {
        previousMainRotationGate = rotGateStr;
        const rotSend = quantizeRotation(
            quatToObj(rot),
            props.rotationDecimals,
        );
        const rotState = JSON.stringify(rotSend);
        if (previousMainStates.get("rotation") !== rotState) {
            queueUpdate("rotation", rotSend);
            previousMainStates.set("rotation", rotState);
        }
    }
    // Scale (gate and send)
    const scl = props.avatarNode.scaling ?? new V3(1, 1, 1);
    const sclGate = quantizeScale(vectorToObj(scl), props.scaleUpdateDecimals);
    const sclGateStr = JSON.stringify(sclGate);
    if (previousMainScaleGate !== sclGateStr) {
        previousMainScaleGate = sclGateStr;
        const sclSend = quantizeScale(vectorToObj(scl), props.scaleDecimals);
        const sclState = JSON.stringify(sclSend);
        if (previousMainStates.get("scale") !== sclState) {
            queueUpdate("scale", sclSend);
            previousMainStates.set("scale", sclState);
        }
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
        // For hips joint, use full precision for gating to ensure updates are sent appropriately
        const isHipsJoint = bone.name.toLowerCase() === "hips";
        const gatePos = isHipsJoint
            ? vectorToObj(pos)
            : quantizePosition(
                vectorToObj(pos),
                props.jointPositionUpdateDecimals,
            );
        const gateRot = isHipsJoint
            ? quatToObj(rot)
            : quantizeRotation(
                quatToObj(rot),
                props.jointRotationUpdateDecimals,
            );
        const gateScale = isHipsJoint
            ? vectorToObj(scale)
            : quantizeScale(
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
        // Use full precision for hips joint to avoid rotation issues
        const jointMetadata = {
            type: "avatarJoint",
            sessionId: name.replace(/^avatar:/, ""),
            jointName: bone.name,
            position: isHipsJoint
                ? vectorToObj(pos)
                : quantizePosition(
                    vectorToObj(pos),
                    props.jointPositionDecimals,
                ),
            rotation: isHipsJoint
                ? quatToObj(rot)
                : quantizeRotation(
                    quatToObj(rot),
                    props.jointRotationDecimals,
                ),
            scale: isHipsJoint
                ? vectorToObj(scale)
                : quantizeScale(vectorToObj(scale), props.jointScaleDecimals),
        };
        const jointKey = `joint:${bone.name}`;
        const state = JSON.stringify(jointMetadata);
        if (previousJointStates.get(jointKey) !== state) {
            queueUpdate(jointKey, jointMetadata);
            previousJointStates.set(jointKey, state);
        }
    }
}, props.jointThrottleInterval);

// Definition now provided by props; no DB load

async function initializeEntity() {
    const fullSessionId = props.vircadiaWorld.connectionInfo.value.fullSessionId;
    if (!fullSessionId) {
        console.error("[AVATAR ENTITY] Missing required session ID, cannot proceed", fullSessionId);
        return;
    }

    if (!entityName.value) {
        console.error("[AVATAR ENTITY] Missing entity name, cannot proceed", entityName.value);
        return;
    }

    // Ensure a minimal entity row exists in DB so others can discover us
    if (entityName.value) {
        // Use RPC to set initial state - this registers us in the Game Loop
        await persistPoseSnapshot();
    }

    // Create minimal entity data structure for compatibility
    // No DB persistence, so we create a simple in-memory structure
    entityData.value = {
        general__entity_name: entityName.value,
        metadata: new Map([
            ["type", "avatar"],
            ["sessionId", fullSessionId],
        ]),
    };
    emit("entity-data-loaded", entityData.value);
}

// Frame hooks
let afterPhysicsObserver: import("@babylonjs/core").Observer<Scene> | null =
    null;

onMounted(async () => {
    await initializeEntity();
    await initializeEntity();
    // await persistCoreAvatarMetadata(); // Merged into persistPoseSnapshot

    afterPhysicsObserver = props.scene.onAfterRenderObservable.add(() => {
        if (!props.avatarNode) return;
        updateTransform();
        if (props.camera) updateCamera();
        if (props.targetSkeleton) updateJoints();
    });

    // Start periodic pose snapshot persistence
    if (poseSnapshotInterval == null) {
        poseSnapshotInterval = setInterval(async () => {
            // Only persist when we have a valid entity name
            if (entityName.value) {
                await persistPoseSnapshot();
            }
        }, props.persistPoseSnapshotInterval) as unknown as number;
    }
});

onUnmounted(() => {
    if (afterPhysicsObserver)
        props.scene.onAfterRenderObservable.remove(afterPhysicsObserver);
    if (poseSnapshotInterval != null) {
        clearInterval(poseSnapshotInterval as unknown as number);
        poseSnapshotInterval = null;
    }
});

// React to core metadata changes
watch(
    () => [props.modelFileName, props.vircadiaWorld.connectionInfo.value.fullSessionId],
    async () => {
        await persistPoseSnapshot();
    },
    { immediate: false },
);

defineExpose({ isCreating, isRetrieving });
</script>