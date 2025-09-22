<template>
	<!-- Non-visual animation loader -->
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, type Ref } from "vue";
import type { Scene, AnimationGroup, Skeleton } from "@babylonjs/core";
import { ImportMeshAsync } from "@babylonjs/core";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";
import type { BabylonAnimationDefinition } from "@schemas";

export type AnimationState = "idle" | "loading" | "ready" | "error";

interface AnimationInfo {
    state: AnimationState;
    error?: string;
    group?: AnimationGroup;
}

const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
    vircadiaWorld: { type: Object as () => VircadiaWorldInstance, required: true },
    animation: {
        type: Object as () => BabylonAnimationDefinition,
        required: true,
    },
    // Allow null initially; parent should guard render, but be tolerant here too
    targetSkeleton: {
        type: Object as () => unknown,
        required: false,
        default: null,
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
        // Retry a few times on timeout
        let attempts = 0;
        const maxAttempts = 3;
        const fetchOnce = async () => {
            const response = await (props.vircadiaWorld as any).client.restAsset.assetGetByKey({ key: props.animation.fileName });
            if (!response.ok) {
                let serverError: string | undefined;
                try {
                    const ct = response.headers.get("Content-Type") || "";
                    if (ct.includes("application/json")) {
                        const j = await response.clone().json();
                        serverError = (j as any)?.error || JSON.stringify(j);
                    }
                } catch {}
                throw new Error(`HTTP ${response.status}${serverError ? ` - ${serverError}` : ""}`);
            }
            const mimeType = response.headers.get("Content-Type") || "application/octet-stream";
            const arrayBuffer = await response.arrayBuffer();
            const blob = new Blob([arrayBuffer], { type: mimeType });
            const url = mimeType.startsWith("model/")
                ? await (async () => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onloadend = () => resolve(reader.result as string); reader.onerror = () => reject(new Error("Failed to convert blob to data URL")); reader.readAsDataURL(blob);} ))()
                : URL.createObjectURL(blob);
            return { url, mimeType } as const;
        };
        let fetched: { url: string; mimeType: string } | null = null;
        while (!fetched) {
            try {
                fetched = await fetchOnce();
            } catch (e) {
                attempts++;
                const msg = e instanceof Error ? e.message : String(e);
                if (!msg.includes("timeout") || attempts >= maxAttempts) throw e;
                await new Promise((r) => setTimeout(r, 200 + attempts * 200));
            }
        }

        const result = await ImportMeshAsync(fetched.url, props.scene, {
            pluginExtension: (() => {
                switch (fetched!.mimeType) {
                    case "model/gltf-binary": return ".glb";
                    case "model/gltf+json": return ".gltf";
                    case "model/fbx": return ".fbx";
                    default: return "";
                }
            })(),
        });

        // Debug: report what we loaded
        console.log("[AvatarAnimation] Loaded animation asset:", {
            fileName: props.animation.fileName,
            groups: result.animationGroups?.length || 0,
            meshes: result.meshes?.length || 0,
            skeletons: result.skeletons?.length || 0,
            targetSkeletonName: (targetSkeletonRef.value as Skeleton | null)
                ?.name,
            targetBoneCount:
                (targetSkeletonRef.value as Skeleton | null)?.bones?.length ||
                0,
        });

        // Retarget each animation group to the target skeleton's transform nodes/bones
        let selectedGroup: AnimationGroup | null = null;
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

            // Log sample of names for debugging
            console.log(
                "[AvatarAnimation] Target skeleton names (first 10):",
                Array.from(boneByName.keys()).slice(0, 10),
            );
            console.log(
                "[AvatarAnimation] Target transform nodes (first 10):",
                Array.from(linkedNodeByName.keys()).slice(0, 10),
            );

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
                            console.log(
                                `[AvatarAnimation] Skipping root node: ${originalName}`,
                            );
                            return null;
                        }

                        // Prefer mapping to linked TransformNode with matching name
                        const tn = linkedNodeByName.get(originalName);
                        if (tn) return tn;
                        // Fallback: map to bone with same name
                        const bone = boneByName.get(originalName);
                        if (bone) return bone;
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
                        } catch {}
                    }
                }
                // Debug each group mapping result
                console.log("[AvatarAnimation] Group retargeted:", {
                    sourceGroup: sourceGroup.name,
                    targetedCount: cloned.targetedAnimations.length,
                    sampleTargets: cloned.targetedAnimations
                        .slice(0, 5)
                        .map(
                            (ta) =>
                                (ta.target as { name?: string }).name ||
                                ta.target?.constructor?.name ||
                                "unknown",
                        ),
                });

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


