<template>
	<!-- Provide target skeleton and passthrough props to children (e.g. animation loaders) -->
	<slot
		:target-skeleton="targetSkeleton"
		:vircadia-world="vircadiaWorld"
		:animations="animations"
		:on-animation-state="onAnimationState"
	/>
</template>

<script setup lang="ts">
// FIXME: Needs a teardown. Other similar components probably do need as well.
import { ref, watch, onMounted, type Ref, computed } from "vue";
import type { Scene, AbstractMesh, Skeleton } from "@babylonjs/core";
import { ImportMeshAsync, type TransformNode } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { useAsset, type useVircadia } from "@vircadia/world-sdk/browser/vue";

const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
    vircadiaWorld: {
        type: Object as () => ReturnType<typeof useVircadia>,
        required: true,
    },
    avatarNode: {
        type: Object as () => TransformNode | null,
        required: false,
        default: null,
    },
    modelFileName: { type: String, required: true },
    meshPivotPoint: {
        type: String as () => "bottom" | "center",
        required: true,
    },
    capsuleHeight: { type: Number, required: true },
    onSetAvatarModel: {
        type: Function as unknown as () => (payload: {
            skeleton: Skeleton | null;
            meshes: AbstractMesh[];
        }) => void,
        required: true,
    },
    // Passthrough to child slot
    animations: { type: Array as () => { fileName: string }[], required: true },
    onAnimationState: {
        type: Function as unknown as () => (payload: {
            fileName: string;
            state: string;
            error?: string;
            group?: unknown;
        }) => void,
        required: true,
    },
});

const emit = defineEmits<{
    state: [
        payload: {
            state: "loading" | "ready" | "error";
            step: string;
            message?: string;
            details?: Record<string, unknown>;
        },
    ];
}>();

const vircadiaWorld = props.vircadiaWorld;
const animations = props.animations;
const onAnimationState = props.onAnimationState as (payload: {
    fileName: string;
    state: string;
    error?: string;
    group?: unknown;
}) => void;
void animations;
void onAnimationState;

const targetSkeleton: Ref<Skeleton | null> = ref(null);
const loadedMeshes: Ref<AbstractMesh[]> = ref([]);
const hasAttachedToAvatarNode = ref(false);

// Create a computed ref that tracks the modelFileName prop
const modelFileNameRef = computed(() => props.modelFileName);

const asset = useAsset({
    fileName: modelFileNameRef,
    useCache: true,
    debug: true, // Enable debug to see what's happening
    instance: vircadiaWorld,
});

async function loadAndAttach(): Promise<void> {
    // Avoid duplicate loads
    if (!props.scene || !props.modelFileName) {
        console.warn("[BabylonMyAvatarModel] Missing scene or modelFileName", {
            hasScene: !!props.scene,
            modelFileName: props.modelFileName,
        });
        emit("state", {
            state: "error",
            step: "validation",
            message: "Missing scene or modelFileName",
            details: { modelFileName: props.modelFileName },
        });
        return;
    }

    console.log(
        `[BabylonMyAvatarModel] Starting load for: ${props.modelFileName}`,
    );

    emit("state", {
        state: "loading",
        step: "start",
        details: { fileName: props.modelFileName },
    });

    // Debug the asset state before loading
    console.log("[BabylonMyAvatarModel] Asset state before load:", {
        fileName: props.modelFileName,
        hasAssetData: !!asset.assetData.value,
        assetData: asset.assetData.value,
    });

    await asset.executeLoad();

    // Debug the asset state after loading
    console.log("[BabylonMyAvatarModel] Asset state after load:", {
        fileName: props.modelFileName,
        hasAssetData: !!asset.assetData.value,
        blobUrl: asset.assetData.value?.blobUrl,
        assetData: asset.assetData.value,
    });

    const blobUrl = asset.assetData.value?.blobUrl;
    if (!blobUrl) {
        console.warn(
            `[BabylonMyAvatarModel] No blobUrl for ${props.modelFileName}`,
            "Asset details:",
            asset.assetData.value,
        );
        emit("state", {
            state: "error",
            step: "assetLoad",
            message: "No blobUrl from asset loader",
            details: {
                fileName: props.modelFileName,
                assetData: asset.assetData.value,
            },
        });
        return;
    }
    emit("state", {
        state: "loading",
        step: "importingMesh",
        details: {
            fileName: props.modelFileName,
            blobUrl,
            extension: asset.fileExtension.value,
        },
    });
    const result = await ImportMeshAsync(blobUrl, props.scene, {
        pluginExtension: asset.fileExtension.value,
    });
    emit("state", {
        state: "loading",
        step: "importedMesh",
        details: {
            meshCount: result.meshes?.length ?? 0,
            skeletonCount: result.skeletons?.length ?? 0,
        },
    });

    // Parent only top-level meshes under avatarNode
    const meshes = result.meshes as AbstractMesh[];
    loadedMeshes.value = meshes;
    if (props.avatarNode) {
        for (const mesh of meshes.filter((m) => !m.parent)) {
            if (props.meshPivotPoint === "bottom") {
                mesh.position.y = -props.capsuleHeight / 2;
            }
            mesh.parent = props.avatarNode;
        }
        // Force world matrix computation after parenting to ensure proper transform inheritance
        props.avatarNode.computeWorldMatrix(true);
        for (const mesh of meshes) {
            mesh.computeWorldMatrix(true);
        }
        hasAttachedToAvatarNode.value = true;
    }

    // Determine skeleton
    let skeleton: Skeleton | null = null;
    if (result.skeletons.length > 0) {
        skeleton = result.skeletons[0] as Skeleton;
    } else {
        const withSkeleton = meshes.find((m) => (m as AbstractMesh).skeleton);
        skeleton = (withSkeleton?.skeleton as Skeleton) || null;
    }
    emit("state", {
        state: "loading",
        step: "skeletonDetermined",
        details: {
            hasSkeleton: !!skeleton,
            boneCount: skeleton?.bones?.length ?? 0,
        },
    });
    // Ensure skinned meshes allow enough bone influencers
    if (skeleton) {
        for (const mesh of meshes.filter((m) => (m as AbstractMesh).skeleton)) {
            if ("numBoneInfluencers" in mesh) {
                const current =
                    (mesh as unknown as { numBoneInfluencers?: number })
                        .numBoneInfluencers || 0;
                (
                    mesh as AbstractMesh & { numBoneInfluencers?: number }
                ).numBoneInfluencers = Math.max(current, 4);
            }
        }
    }

    targetSkeleton.value = skeleton;
    props.onSetAvatarModel({ skeleton, meshes });
    emit("state", {
        state: "ready",
        step: "complete",
        details: {
            hasSkeleton: !!skeleton,
            boneCount: skeleton?.bones?.length ?? 0,
            meshCount: meshes.length,
        },
    });
}

onMounted(async () => {
    try {
        await loadAndAttach();
    } catch (e) {
        console.error("[BabylonMyAvatarModel] Failed to load/attach model", e);
        emit("state", {
            state: "error",
            step: "onMounted",
            message: e instanceof Error ? e.message : String(e),
        });
    }
});

// React if filename changes
watch(
    () => props.modelFileName,
    async () => {
        try {
            emit("state", {
                state: "loading",
                step: "filenameChanged",
                details: { fileName: props.modelFileName },
            });
            await loadAndAttach();
        } catch (e) {
            console.error(
                "[BabylonMyAvatarModel] Reload on filename change failed",
                e,
            );
            emit("state", {
                state: "error",
                step: "filenameChanged",
                message: e instanceof Error ? e.message : String(e),
            });
        }
    },
);

// React if avatarNode becomes available after model load
watch(
    () => props.avatarNode,
    (node) => {
        if (!node || hasAttachedToAvatarNode.value) return;
        if (!loadedMeshes.value || loadedMeshes.value.length === 0) return;
        // Parent only top-level meshes
        const rootMeshes = loadedMeshes.value.filter((m) => !m.parent);
        for (const mesh of rootMeshes) {
            if (props.meshPivotPoint === "bottom") {
                mesh.position.y = -props.capsuleHeight / 2;
            }
            mesh.parent = node;
        }
        node.computeWorldMatrix(true);
        for (const mesh of loadedMeshes.value) {
            mesh.computeWorldMatrix(true);
        }
        hasAttachedToAvatarNode.value = true;
    },
    { immediate: true },
);

defineExpose({ targetSkeleton });
</script>


