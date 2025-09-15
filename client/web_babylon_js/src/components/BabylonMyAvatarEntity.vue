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
    positionThrottleInterval: { type: Number, required: false, default: 50 },
    rotationThrottleInterval: { type: Number, required: false, default: 50 },
    cameraOrientationThrottleInterval: {
        type: Number,
        required: false,
        default: 100,
    },
    jointThrottleInterval: { type: Number, required: false, default: 500 },
});

const emit = defineEmits<{
    "avatar-definition-loaded": [def: AvatarDefinition];
    "entity-data-loaded": [data: EntityData];
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

function vectorToObj(v: Vector3): PositionObj {
    return { x: v.x, y: v.y, z: v.z };
}
function quatToObj(q: Quaternion): RotationObj {
    return { x: q.x, y: q.y, z: q.z, w: q.w };
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
                `(${i * 4 + 1}, ${i * 4 + 2}, ${i * 4 + 3}::jsonb, ${i * 4 + 4})`,
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

const pushBatchedUpdates = useThrottleFn(async () => {
    const name = entityName.value;
    if (!name || !name.includes(":") || batchedUpdates.size === 0) return;

    const updates = Array.from(batchedUpdates.entries());
    batchedUpdates.clear();

    updates.push(["last_seen", new Date().toISOString()]);
    try {
        await upsertMetadataEntries(name, updates, 5000);
    } catch (e) {
        console.error("[BabylonMyAvatarEntity] pushBatchedUpdates failed", e);
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
        const jointMetadata = {
            type: "avatarJoint",
            sessionId: name.replace(/^avatar:/, ""),
            jointName: bone.name,
            position: vectorToObj(pos),
            rotation: quatToObj(rot),
            scale: vectorToObj(scale),
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
    const existsResult =
        await props.vircadiaWorld.client.Utilities.Connection.query({
            query: "SELECT 1 FROM entity.entities WHERE general__entity_name = $1",
            parameters: [entityName.value],
        });

    const exists =
        Array.isArray(existsResult.result) && existsResult.result.length > 0;

    if (!exists) {
        isCreating.value = true;
        try {
            await props.vircadiaWorld.client.Utilities.Connection.query({
                query: "INSERT INTO entity.entities (general__entity_name, group__sync, general__expiry__delete_since_updated_at_ms) VALUES ($1, $2, $3)",
                parameters: [entityName.value, "public.NORMAL", 120000],
            });
            const seed: Array<[string, unknown]> = [
                ["type", "avatar"],
                ["sessionId", fullSessionId.value],
            ];
            await upsertMetadataEntries(entityName.value, seed);
        } catch (e) {
            console.error("Failed to create avatar entity:", e);
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