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
    AvatarJointMetadataSchema,
    type AvatarMetadata,
    type AvatarJointMetadata,
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
// Store last received joint metadata map
const lastReceivedJoints: Ref<Map<string, AvatarJointMetadata>> = ref(
    new Map(),
);

// Track the last successful poll timestamp for incremental updates
// This optimization allows us to only fetch joints that have been updated since
// the last poll, reducing data transfer and allowing more frequent polling
const lastPollTimestamp: Ref<Date | null> = ref(null);

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
function applyAvatarData(
    metadata: AvatarMetadata,
    joints: Map<string, AvatarJointMetadata>,
) {
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

        let bonesUpdated = 0;
        let bonesReset = 0;

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
let jointPollInterval: number | null = null;
let isPollingData = false; // Flag to prevent overlapping general data requests
let isPollingJoints = false; // Flag to prevent overlapping joint requests
let debugInterval: number | null = null;

// Poll for general avatar data from the server (position, rotation, etc.)
async function pollAvatarData() {
    if (
        !vircadiaWorld ||
        vircadiaWorld.connectionInfo.value.status !== "connected"
    ) {
        return;
    }

    if (isPollingData) {
        console.debug(
            `Skipping data poll for ${props.sessionId} - previous request still in progress`,
        );
        return;
    }

    isPollingData = true;

    try {
        const entityName = `avatar:${props.sessionId}`;

        // First check if entity exists
        const entityResult =
            await vircadiaWorld.client.Utilities.Connection.query({
                query: "SELECT general__entity_name FROM entity.entities WHERE general__entity_name = $1",
                parameters: [entityName],
                timeoutMs: 20000, // Increased timeout to 20 seconds
            });

        if (
            Array.isArray(entityResult.result) &&
            entityResult.result.length > 0
        ) {
            // Fetch all metadata for this entity
            const metadata = await retrieveEntityMetadata(entityName);

            if (metadata && metadata.size > 0) {
                try {
                    // Convert Map to object for validation
                    const metaObj = Object.fromEntries(metadata);

                    // Parse and validate metadata using the schema
                    const avatarMetadata = AvatarMetadataSchema.parse(metaObj);

                    appStore.setOtherAvatarMetadata(
                        props.sessionId,
                        avatarMetadata,
                    );

                    // Update avatar position if model is loaded
                    if (avatarNode.value && isModelLoaded.value) {
                        // Apply only position and rotation data (joints will be handled separately)
                        applyAvatarData(avatarMetadata, new Map());
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
            // Avatar entity not found - skip this poll cycle
            // Avatar lifecycle (add/remove) is managed by App.vue
            console.debug(
                `Avatar entity not found for session ${props.sessionId}, skipping update`,
            );
            // Reset the last poll timestamp when avatar is not found
            lastPollTimestamp.value = null;
            return;
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
        isPollingData = false;
    }
}

// Poll for joint data from the server (skeleton bones)
async function pollJointData() {
    if (
        !vircadiaWorld ||
        vircadiaWorld.connectionInfo.value.status !== "connected"
    ) {
        return;
    }

    if (isPollingJoints) {
        console.debug(
            `Skipping joint poll for ${props.sessionId} - previous request still in progress`,
        );
        return;
    }

    isPollingJoints = true;

    try {
        const entityName = `avatar:${props.sessionId}`;

        // First check if entity exists
        const entityResult =
            await vircadiaWorld.client.Utilities.Connection.query({
                query: "SELECT general__entity_name FROM entity.entities WHERE general__entity_name = $1",
                parameters: [entityName],
                timeoutMs: 20000, // Increased timeout to 20 seconds
            });

        if (
            Array.isArray(entityResult.result) &&
            entityResult.result.length > 0
        ) {
            // Fetch joint metadata - only fetch updates since last poll
            let jointQuery: string;
            let jointParameters: unknown[];

            if (lastPollTimestamp.value) {
                // Incremental update - only fetch joints updated since last poll
                jointQuery = `
                    SELECT metadata__key, metadata__value, general__updated_at
                    FROM entity.entity_metadata 
                    WHERE general__entity_name = $1 
                    AND metadata__key LIKE 'joint:%'
                    AND metadata__value->>'type' = 'avatarJoint'
                    AND general__updated_at > $2
                    ORDER BY general__updated_at DESC`;
                jointParameters = [
                    entityName,
                    lastPollTimestamp.value.toISOString(),
                ];
            } else {
                // Initial fetch - get all joints
                jointQuery = `
                    SELECT metadata__key, metadata__value, general__updated_at
                    FROM entity.entity_metadata 
                    WHERE general__entity_name = $1 
                    AND metadata__key LIKE 'joint:%'
                    AND metadata__value->>'type' = 'avatarJoint'
                    ORDER BY general__updated_at DESC`;
                jointParameters = [entityName];
            }

            const jointResult =
                await vircadiaWorld.client.Utilities.Connection.query({
                    query: jointQuery,
                    parameters: jointParameters,
                });

            // If this is an incremental update, start with existing joints
            const joints = lastPollTimestamp.value
                ? new Map(lastReceivedJoints.value)
                : new Map<string, AvatarJointMetadata>();

            let newestUpdateTime: Date | null = lastPollTimestamp.value;

            if (Array.isArray(jointResult.result)) {
                for (const row of jointResult.result) {
                    try {
                        // Parse each joint metadata
                        const jointData = AvatarJointMetadataSchema.parse(
                            row.metadata__value,
                        );
                        joints.set(jointData.jointName, jointData);

                        // Track the newest update time
                        if (row.general__updated_at) {
                            const updateTime = new Date(
                                row.general__updated_at,
                            );
                            if (
                                !newestUpdateTime ||
                                updateTime > newestUpdateTime
                            ) {
                                newestUpdateTime = updateTime;
                            }
                        }
                    } catch (parseError) {
                        console.warn(
                            `Failed to parse joint metadata for ${row.metadata__key}:`,
                            parseError,
                        );
                    }
                }

                // Log incremental update info for debugging
                if (lastPollTimestamp.value && jointResult.result.length > 0) {
                    console.debug(
                        `Incremental joint update for ${props.sessionId}: ${jointResult.result.length} joints updated since ${lastPollTimestamp.value.toISOString()}`,
                    );
                }
            }

            // Update the last poll timestamp
            if (newestUpdateTime) {
                lastPollTimestamp.value = newestUpdateTime;
            } else if (!lastPollTimestamp.value) {
                // If no joints were found and this is the first poll, set to current time
                lastPollTimestamp.value = new Date();
            }

            // Update avatar joints if model is loaded
            if (
                avatarNode.value &&
                isModelLoaded.value &&
                lastReceivedMetadata.value
            ) {
                applyAvatarData(lastReceivedMetadata.value, joints);
            }

            // Store the last received joints for debugging
            lastReceivedJoints.value = joints;
        } else {
            // Avatar entity not found - skip this poll cycle
            console.debug(
                `Avatar entity not found for joint poll ${props.sessionId}, skipping update`,
            );
            // Reset the last poll timestamp when avatar is not found
            lastPollTimestamp.value = null;
            return;
        }
    } catch (error) {
        // Handle timeout errors gracefully
        if (error instanceof Error && error.message.includes("timeout")) {
            console.debug(
                `Joint data query timed out for session ${props.sessionId}, will retry`,
            );
        } else {
            console.error(
                `Error polling joint data for session ${props.sessionId}:`,
                error,
            );
        }
    } finally {
        isPollingJoints = false;
    }
}

// Start polling when connected
function startPolling() {
    if (dataPollInterval || jointPollInterval) {
        return;
    }

    // Initial poll to get data immediately
    pollAvatarData();
    pollJointData();

    // Poll general avatar data at configured interval (position, rotation, etc.)
    dataPollInterval = setInterval(
        pollAvatarData,
        appStore.pollingIntervals.otherAvatarData,
    );

    // Poll joint data at a separate, less frequent interval
    jointPollInterval = setInterval(
        pollJointData,
        appStore.pollingIntervals.otherAvatarJointData,
    );

    console.debug(
        `Started split polling for avatar ${props.sessionId}: data every ${appStore.pollingIntervals.otherAvatarData}ms, joints every ${appStore.pollingIntervals.otherAvatarJointData}ms`,
    );

    // WebRTC connection is now handled by periodic discovery in useBabylonWebRTC
}

// Stop polling
function stopPolling() {
    if (dataPollInterval) {
        clearInterval(dataPollInterval);
        dataPollInterval = null;
    }

    if (jointPollInterval) {
        clearInterval(jointPollInterval);
        jointPollInterval = null;
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
                if (lastReceivedJoints.value.size > 0) {
                    // Try exact match first
                    let jointMetadata = lastReceivedJoints.value.get(bone.name);

                    // If no exact match, try to find a matching joint by checking if bone name contains joint name
                    if (!jointMetadata) {
                        for (const [
                            jointName,
                            metadata,
                        ] of lastReceivedJoints.value) {
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