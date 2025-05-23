<template>
    <!-- No visual output needed for this component -->
</template>

<script setup lang="ts">
import {
    ref,
    reactive,
    onMounted,
    onUnmounted,
    watch,
    type WatchStopHandle,
    inject,
    toRefs,
    type Ref,
    computed,
} from "vue";
import { useVircadiaInstance } from "@vircadia/world-sdk/browser/vue";

import { useAppStore } from "@/stores/appStore";

import {
    Vector3,
    Quaternion,
    CharacterSupportedState,
    type AnimationGroup,
    type Scene,
    type TransformNode,
    type Observer,
    type Skeleton,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

// Debug viewers import
import { SkeletonViewer, AxesViewer } from "@babylonjs/core/Debug";

import { useEntity } from "@vircadia/world-sdk/browser/vue";
import { useThrottleFn } from "@vueuse/core";

import { useBabylonAvatarKeyboardMouseControls } from "../composables/useBabylonAvatarKeyboardMouseControls";
import { useBabylonAvatarPhysicsController } from "../composables/useBabylonAvatarPhysicsController";
import { useBabylonAvatarCameraController } from "../composables/useBabylonAvatarCameraController";
import { useBabylonAvatarModelLoader } from "../composables/useBabylonAvatarModelLoader";
import { useBabylonAvatarAnimationLoader } from "../composables/useBabylonAvatarAnimationLoader";
import {
    AvatarMetadataSchema,
    type AvatarMetadata,
} from "../composables/schemas";
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
    initialAvatarCameraOrientation,
    initialAvatarPosition,
    initialAvatarRotation,
    modelFileName,
    animations,
} = toRefs(avatarDefinition);

// Reactive sessionId from store
const { sessionId } = toRefs(appStore);

// Generate dynamic entity name based on session ID
const entityName = computed(() => `avatar:${sessionId.value}`);

// Reactive metadata object for transforms
const metadata = reactive<AvatarMetadata>({
    type: "avatar",
    sessionId: sessionId.value,
    position: initialAvatarPosition.value,
    rotation: initialAvatarRotation.value,
    cameraOrientation: initialAvatarCameraOrientation.value,
    jointTransforms: {},
    modelFileName: modelFileName.value,
});
// Destructure refs for physics & camera controllers
const {
    position: initialPosition,
    rotation: initialRotation,
    cameraOrientation,
} = toRefs(metadata);

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

// Setup avatar entity inline
const avatarEntity = useEntity({
    entityName: entityName,
    selectClause: "general__entity_name, meta__data",
    insertClause:
        "(general__entity_name, meta__data) VALUES ($1, $2) RETURNING general__entity_name",
    insertParams: [
        entityName.value,
        {
            type: "avatar",
            sessionId: sessionId.value,
            position: initialPosition.value,
            rotation: initialRotation.value,
            cameraOrientation: cameraOrientation.value,
            jointTransforms: {},
        },
    ],
    metaDataSchema: AvatarMetadataSchema,
    defaultMetaData: {
        type: "avatar",
        sessionId: sessionId.value,
        position: initialPosition.value,
        rotation: initialRotation.value,
        cameraOrientation: cameraOrientation.value,
        jointTransforms: {},
        modelFileName: modelFileName.value,
    },
});
const throttledUpdate = useThrottleFn(async () => {
    if (!avatarEntity.entityData.value?.general__entity_name) {
        return;
    }

    const currentMeta = avatarEntity.entityData.value.meta__data;
    if (!currentMeta) {
        return;
    }

    try {
        // Get current transform data
        const currentPos = getPosition();
        const currentRot = getOrientation();

        // Update position using JSON path operation if changed
        if (currentPos) {
            const newPos = vectorToObj(currentPos);
            if (
                currentMeta.position &&
                (currentMeta.position.x !== newPos.x ||
                    currentMeta.position.y !== newPos.y ||
                    currentMeta.position.z !== newPos.z)
            ) {
                await avatarEntity.executeUpdate(
                    "meta__data = jsonb_set(meta__data, '{position}', $1)",
                    [newPos],
                );
            }
        }

        // Update rotation using JSON path operation if changed
        if (currentRot) {
            const newRot = quatToObj(currentRot);
            if (
                currentMeta.rotation &&
                (currentMeta.rotation.x !== newRot.x ||
                    currentMeta.rotation.y !== newRot.y ||
                    currentMeta.rotation.z !== newRot.z ||
                    currentMeta.rotation.w !== newRot.w)
            ) {
                await avatarEntity.executeUpdate(
                    "meta__data = jsonb_set(meta__data, '{rotation}', $1)",
                    [newRot],
                );
            }
        }

        // Update camera orientation using JSON path operation if changed
        if (
            currentMeta.cameraOrientation &&
            (currentMeta.cameraOrientation.alpha !==
                cameraOrientation.value.alpha ||
                currentMeta.cameraOrientation.beta !==
                    cameraOrientation.value.beta ||
                currentMeta.cameraOrientation.radius !==
                    cameraOrientation.value.radius)
        ) {
            await avatarEntity.executeUpdate(
                "meta__data = jsonb_set(meta__data, '{cameraOrientation}', $1)",
                [cameraOrientation.value],
            );
        }

        // Update type if changed
        if (currentMeta.type !== "avatar") {
            await avatarEntity.executeUpdate(
                "meta__data = jsonb_set(meta__data, '{type}', $1)",
                ["avatar"],
            );
        }

        // Update sessionId if changed
        if (currentMeta.sessionId !== sessionId.value) {
            await avatarEntity.executeUpdate(
                "meta__data = jsonb_set(meta__data, '{sessionId}', $1)",
                [sessionId.value],
            );
        }

        // Update modelFileName if changed
        if (currentMeta.modelFileName !== modelFileName.value) {
            await avatarEntity.executeUpdate(
                "meta__data = jsonb_set(meta__data, '{modelFileName}', $1)",
                [modelFileName.value],
            );
        }

        // Update joint transforms (full replacement since it's complex nested data)
        const bones = avatarSkeleton.value?.bones || [];
        if (bones.length > 0) {
            const jointTransforms: Record<
                string,
                { position: PositionObj; rotation: RotationObj }
            > = {};

            for (const bone of bones) {
                const mat = bone.getAbsoluteMatrix();
                const pos = mat.getTranslation();
                const rot = Quaternion.FromRotationMatrix(mat);
                jointTransforms[bone.name] = {
                    position: vectorToObj(pos),
                    rotation: quatToObj(rot),
                };
            }

            await avatarEntity.executeUpdate(
                "meta__data = jsonb_set(meta__data, '{jointTransforms}', $1)",
                [jointTransforms],
            );
        }
    } catch (error) {
        console.error("Avatar metadata update failed:", error);
    }
}, 50);

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
    throw new Error("Vircadia instance not found in BabylonMyAvatar");
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
            const modelTransforms = meshes.value.flatMap((m) =>
                m.getChildTransformNodes(false),
            );
            const retargetedIdle = originalIdleGroup.clone(
                `${originalIdleGroup.name}-retargeted`,
                (oldTarget) => {
                    const target = modelTransforms.find(
                        (node) => node.name === oldTarget.name,
                    );
                    if (!target) {
                        console.warn(
                            `[BabylonMyAvatar] No retarget target for ${oldTarget.name}`,
                        );
                    }
                    return target;
                },
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
            const modelTransformsWalk = meshes.value.flatMap((m) =>
                m.getChildTransformNodes(false),
            );
            const retargetedWalk = originalWalkGroup.clone(
                `${originalWalkGroup.name}-retargeted`,
                (oldTarget) => {
                    const target = modelTransformsWalk.find(
                        (node) => node.name === oldTarget.name,
                    );
                    if (!target) {
                        console.warn(
                            `[BabylonMyAvatar] No retarget target for ${oldTarget.name}`,
                        );
                    }
                    return target;
                },
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
onMounted(async () => {
    // Watch for connection established
    if (vircadiaWorld.connectionInfo.value.status === "connected") {
        if (!(await avatarEntity.exists())) {
            avatarEntity.executeCreate();
        }
        avatarEntity.executeRetrieve();
    } else {
        connectionStatusWatcher = watch(
            () => vircadiaWorld.connectionInfo.value.status,
            (status) => {
                if (status === "connected") {
                    avatarEntity.executeRetrieve();
                    connectionStatusWatcher?.();
                }
            },
        );
    }

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
                            mesh.position.y = -capsuleHeight.value / 2;
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
                        for (const mesh of meshes.value.filter(
                            (m) => m.skeleton,
                        )) {
                            if ("numBoneInfluencers" in mesh) {
                                mesh.numBoneInfluencers = Math.max(
                                    mesh.numBoneInfluencers || 0,
                                    4,
                                );
                            }
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
                            if ("showBoundingBox" in mesh) {
                                mesh.showBoundingBox = true;
                            }
                        }
                    }
                    if (debugAxes.value && avatarNode.value) {
                        // Initialize axes viewer; will update position and orientation each frame
                        axesViewer = new AxesViewer(
                            props.scene,
                            capsuleHeight.value,
                        );
                    }
                    if (debugSkeleton.value && avatarSkeleton.value) {
                        const skinnedMeshes = meshes.value.filter(
                            (m) => m.skeleton === avatarSkeleton.value,
                        );
                        for (const m of skinnedMeshes) {
                            if (avatarSkeleton.value) {
                                skeletonViewer = new SkeletonViewer(
                                    avatarSkeleton.value,
                                    m,
                                    props.scene,
                                );
                                skeletonViewer.isEnabled = true;
                            }
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
        if (keyState.value.turnLeft) yawDelta -= turnSpeed.value * dt;
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
            (keyState.value.strafeRight ? 1 : 0) -
                (keyState.value.strafeLeft ? 1 : 0),
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
            const right = avatarNode.value.getDirection(Vector3.Right());
            const moveWS = forward
                .scale(dir.z)
                .add(right.scale(dir.x))
                .normalize();
            const speed = walkSpeed.value; // use store value
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
        updateTransforms();

        // Make sure skeleton is updated before sending metadata
        if (avatarSkeleton.value) {
            avatarSkeleton.value.computeAbsoluteMatrices();
        }

        throttledUpdate();
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
    emit("dispose");
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
    connectionStatusWatcher?.();
    entityDataWatcher?.();
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
    isRetrieving: avatarEntity.retrieving.value,
    isCreating: avatarEntity.creating.value,
    isUpdating: avatarEntity.updating.value,
    hasError: avatarEntity.error.value,
    errorMessage: avatarEntity.error.value,
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