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
    type Scene,
    type Skeleton,
    type AbstractMesh,
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

// Get Vircadia instance
const vircadiaWorld = inject(useVircadiaInstance());
if (!vircadiaWorld) {
    throw new Error("Vircadia instance not found in BabylonOtherAvatar");
}

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

// Load the avatar model
async function loadAvatarModel() {
    if (isModelLoaded.value) {
        return;
    }

    try {
        console.info(
            `Loading other avatar model for session ${props.sessionId}...`,
        );

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

        console.info(
            `Imported other avatar model for session ${props.sessionId}:`,
            {
                meshes: result.meshes.map((m) => m.name),
                skeletons: result.skeletons.map((s) => s.name),
            },
        );

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

        // Find and store skeleton
        if (result.skeletons.length > 0) {
            avatarSkeleton.value = result.skeletons[0];
        } else {
            const skeletonMesh = result.meshes.find((m) => m.skeleton);
            avatarSkeleton.value = skeletonMesh?.skeleton || null;
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
        }

        isModelLoaded.value = true;
        emit("ready");
        console.info(
            `Other avatar model loaded for session ${props.sessionId}`,
        );
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

    // Apply joint transforms if available
    if (metadata.jointTransforms && avatarSkeleton.value) {
        console.log(
            "Applying joint transforms",
            metadata.jointTransforms.RightArm.rotation.x,
        );
        const bones = avatarSkeleton.value.bones;
        for (const bone of bones) {
            const jointTransform = metadata.jointTransforms[bone.name];
            if (jointTransform) {
                // Apply bone transforms

                const bonePos = objToVector(jointTransform.position);
                const boneRot = objToQuat(jointTransform.rotation);

                // Use proper bone transformation API by setting the matrix directly
                const localMatrix = Matrix.Compose(
                    Vector3.One(), // scale
                    boneRot, // rotation
                    bonePos, // translation
                );

                // Set the bone's transformation matrix directly
                bone.getLocalMatrix().copyFrom(localMatrix);
                bone.markAsDirty();
            }
        }

        // Critical: Prepare the skeleton for rendering updates
        avatarSkeleton.value.prepare();

        // Force recalculation of absolute matrices
        avatarSkeleton.value.computeAbsoluteMatrices(true);
    }
}

// Polling intervals
let dataPollInterval: number | null = null;

// Poll for avatar data from the server
async function pollAvatarData() {
    if (!vircadiaWorld || !vircadiaWorld.connectionInfo.value.isConnected) {
        return;
    }

    try {
        const entityName = `avatar:${props.sessionId}`;
        const query = `SELECT general__entity_name, meta__data FROM entity.entities WHERE general__entity_name = '${entityName}'`;

        const result = await vircadiaWorld.client.Utilities.Connection.query<
            Array<{ general__entity_name: string; meta__data: AvatarMetadata }>
        >({
            query,
            timeoutMs: 5000,
        });

        if (result.result && result.result.length > 0) {
            const rawMetaData = result.result[0].meta__data;

            // Parse and validate metadata using the schema
            try {
                const metadata = AvatarMetadataSchema.parse(rawMetaData);

                // Load model if not loaded yet
                if (!isModelLoaded.value) {
                    await loadAvatarModel();
                }

                // Apply the avatar data
                applyAvatarData(metadata);
            } catch (parseError) {
                console.warn(
                    `Failed to parse avatar metadata for session ${props.sessionId}:`,
                    parseError,
                );
            }
        }
    } catch (error) {
        console.warn(
            `Error polling avatar data for session ${props.sessionId}:`,
            error,
        );
    }
}

// Start polling when connected
function startPolling() {
    if (dataPollInterval) {
        return;
    }

    // Poll avatar data every 50ms for smooth updates
    dataPollInterval = setInterval(pollAvatarData, 50);
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

// Lifecycle hooks
onMounted(() => {
    if (vircadiaWorld.connectionInfo.value.status === "connected") {
        startPolling();
    }
});

onUnmounted(() => {
    emit("dispose");
    stopPolling();

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