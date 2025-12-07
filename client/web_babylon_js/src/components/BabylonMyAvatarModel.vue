<template>
    <!-- Provide target skeleton and passthrough props to children (e.g. animation loaders) -->
    <slot :target-skeleton="targetSkeleton" :vircadia-world="vircadiaWorld" :animations="animations"
        :on-animation-state="onAnimationState" />
</template>

<script setup lang="ts">
// FIXME: Needs a teardown. Other similar components probably do need as well.

import type {
    AbstractMesh,
    AnimationGroup,
    Scene,
    Skeleton,
} from "@babylonjs/core";
import { ImportMeshAsync, type TransformNode } from "@babylonjs/core";
import { onMounted, type Ref, ref, watch } from "vue";
import "@babylonjs/loaders/glTF";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";
import type { AnimationState } from "@/schemas";

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
            state: AnimationState;
            error?: string;
            group?: AnimationGroup | null;
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
    state: AnimationState;
    error?: string;
    group?: AnimationGroup | null;
}) => void;
void animations;
void onAnimationState;

const targetSkeleton: Ref<Skeleton | null> = ref(null);
const loadedMeshes: Ref<AbstractMesh[]> = ref([]);
const hasAttachedToAvatarNode = ref(false);

function extensionFromFileName(fileName: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase();
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
}

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

    const directUrl = vircadiaWorld.client.buildAssetRequestUrl(
        props.modelFileName,
    );
    emit("state", {
        state: "loading",
        step: "importingMesh",
        details: { fileName: props.modelFileName },
    });
    const result = await ImportMeshAsync(directUrl, props.scene, {
        pluginExtension: extensionFromFileName(props.modelFileName),
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
