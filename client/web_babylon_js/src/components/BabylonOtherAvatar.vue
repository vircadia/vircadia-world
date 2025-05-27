<template>
    <!-- No visual output needed for this component -->
</template>

<script setup lang="ts">
import {
    ref,
    onMounted,
    onUnmounted,
    watch,
    inject,
    toRefs,
    type Ref,
} from "vue";
import { useVircadiaInstance } from "@vircadia/world-sdk/browser/vue";
import { useAppStore } from "@/stores/appStore";
import {
    Vector3,
    Quaternion,
    TransformNode,
    Matrix,
    Space,
    type Scene,
    type Skeleton,
    type AbstractMesh,
    type AnimationGroup,
    type Bone,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { useAsset } from "@vircadia/world-sdk/browser/vue";
import { ImportMeshAsync } from "@babylonjs/core";
import {
    AvatarMetadataSchema,
    type AvatarMetadata,
} from "../composables/schemas";
import type {
    PositionObj,
    RotationObj,
} from "../composables/useBabylonAvatarPhysicsController";

// Define component props
const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
    sessionId: { type: String, required: true },
});

const emit = defineEmits<{ ready: []; dispose: [] }>();

// Load avatar configuration from global store
const appStore = useAppStore();
const avatarDefinition = appStore.avatarDefinition;
const { modelFileName, meshPivotPoint, capsuleHeight } =
    toRefs(avatarDefinition);

// Refs for avatar model components
const avatarNode: Ref<TransformNode | null> = ref(null);
const meshes: Ref<AbstractMesh[]> = ref([]);
const avatarSkeleton: Ref<Skeleton | null> = ref(null);
const isModelLoaded = ref(false);

// Store last received metadata for debugging
const lastReceivedMetadata: Ref<AvatarMetadata | null> = ref(null);

// Get Vircadia instance
const vircadiaWorld = inject(useVircadiaInstance());
if (!vircadiaWorld) {
    throw new Error("Vircadia instance not found in BabylonOtherAvatar");
}

// Audio playback is now handled by BabylonWebRTC component

// Asset loader for the avatar model
const modelFileNameRef: Ref<string> = ref(modelFileName.value);
const asset = useAsset({
    fileName: modelFileNameRef,
    useCache: true,
    debug: false,
});

// Helper functions
function objToVector(obj: PositionObj): Vector3 {
    return new Vector3(obj.x, obj.y, obj.z);
}

function objToQuat(obj: RotationObj): Quaternion {
    return new Quaternion(obj.x, obj.y, obj.z, obj.w);
}

// Type for debug data
interface DebugData {
    timestamp: string;
    sessionId: string;
    skeleton: {
        boneCount: number;
    };
    bones: Record<
        string,
        {
            p: string[];
            r: string;
        }
    >;
}

// Type for debug window properties
interface DebugWindow extends Window {
    debugSkeletonLoop?: boolean;
    debugBoneNames?: boolean;
    debugOtherAvatar?: boolean;
}

// Load the avatar model
async function loadAvatarModel() {
    if (isModelLoaded.value) {
        return;
    }

    try {
        // Load the asset
        await asset.executeLoad();
        const assetData = asset.assetData.value;
        if (!assetData?.blobUrl) {
            console.warn("Asset blob URL not available for avatar model");
            return;
        }

        // Import the model
        const result = await ImportMeshAsync(assetData.blobUrl, props.scene, {
            pluginExtension: asset.fileExtension.value,
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

// Apply avatar metadata to the model
function applyAvatarData(metadata: AvatarMetadata) {
    if (!avatarNode.value || !isModelLoaded.value) {
        return;
    }

    // Apply position and rotation
    if (metadata.position) {
        const pos = objToVector(metadata.position);
        avatarNode.value.position = pos;
    }

    if (metadata.rotation) {
        const rot = objToQuat(metadata.rotation);
        avatarNode.value.rotationQuaternion = rot;
    }

    // Apply joint transforms if available (now in LOCAL SPACE)
    if (metadata.jointTransformsLocal && avatarSkeleton.value) {
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

        let bonesUpdated = 0;
        let bonesReset = 0;

        // Update bones with data
        for (const bone of bones) {
            // Try exact match first
            let jointTransform = metadata.jointTransformsLocal[bone.name];

            // If no exact match, try to find a matching joint by checking if bone name contains joint name
            if (!jointTransform) {
                const jointNames = Object.keys(metadata.jointTransformsLocal);
                for (const jointName of jointNames) {
                    if (
                        bone.name.includes(jointName) ||
                        jointName.includes(bone.name)
                    ) {
                        jointTransform =
                            metadata.jointTransformsLocal[jointName];
                        break;
                    }
                }
            }

            if (jointTransform) {
                // Bone has new data - apply it
                const bonePos = objToVector(jointTransform.position);
                const boneRot = objToQuat(jointTransform.rotation);
                const boneScale = jointTransform.scale
                    ? objToVector(jointTransform.scale)
                    : Vector3.One();

                // Set transforms in LOCAL space
                bone.setPosition(bonePos, Space.LOCAL);
                bone.setRotationQuaternion(boneRot, Space.LOCAL);
                bone.setScale(boneScale);
                bonesUpdated++;
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
                bonesReset++;
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

// Polling intervals
let dataPollInterval: number | null = null;
let isPolling = false; // Add flag to prevent overlapping requests
let debugInterval: number | null = null;

// Poll for avatar data from the server
async function pollAvatarData() {
    if (
        !vircadiaWorld ||
        vircadiaWorld.connectionInfo.value.status !== "connected"
    ) {
        return;
    }

    if (isPolling) {
        console.debug(
            `Skipping poll for ${props.sessionId} - previous request still in progress`,
        );
        return;
    }

    isPolling = true;

    try {
        const query = `SELECT general__entity_name, meta__data FROM entity.entities WHERE general__entity_name = 'avatar:${props.sessionId}'`;

        const result = await vircadiaWorld.client.Utilities.Connection.query<
            Array<{ general__entity_name: string; meta__data: unknown }>
        >({
            query,
            timeoutMs: 20000, // Increased timeout to 20 seconds
        });

        if (result.result && result.result.length > 0) {
            const avatarEntity = result.result[0];
            const rawMetadata = avatarEntity.meta__data;

            if (rawMetadata && typeof rawMetadata === "object") {
                try {
                    // Parse and validate metadata using the schema
                    const avatarMetadata =
                        AvatarMetadataSchema.parse(rawMetadata);

                    appStore.setOtherAvatarMetadata(
                        props.sessionId,
                        avatarMetadata,
                    );

                    // Update avatar position if model is loaded
                    if (avatarNode.value && isModelLoaded.value) {
                        applyAvatarData(avatarMetadata);
                    }

                    // Store the last received metadata for debugging
                    lastReceivedMetadata.value = avatarMetadata;
                } catch (parseError) {
                    console.warn(
                        `Failed to parse avatar metadata for session ${props.sessionId}:`,
                        parseError,
                    );
                }
            }
        } else {
            // Avatar entity not found - it may have disconnected
            console.debug(
                `Avatar entity not found for session ${props.sessionId}`,
            );
            appStore.removeOtherAvatarMetadata(props.sessionId);
        }
    } catch (error) {
        // Handle timeout errors gracefully
        if (error instanceof Error && error.message.includes("timeout")) {
            console.debug(
                `Avatar data query timed out for session ${props.sessionId}, will retry`,
            );
        } else {
            console.error(
                `Error polling avatar data for session ${props.sessionId}:`,
                error,
            );
        }
    } finally {
        isPolling = false;
    }
}

// Start polling when connected
function startPolling() {
    if (dataPollInterval) {
        return;
    }

    // Poll avatar data at configured interval
    dataPollInterval = setInterval(
        pollAvatarData,
        appStore.pollingIntervals.otherAvatarData,
    );

    // WebRTC connection is now handled by periodic discovery in useBabylonWebRTC
}

// Stop polling
function stopPolling() {
    if (dataPollInterval) {
        clearInterval(dataPollInterval);
        dataPollInterval = null;
    }
}

// Watch for connection changes
watch(
    () => vircadiaWorld.connectionInfo.value.status,
    (status) => {
        if (status === "connected") {
            startPolling();
        } else {
            stopPolling();
        }
    },
    { immediate: true },
);

// Audio playback is now handled by the BabylonWebRTC component

// Start debug logging
onMounted(() => {
    // Load the avatar model when component is mounted
    loadAvatarModel();

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
                if (lastReceivedMetadata.value?.jointTransformsLocal) {
                    // Try exact match first
                    let jointTransform =
                        lastReceivedMetadata.value.jointTransformsLocal[
                            bone.name
                        ];

                    // If no exact match, try to find a matching joint by checking if bone name contains joint name
                    if (!jointTransform) {
                        const jointNames = Object.keys(
                            lastReceivedMetadata.value.jointTransformsLocal,
                        );
                        for (const jointName of jointNames) {
                            if (
                                bone.name.includes(jointName) ||
                                jointName.includes(bone.name)
                            ) {
                                jointTransform =
                                    lastReceivedMetadata.value
                                        .jointTransformsLocal[jointName];
                                break;
                            }
                        }
                    }

                    if (jointTransform) {
                        lastReceivedValues[bone.name] = {
                            position: jointTransform.position,
                            rotation: jointTransform.rotation,
                            scale: jointTransform.scale,
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
            lastReceivedTimestamp: lastReceivedMetadata.value
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

    if (vircadiaWorld.connectionInfo.value.status === "connected") {
        startPolling();
    }
});

onUnmounted(() => {
    emit("dispose");
    stopPolling();

    if (debugInterval) {
        clearInterval(debugInterval);
    }

    // Remove metadata from store
    appStore.removeOtherAvatarMetadata(props.sessionId);

    // Clean up avatar node and meshes
    if (avatarNode.value) {
        avatarNode.value.dispose();
        avatarNode.value = null;
    }

    // Clean up asset
    asset.cleanup();

    isModelLoaded.value = false;
});

defineExpose({
    sessionId: props.sessionId,
    isModelLoaded,
    avatarNode,
});
</script> 