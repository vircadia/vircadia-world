<template>
	<!-- Non-visual animation loader -->
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, type Ref } from "vue";
import type { Scene, AnimationGroup, Skeleton } from "@babylonjs/core";
import { ImportMeshAsync } from "@babylonjs/core";
import { useAsset } from "@vircadia/world-sdk/browser/vue";
import type { useVircadia } from "@vircadia/world-sdk/browser/vue";
import type { BabylonAnimationDefinition } from "@/composables/schemas";

export type AnimationState = "idle" | "loading" | "ready" | "error";

interface AnimationInfo {
    state: AnimationState;
    error?: string;
    group?: AnimationGroup;
}

const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
    vircadiaWorld: { type: Object as () => unknown, required: true },
    animation: {
        type: Object as () => BabylonAnimationDefinition,
        required: true,
    },
    targetSkeleton: { type: Object as () => unknown, required: true },
});

const emit = defineEmits<{
    state: [
        {
            fileName: string;
            state: AnimationState;
            error?: string;
            group?: AnimationGroup;
        },
    ];
}>();

const info = ref<AnimationInfo>({ state: "idle" });
let disposed = false;

function emitState(): void {
    emit("state", {
        fileName: props.animation.fileName,
        state: info.value.state,
        error: info.value.error,
        group: info.value.group as unknown as AnimationGroup,
    });
}

// Accept either a ref or direct Skeleton, normalize to a ref
const targetSkeletonRef: Ref<any> = (() => {
    const input = props.targetSkeleton as unknown;
    if (input && typeof input === "object" && "value" in (input as object)) {
        return input as Ref<any>;
    }
    return ref((input as Skeleton | null) ?? null) as Ref<any>;
})();

async function load(): Promise<void> {
    if (disposed) return;
    if (info.value.state === "loading" || info.value.state === "ready") return;
    if (!targetSkeletonRef.value) return;

    info.value = { state: "loading" };
    emitState();

    try {
        const asset = useAsset({
            fileName: ref(props.animation.fileName),
            useCache: true,
            debug: false,
            instance: props.vircadiaWorld as ReturnType<typeof useVircadia>,
        });

        await asset.executeLoad();
        const blobUrl = asset.assetData.value?.blobUrl;
        if (!blobUrl)
            throw new Error(`Missing blobUrl for ${props.animation.fileName}`);

        const result = await ImportMeshAsync(blobUrl, props.scene, {
            pluginExtension: asset.fileExtension.value,
        });

        // Retarget each animation group to the target skeleton's bones
        let selectedGroup: AnimationGroup | null = null;
        if (targetSkeletonRef.value) {
            for (const sourceGroup of result.animationGroups) {
                const cloned = sourceGroup.clone(
                    `${props.animation.fileName}-${sourceGroup.name}`,
                    (originalTarget) => {
                        const targetBone = (
                            targetSkeletonRef.value as Skeleton | null
                        )?.bones.find(
                            (b: Skeleton["bones"][number]) =>
                                b.name ===
                                (originalTarget as { name?: string }).name,
                        );
                        return targetBone ?? null;
                    },
                );
                if (cloned.targetedAnimations.length > 0 && !selectedGroup) {
                    selectedGroup = cloned;
                } else {
                    cloned.dispose();
                }
                // Always dispose source group after cloning
                sourceGroup.dispose();
            }
        }

        // Dispose loaded meshes/skeletons from the container
        for (const mesh of result.meshes) {
            mesh.dispose();
        }
        if (result.skeletons) {
            for (const skel of result.skeletons) {
                skel.dispose();
            }
        }

        if (selectedGroup) {
            info.value = { state: "ready", group: selectedGroup };
            selectedGroup.start(true, 1.0);
            selectedGroup.loopAnimation = true;
            emitState();
        } else {
            throw new Error(
                `No targeted animations created for ${props.animation.fileName}`,
            );
        }
    } catch (err) {
        info.value = {
            state: "error",
            error: err instanceof Error ? err.message : String(err),
        };
        emitState();
    }
}

onMounted(() => {
    // Try immediately if skeleton exists
    if (targetSkeletonRef.value) {
        void load();
    }
});

watch(
    () => targetSkeletonRef.value,
    (skel) => {
        if (skel) void load();
    },
);

watch(
    () => props.animation.fileName,
    () => {
        // Reset and reload on file change
        if (info.value.group) {
            info.value.group.dispose();
            info.value.group = undefined;
        }
        info.value = { state: "idle" };
        void load();
    },
);

onUnmounted(() => {
    disposed = true;
    if (info.value.group) {
        info.value.group.dispose();
    }
});
</script>


