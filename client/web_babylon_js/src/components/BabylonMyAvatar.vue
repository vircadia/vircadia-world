<template>
	<slot
		:avatar-skeleton="avatarSkeleton"
		:animations="animations"
		:vircadia-world="vircadiaWorld"
		:on-animation-state="onAnimationState"
		:avatar-node="avatarNode"
		:model-file-name="modelFileName"
		:mesh-pivot-point="meshPivotPoint"
		:capsule-height="capsuleHeight"
		:on-set-avatar-model="onSetAvatarModel"
	/>
</template>

<script setup lang="ts">
import {
    ref,
    reactive,
    onMounted,
    onUnmounted,
    watch,
    type WatchStopHandle,
    type Ref,
    computed,
} from "vue";

import {
    Vector3,
    Quaternion,
    Matrix,
    CharacterSupportedState,
    Space,
    type AnimationGroup,
    type Scene,
    type Observer,
    type Skeleton,
    type Bone,
    type TransformNode,
    type AbstractMesh,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

// Debug viewers import
import { SkeletonViewer, AxesViewer } from "@babylonjs/core/Debug";

import { useThrottleFn } from "@vueuse/core";

import { useBabylonAvatarKeyboardMouseControls } from "../composables/useBabylonAvatarKeyboardMouseControls";
import { useBabylonAvatarPhysicsController } from "../composables/useBabylonAvatarPhysicsController";
import { useBabylonAvatarCameraController } from "../composables/useBabylonAvatarCameraController";
// Model loading now handled by child component (BabylonMyAvatarModel)
import type { useVircadia } from "@vircadia/world-sdk/browser/vue";
import type {
    PositionObj,
    RotationObj,
} from "../composables/useBabylonAvatarPhysicsController";

// Debug bounding box, skeleton, and axes
// removed; now using debug flags from store (debugBoundingBox, debugSkeleton, debugAxes)

// Define component props with defaults (single defineProps)
const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
    vircadiaWorld: {
        type: Object as () => ReturnType<typeof useVircadia>,
        required: true,
    },
    instanceId: { type: String, required: false, default: null },
    avatarDefinitionName: {
        type: String,
        required: true,
    },
});

const emit = defineEmits<{ ready: []; dispose: [] }>();

// AvatarDefinition type
type AvatarDefinition = {
    initialAvatarPosition: { x: number; y: number; z: number };
    initialAvatarRotation: { x: number; y: number; z: number; w: number };
    initialAvatarCameraOrientation: {
        alpha: number;
        beta: number;
        radius: number;
    };
    modelFileName: string;
    meshPivotPoint: "bottom" | "center";
    throttleInterval: number;
    capsuleHeight: number;
    capsuleRadius: number;
    slopeLimit: number;
    jumpSpeed: number;
    debugBoundingBox: boolean;
    debugSkeleton: boolean;
    debugAxes: boolean;
    walkSpeed: number;
    turnSpeed: number;
    blendDuration: number;
    gravity: number;
    animations: { fileName: string }[];
};

const defaultAvatarDef: AvatarDefinition = {
    initialAvatarPosition: { x: 0, y: 0, z: -5 },
    initialAvatarRotation: { x: 0, y: 0, z: 0, w: 1 },
    initialAvatarCameraOrientation: {
        alpha: -Math.PI / 2,
        beta: Math.PI / 3,
        radius: 5,
    },
    modelFileName: "",
    meshPivotPoint: "bottom",
    throttleInterval: 500,
    capsuleHeight: 1.8,
    capsuleRadius: 0.3,
    slopeLimit: 45,
    jumpSpeed: 5,
    debugBoundingBox: false,
    debugSkeleton: false,
    debugAxes: false,
    walkSpeed: 0,
    turnSpeed: 0,
    blendDuration: 0.15,
    gravity: 0,
    animations: [],
};

const dbAvatarDef = ref<AvatarDefinition | null>(null);

const effectiveAvatarDef = computed<AvatarDefinition>(() => {
    return dbAvatarDef.value ?? defaultAvatarDef;
});
// Field-level computed wrappers to replace toRefs
const throttleInterval = computed(
    () => effectiveAvatarDef.value.throttleInterval,
);
const capsuleHeight = computed(() => effectiveAvatarDef.value.capsuleHeight);
const capsuleRadius = computed(() => effectiveAvatarDef.value.capsuleRadius);
const slopeLimit = computed(() => effectiveAvatarDef.value.slopeLimit);
const jumpSpeed = computed(() => effectiveAvatarDef.value.jumpSpeed);
const debugBoundingBox = computed(
    () => effectiveAvatarDef.value.debugBoundingBox,
);
const debugSkeleton = computed(() => effectiveAvatarDef.value.debugSkeleton);
const debugAxes = computed(() => effectiveAvatarDef.value.debugAxes);
const walkSpeed = computed(() => effectiveAvatarDef.value.walkSpeed);
const turnSpeed = computed(() => effectiveAvatarDef.value.turnSpeed);
const blendDuration = computed(() => effectiveAvatarDef.value.blendDuration);
const gravity = computed(() => effectiveAvatarDef.value.gravity);
const meshPivotPoint = computed(() => effectiveAvatarDef.value.meshPivotPoint);
void meshPivotPoint;
const initialAvatarCameraOrientation = computed(
    () => effectiveAvatarDef.value.initialAvatarCameraOrientation,
);
const initialAvatarPosition = computed(
    () => effectiveAvatarDef.value.initialAvatarPosition,
);
const initialAvatarRotation = computed(
    () => effectiveAvatarDef.value.initialAvatarRotation,
);
const modelFileName = computed(() => effectiveAvatarDef.value.modelFileName);
const animations = computed(
    () => effectiveAvatarDef.value.animations as { fileName: string }[],
);

// Reactive sessionId and fullSessionId from vircadia connection
const sessionId = computed(
    () => props.vircadiaWorld.connectionInfo.value.sessionId ?? null,
);
const instanceId = computed(() => props.instanceId ?? null);
const fullSessionId = computed(() => {
    return sessionId.value && instanceId.value
        ? `${sessionId.value}-${instanceId.value}`
        : null;
});

// Generate dynamic entity name based on full session ID (includes instanceId)
const entityName = computed(() => `avatar:${fullSessionId.value}`);

// Simple metadata map that directly corresponds to database entries
const metadataMap = reactive(
    new Map<string, unknown>([
        ["type", "avatar"],
        ["sessionId", fullSessionId.value],
        ["position", initialAvatarPosition.value],
        ["rotation", initialAvatarRotation.value],
        ["cameraOrientation", initialAvatarCameraOrientation.value],
        ["modelFileName", modelFileName.value],
    ]),
);

// Direct refs to specific metadata values for easier access
const position = computed({
    get: () => metadataMap.get("position") as PositionObj,
    set: (value) => metadataMap.set("position", value),
});

const rotation = computed({
    get: () => metadataMap.get("rotation") as RotationObj,
    set: (value) => metadataMap.set("rotation", value),
});

const cameraOrientation = computed({
    get: () =>
        metadataMap.get("cameraOrientation") as {
            alpha: number;
            beta: number;
            radius: number;
        },
    set: (value) => metadataMap.set("cameraOrientation", value),
});

// Watch for fullSessionId changes and update metadata map
watch(fullSessionId, (newSessionId) => {
    metadataMap.set("sessionId", newSessionId);
});

// Helpers
function vectorToObj(v: Vector3): PositionObj {
    return { x: v.x, y: v.y, z: v.z };
}
function quatToObj(q: Quaternion): RotationObj {
    return { x: q.x, y: q.y, z: q.z, w: q.w };
}

async function loadAvatarDefinitionFromDb(
    definitionName: string,
): Promise<void> {
    if (!vircadiaWorld) return;
    try {
        const meta = await retrieveEntityMetadata(definitionName);
        if (!meta) {
            console.warn(
                `No metadata found for avatar definition: ${definitionName}`,
            );
            return;
        }

        // Debug: Log retrieved metadata
        console.log(`Retrieved metadata for ${definitionName}:`, {
            modelFileName: meta.get("modelFileName"),
            allKeys: Array.from(meta.keys()),
            allValues: Array.from(meta.entries()),
        });

        const merged: AvatarDefinition = {
            ...defaultAvatarDef,
            ...((meta.get("initialAvatarPosition") as
                | AvatarDefinition["initialAvatarPosition"]
                | undefined)
                ? {
                      initialAvatarPosition: meta.get(
                          "initialAvatarPosition",
                      ) as AvatarDefinition["initialAvatarPosition"],
                  }
                : {}),
            ...((meta.get("initialAvatarRotation") as
                | AvatarDefinition["initialAvatarRotation"]
                | undefined)
                ? {
                      initialAvatarRotation: meta.get(
                          "initialAvatarRotation",
                      ) as AvatarDefinition["initialAvatarRotation"],
                  }
                : {}),
            ...((meta.get("initialAvatarCameraOrientation") as
                | AvatarDefinition["initialAvatarCameraOrientation"]
                | undefined)
                ? {
                      initialAvatarCameraOrientation: meta.get(
                          "initialAvatarCameraOrientation",
                      ) as AvatarDefinition["initialAvatarCameraOrientation"],
                  }
                : {}),
            ...((meta.get("modelFileName") as string | undefined)
                ? { modelFileName: meta.get("modelFileName") as string }
                : {}),
            ...((meta.get("meshPivotPoint") as
                | AvatarDefinition["meshPivotPoint"]
                | undefined)
                ? {
                      meshPivotPoint: meta.get(
                          "meshPivotPoint",
                      ) as AvatarDefinition["meshPivotPoint"],
                  }
                : {}),
            ...((meta.get("throttleInterval") as number | undefined)
                ? { throttleInterval: meta.get("throttleInterval") as number }
                : {}),
            ...((meta.get("capsuleHeight") as number | undefined)
                ? { capsuleHeight: meta.get("capsuleHeight") as number }
                : {}),
            ...((meta.get("capsuleRadius") as number | undefined)
                ? { capsuleRadius: meta.get("capsuleRadius") as number }
                : {}),
            ...((meta.get("slopeLimit") as number | undefined)
                ? { slopeLimit: meta.get("slopeLimit") as number }
                : {}),
            ...((meta.get("jumpSpeed") as number | undefined)
                ? { jumpSpeed: meta.get("jumpSpeed") as number }
                : {}),
            ...((meta.get("debugBoundingBox") as boolean | undefined)
                ? { debugBoundingBox: meta.get("debugBoundingBox") as boolean }
                : {}),
            ...((meta.get("debugSkeleton") as boolean | undefined)
                ? { debugSkeleton: meta.get("debugSkeleton") as boolean }
                : {}),
            ...((meta.get("debugAxes") as boolean | undefined)
                ? { debugAxes: meta.get("debugAxes") as boolean }
                : {}),
            ...((meta.get("walkSpeed") as number | undefined)
                ? { walkSpeed: meta.get("walkSpeed") as number }
                : {}),
            ...((meta.get("turnSpeed") as number | undefined)
                ? { turnSpeed: meta.get("turnSpeed") as number }
                : {}),
            ...((meta.get("blendDuration") as number | undefined)
                ? { blendDuration: meta.get("blendDuration") as number }
                : {}),
            ...((meta.get("gravity") as number | undefined)
                ? { gravity: meta.get("gravity") as number }
                : {}),
            ...((meta.get("animations") as { fileName: string }[] | undefined)
                ? {
                      animations: meta.get("animations") as {
                          fileName: string;
                      }[],
                  }
                : {}),
        };
        dbAvatarDef.value = merged;
        // Sync initial fields used to seed entity metadata if not created yet
        metadataMap.set("position", merged.initialAvatarPosition);
        metadataMap.set("rotation", merged.initialAvatarRotation);
        metadataMap.set(
            "cameraOrientation",
            merged.initialAvatarCameraOrientation,
        );
        metadataMap.set("modelFileName", merged.modelFileName);
    } catch (e) {
        console.error("Failed to load avatar definition from DB:", e);
    }
}

// Type for debug window properties
interface DebugWindow extends Window {
    debugSkeleton?: boolean;
    debugSkeletonLoop?: boolean;
    lastSkeletonSnapshot?: SkeletonSnapshot;
    startLegRotationTest?: () => void;
    stopLegRotationTest?: () => void;
}

// Type for debug data
interface DebugData {
    timestamp: string;
    sessionId: string;
    skeleton: {
        boneCount: number;
        animations: {
            idle: number | string;
            walk: number | string;
        };
    };
    bones: Record<
        string,
        {
            p: string[];
            r: string;
        }
    >;
}

// Type for skeleton snapshot
interface SkeletonSnapshot {
    timestamp: string;
    boneCount: number;
    animations: {
        idle: string;
        walk: string;
    };
    bones: Record<
        string,
        {
            position: PositionObj;
            rotation: RotationObj;
            scale: PositionObj;
        }
    >;
}

// Instantiate composables
const {
    avatarNode,
    characterController,
    createController,
    updateTransforms,
    getPosition,
    setPosition,
    getOrientation,
    setOrientation,
    getVelocity,
    setVelocity,
    checkSupport,
    integrate,
} = useBabylonAvatarPhysicsController(
    props.scene,
    position,
    rotation,
    capsuleHeight,
    capsuleRadius,
    slopeLimit,
);
const { keyState } = useBabylonAvatarKeyboardMouseControls(props.scene);

// Store previous states for change detection
const previousStates = new Map<string, string>();
const previousJointStates = new Map<string, string>();

// Flags to prevent overlapping updates
const isUpdatingMain = ref(false);
const isUpdatingJoints = ref(false);

// Throttled update function for main avatar data (position, rotation, camera)
const throttledUpdate = useThrottleFn(async () => {
    if (!entityData.value?.general__entity_name) {
        return;
    }

    // Skip if still updating to prevent overlapping requests
    if (isUpdatingMain.value) {
        console.debug(
            "Skipping avatar update - previous update still in progress",
        );
        return;
    }

    try {
        if (!vircadiaWorld) {
            throw new Error("Vircadia instance not found in BabylonMyAvatar");
        }

        isUpdatingMain.value = true;

        // Get current transform data
        const currentPos = getPosition();
        const currentRot = getOrientation();

        // Collect all updates that have changed
        const updates: Array<[string, unknown]> = [];

        // Check and add basic metadata only if changed
        if (currentPos) {
            const newPos = vectorToObj(currentPos);
            const posKey = "position";
            const posState = JSON.stringify(newPos);
            if (previousStates.get(posKey) !== posState) {
                updates.push([posKey, newPos]);
                previousStates.set(posKey, posState);
            }
        }

        if (currentRot) {
            const newRot = quatToObj(currentRot);
            const rotKey = "rotation";
            const rotState = JSON.stringify(newRot);
            if (previousStates.get(rotKey) !== rotState) {
                updates.push([rotKey, newRot]);
                previousStates.set(rotKey, rotState);
            }
        }

        // Check camera orientation
        const camKey = "cameraOrientation";
        const camState = JSON.stringify(cameraOrientation.value);
        if (previousStates.get(camKey) !== camState) {
            updates.push([camKey, cameraOrientation.value]);
            previousStates.set(camKey, camState);
        }

        // These rarely change, but check them too
        const typeKey = "type";
        if (previousStates.get(typeKey) !== "avatar") {
            updates.push([typeKey, "avatar"]);
            previousStates.set(typeKey, "avatar");
        }

        const sessionKey = "sessionId";
        const sessionState = fullSessionId.value || "";
        if (previousStates.get(sessionKey) !== sessionState) {
            updates.push([sessionKey, fullSessionId.value]);
            previousStates.set(sessionKey, sessionState);
        }

        const modelKey = "modelFileName";
        const modelState = modelFileName.value;
        if (previousStates.get(modelKey) !== modelState) {
            updates.push([modelKey, modelFileName.value]);
            previousStates.set(modelKey, modelState);
        }

        // Always update last_seen to keep entity alive
        updates.push(["last_seen", new Date().toISOString()]);

        // Build the VALUES clause dynamically for batch insert
        const valuesClause = updates
            .map(
                (_, index) =>
                    `($1, $${index * 3 + 2}, $${index * 3 + 3}, $${index * 3 + 4})`,
            )
            .join(", ");

        // Flatten parameters: [entityName, key1, value1, sync1, key2, value2, sync2, ...]
        const parameters: unknown[] = [entityName.value];
        for (const [key, value] of updates) {
            parameters.push(key, value, "public.NORMAL");
        }

        // Single query to update all changed metadata
        await vircadiaWorld.client.Utilities.Connection.query({
            query: `
                INSERT INTO entity.entity_metadata 
                    (general__entity_name, metadata__key, metadata__value, group__sync)
                VALUES ${valuesClause}
                ON CONFLICT (general__entity_name, metadata__key) 
                DO UPDATE SET metadata__value = EXCLUDED.metadata__value
            `,
            parameters,
            timeoutMs: 5000, // Add timeout to prevent hanging
        });

        // Update local map only for changed values
        for (const [key, value] of updates) {
            metadataMap.set(key, value);
        }

        // Update local entity data for consistency
        if (entityData.value) {
            entityData.value.metadata = new Map(metadataMap);
        }

        // No global store; if needed, parent can observe via DB or events

        // Log update statistics in debug mode
        if ((window as DebugWindow).debugSkeleton) {
            console.log(
                `[Avatar Update] Sent ${updates.length} main data changes`,
            );
        }
    } catch (error) {
        console.error("Avatar metadata update failed:", error);
    } finally {
        isUpdatingMain.value = false;
    }
}, throttleInterval.value);

// Separate throttled update function for joint data
const throttledJointUpdate = useThrottleFn(
    async () => {
        if (!entityData.value?.general__entity_name || !avatarSkeleton.value) {
            return;
        }

        // Skip if still updating to prevent overlapping requests
        if (isUpdatingJoints.value) {
            console.debug(
                "Skipping joint update - previous update still in progress",
            );
            return;
        }

        try {
            if (!vircadiaWorld) {
                throw new Error(
                    "Vircadia instance not found in BabylonMyAvatar",
                );
            }

            isUpdatingJoints.value = true;

            // Collect joint updates that have changed
            const updates: Array<[string, unknown]> = [];
            const bones = avatarSkeleton.value.bones || [];

            for (const bone of bones) {
                // Use LOCAL matrix for better network efficiency
                const localMat = bone.getLocalMatrix();

                // Decompose the matrix to get position, rotation, and scale
                const pos = new Vector3();
                const rot = new Quaternion();
                const scale = new Vector3();
                localMat.decompose(scale, rot, pos);

                // Create joint metadata
                const jointMetadata = {
                    type: "avatarJoint",
                    sessionId: fullSessionId.value,
                    jointName: bone.name,
                    position: vectorToObj(pos),
                    rotation: quatToObj(rot),
                    scale: vectorToObj(scale),
                };

                // Check if this joint has changed
                const jointKey = `joint:${bone.name}`;
                const jointState = JSON.stringify(jointMetadata);
                const previousJointState = previousJointStates.get(jointKey);

                if (jointState !== previousJointState) {
                    updates.push([jointKey, jointMetadata]);
                    previousJointStates.set(jointKey, jointState);
                }
            }

            // Only proceed if there are changes
            if (updates.length === 0) {
                return;
            }

            // Always add last_seen to keep entity alive
            updates.push(["last_seen", new Date().toISOString()]);

            // Build the VALUES clause dynamically for batch insert
            const valuesClause = updates
                .map(
                    (_, index) =>
                        `($1, $${index * 3 + 2}, $${index * 3 + 3}, $${index * 3 + 4})`,
                )
                .join(", ");

            // Flatten parameters: [entityName, key1, value1, sync1, key2, value2, sync2, ...]
            const parameters: unknown[] = [entityName.value];
            for (const [key, value] of updates) {
                parameters.push(key, value, "public.NORMAL");
            }

            // Single query to update all changed joint metadata
            await vircadiaWorld.client.Utilities.Connection.query({
                query: `
                INSERT INTO entity.entity_metadata 
                    (general__entity_name, metadata__key, metadata__value, group__sync)
                VALUES ${valuesClause}
                ON CONFLICT (general__entity_name, metadata__key) 
                DO UPDATE SET metadata__value = EXCLUDED.metadata__value
            `,
                parameters,
                timeoutMs: 5000, // Add timeout to prevent hanging
            });

            // Update local map only for changed values
            for (const [key, value] of updates) {
                metadataMap.set(key, value);
            }

            // Log update statistics in debug mode
            if ((window as DebugWindow).debugSkeleton) {
                const jointUpdates = updates.filter(([key]) =>
                    key.startsWith("joint:"),
                ).length;
                console.log(
                    `[Avatar Joint Update] Sent ${jointUpdates} joint changes`,
                );
            }
        } catch (error) {
            console.error("Avatar joint update failed:", error);
        } finally {
            isUpdatingJoints.value = false;
        }
    },
    Math.max(throttleInterval.value * 5, 2500),
);

// Use Vircadia instance from props (moved up to fix initialization order)
const vircadiaWorld = props.vircadiaWorld;

// Camera controller
const { camera, setupCamera, updateCameraFromMeta } =
    useBabylonAvatarCameraController(
        props.scene,
        avatarNode,
        cameraOrientation,
        capsuleHeight,
        throttledUpdate,
    );

// Avatar model data provided by child component
const avatarMeshes: Ref<import("@babylonjs/core").AbstractMesh[]> = ref([]);

// Replace the existing localAnimGroups and animation-related code
const blendWeight = ref(0); // 0 = idle, 1 = walk
// removed local blendDuration; using store value for blendDuration

// Initialize and manage blended animations
let idleAnimation: AnimationGroup | null = null;
let walkAnimation: AnimationGroup | null = null;

// Avatar model data provided by child component via slot callback
// (reuse avatarMeshes declared above with concrete type)

function onSetAvatarModel(payload: {
    skeleton: Skeleton | null;
    meshes: AbstractMesh[];
}): void {
    avatarSkeleton.value = payload.skeleton;
    avatarMeshes.value = payload.meshes;
    trySetupBlendedAnimations();

    // Debug visuals
    if (debugBoundingBox.value) {
        for (const mesh of avatarMeshes.value) {
            if ("showBoundingBox" in mesh) {
                (
                    mesh as unknown as { showBoundingBox?: boolean }
                ).showBoundingBox = true;
            }
        }
    }
    if (debugAxes.value && avatarNode.value) {
        axesViewer = new AxesViewer(props.scene, capsuleHeight.value);
    }
    if (debugSkeleton.value && avatarSkeleton.value) {
        const skinnedMeshes = avatarMeshes.value.filter(
            (m) => m.skeleton === avatarSkeleton.value,
        );
        for (const m of skinnedMeshes) {
            if (avatarSkeleton.value) {
                skeletonViewer = new SkeletonViewer(
                    avatarSkeleton.value,
                    m,
                    props.scene,
                );
                skeletonViewer.isEnabled = true;
            }
        }
    }

    // Ensure camera is set up
    setupCamera();
    emit("ready");
}

// mark used in template bindings
void onSetAvatarModel;

// Test functions for leg rotation
function startLegRotationTest(): void {
    if (!avatarSkeleton.value) {
        console.error("[LegTest] No skeleton available");
        return;
    }

    // Find left leg bone (common names: LeftUpLeg, LeftThigh, Left_Leg, etc.)
    const leftLegBone = avatarSkeleton.value.bones.find(
        (bone) =>
            bone.name.toLowerCase().includes("left") &&
            (bone.name.toLowerCase().includes("leg") ||
                bone.name.toLowerCase().includes("thigh") ||
                bone.name.toLowerCase().includes("upleg")),
    );

    if (!leftLegBone) {
        console.error("[LegTest] Could not find left leg bone");
        console.log(
            "[LegTest] Available bones:",
            avatarSkeleton.value.bones.map((b) => b.name),
        );
        return;
    }

    console.log(
        `[LegTest] Starting rotation test on bone: ${leftLegBone.name}`,
    );

    // Check if this bone has a linked TransformNode (common with GLTF)
    const linkedNode = leftLegBone.getTransformNode();
    if (linkedNode) {
        console.log(
            `[LegTest] Bone has linked TransformNode: ${linkedNode.name}`,
        );
    } else {
        console.log(
            "[LegTest] Bone has no linked TransformNode - using bone directly",
        );
    }

    // Pause animations
    if (idleAnimation) {
        idleAnimation.pause();
        console.log("[LegTest] Paused idle animation");
    }
    if (walkAnimation) {
        walkAnimation.pause();
        console.log("[LegTest] Paused walk animation");
    }

    // Store original rotation
    const localMat = leftLegBone.getLocalMatrix();
    const pos = new Vector3();
    const rot = new Quaternion();
    const scale = new Vector3();
    localMat.decompose(scale, rot, pos);

    legRotationTest.isActive = true;
    legRotationTest.startTime = Date.now();
    legRotationTest.targetBone = leftLegBone;
    legRotationTest.originalRotation = rot.clone();

    console.log(
        `[LegTest] Original rotation: x=${rot.x.toFixed(3)}, y=${rot.y.toFixed(3)}, z=${rot.z.toFixed(3)}, w=${rot.w.toFixed(3)}`,
    );
}

function stopLegRotationTest(): void {
    if (!legRotationTest.isActive || !legRotationTest.targetBone) {
        console.log("[LegTest] No active test to stop");
        return;
    }

    console.log("[LegTest] Stopping rotation test");

    // Restore original rotation
    if (legRotationTest.originalRotation) {
        legRotationTest.targetBone.setRotationQuaternion(
            legRotationTest.originalRotation,
            Space.LOCAL,
        );
    }

    // Resume animations
    if (idleAnimation) {
        idleAnimation.play();
        console.log("[LegTest] Resumed idle animation");
    }
    if (walkAnimation) {
        walkAnimation.play();
        console.log("[LegTest] Resumed walk animation");
    }

    // Reset test state
    legRotationTest.isActive = false;
    legRotationTest.targetBone = null;
    legRotationTest.originalRotation = null;

    console.log("[LegTest] Test stopped and state reset");
}

// Reference to the avatar skeleton for animation retargeting
const avatarSkeleton: Ref<Skeleton | null> = ref(null);

// Debug flag for skeleton data - set window.debugSkeleton = true in console to enable
const debugSkeletonData = ref(false);

// Test leg rotation state
const legRotationTest = reactive({
    isActive: false,
    startTime: 0,
    duration: 1000, // 1 second
    targetBone: null as Bone | null,
    originalRotation: null as Quaternion | null,
});

const entityData = ref<{
    general__entity_name: string;
    metadata: Map<string, unknown>;
} | null>(null);
const isRetrieving = ref(false);
const isCreating = ref(false);

// Helper function to retrieve metadata for an entity
async function retrieveEntityMetadata(
    entityName: string,
): Promise<Map<string, unknown> | null> {
    if (!vircadiaWorld) {
        console.error("Vircadia instance not found");
        return null;
    }

    try {
        // Fetch all metadata for this entity
        const metadataResult =
            await vircadiaWorld.client.Utilities.Connection.query({
                query: "SELECT metadata__key, metadata__value FROM entity.entity_metadata WHERE general__entity_name = $1",
                parameters: [entityName],
            });

        if (Array.isArray(metadataResult.result)) {
            // Reconstruct metadata map from rows
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

// Audio stream is now handled by the BabylonWebRTC component

// Animation state map aggregated from children
type AnimationState = "idle" | "loading" | "ready" | "error";
type AnimationInfo = {
    state: AnimationState;
    error?: string;
    group?: AnimationGroup | null;
};
const animationsMap = ref<Map<string, AnimationInfo>>(new Map());

function onAnimationState(payload: {
    fileName: string;
    state: AnimationState;
    error?: string;
    group?: AnimationGroup | null;
}): void {
    animationsMap.value.set(payload.fileName, {
        state: payload.state,
        error: payload.error,
        group: payload.group,
    });
    // If idle/walk become ready, set up blending
    if (!idleAnimation || !walkAnimation) {
        trySetupBlendedAnimations();
    }
}

function trySetupBlendedAnimations(): void {
    // Determine primary idle and walk animations (only these should be blended)
    const idleFileName = animations.value.find((anim: { fileName: string }) =>
        anim.fileName.toLowerCase().includes("idle.1.glb"),
    )?.fileName;
    const walkFileName = animations.value.find((anim: { fileName: string }) =>
        anim.fileName.toLowerCase().includes("walk.1.glb"),
    )?.fileName;

    const idleInfo = idleFileName
        ? animationsMap.value.get(idleFileName)
        : undefined;
    const walkInfo = walkFileName
        ? animationsMap.value.get(walkFileName)
        : undefined;

    if (!idleAnimation) {
        if (idleInfo?.state === "ready" && idleInfo.group) {
            idleAnimation = idleInfo.group as AnimationGroup;
        }
        if (idleAnimation) {
            idleAnimation.stop();
            idleAnimation.loopAnimation = true;
            idleAnimation.setWeightForAllAnimatables(1.0);
        }
    }

    if (!walkAnimation) {
        if (walkInfo?.state === "ready" && walkInfo.group) {
            walkAnimation = walkInfo.group as AnimationGroup;
        }
        if (walkAnimation) {
            walkAnimation.stop();
            walkAnimation.loopAnimation = true;
            walkAnimation.setWeightForAllAnimatables(0.0);
        }
    }

    if (idleAnimation && walkAnimation) {
        // Start both paused at correct weights; resume only when we drive blending
        idleAnimation.play(true);
        walkAnimation.play(true);
        idleAnimation.setWeightForAllAnimatables(1.0);
        walkAnimation.setWeightForAllAnimatables(0.0);
    }
}

// Update animation weights based on movement
function updateAnimationBlending(isMoving: boolean, dt: number): void {
    // Ensure both animations are ready
    if (!idleAnimation || !walkAnimation) {
        return;
    }

    const targetWeight = isMoving ? 1 : 0;
    // If weight is already at target, no blending needed
    if (blendWeight.value === targetWeight) {
        return;
    }

    // Compute weight change based on transition duration
    const change = dt / blendDuration.value;
    // Move weight toward target
    if (targetWeight > blendWeight.value) {
        blendWeight.value += change;
    } else {
        blendWeight.value -= change;
    }
    // Clamp blendWeight between 0 and 1
    blendWeight.value = Math.min(Math.max(blendWeight.value, 0), 1);

    // Apply weights to animations
    idleAnimation.setWeightForAllAnimatables(1 - blendWeight.value);
    walkAnimation.setWeightForAllAnimatables(blendWeight.value);
}

// Observers and watcher cleanup handles
let skeletonViewer: SkeletonViewer | null = null;
let axesViewer: AxesViewer | null = null;
let beforePhysicsObserver: Observer<Scene> | null = null;
let afterPhysicsObserver: Observer<Scene> | null = null;
let rootMotionObserver: Observer<Scene> | null = null;
let connectionStatusWatcher: WatchStopHandle | null = null;
let entityDataWatcher: WatchStopHandle | null = null;
let debugInterval: number | null = null;

// Lifecycle hooks
onMounted(async () => {
    // Load avatar definition from DB first so downstream logic uses it
    if (vircadiaWorld.connectionInfo.value.status === "connected") {
        await loadAvatarDefinitionFromDb(props.avatarDefinitionName);
    }
    // Watch for connection established
    if (vircadiaWorld.connectionInfo.value.status === "connected") {
        // Check if entity exists
        const existsResult =
            await vircadiaWorld.client.Utilities.Connection.query({
                query: "SELECT 1 FROM entity.entities WHERE general__entity_name = $1",
                parameters: [entityName.value],
            });

        const exists =
            Array.isArray(existsResult.result) &&
            existsResult.result.length > 0;

        if (!exists) {
            isCreating.value = true;
            try {
                // First create the entity
                await vircadiaWorld.client.Utilities.Connection.query({
                    query: "INSERT INTO entity.entities (general__entity_name, group__sync, general__expiry__delete_since_updated_at_ms) VALUES ($1, $2, $3) RETURNING general__entity_name",
                    parameters: [
                        entityName.value,
                        "public.NORMAL",
                        120000, // 120 seconds timeout for inactivity
                    ],
                });

                // Then insert metadata rows
                const metadataInserts = Array.from(metadataMap.entries()).map(
                    ([key, value]) => ({
                        key,
                        value,
                    }),
                );

                for (const { key, value } of metadataInserts) {
                    await vircadiaWorld.client.Utilities.Connection.query({
                        query: `INSERT INTO entity.entity_metadata (general__entity_name, metadata__key, metadata__value, group__sync)
                                VALUES ($1, $2, $3, $4)`,
                        parameters: [
                            entityName.value,
                            key,
                            value,
                            "public.NORMAL",
                        ],
                    });
                }
            } catch (e) {
                console.error("Failed to create avatar entity:", e);
            } finally {
                isCreating.value = false;
            }
        }

        // Retrieve entity data
        isRetrieving.value = true;
        try {
            // First check if entity exists
            const entityResult =
                await vircadiaWorld.client.Utilities.Connection.query({
                    query: "SELECT general__entity_name FROM entity.entities WHERE general__entity_name = $1",
                    parameters: [entityName.value],
                });

            if (
                Array.isArray(entityResult.result) &&
                entityResult.result.length > 0
            ) {
                // Fetch all metadata for this entity
                const metadata = await retrieveEntityMetadata(entityName.value);
                if (metadata) {
                    entityData.value = {
                        general__entity_name: entityName.value,
                        metadata: metadata,
                    };
                }
            }
        } catch (e) {
            console.error("Failed to retrieve avatar entity:", e);
        } finally {
            isRetrieving.value = false;
        }
    } else {
        connectionStatusWatcher = watch(
            () => vircadiaWorld.connectionInfo.value.status,
            async (status) => {
                if (status === "connected") {
                    await loadAvatarDefinitionFromDb(
                        props.avatarDefinitionName,
                    );
                    // Retrieve entity data when connected
                    isRetrieving.value = true;
                    try {
                        // First check if entity exists
                        const entityResult =
                            await vircadiaWorld.client.Utilities.Connection.query(
                                {
                                    query: "SELECT general__entity_name FROM entity.entities WHERE general__entity_name = $1",
                                    parameters: [entityName.value],
                                },
                            );

                        if (
                            Array.isArray(entityResult.result) &&
                            entityResult.result.length > 0
                        ) {
                            // Fetch all metadata for this entity
                            const metadata = await retrieveEntityMetadata(
                                entityName.value,
                            );
                            if (metadata) {
                                entityData.value = {
                                    general__entity_name: entityName.value,
                                    metadata: metadata,
                                };
                            }
                        }
                    } catch (e) {
                        console.error("Failed to retrieve avatar entity:", e);
                    } finally {
                        isRetrieving.value = false;
                    }
                    connectionStatusWatcher?.();
                }
            },
        );
    }

    // Watch for entity data changes
    entityDataWatcher = watch(
        () => entityData.value,
        async (data) => {
            const meta = data?.metadata;
            if (meta && !characterController.value) {
                console.info("Loading avatar model...");
                // First create, use defaults when missing
                const metaPosition = meta.get("position") as
                    | PositionObj
                    | undefined;
                if (metaPosition) {
                    position.value = metaPosition;
                }
                const metaRotation = meta.get("rotation") as
                    | RotationObj
                    | undefined;
                if (metaRotation) {
                    rotation.value = metaRotation;
                }
                // Apply saved camera orientation on initial load
                const metaCameraOrientation = meta.get("cameraOrientation") as
                    | { alpha: number; beta: number; radius: number }
                    | undefined;
                if (metaCameraOrientation) {
                    cameraOrientation.value = metaCameraOrientation;
                }
                createController();
                // Model loading now handled by child component. Ensure camera setup; child will call onSetAvatarModel.
                if (avatarNode.value) {
                    setupCamera();

                    // Parenting is done by the child model component

                    // Skeleton is provided by child model component via onSetAvatarModel

                    if (avatarSkeleton.value) {
                        // Mesh influencer setup handled by child model component

                        // Note: GLTF skeletons don't expose bones as TransformNodes
                        // The animations will update the skeleton directly through the skeleton system

                        // Children components will auto-load animations when skeleton is set
                        // Attempt to set up blending as children report readiness
                        trySetupBlendedAnimations();

                        // After animations are set up, check what they're targeting
                        setTimeout(() => {
                            if (idleAnimation) {
                                console.log("Idle animation details:");
                                console.log("- Name:", idleAnimation.name);
                                console.log(
                                    "- Is playing:",
                                    idleAnimation.isPlaying,
                                );
                                console.log(
                                    "- Target count:",
                                    idleAnimation.targetedAnimations.length,
                                );

                                // Check if any animations target the skeleton
                                let skeletonTargets = 0;
                                let boneTargets = 0;
                                for (const anim of idleAnimation.targetedAnimations) {
                                    if (anim.target === avatarSkeleton.value) {
                                        skeletonTargets++;
                                    } else if (
                                        anim.target.name &&
                                        avatarSkeleton.value?.bones.find(
                                            (b) => b.name === anim.target.name,
                                        )
                                    ) {
                                        boneTargets++;
                                    }
                                }
                                console.log(
                                    "- Skeleton targets:",
                                    skeletonTargets,
                                );
                                console.log("- Bone targets:", boneTargets);

                                // Log first few animation targets
                                console.log("First 5 animation targets:");
                                for (
                                    let i = 0;
                                    i <
                                    Math.min(
                                        5,
                                        idleAnimation.targetedAnimations.length,
                                    );
                                    i++
                                ) {
                                    const target =
                                        idleAnimation.targetedAnimations[i]
                                            .target;
                                    console.log(
                                        `  - ${target.name || target.constructor.name} (${target.constructor.name})`,
                                    );
                                }
                            }
                        }, 1000);

                        // Debug visualization now based on avatarMeshes in onSetAvatarModel

                        // Expose test functions to window for debugging
                        (window as DebugWindow).startLegRotationTest =
                            startLegRotationTest;
                        (window as DebugWindow).stopLegRotationTest =
                            stopLegRotationTest;
                        console.log(
                            "[LegTest] Test functions available: window.startLegRotationTest() and window.stopLegRotationTest()",
                        );

                        // Also add a debug function to check skeleton state
                        (
                            window as DebugWindow & {
                                debugSkeletonState?: () => void;
                                debugAvatarLoadingState?: () => void;
                            }
                        ).debugSkeletonState = () => {
                            if (!avatarSkeleton.value) {
                                console.log("No skeleton available");
                                return;
                            }

                            console.log("=== Skeleton Debug Info ===");
                            console.log(
                                `Bone count: ${avatarSkeleton.value.bones.length}`,
                            );
                            console.log(`Name: ${avatarSkeleton.value.name}`);
                            console.log(
                                `Needs initial skeleton matrix: ${avatarSkeleton.value.needInitialSkinMatrix}`,
                            );

                            // Find leg bone
                            const leftLegBone = avatarSkeleton.value.bones.find(
                                (bone) =>
                                    bone.name.toLowerCase().includes("left") &&
                                    (bone.name.toLowerCase().includes("leg") ||
                                        bone.name
                                            .toLowerCase()
                                            .includes("thigh") ||
                                        bone.name
                                            .toLowerCase()
                                            .includes("upleg")),
                            );

                            if (leftLegBone) {
                                console.log(
                                    `\nLeft leg bone: ${leftLegBone.name}`,
                                );
                                console.log(
                                    `- Has linked transform: ${!!leftLegBone.getTransformNode()}`,
                                );
                                console.log(
                                    `- Parent: ${leftLegBone.getParent()?.name || "none"}`,
                                );
                                console.log(
                                    `- Children: ${leftLegBone.children.map((c) => c.name).join(", ") || "none"}`,
                                );

                                // Check if animations are targeting this bone
                                let animTargets = 0;
                                if (idleAnimation) {
                                    for (const anim of idleAnimation.targetedAnimations) {
                                        if (
                                            anim.target === leftLegBone ||
                                            anim.target.name ===
                                                leftLegBone.name
                                        ) {
                                            animTargets++;
                                        }
                                    }
                                }
                                console.log(
                                    `- Animation targets: ${animTargets}`,
                                );
                            }

                            // Check meshes using this skeleton
                            const skinnedMeshes = avatarMeshes.value.filter(
                                (m) => m.skeleton === avatarSkeleton.value,
                            );
                            console.log(
                                `\nSkinned meshes: ${skinnedMeshes.length}`,
                            );
                            for (const mesh of skinnedMeshes) {
                                console.log(
                                    `- ${mesh.name} (bone influencers: ${mesh.numBoneInfluencers || "N/A"})`,
                                );
                            }
                        };

                        // Enhanced debug function for avatar loading state
                        (
                            window as DebugWindow & {
                                debugAvatarLoadingState?: () => void;
                            }
                        ).debugAvatarLoadingState = () => {
                            console.log("=== AVATAR LOADING DEBUG STATE ===");
                            console.log("Scene initialized:", !!props.scene);
                            console.log("Avatar node:", !!avatarNode.value);
                            console.log(
                                "Character controller:",
                                !!characterController.value,
                            );
                            console.log("Camera:", !!camera.value);
                            console.log(
                                "Scene active camera:",
                                !!props.scene?.activeCamera,
                            );
                            console.log(
                                "Meshes loaded:",
                                avatarMeshes.value.length,
                            );
                            console.log(
                                "Avatar skeleton:",
                                !!avatarSkeleton.value,
                            );
                            console.log("Idle animation:", !!idleAnimation);
                            console.log("Walk animation:", !!walkAnimation);
                            console.log(
                                "Is creating entity:",
                                isCreating.value,
                            );
                            console.log("Entity data:", !!entityData.value);
                            console.log(
                                "Full session ID:",
                                fullSessionId.value,
                            );
                            console.log("Entity name:", entityName.value);
                            console.log("Position:", position.value);
                            console.log("Rotation:", rotation.value);
                            console.log(
                                "Camera orientation:",
                                cameraOrientation.value,
                            );

                            // Check if meshes are visible
                            if (avatarMeshes.value.length > 0) {
                                console.log("Mesh visibility:");
                                for (const mesh of avatarMeshes.value) {
                                    console.log(
                                        `- ${mesh.name}: visible=${mesh.isVisible}, enabled=${mesh.isEnabled()}`,
                                    );
                                }
                            }

                            return {
                                sceneOk: !!props.scene,
                                avatarNodeOk: !!avatarNode.value,
                                controllerOk: !!characterController.value,
                                cameraOk: !!camera.value,
                                meshCount: avatarMeshes.value.length,
                                skeletonOk: !!avatarSkeleton.value,
                                animationsOk:
                                    !!idleAnimation && !!walkAnimation,
                                entityOk: !!entityData.value,
                            };
                        };

                        console.log(
                            "[DEBUG] Avatar debug functions available:",
                        );
                        console.log("- window.startLegRotationTest()");
                        console.log("- window.stopLegRotationTest()");
                        console.log("- window.debugSkeletonState()");
                        console.log("- window.debugAvatarLoadingState()");

                        // Camera debug function
                        (
                            window as DebugWindow & {
                                debugCameraView?: () => void;
                            }
                        ).debugCameraView = () => {
                            if (!camera.value || !props.scene) {
                                console.log("No camera or scene available");
                                return;
                            }

                            console.log("=== CAMERA DEBUG ===");
                            console.log(
                                "Camera position:",
                                camera.value.position,
                            );
                            console.log(
                                "Camera target:",
                                camera.value.getTarget(),
                            );
                            console.log("Camera alpha/beta/radius:", {
                                alpha: camera.value.alpha,
                                beta: camera.value.beta,
                                radius: camera.value.radius,
                            });
                            console.log(
                                "Avatar position:",
                                avatarNode.value?.position,
                            );
                            console.log(
                                "Scene active camera:",
                                !!props.scene.activeCamera,
                            );
                            console.log("Canvas size:", {
                                width: props.scene.getEngine().getRenderWidth(),
                                height: props.scene
                                    .getEngine()
                                    .getRenderHeight(),
                            });
                        };

                        // Render loop debug function
                        (
                            window as DebugWindow & {
                                debugRenderLoop?: () => void;
                            }
                        ).debugRenderLoop = () => {
                            const engine = props.scene?.getEngine();
                            if (!engine) {
                                console.log("No engine available");
                                return;
                            }

                            console.log("=== RENDER LOOP DEBUG ===");
                            console.log(
                                "Engine is running render loop:",
                                !!engine.runRenderLoop,
                            );
                            console.log("FPS:", engine.getFps());
                            console.log("Scene ready:", props.scene?.isReady());
                            console.log(
                                "Scene lights count:",
                                props.scene?.lights.length,
                            );
                            console.log(
                                "Scene meshes count:",
                                props.scene?.meshes.length,
                            );
                            console.log(
                                "Engine rendering canvas:",
                                !!engine.getRenderingCanvas(),
                            );
                        };

                        console.log("- window.debugCameraView()");
                        console.log("- window.debugRenderLoop()");

                        // Expose debug data function for overlay
                        (
                            window as DebugWindow & {
                                __debugMyAvatarData?: () => unknown;
                            }
                        ).__debugMyAvatarData = () => {
                            if (!avatarSkeleton.value) return null;

                            const joints: Record<
                                string,
                                {
                                    position: PositionObj;
                                    rotation: RotationObj;
                                    scale: PositionObj;
                                }
                            > = {};

                            // Collect ALL joints now
                            for (const bone of avatarSkeleton.value.bones) {
                                const localMat = bone.getLocalMatrix();
                                const pos = new Vector3();
                                const rot = new Quaternion();
                                const scale = new Vector3();
                                localMat.decompose(scale, rot, pos);

                                joints[bone.name] = {
                                    position: vectorToObj(pos),
                                    rotation: quatToObj(rot),
                                    scale: vectorToObj(scale),
                                };
                            }

                            return {
                                sessionId: sessionId.value,
                                boneCount: avatarSkeleton.value.bones.length,
                                position: position.value
                                    ? { ...position.value }
                                    : { x: 0, y: 0, z: 0 },
                                rotation: rotation.value
                                    ? { ...rotation.value }
                                    : { x: 0, y: 0, z: 0, w: 1 },
                                joints,
                            };
                        };

                        // Animation debug snapshot provider
                        const animationEvents: string[] = [];
                        const record = (msg: string) => {
                            const ts =
                                new Date()
                                    .toISOString()
                                    .split("T")[1]
                                    ?.split(".")[0] || "";
                            animationEvents.push(`${ts} ${msg}`);
                            if (animationEvents.length > 100)
                                animationEvents.shift();
                        };
                        if (idleAnimation)
                            record(`idle loaded: ${idleAnimation.name}`);
                        if (walkAnimation)
                            record(`walk loaded: ${walkAnimation.name}`);
                        (
                            window as DebugWindow & {
                                __debugMyAvatarAnimation?: () => {
                                    idle: { ready: boolean };
                                    walk: { ready: boolean };
                                    blendWeight: number;
                                    events: string[];
                                    animations: {
                                        fileName: string;
                                        state: string;
                                    }[];
                                } | null;
                            }
                        ).__debugMyAvatarAnimation = () => {
                            return {
                                idle: { ready: !!idleAnimation },
                                walk: { ready: !!walkAnimation },
                                blendWeight: blendWeight.value,
                                events: animationEvents.slice(),
                                animations: Array.from(
                                    animationsMap.value.entries(),
                                ).map(([fileName, info]) => ({
                                    fileName,
                                    state: info.state,
                                })),
                            };
                        };

                        // Add function to set avatar transform from debug overlay
                        (
                            window as DebugWindow & {
                                __debugSetMyAvatarTransform?: (
                                    position: {
                                        x: number;
                                        y: number;
                                        z: number;
                                    },
                                    rotation: {
                                        x: number;
                                        y: number;
                                        z: number;
                                        w: number;
                                    },
                                ) => void;
                            }
                        ).__debugSetMyAvatarTransform = (
                            newPosition,
                            newRotation,
                        ) => {
                            if (
                                !characterController.value ||
                                !avatarNode.value
                            ) {
                                console.error(
                                    "Character controller or avatar node not available",
                                );
                                return;
                            }

                            // Set position
                            setPosition(
                                new Vector3(
                                    newPosition.x,
                                    newPosition.y,
                                    newPosition.z,
                                ),
                            );
                            position.value = { ...newPosition };

                            // Set rotation
                            setOrientation(
                                new Quaternion(
                                    newRotation.x,
                                    newRotation.y,
                                    newRotation.z,
                                    newRotation.w,
                                ),
                            );
                            rotation.value = { ...newRotation };

                            // Force update transforms
                            updateTransforms();

                            // Update entity metadata
                            throttledUpdate();

                            console.log("[Debug] Avatar transform updated", {
                                position: newPosition,
                                rotation: newRotation,
                            });
                        };

                        console.log(
                            "[AVATAR] Emitting ready event after animation setup",
                        );
                        emit("ready");

                        // Audio stream is now initialized by the BabylonWebRTC component
                    } else {
                        console.warn(
                            "No skeleton found on avatar meshes, skipping animation load.",
                        );
                    }

                    // Debug mode: show bounding boxes, axes, and skeleton
                    if (debugBoundingBox.value) {
                        for (const mesh of avatarMeshes.value) {
                            if ("showBoundingBox" in mesh) {
                                (
                                    mesh as unknown as {
                                        showBoundingBox?: boolean;
                                    }
                                ).showBoundingBox = true;
                            }
                        }
                    }
                    if (debugAxes.value && avatarNode.value) {
                        // Initialize axes viewer; will update position and orientation each frame
                        axesViewer = new AxesViewer(
                            props.scene,
                            capsuleHeight.value,
                        );
                    }
                    if (debugSkeleton.value && avatarSkeleton.value) {
                        const skinnedMeshes = avatarMeshes.value.filter(
                            (m) => m.skeleton === avatarSkeleton.value,
                        );
                        for (const m of skinnedMeshes) {
                            if (avatarSkeleton.value) {
                                skeletonViewer = new SkeletonViewer(
                                    avatarSkeleton.value,
                                    m,
                                    props.scene,
                                );
                                skeletonViewer.isEnabled = true;
                            }
                        }
                    }

                    // Ensure camera is set up before starting the render loop
                    setupCamera();
                    console.log(
                        "[AVATAR] Emitting ready event after camera setup",
                    );
                    emit("ready");
                } else {
                    console.warn(
                        "Avatar node not initialized, skipping model load",
                    );
                }
            } else if (meta && characterController.value) {
                // Remote update, apply if present
                const metaPosition = meta.get("position") as
                    | PositionObj
                    | undefined;
                if (metaPosition) {
                    const p = metaPosition;
                    setPosition(new Vector3(p.x, p.y, p.z));
                }
                const metaRotation = meta.get("rotation") as
                    | RotationObj
                    | undefined;
                if (metaRotation) {
                    const r = metaRotation;
                    setOrientation(new Quaternion(r.x, r.y, r.z, r.w));
                }
                updateTransforms();
                const metaCameraOrientation = meta.get("cameraOrientation") as
                    | { alpha: number; beta: number; radius: number }
                    | undefined;
                if (metaCameraOrientation) {
                    updateCameraFromMeta(metaCameraOrientation);
                }
            }
        },
        { immediate: true },
    );

    // Handle input just before the physics engine step
    beforePhysicsObserver = props.scene.onBeforePhysicsObservable.add(() => {
        if (!characterController.value) return;
        const dt = props.scene.getEngine().getDeltaTime() / 1000;

        // Handle rotation input
        let yawDelta = 0;
        if (keyState.value.turnLeft) yawDelta -= turnSpeed.value * dt;
        if (keyState.value.turnRight) yawDelta += turnSpeed.value * dt;
        if (yawDelta !== 0) {
            const deltaQ = Quaternion.RotationAxis(Vector3.Up(), yawDelta);
            const currentQ = getOrientation();
            if (!currentQ) {
                console.error("No current orientation found.");
                return;
            }
            setOrientation(currentQ.multiply(deltaQ));
        }

        // Compute movement direction
        const dir = new Vector3(
            (keyState.value.strafeRight ? 1 : 0) -
                (keyState.value.strafeLeft ? 1 : 0),
            0,
            (keyState.value.forward ? 1 : 0) -
                (keyState.value.backward ? 1 : 0),
        );

        // Check if character is moving for animation blending
        const isMoving = dir.lengthSquared() > 0;

        // Update animation blending based on movement state
        updateAnimationBlending(isMoving, dt);

        // Horizontal movement via velocity
        const vel = getVelocity();
        if (isMoving && vel && avatarNode.value) {
            // Movement relative to capsule's facing via getDirection
            const forward = avatarNode.value.getDirection(Vector3.Forward());
            const right = avatarNode.value.getDirection(Vector3.Right());
            const moveWS = forward
                .scale(dir.z)
                .add(right.scale(dir.x))
                .normalize();
            const speed = walkSpeed.value; // use store value
            // preserve vertical velocity
            setVelocity(moveWS.scale(speed).add(new Vector3(0, vel.y, 0)));
        } else if (vel) {
            setVelocity(new Vector3(0, vel.y, 0));
        }
        // Jump if on ground
        if (keyState.value.jump) {
            const support = checkSupport(dt);
            if (
                support?.supportedState === CharacterSupportedState.SUPPORTED &&
                vel
            ) {
                setVelocity(new Vector3(vel.x, jumpSpeed.value, vel.z));
            }
        }
    });
    // After the physics engine updates, integrate the character and sync transforms
    afterPhysicsObserver = props.scene.onAfterPhysicsObservable.add(() => {
        if (!characterController.value) return;
        const dt = props.scene.getEngine().getDeltaTime() / 1000;
        // Apply manual gravity to vertical velocity
        const velAfter = getVelocity();
        if (velAfter) {
            velAfter.y += gravity.value * dt;
            setVelocity(velAfter);
        }
        // Integrate physics and sync transforms
        const supportAfter = checkSupport(dt);
        if (supportAfter) {
            integrate(dt, supportAfter);
        }
        updateTransforms();

        // Make sure skeleton is updated before sending metadata
        if (avatarSkeleton.value) {
            // Don't force skeleton matrix computation - let Babylon handle it naturally
            // This was interfering with other avatars' bone transforms:
            // avatarSkeleton.value.computeAbsoluteMatrices();

            // Debug skeleton data capture (enable with window.debugSkeleton = true)
            if (
                (window as DebugWindow).debugSkeleton &&
                !debugSkeletonData.value
            ) {
                debugSkeletonData.value = true;

                // Capture snapshot of skeleton state
                const snapshot: SkeletonSnapshot = {
                    timestamp: new Date().toISOString(),
                    boneCount: avatarSkeleton.value.bones.length,
                    animations: {
                        idle: idleAnimation?.isPlaying
                            ? `weight: ${(1 - blendWeight.value).toFixed(2)}`
                            : "not playing",
                        walk: walkAnimation?.isPlaying
                            ? `weight: ${blendWeight.value.toFixed(2)}`
                            : "not playing",
                    },
                    bones: {},
                };

                // Capture all bone transforms
                for (const bone of avatarSkeleton.value.bones) {
                    const localMat = bone.getLocalMatrix();
                    const pos = new Vector3();
                    const rot = new Quaternion();
                    const scale = new Vector3();
                    localMat.decompose(scale, rot, pos);

                    snapshot.bones[bone.name] = {
                        position: { x: pos.x, y: pos.y, z: pos.z },
                        rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
                        scale: { x: scale.x, y: scale.y, z: scale.z },
                    };
                }

                // Store in window for inspection
                (window as DebugWindow).lastSkeletonSnapshot = snapshot;
                console.log(
                    "[DEBUG] Skeleton snapshot captured. Access with: window.lastSkeletonSnapshot",
                );

                // Reset flag after 1 second
                setTimeout(() => {
                    debugSkeletonData.value = false;
                }, 1000);
            }
        }

        throttledUpdate();
        throttledJointUpdate();

        // update camera target to follow the avatar
        if (camera.value && avatarNode.value) {
            const node = avatarNode.value;
            camera.value.setTarget(
                new Vector3(
                    node.position.x,
                    node.position.y + capsuleHeight.value / 2,
                    node.position.z,
                ),
            );
        }
        // Debug axes update: position and orient axes to match avatar
        if (debugAxes.value && axesViewer && avatarNode.value) {
            const node = avatarNode.value;
            axesViewer.update(
                node.absolutePosition,
                node.getDirection(Vector3.Right()),
                node.getDirection(Vector3.Up()),
                node.getDirection(Vector3.Forward()),
            );
        }

        // Update leg rotation test
        if (
            legRotationTest.isActive &&
            legRotationTest.targetBone &&
            legRotationTest.originalRotation
        ) {
            const elapsed = Date.now() - legRotationTest.startTime;
            const progress = Math.min(elapsed / legRotationTest.duration, 1.0);

            // Calculate rotation angle (0 to 360 degrees)
            const angle = progress * Math.PI * 2;

            // Create rotation around Y axis (up)
            const rotationDelta = Quaternion.RotationAxis(Vector3.Up(), angle);

            // Apply rotation: original * delta
            const newRotation =
                legRotationTest.originalRotation.multiply(rotationDelta);

            // Try multiple approaches to ensure the rotation is applied

            // Approach 1: Set rotation quaternion directly
            legRotationTest.targetBone.setRotationQuaternion(
                newRotation,
                Space.LOCAL,
            );

            // Approach 2: Update the bone's local matrix directly
            // Get current position and scale from the matrix
            const currentMatrix = legRotationTest.targetBone.getLocalMatrix();
            const pos = new Vector3();
            const oldRot = new Quaternion();
            const scale = new Vector3();
            currentMatrix.decompose(scale, oldRot, pos);

            // Create new matrix with our rotation
            const rotMatrix = Matrix.FromQuaternionToRef(
                newRotation,
                new Matrix(),
            );
            const translationMatrix = Matrix.Translation(pos.x, pos.y, pos.z);
            const scaleMatrix = Matrix.Scaling(scale.x, scale.y, scale.z);
            const newMatrix = scaleMatrix
                .multiply(rotMatrix)
                .multiply(translationMatrix);

            // Apply the new matrix
            legRotationTest.targetBone.updateMatrix(newMatrix, false, false);

            // CRITICAL: Force skeleton to update and propagate to mesh
            if (avatarSkeleton.value) {
                // Mark skeleton as dirty to force update
                avatarSkeleton.value.prepare();

                // If the bone has a linked TransformNode, update that too
                const linkedNode =
                    legRotationTest.targetBone.getTransformNode();
                if (linkedNode?.rotationQuaternion) {
                    linkedNode.rotationQuaternion = newRotation;
                }
            }

            // Log progress every ~10%
            const progressPercent = Math.floor(progress * 10) * 10;
            if (
                progressPercent % 10 === 0 &&
                Math.abs(progress * 100 - progressPercent) < 1
            ) {
                console.log(
                    `[LegTest] Progress: ${progressPercent}%, angle: ${((angle * 180) / Math.PI).toFixed(1)}°`,
                );

                // Get current bone transform
                const localMat = legRotationTest.targetBone.getLocalMatrix();
                const pos = new Vector3();
                const rot = new Quaternion();
                const scale = new Vector3();
                localMat.decompose(scale, rot, pos);

                console.log(
                    `[LegTest] Current rotation: x=${rot.x.toFixed(3)}, y=${rot.y.toFixed(3)}, z=${rot.z.toFixed(3)}, w=${rot.w.toFixed(3)}`,
                );

                // Also log if bone has a linked transform node
                const linkedNode =
                    legRotationTest.targetBone.getTransformNode();
                if (linkedNode) {
                    console.log(
                        `[LegTest] Bone has linked TransformNode: ${linkedNode.name}`,
                    );
                }
            }

            // Auto-stop after completion
            if (progress >= 1.0) {
                console.log("[LegTest] Rotation complete, auto-stopping");
                stopLegRotationTest();
            }
        }
    });
    // Prevent unwanted root motion sliding by resetting root bone position each frame
    rootMotionObserver = props.scene.onBeforeRenderObservable.add(() => {
        if (avatarSkeleton.value && avatarSkeleton.value.bones.length > 0) {
            // const rootBone = avatarSkeleton.value.bones[0];
            // rootBone.position.set(0,0,0);
            // rootBone.rotationQuaternion?.set(0,0,0,1);
        }
    });

    // Start debug logging if enabled
    debugInterval = setInterval(() => {
        if (
            (window as DebugWindow).debugSkeletonLoop &&
            avatarSkeleton.value &&
            avatarMeshes.value.length > 0
        ) {
            const debugData: DebugData = {
                timestamp: new Date().toISOString().split("T")[1].split(".")[0],
                sessionId: sessionId.value || "",
                skeleton: {
                    boneCount: avatarSkeleton.value.bones.length,
                    animations: {
                        idle: idleAnimation?.isPlaying
                            ? 1 - blendWeight.value
                            : 0,
                        walk: walkAnimation?.isPlaying ? blendWeight.value : 0,
                    },
                },
                bones: {},
            };

            // Sample key bones to check movement
            const keyBones =
                legRotationTest.isActive && legRotationTest.targetBone
                    ? ["Hips", "Spine", "Head", legRotationTest.targetBone.name]
                    : ["Hips", "Spine", "Head"];

            // If leg test is active, mark animations as paused
            if (legRotationTest.isActive && legRotationTest.targetBone) {
                debugData.skeleton.animations.idle = "PAUSED (leg test)";
                debugData.skeleton.animations.walk = "PAUSED (leg test)";
            }

            debugData.bones = {};

            for (const boneName of keyBones) {
                const bone = avatarSkeleton.value.bones.find((b) =>
                    typeof boneName === "string"
                        ? b.name.includes(boneName)
                        : b.name === boneName,
                );
                if (bone) {
                    const localMat = bone.getLocalMatrix();
                    const pos = new Vector3();
                    const rot = new Quaternion();
                    const scale = new Vector3();
                    localMat.decompose(scale, rot, pos);

                    // For leg test bone, always log
                    const isLegTestBone =
                        legRotationTest.isActive &&
                        bone === legRotationTest.targetBone;

                    // Only log if not at identity OR if it's the leg test bone
                    if (
                        isLegTestBone ||
                        pos.lengthSquared() > 0.001 ||
                        Math.abs(rot.w - 1) > 0.001
                    ) {
                        debugData.bones[bone.name] = {
                            p: [
                                pos.x.toFixed(2),
                                pos.y.toFixed(2),
                                pos.z.toFixed(2),
                            ],
                            r: rot.w.toFixed(2),
                        };

                        // Add extra info for leg test bone
                        if (isLegTestBone) {
                            debugData.bones[bone.name].r =
                                `${rot.x.toFixed(2)},${rot.y.toFixed(2)},${rot.z.toFixed(2)},${rot.w.toFixed(2)}`;
                        }
                    }
                }
            }

            console.log("[MY_AVATAR]", JSON.stringify(debugData));
        }
    }, 1000); // Log every second
});

// React to definition name changes
watch(
    () => props.avatarDefinitionName,
    async (newName, oldName) => {
        if (newName && newName !== oldName) {
            if (vircadiaWorld.connectionInfo.value.status === "connected") {
                await loadAvatarDefinitionFromDb(newName);
            }
        }
    },
);

onUnmounted(() => {
    emit("dispose");
    if (beforePhysicsObserver) {
        props.scene.onBeforePhysicsObservable.remove(beforePhysicsObserver);
    }
    if (afterPhysicsObserver) {
        props.scene.onAfterPhysicsObservable.remove(afterPhysicsObserver);
    }
    if (rootMotionObserver) {
        props.scene.onBeforeRenderObservable.remove(rootMotionObserver);
    }
    if (debugInterval) {
        clearInterval(debugInterval);
    }

    // Cleanup Vue watchers
    connectionStatusWatcher?.();
    entityDataWatcher?.();
    // Dispose debug viewers
    if (skeletonViewer) {
        skeletonViewer.dispose();
        skeletonViewer = null;
    }
    if (axesViewer) {
        axesViewer.dispose();
        axesViewer = null;
    }
    avatarNode.value?.dispose();
});

defineExpose({
    isRetrieving,
    isCreating,
    isUpdatingMain,
    isUpdatingJoints,
    hasError: computed(() => false),
    errorMessage: computed(() => null),
    getPosition,
    setPosition,
    getOrientation,
    setOrientation,
    getVelocity,
    setVelocity,
    checkSupport,
    integrate,
    animations,
    avatarSkeleton,
    onAnimationState,
});
</script>