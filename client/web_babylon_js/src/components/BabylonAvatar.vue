<template>
    <!-- No visual output needed for this component -->
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, inject, toRefs } from "vue";
import type {
    Scene,
    Vector3 as BabylonVector3,
    Quaternion as BabylonQuaternion,
    TransformNode,
    Observer,
    Node,
} from "@babylonjs/core";
import {
    Vector3,
    Quaternion,
    ArcRotateCamera,
    CharacterSupportedState,
    Animation as BabylonAnimation,
    MeshBuilder as BabylonMeshBuilder,
} from "@babylonjs/core";
import { AnimationGroup } from "@babylonjs/core";
import { z } from "zod";
import { useVircadiaInstance, useAsset } from "@vircadia/world-sdk/browser/vue";
import { useAppStore } from "@/stores/appStore";
import { ImportMeshAsync } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

import { useBabylonAvatarKeyboardControls } from "../composables/useBabylonAvatarKeyboardControls";
import { useBabylonAvatarEntity } from "../composables/useBabylonAvatarEntity";
import { useBabylonAvatarPhysicsController } from "../composables/useBabylonAvatarPhysicsController";
import { useBabylonAvatarCameraController } from "../composables/useBabylonAvatarCameraController";
import { useBabylonAvatarModelLoader } from "../composables/useBabylonAvatarModelLoader";
import type {
    PositionObj,
    RotationObj,
} from "../composables/useBabylonAvatarPhysicsController";
import { onKeyStroke } from "@vueuse/core";

// Define component props with defaults
const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
});

const emit = defineEmits<{ ready: [] }>();

// Load avatar configuration from global store
const appStore = useAppStore();
const avatarDefinition = appStore.avatarDefinition;
const {
    entityName,
    throttleInterval,
    capsuleHeight,
    capsuleRadius,
    slopeLimit,
    jumpSpeed,
    initialPosition: storePosition,
    initialRotation: storeRotation,
    initialCameraOrientation: storeCameraOrientation,
    modelFileName,
    animations,
} = toRefs(avatarDefinition);

// Reactive local transform state from store
const initialPosition = ref<PositionObj>(storePosition.value);
const initialRotation = ref<RotationObj>(storeRotation.value);
const cameraOrientation = ref(storeCameraOrientation.value);

// Zod schemas (kept local per request)
const Vector3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() });
const QuaternionSchema = z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
    w: z.number(),
});
const CameraSchema = z.object({
    alpha: z.number(),
    beta: z.number(),
    radius: z.number(),
});

// Replace PhysicsAvatarMetaSchema without FieldValue wrappers
const PhysicsAvatarMetaSchema = z.object({
    type: z.literal(entityName.value),
    position: Vector3Schema,
    rotation: QuaternionSchema.optional(),
    cameraOrientation: CameraSchema.optional(),
    modelURL: z.string().optional(),
});
type PhysicsAvatarMeta = z.infer<typeof PhysicsAvatarMetaSchema>;

// Helpers
function vectorToObj(v: BabylonVector3): PositionObj {
    return { x: v.x, y: v.y, z: v.z };
}
function quatToObj(q: BabylonQuaternion): RotationObj {
    return { x: q.x, y: q.y, z: q.z, w: q.w };
}

// Instantiate composables
const {
    avatarNode,
    characterController,
    createController,
    updateTransforms,
    getPosition,
    setPosition,
    getOrientation,
    setOrientation,
    getVelocity,
    setVelocity,
    checkSupport,
    integrate,
} = useBabylonAvatarPhysicsController(
    props.scene,
    initialPosition,
    initialRotation,
    capsuleHeight,
    capsuleRadius,
    slopeLimit,
);
const { keyState } = useBabylonAvatarKeyboardControls(props.scene);
const {
    avatarEntity,
    isRetrieving,
    isCreating,
    isUpdating,
    hasError,
    errorMessage,
    throttledUpdate,
} = useBabylonAvatarEntity<PhysicsAvatarMeta>(
    ref(entityName.value),
    throttleInterval.value,
    PhysicsAvatarMetaSchema,
    () => ({
        type: entityName.value,
        position: initialPosition.value,
        rotation: initialRotation.value,
        cameraOrientation: cameraOrientation.value,
    }),
    () => ({
        type: entityName.value,
        position: (() => {
            const p = getPosition();
            return p ? vectorToObj(p) : initialPosition.value;
        })(),
        rotation: characterController.value
            ? quatToObj(getOrientation())
            : initialRotation.value,
        cameraOrientation: cameraOrientation.value,
    }),
);

// Camera controller
const { camera, setupCamera, updateCameraFromMeta } =
    useBabylonAvatarCameraController(
        props.scene,
        avatarNode,
        cameraOrientation,
        capsuleHeight,
        throttledUpdate,
    );

// Avatar model loader (GLTF/GLB)
const { meshes, skeletons, animationGroups, loadModel } =
    useBabylonAvatarModelLoader({ fileName: modelFileName.value });

// Local map of retargeted AnimationGroups for controlled playback
const localAnimGroups = new Map<string, AnimationGroup>();
let currentAnimName = "";
let currentAnimIndex = 0;

// Helper to stop all and play a single animation group by name
function playAnimation(name: string): void {
    console.info(`▷ playAnimation('${name}') attempt...`);
    const group = localAnimGroups.get(name);

    if (!group) {
        console.warn(`Animation group '${name}' not found in localAnimGroups.`);
        return;
    }
    console.info(
        `Found group: ${group.name}, From: ${group.from}, To: ${group.to}, Loop: ${group.loopAnimation}`,
    );

    // Log some targeted animations
    if (group.targetedAnimations.length > 0) {
        console.info(
            `Animation group '${name}' has ${group.targetedAnimations.length} targeted animation(s). First few actual targets after retargeting:`,
        );
        for (let i = 0; i < Math.min(5, group.targetedAnimations.length); i++) {
            const targetedAnim = group.targetedAnimations[i];
            const targetNode = targetedAnim.target as Node;
            if (targetNode) {
                console.info(
                    `  - Target Node: '${targetNode.name}' (ID: ${targetNode.id}, Class: ${targetNode.getClassName()}), Animation Property: '${targetedAnim.animation.targetProperty}'`,
                );
            } else {
                console.info(
                    `  - Target Node: null (was likely removed during retargeting), Animation Property: '${targetedAnim.animation.targetProperty}'`,
                );
            }
        }
    } else {
        console.warn(
            `Animation group '${name}' has NO targeted animations after retargeting. Nothing to play.`,
        );
        // No need to stop/start if there's nothing to play
        currentAnimName = name; // Still update current to prevent re-processing this empty group
        return;
    }

    // Stop all other groups
    for (const g of localAnimGroups.values()) {
        if (g.name !== name && g.isStarted) {
            g.stop();
        }
    }

    // Start the chosen group
    if (group.isStarted) {
        group.restart(); // If it's the same animation, restart it
    } else {
        group.start(group.loopAnimation, 1.0, group.from, group.to, false);
    }
    console.info(
        `▶ Animation group '${group.name}' started/restarted. Animatables: ${group.animatables.length}`,
    );
    currentAnimName = name;
}

// Observers for physics events, for cleanup on unmount
let beforePhysicsObserver: Observer<Scene> | null = null;
let afterPhysicsObserver: Observer<Scene> | null = null;

// Lifecycle hooks
onMounted(() => {
    const vircadiaWorld = inject(useVircadiaInstance());
    if (!vircadiaWorld) {
        throw new Error("Vircadia instance not found in PhysicsAvatar");
    }
    const retrieveAvatar = () => avatarEntity.executeRetrieve();
    if (vircadiaWorld.connectionInfo.value.status === "connected") {
        retrieveAvatar();
    } else {
        watch(
            () => vircadiaWorld.connectionInfo.value.status,
            (status) => {
                if (status === "connected") {
                    retrieveAvatar();
                }
            },
        );
    }

    // Ensure entity exists: create if not found
    const stopWatchCreate = watch(
        [
            () => avatarEntity.retrieving.value,
            () => avatarEntity.error.value,
            () => avatarEntity.entityData.value,
        ],
        ([retrieving, error, data], [wasRetrieving]) => {
            if (wasRetrieving && !retrieving) {
                if (!data && !error) {
                    avatarEntity
                        .executeCreate()
                        .then(() => avatarEntity.executeRetrieve());
                }
                stopWatchCreate();
            }
        },
        { immediate: false },
    );

    watch(
        () => avatarEntity.entityData.value,
        async (data) => {
            const meta = data?.meta__data;
            if (meta && !characterController.value) {
                // First create, use defaults when missing
                if (meta.position) {
                    initialPosition.value = meta.position;
                }
                if (meta.rotation) {
                    initialRotation.value = meta.rotation;
                }
                // Apply saved camera orientation on initial load
                if (meta.cameraOrientation) {
                    cameraOrientation.value = meta.cameraOrientation;
                }
                createController();
                // load and parent the avatar mesh under the physics root
                if (avatarNode.value) {
                    await loadModel(
                        props.scene,
                        avatarNode.value as TransformNode,
                    );
                    // scale meshes to fit capsule
                    {
                        let minVec = new Vector3(
                            Number.POSITIVE_INFINITY,
                            Number.POSITIVE_INFINITY,
                            Number.POSITIVE_INFINITY,
                        );
                        let maxVec = new Vector3(
                            Number.NEGATIVE_INFINITY,
                            Number.NEGATIVE_INFINITY,
                            Number.NEGATIVE_INFINITY,
                        );
                        for (const mesh of meshes.value) {
                            const { min, max } =
                                mesh.getHierarchyBoundingVectors(true);
                            minVec = Vector3.Minimize(minVec, min);
                            maxVec = Vector3.Maximize(maxVec, max);
                        }
                        const modelHeight = maxVec.y - minVec.y;
                        const heightScale = capsuleHeight.value / modelHeight;
                        const uniformScale = heightScale;
                        for (const mesh of meshes.value) {
                            mesh.scaling.set(
                                uniformScale,
                                -uniformScale,
                                uniformScale,
                            );
                            mesh.position.x = 0;
                            mesh.position.z = 0;
                            mesh.position.y = -1;
                        }
                    }
                    // Method 1: Load animations and retarget them onto the avatar's primary skeleton.
                    const avatarSkeleton =
                        skeletons.value[0] ??
                        meshes.value.find((m) => m.skeleton)?.skeleton;

                    if (!avatarSkeleton) {
                        console.warn(
                            "No skeleton found on avatar meshes, skipping animation load.",
                        );
                    } else {
                        console.info(
                            `Found avatar skeleton: ${avatarSkeleton.name} with ${avatarSkeleton.bones.length} bones.`,
                            avatarSkeleton.bones.map((b) => b.name),
                        );
                        localAnimGroups.clear();

                        for (const def of animations.value) {
                            const asset = useAsset({
                                fileName: ref(def.fileName),
                                useCache: true,
                                debug: false,
                                instance: vircadiaWorld, // ensure vircadiaWorld is in scope
                            });
                            await asset.executeLoad();
                            const blobUrl = asset.assetData.value?.blobUrl;

                            if (!blobUrl) {
                                console.warn(
                                    `Animation asset blob URL not available for \'${def.fileName}\'`,
                                );
                                continue;
                            }

                            try {
                                console.info(
                                    `Loading animations from: ${def.fileName}`,
                                );
                                const result = await ImportMeshAsync(
                                    blobUrl,
                                    props.scene,
                                    {
                                        pluginExtension:
                                            asset.fileExtension.value,
                                    },
                                );

                                // We don't need the meshes or skeletons from the animation-only file
                                for (const mesh of result.meshes) {
                                    mesh.dispose();
                                }
                                if (result.skeletons) {
                                    for (const skeleton of result.skeletons) {
                                        skeleton.dispose();
                                    }
                                }

                                let groupsToProcess = result.animationGroups;
                                if (
                                    def.groupNames &&
                                    def.groupNames.length > 0
                                ) {
                                    const groupNames = def.groupNames; // For TS narrowing
                                    groupsToProcess =
                                        result.animationGroups.filter((g) =>
                                            groupNames.includes(g.name),
                                        );
                                    console.info(
                                        `Filtered for groups: ${groupNames.join(", ")} in ${def.fileName}, found ${groupsToProcess.length}`,
                                    );
                                } else {
                                    console.info(
                                        `Using all ${result.animationGroups.length} groups from ${def.fileName}`,
                                    );
                                }

                                if (groupsToProcess.length === 0) {
                                    console.warn(
                                        `No animation groups found or matched in ${def.fileName}`,
                                    );
                                }

                                for (const sourceGroup of groupsToProcess) {
                                    const newGroupName = `${def.fileName}-${sourceGroup.name}`;

                                    // This picker function is called by clone() for each animation track's target.
                                    // It must return the new target node (a bone in our avatarSkeleton) or null to skip the track.
                                    const newTargetPicker = (
                                        originalTarget: Node,
                                    ): Node | null => {
                                        if (
                                            avatarSkeleton &&
                                            originalTarget &&
                                            originalTarget.name
                                        ) {
                                            const targetBone =
                                                avatarSkeleton.bones.find(
                                                    (bone) =>
                                                        bone.name ===
                                                        originalTarget.name,
                                                );
                                            if (!targetBone) {
                                                console.warn(
                                                    `Retargeting: Bone '${originalTarget.name}' from animation group '${sourceGroup.name}' (file: ${def.fileName}, new group: ${newGroupName}) not found in avatar skeleton. This animation track will be skipped.`,
                                                );
                                            }
                                            return targetBone ?? null;
                                        }
                                        console.warn(
                                            `Retargeting: Invalid original target (name: ${originalTarget?.name}) or missing avatar skeleton for a track in animation group '${sourceGroup.name}' (file: ${def.fileName}, new group: ${newGroupName}). Track will be skipped.`,
                                        );
                                        return null;
                                    };

                                    // Clone the animation group, retargeting its animations to the avatar's skeleton.
                                    // The third parameter to clone (cloneAnimations) defaults to false, meaning Animation objects are shared, which is efficient.
                                    const clonedGroup = sourceGroup.clone(
                                        newGroupName,
                                        newTargetPicker,
                                    );

                                    if (
                                        clonedGroup &&
                                        clonedGroup.targetedAnimations.length >
                                            0
                                    ) {
                                        clonedGroup.loopAnimation =
                                            def.loop ?? false;
                                        localAnimGroups.set(
                                            clonedGroup.name,
                                            clonedGroup,
                                        );
                                        console.info(
                                            `Successfully cloned and retargeted animation group: '${clonedGroup.name}' with ${clonedGroup.targetedAnimations.length} tracks. Loop: ${clonedGroup.loopAnimation}`,
                                        );
                                    } else {
                                        console.warn(
                                            `Cloned animation group '${newGroupName}' (from file ${def.fileName}, source group ${sourceGroup.name}) resulted in no targeted animations after retargeting, or the clone operation failed. The group will not be stored.`,
                                        );
                                        // Dispose the cloned group if it was created but is empty or invalid
                                        clonedGroup?.dispose();
                                    }
                                    // Dispose of the original animation group from the loaded file, as it's no longer needed.
                                    sourceGroup.dispose();
                                }
                            } catch (e) {
                                console.error(
                                    `Error loading or retargeting animation \'${def.fileName}\':`,
                                    e,
                                );
                            }
                        }

                        // Automatically play the first animation group (e.g., idle)
                        if (localAnimGroups.size > 0) {
                            const firstAnimName = localAnimGroups
                                .keys()
                                .next().value;
                            if (firstAnimName) {
                                playAnimation(firstAnimName);
                                console.info(
                                    `Playing first animation: ${firstAnimName}`,
                                );
                            } else {
                                console.warn(
                                    "First animation name is undefined, cannot play.",
                                );
                            }
                        } else {
                            console.warn("No animations loaded to play.");
                        }

                        // Allow cycling through animations with 'f'
                        onKeyStroke("f", (e) => {
                            e.preventDefault();
                            if (localAnimGroups.size === 0) return;
                            const animNames = Array.from(
                                localAnimGroups.keys(),
                            );
                            currentAnimIndex =
                                (currentAnimIndex + 1) % animNames.length;
                            const animToPlay = animNames[currentAnimIndex];
                            console.info(
                                `Cycling to animation [${currentAnimIndex}]: ${animToPlay}`,
                            );
                            playAnimation(animToPlay);
                        });
                    }
                } else {
                    console.warn(
                        "Avatar node not initialized, skipping model load",
                    );
                }
                setupCamera();

                // --- BEGIN TEST CUBE ANIMATION ---
                try {
                    console.info(
                        "Attempting to create and animate a test cube.",
                    );
                    const testCube = BabylonMeshBuilder.CreateBox(
                        "testCube",
                        { size: 0.2 },
                        props.scene,
                    );
                    testCube.position = new Vector3(
                        0,
                        capsuleHeight.value + 0.5,
                        0.5,
                    ); // Position it slightly above and in front of typical avatar origin for visibility

                    if (avatarNode.value) {
                        // Parent to avatarNode so it moves with the avatar, making it easier to keep in view
                        // testCube.parent = avatarNode.value;
                        // For initial test, let's place it in world space relative to avatar's expected start to avoid parenting complexities if avatarNode itself is an issue.
                        const initialAvatarPos = avatarNode.value.position;
                        testCube.position = new Vector3(
                            initialAvatarPos.x,
                            initialAvatarPos.y + capsuleHeight.value + 0.5,
                            initialAvatarPos.z + 0.5,
                        );
                        console.info(
                            `Test cube initial position: ${testCube.position.toString()}`,
                        );
                    } else {
                        console.warn(
                            "Test cube: avatarNode not available for positioning reference, using absolute position.",
                        );
                        testCube.position = new Vector3(0, 1.8 + 0.5, 0.5); // Default position if avatarNode is not ready
                    }

                    const frameRate = 10;
                    const xSlide = new BabylonAnimation(
                        "xSlide",
                        "position.x",
                        frameRate,
                        BabylonAnimation.ANIMATIONTYPE_FLOAT,
                        BabylonAnimation.ANIMATIONLOOPMODE_CYCLE,
                    );
                    const keyFrames = [];
                    keyFrames.push({ frame: 0, value: testCube.position.x });
                    keyFrames.push({
                        frame: frameRate * 1,
                        value: testCube.position.x + 0.5,
                    }); // Slide 0.5 units
                    keyFrames.push({
                        frame: frameRate * 2,
                        value: testCube.position.x,
                    });
                    xSlide.setKeys(keyFrames);
                    testCube.animations.push(xSlide);
                    props.scene.beginAnimation(
                        testCube,
                        0,
                        2 * frameRate,
                        true,
                    );
                    console.info(
                        "Test cube animation started. Check if a small cube near the avatar's head is sliding horizontally.",
                    );
                } catch (e) {
                    console.error("Error creating test cube animation:", e);
                }
                // --- END TEST CUBE ANIMATION ---

                emit("ready");
            } else if (meta && characterController.value) {
                // Remote update, apply if present
                if (meta.position) {
                    const p = meta.position;
                    setPosition(new Vector3(p.x, p.y, p.z));
                }
                if (meta.rotation) {
                    const r = meta.rotation;
                    setOrientation(new Quaternion(r.x, r.y, r.z, r.w));
                }
                updateTransforms();
                if (meta.cameraOrientation) {
                    updateCameraFromMeta(meta.cameraOrientation);
                }
            }
        },
        { immediate: true },
    );

    // Handle input just before the physics engine step
    beforePhysicsObserver = props.scene.onBeforePhysicsObservable.add(() => {
        if (!characterController.value) return;
        const dt = props.scene.getEngine().getDeltaTime() / 1000;
        // Compute movement direction
        const dir = new Vector3(
            (keyState.value.right ? 1 : 0) - (keyState.value.left ? 1 : 0),
            0,
            (keyState.value.forward ? 1 : 0) -
                (keyState.value.backward ? 1 : 0),
        );
        // Horizontal movement via velocity
        const vel = getVelocity();
        if (dir.lengthSquared() > 0 && vel) {
            const cameraRotationY =
                camera.value instanceof ArcRotateCamera
                    ? camera.value.alpha + Math.PI / 2
                    : 0;
            const transformedDir = new Vector3(
                dir.x * Math.cos(cameraRotationY) -
                    dir.z * Math.sin(cameraRotationY),
                0,
                dir.x * Math.sin(cameraRotationY) +
                    dir.z * Math.cos(cameraRotationY),
            );
            const speed = 4; // or customize per-character
            const horiz = transformedDir.normalize().scale(speed);
            setVelocity(new Vector3(horiz.x, vel.y, horiz.z));
        } else if (vel) {
            setVelocity(new Vector3(0, vel.y, 0));
        }
        // Jump if on ground
        if (keyState.value.jump) {
            const support = checkSupport(dt);
            if (
                support?.supportedState === CharacterSupportedState.SUPPORTED &&
                vel
            ) {
                setVelocity(new Vector3(vel.x, jumpSpeed.value, vel.z));
            }
        }
    });
    // After the physics engine updates, integrate the character and sync transforms
    afterPhysicsObserver = props.scene.onAfterPhysicsObservable.add(() => {
        if (!characterController.value) return;
        const dt = props.scene.getEngine().getDeltaTime() / 1000;
        // Apply manual gravity to vertical velocity
        const velAfter = getVelocity();
        if (velAfter) {
            velAfter.y += -9.8 * dt;
            setVelocity(velAfter);
        }
        // Integrate physics and sync transforms
        const supportAfter = checkSupport(dt);
        if (supportAfter) {
            integrate(dt, supportAfter);
        }
        throttledUpdate();
        updateTransforms();
        // update camera target to follow the avatar
        if (camera.value && avatarNode.value) {
            const node = avatarNode.value;
            camera.value.setTarget(
                new Vector3(
                    node.position.x,
                    node.position.y + capsuleHeight.value / 2,
                    node.position.z,
                ),
            );
        }
    });
});

onUnmounted(() => {
    // Remove physics observers to avoid duplicate callbacks
    if (beforePhysicsObserver) {
        props.scene.onBeforePhysicsObservable.remove(beforePhysicsObserver);
    }
    if (afterPhysicsObserver) {
        props.scene.onAfterPhysicsObservable.remove(afterPhysicsObserver);
    }
    avatarNode.value?.dispose();
    avatarEntity.cleanup();
    // camera is disposed by useAvatarCameraController composable
});

defineExpose({
    isRetrieving,
    isCreating,
    isUpdating,
    hasError,
    errorMessage,
    getPosition,
    setPosition,
    getOrientation,
    setOrientation,
    getVelocity,
    setVelocity,
    checkSupport,
    integrate,
});
</script>