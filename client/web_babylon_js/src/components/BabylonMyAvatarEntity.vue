<template>
    <!-- Renderless component: handles entity creation and metadata updates -->
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type {
    Scene,
    TransformNode,
    Skeleton,
    Vector3,
    Quaternion,
} from "@babylonjs/core";
import { Vector3 as V3, Quaternion as Q4 } from "@babylonjs/core";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";
import { useThrottleFn } from "@vueuse/core";

type PositionObj = { x: number; y: number; z: number };
type RotationObj = { x: number; y: number; z: number; w: number };

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
    modelFileName: { type: String, required: false, default: "" },
    instanceId: { type: String, required: false, default: null },
    positionThrottleInterval: { type: Number, required: false, default: 50 },
    rotationThrottleInterval: { type: Number, required: false, default: 50 },
    jointThrottleInterval: { type: Number, required: false, default: 300 },
});

// Local state
const isCreating = ref(false);
const entityName = computed(() => {
    const sessionId =
        props.vircadiaWorld.connectionInfo.value.sessionId || null;
    const instanceId = props.instanceId || null;
    const full = sessionId && instanceId ? `${sessionId}-${instanceId}` : null;
    return full ? `avatar:${full}` : null;
});

// Track previous states to minimize writes
const previousMainStates = new Map<string, string>();
const previousJointStates = new Map<string, string>();

function vectorToObj(v: Vector3): PositionObj {
    return { x: v.x, y: v.y, z: v.z };
}
function quatToObj(q: Quaternion): RotationObj {
    return { x: q.x, y: q.y, z: q.z, w: q.w };
}

async function ensureEntityExists(): Promise<void> {
    if (!entityName.value) return;
    try {
        const existsResult =
            await props.vircadiaWorld.client.Utilities.Connection.query({
                query: "SELECT 1 FROM entity.entities WHERE general__entity_name = $1",
                parameters: [entityName.value],
            });
        const exists =
            Array.isArray(existsResult.result) &&
            existsResult.result.length > 0;
        if (!exists) {
            isCreating.value = true;
            await props.vircadiaWorld.client.Utilities.Connection.query({
                query: "INSERT INTO entity.entities (general__entity_name, group__sync, general__expiry__delete_since_updated_at_ms) VALUES ($1, $2, $3)",
                parameters: [entityName.value, "public.NORMAL", 120000],
            });
            // Seed minimal metadata rows
            const seed: Array<[string, unknown]> = [
                ["type", "avatar"],
                ["sessionId", entityName.value.replace(/^avatar:/, "")],
            ];
            if (props.modelFileName)
                seed.push(["modelFileName", props.modelFileName]);
            const valuesClause = seed
                .map(
                    (_, i) =>
                        `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`,
                )
                .join(", ");
            const parameters: unknown[] = [entityName.value];
            for (const [k, v] of seed) {
                parameters.push(k, v, "public.NORMAL");
            }
            await props.vircadiaWorld.client.Utilities.Connection.query({
                query: `INSERT INTO entity.entity_metadata (general__entity_name, metadata__key, metadata__value, group__sync) VALUES ${valuesClause}`,
                parameters,
            });
        }
    } catch (e) {
        console.error("[BabylonMyAvatarEntity] ensureEntityExists failed", e);
    } finally {
        isCreating.value = false;
    }
}

// Position metadata push
const pushPositionUpdate = useThrottleFn(async () => {
    if (!props.avatarNode) return;
    const name = entityName.value;
    if (!name || !name.includes(":")) return;

    try {
        const pos = props.avatarNode.position ?? new V3(0, 0, 0);
        const posObj = vectorToObj(pos);
        const posState = JSON.stringify(posObj);

        if (previousMainStates.get("position") === posState) return;

        const updates: Array<[string, unknown]> = [["position", posObj]];
        updates.push(["last_seen", new Date().toISOString()]);

        const valuesClause = updates
            .map((_, i) => `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`)
            .join(", ");
        const parameters: unknown[] = [name];
        for (const [k, v] of updates) {
            parameters.push(k, v, "public.NORMAL");
        }

        await props.vircadiaWorld.client.Utilities.Connection.query({
            query: `INSERT INTO entity.entity_metadata (general__entity_name, metadata__key, metadata__value, group__sync) VALUES ${valuesClause} ON CONFLICT (general__entity_name, metadata__key) DO UPDATE SET metadata__value = EXCLUDED.metadata__value`,
            parameters,
            timeoutMs: 5000,
        });

        previousMainStates.set("position", posState);
    } catch (e) {
        console.error("[BabylonMyAvatarEntity] pushPositionUpdate failed", e);
    }
}, props.positionThrottleInterval);

// Rotation metadata push
const pushRotationUpdate = useThrottleFn(async () => {
    if (!props.avatarNode) return;
    const name = entityName.value;
    if (!name || !name.includes(":")) return;

    try {
        const rot = props.avatarNode.rotationQuaternion ?? new Q4(0, 0, 0, 1);
        const rotObj = quatToObj(rot);
        const rotState = JSON.stringify(rotObj);

        if (previousMainStates.get("rotation") === rotState) return;

        const updates: Array<[string, unknown]> = [["rotation", rotObj]];
        updates.push(["last_seen", new Date().toISOString()]);

        const valuesClause = updates
            .map((_, i) => `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`)
            .join(", ");
        const parameters: unknown[] = [name];
        for (const [k, v] of updates) {
            parameters.push(k, v, "public.NORMAL");
        }

        await props.vircadiaWorld.client.Utilities.Connection.query({
            query: `INSERT INTO entity.entity_metadata (general__entity_name, metadata__key, metadata__value, group__sync) VALUES ${valuesClause} ON CONFLICT (general__entity_name, metadata__key) DO UPDATE SET metadata__value = EXCLUDED.metadata__value`,
            parameters,
            timeoutMs: 5000,
        });

        previousMainStates.set("rotation", rotState);
    } catch (e) {
        console.error("[BabylonMyAvatarEntity] pushRotationUpdate failed", e);
    }
}, props.rotationThrottleInterval);

// Joint metadata push (local bone transforms)
const pushJointUpdate = useThrottleFn(async () => {
    if (!props.targetSkeleton) return;
    const name = entityName.value;
    if (!name || !name.includes(":")) return;

    try {
        const updates: Array<[string, unknown]> = [];
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
                updates.push([jointKey, jointMetadata]);
                previousJointStates.set(jointKey, state);
            }
        }

        if (updates.length === 0) return;
        updates.push(["last_seen", new Date().toISOString()]);

        const valuesClause = updates
            .map((_, i) => `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`)
            .join(", ");
        const parameters: unknown[] = [name];
        for (const [k, v] of updates) {
            parameters.push(k, v, "public.NORMAL");
        }
        await props.vircadiaWorld.client.Utilities.Connection.query({
            query: `INSERT INTO entity.entity_metadata (general__entity_name, metadata__key, metadata__value, group__sync) VALUES ${valuesClause} ON CONFLICT (general__entity_name, metadata__key) DO UPDATE SET metadata__value = EXCLUDED.metadata__value`,
            parameters,
            timeoutMs: 5000,
        });
    } catch (e) {
        console.error("[BabylonMyAvatarEntity] pushJointUpdate failed", e);
    }
}, props.jointThrottleInterval);

// Frame hooks
let afterPhysicsObserver: import("@babylonjs/core").Observer<Scene> | null =
    null;

onMounted(async () => {
    // Wait until connected before creating entity
    if (props.vircadiaWorld.connectionInfo.value.status === "connected") {
        await ensureEntityExists();
    }
    const stop = watch(
        () => props.vircadiaWorld.connectionInfo.value.status,
        async (s) => {
            if (s === "connected") await ensureEntityExists();
        },
        { immediate: false },
    );
    // Attach per-frame updates
    afterPhysicsObserver = props.scene.onAfterPhysicsObservable.add(() => {
        if (!props.avatarNode) return;
        pushPositionUpdate();
        pushRotationUpdate();
        if (props.targetSkeleton) pushJointUpdate();
    });

    onUnmounted(() => {
        stop();
    });
});

onUnmounted(() => {
    if (afterPhysicsObserver)
        props.scene.onAfterPhysicsObservable.remove(afterPhysicsObserver);
});

defineExpose({ isCreating });
</script>


