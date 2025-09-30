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
    AvatarJointMetadata,
    AvatarPositionData,
    AvatarRotationData,
    DebugData,
    DebugWindow,
} from "@schemas";
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

// Use Vircadia instance from props
const vircadiaWorld = props.vircadiaWorld;

// Audio playback is now handled by BabylonWebRTC component

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

// Debug interfaces now imported from @schemas

// Watch for changes in avatar base data
watch(
    () => props.avatarData,
    (newData) => {
        if (newData && isModelLoaded.value) {
            // Base avatar data changed; if we already have pos/rot, re-apply transforms
            if (currentPositionData.value && currentRotationData.value) {
                applyAvatarTransforms(
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
                applyAvatarTransforms(
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
                applyAvatarTransforms(
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
                applyAvatarTransforms(
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

        // Find and store skeleton - Use the first skeleton from import
        if (result.skeletons.length > 0) {
            avatarSkeleton.value = result.skeletons[0];

            // Ensure the skeleton is properly bound to its meshes
            for (const mesh of result.meshes) {
                if (mesh.skeleton === avatarSkeleton.value) {
                    // Force refresh of skeleton binding
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
            // Force initial computation to ensure proper setup
            avatarSkeleton.value.computeAbsoluteMatrices(true);

            for (const bone of avatarSkeleton.value.bones) {
                bone.linkTransformNode(null);
            }

            // Note: GLTF skeletons don't expose bones as TransformNodes
            // The bones are managed internally by the skeleton system
        }

        isModelLoaded.value = true;
        emit("ready");
    } catch (error) {
        console.error(
            `Error loading other avatar model for session ${props.sessionId}:`,
            error,
        );
    }
}

// Apply avatar transforms to the model
function applyAvatarTransforms(
    position: AvatarPositionData | null,
    rotation: AvatarRotationData | null,
    joints: Map<string, AvatarJointMetadata>,
) {
    if (!avatarNode.value || !isModelLoaded.value) {
        return;
    }

    // Apply position and rotation
    if (position) {
        const pos = objToVector(position);
        avatarNode.value.position = pos;
    }

    if (rotation) {
        const rot = objToQuat(rotation);
        avatarNode.value.rotationQuaternion = rot;
    }

    // Apply joint transforms if available (now from individual metadata entries)
    if (joints.size > 0 && avatarSkeleton.value) {
        const bones = avatarSkeleton.value.bones;

        // Debug: Check if skeleton is properly bound to meshes
        const skinnedMeshCount = meshes.value.filter(
            (m) => m.skeleton === avatarSkeleton.value,
        ).length;
        if (skinnedMeshCount === 0) {
            console.warn(
                `No meshes are bound to the skeleton for session ${props.sessionId}!`,
            );
        }

        // Update bones with data
        for (const bone of bones) {
            // Try exact match first
            let jointMetadata = joints.get(bone.name);

            // If no exact match, try to find a matching joint by checking if bone name contains joint name
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
                // Bone has new data - apply it
                const bonePos = objToVector(jointMetadata.position);
                const boneRot = objToQuat(jointMetadata.rotation);
                const boneScale = jointMetadata.scale
                    ? objToVector(jointMetadata.scale)
                    : Vector3.One();

                // Set transforms in LOCAL space
                bone.setPosition(bonePos, Space.LOCAL);
                bone.setRotationQuaternion(boneRot, Space.LOCAL);
                bone.setScale(boneScale);
            } else {
                // Bone has no data - reset to bind pose to prevent T-pose artifacts
                // This is crucial to prevent bones from staying in previous positions
                if (bone.getBindMatrix) {
                    const bindMatrix = bone.getBindMatrix();
                    const bindPos = new Vector3();
                    const bindRot = new Quaternion();
                    const bindScale = new Vector3();
                    bindMatrix.decompose(bindScale, bindRot, bindPos);

                    bone.setPosition(bindPos, Space.LOCAL);
                    bone.setRotationQuaternion(bindRot, Space.LOCAL);
                    bone.setScale(bindScale);
                } else {
                    // Fallback: reset to identity transforms
                    bone.setPosition(Vector3.Zero(), Space.LOCAL);
                    bone.setRotationQuaternion(
                        Quaternion.Identity(),
                        Space.LOCAL,
                    );
                    bone.setScale(Vector3.One());
                }
            }

            // Mark the bone as updated
            bone.markAsDirty();
        }

        // Force skeleton update to ensure proper hierarchy computation
        // Use 'true' to force computation even if bones haven't changed
        avatarSkeleton.value.computeAbsoluteMatrices(true);

        // Force mesh updates for all skinned meshes
        for (const mesh of meshes.value) {
            if (mesh.skeleton === avatarSkeleton.value) {
                // Force the mesh to update its world matrix
                mesh.computeWorldMatrix(true);

                // If the mesh has a method to update from skeleton, use it
                if (
                    "applySkeleton" in mesh &&
                    typeof mesh.applySkeleton === "function"
                ) {
                    // mesh.applySkeleton(avatarSkeleton.value);
                }
            }
        }
    }
}

// Debug interval
let debugInterval: number | null = null;

// Audio playback is now handled by the BabylonWebRTC component

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
        applyAvatarTransforms(
            currentPositionData.value,
            currentRotationData.value,
            props.jointData || new Map(),
        );
    }

    // Audio playback is now handled by the BabylonWebRTC component

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

        // Only collect key joints: Hips, Spine bones, and leg bones
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
                    // Try exact match first
                    let jointMetadata = currentJointData.value.get(bone.name);

                    // If no exact match, try to find a matching joint by checking if bone name contains joint name
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

    emit("avatar-removed", { sessionId: props.sessionId });

    // Clean up avatar node and meshes
    if (avatarNode.value) {
        avatarNode.value.dispose();
        avatarNode.value = null;
    }

    // No object URL to revoke (using data URL or revoked immediately for objects)

    isModelLoaded.value = false;
});

defineExpose({
    sessionId: props.sessionId,
    isModelLoaded,
    avatarNode,
});
</script>