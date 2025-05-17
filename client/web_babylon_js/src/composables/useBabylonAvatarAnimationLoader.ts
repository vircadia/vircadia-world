import { ref, type Ref } from "vue";
import { useAsset, type useVircadia } from "@vircadia/world-sdk/browser/vue";
import type { Scene, AnimationGroup, Skeleton } from "@babylonjs/core";
import { ImportMeshAsync } from "@babylonjs/core";
import type { BabylonAnimationDefinition } from "./types";

export type AnimationState = "idle" | "loading" | "ready" | "error";

export interface AnimationInfo {
    state: AnimationState;
    error?: string;
    group?: AnimationGroup;
}

export function useBabylonAvatarAnimationLoader(options: {
    scene: Scene;
    animations: Ref<BabylonAnimationDefinition[]>;
    targetSkeleton: Ref<Skeleton | null>;
    vircadiaWorld: ReturnType<typeof useVircadia>;
}) {
    const { scene, animations, targetSkeleton, vircadiaWorld } = options;

    // Map to track animation state by filename
    const animationsMap: Ref<Map<string, AnimationInfo>> = ref(new Map());

    // Initialize map with all animations in idle state
    const initializeAnimationMap = () => {
        for (const anim of animations.value) {
            if (!animationsMap.value.has(anim.fileName)) {
                animationsMap.value.set(anim.fileName, { state: "idle" });
            }
        }
    };

    // Load a single animation
    const loadAnimation = async (
        animation: BabylonAnimationDefinition,
    ): Promise<void> => {
        const { fileName } = animation;

        // Skip if already loading or ready
        const currentState = animationsMap.value.get(fileName);
        if (
            currentState?.state === "loading" ||
            currentState?.state === "ready"
        ) {
            return;
        }

        // Set loading state
        animationsMap.value.set(fileName, { state: "loading" });

        try {
            // Use Vircadia asset system to load the animation file
            const asset = useAsset({
                fileName: ref(fileName),
                useCache: true,
                debug: false,
                instance: vircadiaWorld,
            });

            await asset.executeLoad();
            const blobUrl = asset.assetData.value?.blobUrl;

            if (!blobUrl) {
                throw new Error(
                    `Animation asset blob URL not available for '${fileName}'`,
                );
            }

            // Load the animation model
            const result = await ImportMeshAsync(blobUrl, scene, {
                pluginExtension: asset.fileExtension.value,
            });

            // Clean up loaded meshes and skeletons as we only need the animations
            for (const mesh of result.meshes) {
                mesh.dispose();
            }

            if (result.skeletons) {
                for (const skel of result.skeletons) {
                    skel.dispose();
                }
            }

            // Process animation groups, retargeting them to the avatar skeleton
            if (targetSkeleton.value) {
                for (const sourceGroup of result.animationGroups) {
                    const clonedGroup = sourceGroup.clone(
                        `${fileName}-${sourceGroup.name}`,
                        (originalTarget) => {
                            if (!targetSkeleton.value) return null;

                            const targetBone = targetSkeleton.value.bones.find(
                                (bone) => bone.name === originalTarget.name,
                            );

                            if (!targetBone) {
                                console.warn(
                                    `Retarget: Bone '${originalTarget.name}' not found on avatar skeleton`,
                                );
                            }

                            return targetBone ?? null;
                        },
                    );

                    // Store successful animation
                    if (clonedGroup.targetedAnimations.length > 0) {
                        animationsMap.value.set(fileName, {
                            state: "ready",
                            group: clonedGroup,
                        });
                        console.info(
                            `Loaded animation group '${clonedGroup.name}' from ${fileName}`,
                        );
                    } else {
                        clonedGroup.dispose();
                        throw new Error(
                            `No targeted animations could be created for '${fileName}'`,
                        );
                    }

                    // Dispose source group after retargeting
                    sourceGroup.dispose();
                }
            } else {
                throw new Error("No target skeleton available for retargeting");
            }
        } catch (error) {
            console.error(`Error loading animation '${fileName}':`, error);
            animationsMap.value.set(fileName, {
                state: "error",
                error: error instanceof Error ? error.message : String(error),
            });
        }
    };

    // Load multiple or all animations
    const loadAnimations = async (fileNames?: string[]): Promise<void> => {
        // Initialize map first
        initializeAnimationMap();

        // Filter animations to load
        const animsToLoad = fileNames
            ? animations.value.filter((a) => fileNames.includes(a.fileName))
            : animations.value;

        // Load all animations in parallel
        await Promise.all(animsToLoad.map(loadAnimation));
    };

    // Check if specific animations are ready
    const areAnimationsReady = (fileNames: string[]): boolean => {
        return fileNames.every(
            (fileName) => animationsMap.value.get(fileName)?.state === "ready",
        );
    };

    // Get animation groups for a specific set of animations
    const getAnimationGroups = (fileNames: string[]): AnimationGroup[] => {
        return fileNames
            .map((fileName) => animationsMap.value.get(fileName)?.group)
            .filter((group): group is AnimationGroup => !!group);
    };

    return {
        animationsMap,
        loadAnimation,
        loadAnimations,
        areAnimationsReady,
        getAnimationGroups,
    };
}
