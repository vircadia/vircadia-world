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
} from "@babylonjs/core";
import {
    Vector3,
    Quaternion,
    ArcRotateCamera,
    CharacterSupportedState,
} from "@babylonjs/core";
import type { AnimationGroup } from "@babylonjs/core";
import { z } from "zod";
import { useVircadiaInstance } from "@vircadia/world-sdk/browser/vue";
import { useAppStore } from "@/stores/appStore";

import { useBabylonAvatarKeyboardControls } from "../composables/useBabylonAvatarKeyboardControls";
import { useBabylonAvatarEntity } from "../composables/useBabylonAvatarEntity";
import { useBabylonAvatarPhysicsController } from "../composables/useBabylonAvatarPhysicsController";
import { useBabylonAvatarCameraController } from "../composables/useBabylonAvatarCameraController";
import { useBabylonAvatarModelLoader } from "../composables/useBabylonAvatarModelLoader";
import { useBabylonAvatarModelAnimationGroups } from "../composables/useBabylonAvatarModelAnimationGroups.ts";
import type {
    PositionObj,
    RotationObj,
} from "../composables/useBabylonAvatarPhysicsController";

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

// Avatar animation loader
const { animationGroupsMap, loadAnimations } =
    useBabylonAvatarModelAnimationGroups(animations.value);

// Local map of retargeted AnimationGroups for controlled playback
const localAnimGroups = new Map<string, AnimationGroup>();
let currentAnimName = "";

// Helper to stop all and play a single animation group by name
function playAnimation(name: string): void {
    if (name === currentAnimName) {
        return;
    }
    const groupToPlay = localAnimGroups.get(name);
    if (!groupToPlay) {
        console.warn(`Animation group '${name}' not found`);
        return;
    }
    // stop all other groups
    for (const g of localAnimGroups.values()) {
        if (g.isStarted) {
            g.stop();
        }
    }
    // start the chosen group with its loop setting
    groupToPlay.start(groupToPlay.loopAnimation);
    currentAnimName = name;
}

// Expose debug helpers in development for testing via browser console
if (import.meta.env.DEV) {
    // @ts-ignore
    window.localAnimGroups = localAnimGroups;
    // @ts-ignore
    window.playAnimation = playAnimation;
    // @ts-ignore
    window.getLoadedAnimationNames = () => Array.from(localAnimGroups.keys());
    console.info(
        "Debug helpers added: window.localAnimGroups, window.playAnimation(), window.getLoadedAnimationNames()",
    );
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
                    // load and apply run animation to avatar skeleton
                    await loadAnimations(props.scene);
                    {
                        const runDef = animations.value.find(
                            (def) =>
                                def.fileName ===
                                "babylon.avatar.animation.idle.glb",
                        );
                        if (runDef) {
                            console.info(
                                `Loading animations from: '${runDef.fileName}'`,
                            );
                            // Retarget and collect only desired groups in defined order
                            const allGroups =
                                animationGroupsMap.value[runDef.fileName] || [];
                            const groups =
                                runDef.groupNames &&
                                runDef.groupNames.length > 0
                                    ? runDef.groupNames
                                          .map((name) =>
                                              allGroups.find(
                                                  (g) => g.name === name,
                                              ),
                                          )
                                          .filter(
                                              (g): g is AnimationGroup => !!g,
                                          )
                                    : allGroups;
                            console.info(
                                "Ordered animation groups:",
                                groups.map((g) => g.name),
                            );
                            // fetch the skeleton actually bound to one of the avatar meshes
                            const meshWithSkeleton = meshes.value.find(
                                (m) => m.skeleton,
                            );
                            if (
                                !meshWithSkeleton ||
                                !meshWithSkeleton.skeleton
                            ) {
                                console.warn(
                                    "No skeleton found on avatar meshes, skipping animation retarget",
                                );
                                return;
                            }
                            const avatarSkeleton = meshWithSkeleton.skeleton;
                            console.info(
                                `Retargeting to mesh '${meshWithSkeleton.name}' skeleton with ${avatarSkeleton.name} (${avatarSkeleton.bones.length} bones)`,
                            );
                            // Use AnimationGroup.clone to retarget animations onto the avatar skeleton
                            localAnimGroups.clear();
                            for (const g of groups) {
                                // Retarget each animation group by mapping to the avatar skeleton bone
                                const retargeted = g.clone(g.name, (target) => {
                                    const bone = avatarSkeleton.bones.find(
                                        (b) => b.name === target.name,
                                    );
                                    if (!bone) {
                                        console.warn(
                                            `No bone found for target '${target.name}', skipping retarget`,
                                        );
                                        return target;
                                    }
                                    return bone;
                                });
                                retargeted.loopAnimation = runDef.loop ?? false;
                                localAnimGroups.set(
                                    retargeted.name,
                                    retargeted,
                                );
                                console.info(
                                    `Retargeted group '${retargeted.name}': ${retargeted.targetedAnimations.length} animations to ${avatarSkeleton.bones.length} bones on skeleton '${avatarSkeleton.name}'`,
                                );
                            }
                            console.info(
                                "Loaded animation groups:",
                                Array.from(localAnimGroups.keys()),
                            );
                            // for now, play the first loaded animation to verify it works
                            const firstAnim = localAnimGroups
                                .keys()
                                .next().value;
                            if (firstAnim) {
                                playAnimation(firstAnim);
                            }
                        }
                    }
                } else {
                    console.warn(
                        "Avatar node not initialized, skipping model load",
                    );
                }
                setupCamera();
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