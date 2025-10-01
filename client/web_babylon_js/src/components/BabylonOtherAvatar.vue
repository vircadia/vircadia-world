<template>
    <!-- No visual output needed for this component -->
</template>

<script setup lang="ts">
import {
    type AbstractMesh,
    Quaternion,
    type Scene,
    type Skeleton,
    Space,
    TransformNode,
    Vector3,
} from "@babylonjs/core";
import { onMounted, onUnmounted, type Ref, ref, watch } from "vue";
import "@babylonjs/loaders/glTF";
import { ImportMeshAsync } from "@babylonjs/core";
import type {
    AvatarBaseData,
    AvatarFrameMessage,
    AvatarJointMetadata,
    AvatarPositionData,
    AvatarRotationData,
    DebugData,
    DebugWindow,
} from "@schemas";
import { AvatarFrameMessageSchema } from "@schemas";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";

// Local helper types (previously from physics controller composable)
type PositionObj = { x: number; y: number; z: number };
type RotationObj = { x: number; y: number; z: number; w: number };

// Define component props
const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
    sessionId: { type: String, required: true }, // Full sessionId in format "sessionId-instanceId"
    vircadiaWorld: {
        type: Object as () => VircadiaWorldInstance,
        required: true,
    },
    avatarData: { type: Object as () => AvatarBaseData, required: false },
    positionData: { type: Object as () => AvatarPositionData, required: false },
    rotationData: { type: Object as () => AvatarRotationData, required: false },
    jointData: {
        type: Object as () => Map<string, AvatarJointMetadata>,
        required: false,
    },
});

const emit = defineEmits<{
    ready: [];
    dispose: [];
    "avatar-removed": [{ sessionId: string }];
}>();

// Avatar configuration defaults
const defaultAvatarDefinition = {
    modelFileName: "babylon.avatar.glb",
    meshPivotPoint: "bottom" as const,
    capsuleHeight: 1.8,
};
const modelFileName = ref<string>(defaultAvatarDefinition.modelFileName);
const meshPivotPoint = ref<"bottom" | "center">(
    defaultAvatarDefinition.meshPivotPoint,
);
const capsuleHeight = ref<number>(defaultAvatarDefinition.capsuleHeight);

// Refs for avatar model components
const avatarNode: Ref<TransformNode | null> = ref(null);
const meshes: Ref<AbstractMesh[]> = ref([]);
const avatarSkeleton: Ref<Skeleton | null> = ref(null);
const isModelLoaded = ref(false);

// Store current avatar data and joint data from props
const currentPositionData: Ref<AvatarPositionData | null> = ref(null);
const currentRotationData: Ref<AvatarRotationData | null> = ref(null);
const currentJointData: Ref<Map<string, AvatarJointMetadata>> = ref(new Map());

// LERP Smoothing Configuration
const AVATAR_SMOOTH_FACTOR = 0.2; // Main avatar position/rotation (0.1-0.3 recommended)
const BONE_SMOOTH_FACTOR = 0.25; // Bone transforms (slightly faster for responsiveness)

// Target transforms for smooth interpolation
const targetPosition = ref<Vector3>(new Vector3());
const targetRotation = ref<Quaternion>(new Quaternion());
const targetBoneTransforms = ref<
    Map<
        string,
        {
            position: Vector3;
            rotation: Quaternion;
            scale: Vector3;
        }
    >
>(new Map());

// Render loop observer for smooth interpolation
let renderObserver: (() => void) | null = null;

// Use Vircadia instance from props
const vircadiaWorld = props.vircadiaWorld;

// Build direct asset URL helper
function buildDirectUrl(fileName: string): string {
    return vircadiaWorld.client.buildAssetRequestUrl(fileName);
}

// Helper functions
function objToVector(obj: PositionObj): Vector3 {
    return new Vector3(obj.x, obj.y, obj.z);
}

function objToQuat(obj: RotationObj): Quaternion {
    return new Quaternion(obj.x, obj.y, obj.z, obj.w);
}

// Adaptive smooth factor based on distance (optional enhancement)
function adaptiveSmoothFactor(
    current: Vector3,
    target: Vector3,
    baseFactor: number,
): number {
    const distance = Vector3.Distance(current, target);

    // If far away, catch up faster
    if (distance > 2.0) return Math.min(0.5, baseFactor * 3);
    if (distance > 0.5) return Math.min(0.3, baseFactor * 2);
    return baseFactor;
}

// Watch for changes in avatar base data
watch(
    () => props.avatarData,
    (newData) => {
        if (newData && isModelLoaded.value) {
            // Base avatar data changed; if we already have pos/rot, re-apply transforms
            if (currentPositionData.value && currentRotationData.value) {
                updateTargetTransforms(
                    currentPositionData.value,
                    currentRotationData.value,
                    currentJointData.value,
                );
            }
        }
    },
    { deep: true },
);

// Watch for changes in position data
watch(
    () => props.positionData,
    (newPosition) => {
        if (newPosition && isModelLoaded.value) {
            currentPositionData.value = newPosition;
            if (currentRotationData.value) {
                updateTargetTransforms(
                    newPosition,
                    currentRotationData.value,
                    currentJointData.value,
                );
            }
        }
    },
    { deep: true },
);

// Watch for changes in rotation data
watch(
    () => props.rotationData,
    (newRotation) => {
        if (newRotation && isModelLoaded.value) {
            currentRotationData.value = newRotation;
            if (currentPositionData.value) {
                updateTargetTransforms(
                    currentPositionData.value,
                    newRotation,
                    currentJointData.value,
                );
            }
        }
    },
    { deep: true },
);

// Watch for changes in joint data
watch(
    () => props.jointData,
    (newJointData) => {
        if (newJointData && isModelLoaded.value) {
            currentJointData.value = newJointData;
            if (currentPositionData.value && currentRotationData.value) {
                updateTargetTransforms(
                    currentPositionData.value,
                    currentRotationData.value,
                    newJointData,
                );
            }
        }
    },
    { deep: true },
);

// Load the avatar model
async function loadAvatarModel() {
    if (isModelLoaded.value) {
        return;
    }

    try {
        // Load the asset using direct URL and extension from filename
        const directUrl = buildDirectUrl(modelFileName.value);
        const result = await ImportMeshAsync(directUrl, props.scene, {
            pluginExtension: (() => {
                const ext = modelFileName.value.split(".").pop()?.toLowerCase();
                switch (ext) {
                    case "glb":
                        return ".glb";
                    case "gltf":
                        return ".gltf";
                    case "fbx":
                        return ".fbx";
                    default:
                        return "";
                }
            })(),
        });

        // Stop and dispose any default animations to prevent interference
        if (result.animationGroups && result.animationGroups.length > 0) {
            for (const animGroup of result.animationGroups) {
                animGroup.stop();
                animGroup.dispose();
            }
        }

        // Create avatar root node
        avatarNode.value = new TransformNode(
            `otherAvatar_${props.sessionId}`,
            props.scene,
        );

        // Initialize position and rotation
        targetPosition.value = new Vector3(0, 0, 0);
        targetRotation.value = Quaternion.Identity();
        avatarNode.value.position = targetPosition.value.clone();
        avatarNode.value.rotationQuaternion = targetRotation.value.clone();

        // Store meshes and setup skeleton
        meshes.value = result.meshes;

        // Parent only top-level meshes under avatarNode to preserve hierarchy
        const rootMeshes = result.meshes.filter((m) => !m.parent);
        for (const mesh of rootMeshes) {
            if (meshPivotPoint.value === "bottom") {
                mesh.position.y = -capsuleHeight.value / 2;
            }
            mesh.parent = avatarNode.value;
        }

        // Find and store skeleton
        if (result.skeletons.length > 0) {
            avatarSkeleton.value = result.skeletons[0];

            // Ensure the skeleton is properly bound to its meshes
            for (const mesh of result.meshes) {
                if (mesh.skeleton === avatarSkeleton.value) {
                    mesh.skeleton = avatarSkeleton.value;
                }
            }
        } else {
            console.warn("No skeletons found in import result");
            return;
        }

        if (avatarSkeleton.value) {
            // Ensure skinned meshes have enough bone influencers
            for (const mesh of result.meshes.filter((m) => m.skeleton)) {
                if ("numBoneInfluencers" in mesh) {
                    mesh.numBoneInfluencers = Math.max(
                        mesh.numBoneInfluencers || 0,
                        4,
                    );
                }
            }

            // Initialize skeleton for proper bone manipulation
            avatarSkeleton.value.prepare();
            avatarSkeleton.value.computeAbsoluteMatrices(true);

            for (const bone of avatarSkeleton.value.bones) {
                bone.linkTransformNode(null);
            }
        }

        isModelLoaded.value = true;

        // Setup smooth interpolation render loop
        setupRenderLoop();

        emit("ready");
    } catch (error) {
        console.error(
            `Error loading other avatar model for session ${props.sessionId}:`,
            error,
        );
    }
}

// Setup the smooth interpolation render loop
function setupRenderLoop() {
    if (renderObserver) {
        props.scene.unregisterBeforeRender(renderObserver);
    }

    renderObserver = () => {
        if (!avatarNode.value || !isModelLoaded.value) return;

        // Smooth avatar position with adaptive factor
        const posFactor = adaptiveSmoothFactor(
            avatarNode.value.position,
            targetPosition.value,
            AVATAR_SMOOTH_FACTOR,
        );
        avatarNode.value.position = Vector3.Lerp(
            avatarNode.value.position,
            targetPosition.value,
            posFactor,
        );

        // Smooth avatar rotation
        if (avatarNode.value.rotationQuaternion && targetRotation.value) {
            avatarNode.value.rotationQuaternion = Quaternion.Slerp(
                avatarNode.value.rotationQuaternion,
                targetRotation.value,
                AVATAR_SMOOTH_FACTOR,
            );
        }

        // Smooth bone transforms
        if (avatarSkeleton.value && targetBoneTransforms.value.size > 0) {
            for (const bone of avatarSkeleton.value.bones) {
                const targetTransform = targetBoneTransforms.value.get(
                    bone.name,
                );

                if (targetTransform) {
                    // Get current bone transforms
                    const currentPos = bone.getPosition(Space.LOCAL);
                    const currentRot =
                        bone.getRotationQuaternion(Space.LOCAL) ||
                        Quaternion.Identity();
                    const currentScale = bone.getScale();

                    // Lerp to target
                    const smoothedPos = Vector3.Lerp(
                        currentPos,
                        targetTransform.position,
                        BONE_SMOOTH_FACTOR,
                    );
                    const smoothedRot = Quaternion.Slerp(
                        currentRot,
                        targetTransform.rotation,
                        BONE_SMOOTH_FACTOR,
                    );
                    const smoothedScale = Vector3.Lerp(
                        currentScale,
                        targetTransform.scale,
                        BONE_SMOOTH_FACTOR,
                    );

                    // Apply smoothed transforms
                    bone.setPosition(smoothedPos, Space.LOCAL);
                    bone.setRotationQuaternion(smoothedRot, Space.LOCAL);
                    bone.setScale(smoothedScale);
                    bone.markAsDirty();
                }
            }

            // Update skeleton
            avatarSkeleton.value.computeAbsoluteMatrices(true);

            // Force mesh updates
            for (const mesh of meshes.value) {
                if (mesh.skeleton === avatarSkeleton.value) {
                    mesh.computeWorldMatrix(true);
                }
            }
        }
    };

    props.scene.registerBeforeRender(renderObserver);
}

// Update target transforms (called when new data arrives)
function updateTargetTransforms(
    position: AvatarPositionData | null,
    rotation: AvatarRotationData | null,
    joints: Map<string, AvatarJointMetadata>,
) {
    if (!avatarNode.value || !isModelLoaded.value) {
        return;
    }

    // Update target position and rotation
    if (position) {
        targetPosition.value = objToVector(position);
    }

    if (rotation) {
        targetRotation.value = objToQuat(rotation);
    }

    // Update target bone transforms
    if (joints.size > 0 && avatarSkeleton.value) {
        const bones = avatarSkeleton.value.bones;

        for (const bone of bones) {
            // Try exact match first
            let jointMetadata = joints.get(bone.name);

            // If no exact match, try to find a matching joint
            if (!jointMetadata) {
                for (const [jointName, metadata] of joints) {
                    if (
                        bone.name.includes(jointName) ||
                        jointName.includes(bone.name)
                    ) {
                        jointMetadata = metadata;
                        break;
                    }
                }
            }

            if (jointMetadata) {
                // Store target transforms for this bone
                targetBoneTransforms.value.set(bone.name, {
                    position: objToVector(jointMetadata.position),
                    rotation: objToQuat(jointMetadata.rotation),
                    scale: jointMetadata.scale
                        ? objToVector(jointMetadata.scale)
                        : Vector3.One(),
                });
            } else {
                // Reset to bind pose
                if (bone.getBindMatrix) {
                    const bindMatrix = bone.getBindMatrix();
                    const bindPos = new Vector3();
                    const bindRot = new Quaternion();
                    const bindScale = new Vector3();
                    bindMatrix.decompose(bindScale, bindRot, bindPos);

                    targetBoneTransforms.value.set(bone.name, {
                        position: bindPos,
                        rotation: bindRot,
                        scale: bindScale,
                    });
                } else {
                    // Fallback: reset to identity
                    targetBoneTransforms.value.set(bone.name, {
                        position: Vector3.Zero(),
                        rotation: Quaternion.Identity(),
                        scale: Vector3.One(),
                    });
                }
            }
        }
    }
}

// Ingest a raw avatar_frame message, validate, and update targets
function ingestAvatarFrame(raw: unknown) {
    const parsed = AvatarFrameMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const frame: AvatarFrameMessage = parsed.data;

    if (frame.position) {
        currentPositionData.value = frame.position;
    }
    if (frame.rotation) {
        currentRotationData.value = frame.rotation;
    }
    // Convert joints record to Map<string, AvatarJointMetadata>-like entries
    if (frame.joints && Object.keys(frame.joints).length > 0) {
        const m = new Map<string, AvatarJointMetadata>();
        for (const key of Object.keys(frame.joints)) {
            const j = frame.joints[key];
            m.set(key, {
                type: "avatarJoint",
                sessionId: props.sessionId,
                jointName: key,
                position: j.position,
                rotation: j.rotation,
                scale: j.scale || { x: 1, y: 1, z: 1 },
            });
        }
        currentJointData.value = m;
    }

    updateTargetTransforms(
        currentPositionData.value,
        currentRotationData.value,
        currentJointData.value,
    );
}

// Debug interval
let debugInterval: number | null = null;

// Start debug logging
onMounted(async () => {
    // Load the avatar model when component is mounted
    await loadAvatarModel();

    // Apply any existing data if model loaded successfully
    if (
        isModelLoaded.value &&
        props.avatarData &&
        props.positionData &&
        props.rotationData
    ) {
        currentPositionData.value = props.positionData;
        currentRotationData.value = props.rotationData;
        updateTargetTransforms(
            currentPositionData.value,
            currentRotationData.value,
            props.jointData || new Map(),
        );
    }

    // Expose debug data function for overlay
    (
        window as DebugWindow & { __debugOtherAvatarData?: () => unknown }
    ).__debugOtherAvatarData = () => {
        if (!avatarSkeleton.value || !isModelLoaded.value) return null;

        const currentEngineState: Record<
            string,
            {
                position: { x: number; y: number; z: number };
                rotation: { x: number; y: number; z: number; w: number };
                scale: { x: number; y: number; z: number };
            }
        > = {};

        const lastReceivedValues: Record<
            string,
            {
                position: { x: number; y: number; z: number };
                rotation: { x: number; y: number; z: number; w: number };
                scale?: { x: number; y: number; z: number };
            }
        > = {};

        // Only collect key joints
        const keyJoints = ["Hips", "Spine", "LeftUpLeg", "RightUpLeg"];

        for (const jointName of keyJoints) {
            const bone = avatarSkeleton.value.bones.find((b) =>
                b.name.toLowerCase().includes(jointName.toLowerCase()),
            );

            if (bone) {
                // Current engine state
                const pos = bone.getPosition(Space.LOCAL);
                const rot =
                    bone.getRotationQuaternion(Space.LOCAL) ||
                    Quaternion.Identity();
                const scale = bone.getScale();

                currentEngineState[bone.name] = {
                    position: { x: pos.x, y: pos.y, z: pos.z },
                    rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
                    scale: { x: scale.x, y: scale.y, z: scale.z },
                };

                // Last received values from server
                if (currentJointData.value.size > 0) {
                    let jointMetadata = currentJointData.value.get(bone.name);

                    if (!jointMetadata) {
                        for (const [
                            jointName,
                            metadata,
                        ] of currentJointData.value) {
                            if (
                                bone.name.includes(jointName) ||
                                jointName.includes(bone.name)
                            ) {
                                jointMetadata = metadata;
                                break;
                            }
                        }
                    }

                    if (jointMetadata) {
                        lastReceivedValues[bone.name] = {
                            position: jointMetadata.position,
                            rotation: jointMetadata.rotation,
                            scale: jointMetadata.scale,
                        };
                    }
                }
            }
        }

        return {
            sessionId: props.sessionId,
            boneCount: avatarSkeleton.value.bones.length,
            smoothingFactor: AVATAR_SMOOTH_FACTOR,
            boneSmoothing: BONE_SMOOTH_FACTOR,
            currentEngineState,
            lastReceivedValues,
            lastReceivedTimestamp:
                currentPositionData.value && currentRotationData.value
                    ? new Date().toISOString()
                    : null,
        };
    };

    debugInterval = setInterval(() => {
        if (
            (window as DebugWindow).debugSkeletonLoop &&
            isModelLoaded.value &&
            avatarSkeleton.value
        ) {
            const debugData: DebugData = {
                timestamp: new Date().toISOString().split("T")[1].split(".")[0],
                sessionId: props.sessionId,
                skeleton: {
                    boneCount: avatarSkeleton.value.bones.length,
                },
                bones: {},
            };

            // Sample key bones to see if they're animating
            const keyBones = ["Hips", "Spine", "Head"];
            debugData.bones = {};

            for (const boneName of keyBones) {
                const bone = avatarSkeleton.value.bones.find((b) =>
                    b.name.includes(boneName),
                );
                if (bone) {
                    const pos = bone.getPosition(Space.LOCAL);
                    const rot = bone.getRotationQuaternion(Space.LOCAL);

                    // Only log if not at identity
                    if (
                        pos.lengthSquared() > 0.001 ||
                        (rot && Math.abs(rot.w - 1) > 0.001)
                    ) {
                        debugData.bones[bone.name] = {
                            p: [
                                pos.x.toFixed(2),
                                pos.y.toFixed(2),
                                pos.z.toFixed(2),
                            ],
                            r: rot ? rot.w.toFixed(2) : "1.00",
                        };
                    }
                }
            }

            console.log("[OTHER_AVATAR]", JSON.stringify(debugData));
        }
    }, 1000); // Log every second
});

onUnmounted(() => {
    emit("dispose");

    if (debugInterval) {
        clearInterval(debugInterval);
    }

    // Unregister render loop
    if (renderObserver) {
        props.scene.unregisterBeforeRender(renderObserver);
        renderObserver = null;
    }

    emit("avatar-removed", { sessionId: props.sessionId });

    // Clean up avatar node and meshes
    if (avatarNode.value) {
        avatarNode.value.dispose();
        avatarNode.value = null;
    }

    isModelLoaded.value = false;
});

defineExpose({
    sessionId: props.sessionId,
    isModelLoaded,
    avatarNode,
    ingestAvatarFrame,
});
</script>
