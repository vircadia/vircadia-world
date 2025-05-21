<template>
    <!-- No visual output needed for this component -->
</template>

<script setup lang="ts">
import {
    ref,
    onMounted,
    onUnmounted,
    watch,
    type WatchStopHandle,
    inject,
    toRefs,
    type Ref,
} from "vue";
import { useVircadiaInstance } from "@vircadia/world-sdk/browser/vue";

import { useAppStore } from "@/stores/appStore";

import {
    Vector3,
    Quaternion,
    CharacterSupportedState,
    type AnimationGroup,
    type Scene,
    TransformNode,
    type Observer,
    type Skeleton,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

// Debug viewers import
import { SkeletonViewer, AxesViewer } from "@babylonjs/core/Debug";

import { z } from "zod";

import { useBabylonAvatarKeyboardMouseControls } from "../composables/useBabylonAvatarKeyboardMouseControls";
import { useBabylonAvatarEntity } from "../composables/useBabylonAvatarEntity";
import { useBabylonAvatarPhysicsController } from "../composables/useBabylonAvatarPhysicsController";
import { useBabylonAvatarCameraController } from "../composables/useBabylonAvatarCameraController";
import { useBabylonAvatarModelLoader } from "../composables/useBabylonAvatarModelLoader";
import { useBabylonAvatarAnimationLoader } from "../composables/useBabylonAvatarAnimationLoader";
import type {
    PositionObj,
    RotationObj,
} from "../composables/useBabylonAvatarPhysicsController";

// Debug bounding box, skeleton, and axes
// removed; now using debug flags from store (debugBoundingBox, debugSkeleton, debugAxes)

// Define component props with defaults
const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
});

const emit = defineEmits<{ ready: []; dispose: [] }>();

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
    debugBoundingBox,
    debugSkeleton,
    debugAxes,
    walkSpeed,
    turnSpeed,
    blendDuration,
    gravity,
    meshPivotPoint,
    initialPosition: storePosition,
    initialRotation: storeRotation,
    initialCameraOrientation: storeCameraOrientation,
    modelFileName,
    animations,
} = toRefs(avatarDefinition);

// Reactive local transform state from store
const initialPosition: Ref<PositionObj> = ref(storePosition.value);
const initialRotation: Ref<RotationObj> = ref(storeRotation.value);
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
function vectorToObj(v: Vector3): PositionObj {
    return { x: v.x, y: v.y, z: v.z };
}
function quatToObj(q: Quaternion): RotationObj {
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
const { keyState } = useBabylonAvatarKeyboardMouseControls(props.scene);
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
        rotation: (() => {
            const q = getOrientation();
            return q ? quatToObj(q) : initialRotation.value;
        })(),
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

// Replace the existing localAnimGroups and animation-related code
const blendWeight = ref(0); // 0 = idle, 1 = walk
// removed local blendDuration; using store value for blendDuration

// Initialize and manage blended animations
let idleAnimation: AnimationGroup | null = null;
let walkAnimation: AnimationGroup | null = null;

// Reference to the avatar skeleton for animation retargeting
const avatarSkeleton: Ref<Skeleton | null> = ref(null);

// Get Vircadia instance
const vircadiaWorld = inject(useVircadiaInstance());
if (!vircadiaWorld) {
    throw new Error("Vircadia instance not found in BabylonAvatar");
}

// Animation loader composable
const {
    animationsMap,
    loadAnimations,
    areAnimationsReady,
    getAnimationGroups,
} = useBabylonAvatarAnimationLoader({
    scene: props.scene,
    animations,
    targetSkeleton: avatarSkeleton,
    vircadiaWorld,
});

function setupBlendedAnimations(): void {
    console.info(
        "Setting up blended animations, available animations:",
        Array.from(animationsMap.value.keys())
            .filter((name) => animationsMap.value.get(name)?.state === "ready")
            .map(
                (name) =>
                    `${name} (${animationsMap.value.get(name)?.group?.name || "unnamed"})`,
            ),
    );

    // Look for idle and walk animations in successfully loaded animations
    const idleFileName = animations.value.find((anim) =>
        anim.fileName.toLowerCase().includes("idle.1.glb"),
    )?.fileName;

    const walkFileName = animations.value.find((anim) =>
        anim.fileName.toLowerCase().includes("walk.1.glb"),
    )?.fileName;

    if (
        idleFileName &&
        animationsMap.value.get(idleFileName)?.state === "ready"
    ) {
        const animInfo = animationsMap.value.get(idleFileName);
        if (animInfo?.group && animInfo.state === "ready") {
            // Retarget idle animation to model skeleton via clone
            const originalIdleGroup = animInfo.group;
            const modelTransforms = meshes.value.flatMap((m) => m.getChildTransformNodes(false));
            const retargetedIdle = originalIdleGroup.clone(
                `${originalIdleGroup.name}-retargeted`,
                (oldTarget) => {
                    const target = modelTransforms.find((node) => node.name === oldTarget.name);
                    if (!target) {
                        console.warn(`[BabylonAvatar] No retarget target for ${oldTarget.name}`);
                    }
                    return target;
                }
            );
            idleAnimation = retargetedIdle;
            console.info(`Found idle animation: ${idleAnimation.name}`);
            idleAnimation.start(true, 1.0);
            idleAnimation.loopAnimation = true;
        }
    } else {
        // If no explicit idle animation found, use the first available one
        for (const [fileName, info] of animationsMap.value.entries()) {
            if (info.state === "ready" && info.group) {
                console.info(
                    `No explicit idle animation found, using ${fileName} as idle`,
                );
                idleAnimation = info.group;
                if (idleAnimation) {
                    idleAnimation.start(true, 1.0);
                    idleAnimation.loopAnimation = true;
                    break;
                }
            }
        }
    }

    if (
        walkFileName &&
        animationsMap.value.get(walkFileName)?.state === "ready"
    ) {
        const walkInfo = animationsMap.value.get(walkFileName);
        if (walkInfo?.group && walkInfo.state === "ready") {
            // Retarget walk animation to model skeleton via clone
            const originalWalkGroup = walkInfo.group;
            const modelTransformsWalk = meshes.value.flatMap((m) => m.getChildTransformNodes(false));
            const retargetedWalk = originalWalkGroup.clone(
                `${originalWalkGroup.name}-retargeted`,
                (oldTarget) => {
                    const target = modelTransformsWalk.find((node) => node.name === oldTarget.name);
                    if (!target) {
                        console.warn(`[BabylonAvatar] No retarget target for ${oldTarget.name}`);
                    }
                    return target;
                }
            );
            walkAnimation = retargetedWalk;
            console.info(`Found walk animation: ${walkAnimation.name}`);
            walkAnimation.start(true, 1.0);
            walkAnimation.loopAnimation = true;
        }
    }

    // Initialize weights for smooth blending between idle and walk
    if (idleAnimation && walkAnimation) {
        idleAnimation.setWeightForAllAnimatables(1.0);
        walkAnimation.setWeightForAllAnimatables(0.0);
    }

    console.info("Blended animations setup complete");
}

// Update animation weights based on movement
function updateAnimationBlending(isMoving: boolean, dt: number): void {
    // Ensure both animations are ready
    if (!idleAnimation || !walkAnimation) {
        return;
    }

    const targetWeight = isMoving ? 1 : 0;
    // If weight is already at target, no blending needed
    if (blendWeight.value === targetWeight) {
        return;
    }

    // Compute weight change based on transition duration
    const change = dt / blendDuration.value;
    // Move weight toward target
    if (targetWeight > blendWeight.value) {
        blendWeight.value += change;
    } else {
        blendWeight.value -= change;
    }
    // Clamp blendWeight between 0 and 1
    blendWeight.value = Math.min(Math.max(blendWeight.value, 0), 1);

    // Apply weights to animations
    idleAnimation.setWeightForAllAnimatables(1 - blendWeight.value);
    walkAnimation.setWeightForAllAnimatables(blendWeight.value);
}

// Observers and watcher cleanup handles
let skeletonViewer: SkeletonViewer | null = null;
let axesViewer: AxesViewer | null = null;
let beforePhysicsObserver: Observer<Scene> | null = null;
let afterPhysicsObserver: Observer<Scene> | null = null;
let rootMotionObserver: Observer<Scene> | null = null;
let connectionStatusWatcher: WatchStopHandle | null = null;
let entityDataWatcher: WatchStopHandle | null = null;

// Lifecycle hooks
onMounted(() => {
    const retrieveAvatar = () => avatarEntity.executeRetrieve();
    // Watch for connection established
    if (vircadiaWorld.connectionInfo.value.status === "connected") {
        retrieveAvatar();
    } else {
        connectionStatusWatcher = watch(
            () => vircadiaWorld.connectionInfo.value.status,
            (status) => {
                if (status === "connected") {
                    retrieveAvatar();
                    connectionStatusWatcher && connectionStatusWatcher();
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

    // Watch for entity data changes
    entityDataWatcher = watch(
        () => avatarEntity.entityData.value,
        async (data) => {
            const meta = data?.meta__data;
            if (meta && !characterController.value) {
                console.info("Loading avatar model...");
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
                    await loadModel(props.scene);

                    // Parent only top-level meshes under avatarNode to preserve hierarchy
                    const rootMeshes = meshes.value.filter((m) => !m.parent);
                    for (const mesh of rootMeshes) {
                        if (meshPivotPoint.value === "bottom") {
                            mesh.position.y = -capsuleHeight.value/2;
                        }
                        mesh.parent = avatarNode.value as TransformNode;
                    }

                    // Find and store skeleton for animation retargeting
                    if (skeletons.value.length > 0) {
                        avatarSkeleton.value = skeletons.value[0];
                    } else {
                        const skeletonMesh = meshes.value.find(
                            (m) => m.skeleton,
                        );
                        avatarSkeleton.value = skeletonMesh?.skeleton || null;
                    }

                    if (avatarSkeleton.value) {
                        // Ensure skinned meshes have enough bone influencers
                        for (const mesh of meshes.value.filter((m) => m.skeleton)) {
                            (mesh as any).numBoneInfluencers = Math.max(
                                (mesh as any).numBoneInfluencers,
                                4,
                            );
                        }
                        // Load animations
                        console.info("Loading animations...");
                        await loadAnimations();
                        console.info(
                            "Animation loading complete, setting up animation blending...",
                        );
                        setupBlendedAnimations();
                    } else {
                        console.warn(
                            "No skeleton found on avatar meshes, skipping animation load.",
                        );
                    }

                    // Debug mode: show bounding boxes, axes, and skeleton
                    if (debugBoundingBox.value) {
                        for (const mesh of meshes.value) {
                            // @ts-ignore: mesh is AbstractMesh with showBoundingBox property
                            (mesh as any).showBoundingBox = true;
                        }
                    }
                    if (debugAxes.value && avatarNode.value) {
                        // Initialize axes viewer; will update position and orientation each frame
                        axesViewer = new AxesViewer(props.scene, capsuleHeight.value);
                    }
                    if (debugSkeleton.value && avatarSkeleton.value) {
                        const skinnedMeshes = meshes.value.filter(
                            (m) => m.skeleton === avatarSkeleton.value,
                        );
                        for (const m of skinnedMeshes) {
                            skeletonViewer = new SkeletonViewer(
                                avatarSkeleton.value!,
                                m,
                                props.scene,
                            );
                            skeletonViewer.isEnabled = true;
                        }
                    }

                    // Ensure camera is set up before starting the render loop
                    setupCamera();
                    emit("ready");
                } else {
                    console.warn(
                        "Avatar node not initialized, skipping model load",
                    );
                }
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

        // Handle rotation input
        let yawDelta = 0;
        if (keyState.value.turnLeft)  yawDelta -= turnSpeed.value * dt;
        if (keyState.value.turnRight) yawDelta += turnSpeed.value * dt;
        if (yawDelta !== 0) {
            const deltaQ = Quaternion.RotationAxis(Vector3.Up(), yawDelta);
            const currentQ = getOrientation();
            if (!currentQ) {
                console.error("No current orientation found.");
                return;
            }
            setOrientation(currentQ.multiply(deltaQ));
        }

        // Compute movement direction
        const dir = new Vector3(
            (keyState.value.strafeRight ? 1 : 0) - (keyState.value.strafeLeft ? 1 : 0),
            0,
            (keyState.value.forward ? 1 : 0) -
                (keyState.value.backward ? 1 : 0),
        );

        // Check if character is moving for animation blending
        const isMoving = dir.lengthSquared() > 0;

        // Update animation blending based on movement state
        updateAnimationBlending(isMoving, dt);

        // Horizontal movement via velocity
        const vel = getVelocity();
        if (isMoving && vel && avatarNode.value) {
            // Movement relative to capsule's facing via getDirection
            const forward = avatarNode.value.getDirection(Vector3.Forward());
            const right   = avatarNode.value.getDirection(Vector3.Right());
            const moveWS  = forward.scale(dir.z).add(right.scale(dir.x)).normalize();
            const speed   = walkSpeed.value; // use store value
            // preserve vertical velocity
            setVelocity(moveWS.scale(speed).add(new Vector3(0, vel.y, 0)));
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
            velAfter.y += gravity.value * dt;
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
        // Debug axes update: position and orient axes to match avatar
        if (debugAxes.value && axesViewer && avatarNode.value) {
            const node = avatarNode.value;
            axesViewer.update(
                node.absolutePosition,
                node.getDirection(Vector3.Right()),
                node.getDirection(Vector3.Up()),
                node.getDirection(Vector3.Forward()),
            );
        }
    });
    // Prevent unwanted root motion sliding by resetting root bone position each frame
    rootMotionObserver = props.scene.onBeforeRenderObservable.add(() => {
        if (avatarSkeleton.value && avatarSkeleton.value.bones.length > 0) {
            const rootBone = avatarSkeleton.value.bones[0];
            // rootBone.position.set(0,0,0);
            // rootBone.rotationQuaternion?.set(0,0,0,1);
        }
    });
});

onUnmounted(() => {
    emit('dispose');
    if (beforePhysicsObserver) {
        props.scene.onBeforePhysicsObservable.remove(beforePhysicsObserver);
    }
    if (afterPhysicsObserver) {
        props.scene.onAfterPhysicsObservable.remove(afterPhysicsObserver);
    }
    

    if (rootMotionObserver) {
        props.scene.onBeforeRenderObservable.remove(rootMotionObserver);
    }
    // Cleanup Vue watchers
    connectionStatusWatcher && connectionStatusWatcher();
    entityDataWatcher && entityDataWatcher();
    // Dispose debug viewers
    if (skeletonViewer) {
        skeletonViewer.dispose();
        skeletonViewer = null;
    }
    if (axesViewer) {
        axesViewer.dispose();
        axesViewer = null;
    }
    avatarNode.value?.dispose();
    avatarEntity.cleanup();
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