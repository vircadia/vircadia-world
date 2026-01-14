<template>
    <!-- Non-visual animation loader -->
</template>

<script setup lang="ts">
import type { AnimationGroup, Scene, Skeleton } from "@babylonjs/core";
import { ImportMeshAsync } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import type {
    AnimationInfo,
    AnimationState,
    BabylonAnimationDefinition,
} from "@schemas";
import { onMounted, onUnmounted, type Ref, ref, watch } from "vue";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";

const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
    vircadiaWorld: {
        type: Object as () => VircadiaWorldInstance,
        required: true,
    },
    animation: {
        type: Object as () => BabylonAnimationDefinition,
        required: true,
    },
    // Allow null initially; parent should guard render, but be tolerant here too
    targetSkeleton: {
        type: Object as () => Skeleton,
        required: false,
        default: null,
    },
    // Optional bone name mapping: source animation bone name -> target skeleton bone name
    // Used when animations reference bones with different names than the target skeleton
    boneMapping: {
        type: Object as () => Record<string, string>,
        required: false,
        default: () => ({}),
    },
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

// Simple global concurrency limiter to avoid flooding the DB with parallel loads
let __animationsInFlight = 0;
const MAX_CONCURRENT_ANIM_LOADS = 2;
async function waitForSlot(): Promise<void> {
    if (__animationsInFlight < MAX_CONCURRENT_ANIM_LOADS) {
        __animationsInFlight++;
        return;
    }
    await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
            if (__animationsInFlight < MAX_CONCURRENT_ANIM_LOADS) {
                clearInterval(interval);
                __animationsInFlight++;
                resolve();
            }
        }, 25);
    });
}
function releaseSlot(): void {
    __animationsInFlight = Math.max(0, __animationsInFlight - 1);
}

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

    await waitForSlot();
    try {
        const directUrl = props.animation.fileUrl || props.vircadiaWorld.client.buildAssetRequestUrl(
            props.animation.fileName,
        );
        const ext = (() => {
            const e = props.animation.fileName.split(".").pop()?.toLowerCase();
            switch (e) {
                case "glb":
                    return ".glb";
                case "gltf":
                    return ".gltf";
                case "fbx":
                    return ".fbx";
                default:
                    return "";
            }
        })();

        const result = await ImportMeshAsync(directUrl, props.scene, {
            pluginExtension: ext,
        });

        // Retarget each animation group to the target skeleton's transform nodes/bones
        let selectedGroup: AnimationGroup | null = null;
        const unmappedBones = new Set<string>(); // Track bones that couldn't be mapped

        if (targetSkeletonRef.value) {
            // Precompute maps for faster name lookups
            const targetSkeleton = targetSkeletonRef.value as Skeleton;
            const boneByName = new Map<string, Skeleton["bones"][number]>();
            const linkedNodeByName = new Map<
                string,
                import("@babylonjs/core").TransformNode
            >();
            for (const b of targetSkeleton.bones) {
                boneByName.set(b.name, b);
                const tn = b.getTransformNode();
                if (tn) linkedNodeByName.set(tn.name, tn);
            }

            // Log target skeleton bone names once for debugging
            console.log(`[BabylonMyAvatarAnimation] ${props.animation.fileName} - Target skeleton bones:`,
                Array.from(boneByName.keys()));

            for (const sourceGroup of result.animationGroups) {
                const cloned = sourceGroup.clone(
                    `${props.animation.fileName}-${sourceGroup.name}`,
                    (originalTarget) => {
                        const originalName =
                            (originalTarget as { name?: string }).name || "";

                        // Skip root transform nodes that might contain position data
                        // This prevents animations from overriding physics-controlled position
                        const lowerName = originalName.toLowerCase();
                        if (
                            lowerName === "root" ||
                            lowerName === "__root__" ||
                            lowerName === "rootnode" ||
                            lowerName === "armature"
                        ) {
                            return null;
                        }

                        // Apply bone mapping if provided - translate source bone name to target bone name
                        const mappedName = props.boneMapping[originalName] ?? originalName;

                        // Prefer mapping to linked TransformNode with matching name
                        let tn = linkedNodeByName.get(mappedName);
                        if (tn) return tn;
                        // Fallback: map to bone with same name
                        let bone = boneByName.get(mappedName);
                        if (bone) return bone;

                        // If mapping was applied but didn't find a match, try the original name as fallback
                        if (mappedName !== originalName) {
                            tn = linkedNodeByName.get(originalName);
                            if (tn) return tn;
                            bone = boneByName.get(originalName);
                            if (bone) return bone;
                        }

                        // Track unmapped bones for debugging
                        unmappedBones.add(originalName);
                        return null;
                    },
                );
                // If requested, strip horizontal translation for hip/root targets
                if (props.animation.ignoreHipTranslation) {
                    for (const ta of cloned.targetedAnimations) {
                        const targetName =
                            (
                                ta.target as { name?: string }
                            )?.name?.toLowerCase?.() || "";
                        const isHipLike =
                            targetName === "hips" ||
                            targetName.includes("hip") ||
                            targetName.includes("pelvis") ||
                            targetName.includes("root") ||
                            targetName.includes("__root__") ||
                            targetName.includes("armature");
                        if (!isHipLike) continue;
                        const property = ta.animation?.targetProperty ?? "";
                        const keys = ta.animation?.getKeys?.();
                        if (!keys || keys.length === 0) continue;
                        try {
                            if (property === "position") {
                                for (const k of keys as Array<{
                                    value: {
                                        x?: number;
                                        y?: number;
                                        z?: number;
                                    };
                                }>) {
                                    if (typeof k.value.x === "number")
                                        k.value.x = 0;
                                    if (typeof k.value.z === "number")
                                        k.value.z = 0;
                                }
                            } else if (property === "matrix") {
                                for (const k of keys as Array<{
                                    value: {
                                        getTranslation?: () => any;
                                        setTranslation?: (v: any) => void;
                                    };
                                }>) {
                                    const mat: any = k.value;
                                    if (
                                        mat &&
                                        typeof mat.getTranslation === "function"
                                    ) {
                                        const t = mat.getTranslation();
                                        if (t) {
                                            t.x = 0;
                                            t.z = 0;
                                            if (
                                                typeof mat.setTranslation ===
                                                "function"
                                            ) {
                                                mat.setTranslation(t);
                                            } else if (
                                                typeof mat.setFromFloat32Array ===
                                                "function"
                                            ) {
                                                // best-effort; some matrix impls are immutable
                                            }
                                        }
                                    }
                                }
                            }
                        } catch { }
                    }
                }

                // If requested, strip scaling from all bones
                if (props.animation.ignoreScale) {
                    for (const ta of cloned.targetedAnimations) {
                        const property = ta.animation?.targetProperty ?? "";
                        if (property === "scaling") {
                            // Strip scaling animation entirely by clearing keys or setting to identity
                            // Or better: modify keys to be 1,1,1
                            const keys = ta.animation?.getKeys?.();
                            if (keys && keys.length > 0) {
                                for (const k of keys as Array<{
                                    value: {
                                        x?: number;
                                        y?: number;
                                        z?: number;
                                    };
                                }>) {
                                    if (typeof k.value.x === "number") k.value.x = 1;
                                    if (typeof k.value.y === "number") k.value.y = 1;
                                    if (typeof k.value.z === "number") k.value.z = 1;
                                }
                            }
                        } else if (property === "matrix") {
                            // Handling matrix scale stripping is complex; often "scaling" property is used
                        }
                    }
                }

                // Filter out targeted animations that have null targets
                // This can happen when the source animation references bones not present in the target skeleton
                const validTargetedAnimations = cloned.targetedAnimations.filter(
                    (ta) => ta.target != null
                );

                // If we have valid animations, replace the cloned group's animations
                if (validTargetedAnimations.length > 0) {
                    // Create a new clean group with only valid targeted animations
                    const cleanGroup = new (await import("@babylonjs/core")).AnimationGroup(
                        cloned.name,
                        props.scene
                    );

                    let strippedPositionCount = 0;
                    for (const ta of validTargetedAnimations) {
                        const targetName = ((ta.target as any)?.name || "").toLowerCase();
                        const isRootBone =
                            targetName === "hips" ||
                            targetName.includes("hip") ||
                            targetName.includes("pelvis") ||
                            targetName === "root" ||
                            targetName.includes("__root__");

                        // CRITICAL FIX: Strip position animations from non-root bones
                        // Since animations were made from empties with absolute world positions,
                        // they don't work with skeletal hierarchies where child positions
                        // should be derived from parent rotations + bone lengths
                        if (ta.animation && ta.animation.targetProperty === "position" && !isRootBone) {
                            // Skip this animation - don't add it to the group
                            // This removes position animations from head, neck, spine, etc.
                            strippedPositionCount++;
                            continue;
                        }

                        cleanGroup.addTargetedAnimation(ta.animation, ta.target);
                    }

                    if (strippedPositionCount > 0) {
                        console.log(`[BabylonMyAvatarAnimation] ${props.animation.fileName}: Stripped ${strippedPositionCount} position animations from non-root bones`);
                    }

                    cloned.dispose();

                    if (!selectedGroup) {
                        selectedGroup = cleanGroup;
                    } else {
                        cleanGroup.dispose();
                    }
                } else {
                    cloned.dispose();
                }
                // Always dispose source group after cloning
                sourceGroup.dispose();
            }

            // Log unmapped bones for debugging bone mapping
            if (unmappedBones.size > 0) {
                console.log(`[BabylonMyAvatarAnimation] ${props.animation.fileName} - Unmapped animation bones:`,
                    Array.from(unmappedBones));
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
            // Do NOT auto-start; parent decides which groups to play/blend
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
        console.error("[AvatarAnimation] Failed to load animation:", {
            fileName: props.animation.fileName,
            error: info.value.error,
        });
        emitState();
    } finally {
        releaseSlot();
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
