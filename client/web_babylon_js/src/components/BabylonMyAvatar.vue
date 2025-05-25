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
    Matrix,
    CharacterSupportedState,
    Space,
    type AnimationGroup,
    type Scene,
    type Observer,
    type Skeleton,
    type Bone,
    type TransformNode,
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
    jointTransformsLocal: {},
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

// Type for debug window properties
interface DebugWindow extends Window {
    debugSkeleton?: boolean;
    debugSkeletonLoop?: boolean;
    lastSkeletonSnapshot?: SkeletonSnapshot;
    startLegRotationTest?: () => void;
    stopLegRotationTest?: () => void;
}

// Type for debug data
interface DebugData {
    timestamp: string;
    sessionId: string;
    skeleton: {
        boneCount: number;
        animations: {
            idle: number | string;
            walk: number | string;
        };
    };
    bones: Record<
        string,
        {
            p: string[];
            r: string;
        }
    >;
}

// Type for skeleton snapshot
interface SkeletonSnapshot {
    timestamp: string;
    boneCount: number;
    animations: {
        idle: string;
        walk: string;
    };
    bones: Record<
        string,
        {
            position: PositionObj;
            rotation: RotationObj;
            scale: PositionObj;
        }
    >;
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
    metaDataSchema: AvatarMetadataSchema,
    defaultMetaData: {
        type: "avatar",
        sessionId: sessionId.value,
        position: initialPosition.value,
        rotation: initialRotation.value,
        cameraOrientation: cameraOrientation.value,
        jointTransformsLocal: {},
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

        // Update joint transforms in LOCAL SPACE - Only send key joints for optimization
        const jointTransformsLocal: Record<
            string,
            {
                position: PositionObj;
                rotation: RotationObj;
                scale: PositionObj;
            }
        > = {};

        // Only send key joints: Hips, Spine bones, and upper leg bones
        const keyJointNames = ["Hips", "Spine", "LeftUpLeg", "RightUpLeg"];

        if (avatarSkeleton.value) {
            const bones = avatarSkeleton.value.bones || [];

            for (const jointName of keyJointNames) {
                // Find the bone that contains this joint name
                const bone = bones.find((b) =>
                    b.name.toLowerCase().includes(jointName.toLowerCase()),
                );

                if (bone) {
                    // Use LOCAL matrix for better network efficiency
                    const localMat = bone.getLocalMatrix();

                    // Decompose the matrix to get position, rotation, and scale
                    const pos = new Vector3();
                    const rot = new Quaternion();
                    const scale = new Vector3();
                    localMat.decompose(scale, rot, pos);

                    jointTransformsLocal[bone.name] = {
                        position: vectorToObj(pos),
                        rotation: quatToObj(rot),
                        scale: vectorToObj(scale),
                    };
                }
            }
        }

        if (Object.keys(jointTransformsLocal).length > 0) {
            await avatarEntity.executeUpdate(
                "meta__data = jsonb_set(meta__data, '{jointTransformsLocal}', $1)",
                [jointTransformsLocal],
            );
        }
    } catch (error) {
        console.error("Avatar metadata update failed:", error);
    }
}, 500);

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

// Test functions for leg rotation
function startLegRotationTest(): void {
    if (!avatarSkeleton.value) {
        console.error("[LegTest] No skeleton available");
        return;
    }

    // Find left leg bone (common names: LeftUpLeg, LeftThigh, Left_Leg, etc.)
    const leftLegBone = avatarSkeleton.value.bones.find(
        (bone) =>
            bone.name.toLowerCase().includes("left") &&
            (bone.name.toLowerCase().includes("leg") ||
                bone.name.toLowerCase().includes("thigh") ||
                bone.name.toLowerCase().includes("upleg")),
    );

    if (!leftLegBone) {
        console.error("[LegTest] Could not find left leg bone");
        console.log(
            "[LegTest] Available bones:",
            avatarSkeleton.value.bones.map((b) => b.name),
        );
        return;
    }

    console.log(
        `[LegTest] Starting rotation test on bone: ${leftLegBone.name}`,
    );

    // Check if this bone has a linked TransformNode (common with GLTF)
    const linkedNode = leftLegBone.getTransformNode();
    if (linkedNode) {
        console.log(
            `[LegTest] Bone has linked TransformNode: ${linkedNode.name}`,
        );
    } else {
        console.log(
            "[LegTest] Bone has no linked TransformNode - using bone directly",
        );
    }

    // Pause animations
    if (idleAnimation) {
        idleAnimation.pause();
        console.log("[LegTest] Paused idle animation");
    }
    if (walkAnimation) {
        walkAnimation.pause();
        console.log("[LegTest] Paused walk animation");
    }

    // Store original rotation
    const localMat = leftLegBone.getLocalMatrix();
    const pos = new Vector3();
    const rot = new Quaternion();
    const scale = new Vector3();
    localMat.decompose(scale, rot, pos);

    legRotationTest.isActive = true;
    legRotationTest.startTime = Date.now();
    legRotationTest.targetBone = leftLegBone;
    legRotationTest.originalRotation = rot.clone();

    console.log(
        `[LegTest] Original rotation: x=${rot.x.toFixed(3)}, y=${rot.y.toFixed(3)}, z=${rot.z.toFixed(3)}, w=${rot.w.toFixed(3)}`,
    );
}

function stopLegRotationTest(): void {
    if (!legRotationTest.isActive || !legRotationTest.targetBone) {
        console.log("[LegTest] No active test to stop");
        return;
    }

    console.log("[LegTest] Stopping rotation test");

    // Restore original rotation
    if (legRotationTest.originalRotation) {
        legRotationTest.targetBone.setRotationQuaternion(
            legRotationTest.originalRotation,
            Space.LOCAL,
        );
    }

    // Resume animations
    if (idleAnimation) {
        idleAnimation.play();
        console.log("[LegTest] Resumed idle animation");
    }
    if (walkAnimation) {
        walkAnimation.play();
        console.log("[LegTest] Resumed walk animation");
    }

    // Reset test state
    legRotationTest.isActive = false;
    legRotationTest.targetBone = null;
    legRotationTest.originalRotation = null;

    console.log("[LegTest] Test stopped and state reset");
}

// Reference to the avatar skeleton for animation retargeting
const avatarSkeleton: Ref<Skeleton | null> = ref(null);

// Debug flag for skeleton data - set window.debugSkeleton = true in console to enable
const debugSkeletonData = ref(false);

// Test leg rotation state
const legRotationTest = reactive({
    isActive: false,
    startTime: 0,
    duration: 1000, // 1 second
    targetBone: null as Bone | null,
    originalRotation: null as Quaternion | null,
});

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

            // IMPORTANT: We need to retarget to the actual skeleton bones, not transform nodes
            const retargetedIdle = originalIdleGroup.clone(
                `${originalIdleGroup.name}-retargeted`,
                (oldTarget) => {
                    // Find the corresponding bone in the skeleton
                    const bone = avatarSkeleton.value?.bones.find(
                        (b) => b.name === oldTarget.name,
                    );
                    if (bone) {
                        // Return the bone's linked transform node if it exists,
                        // otherwise return the bone itself
                        return bone.getTransformNode() || bone;
                    }

                    // If no bone found, log and return null
                    console.warn(
                        `[BabylonMyAvatar] No bone found for animation target ${oldTarget.name}`,
                    );
                    return null;
                },
            );
            idleAnimation = retargetedIdle;
            idleAnimation.start(true, 1.0);
            idleAnimation.loopAnimation = true;
        }
    } else {
        // If no explicit idle animation found, use the first available one
        for (const [fileName, info] of animationsMap.value.entries()) {
            if (info.state === "ready" && info.group) {
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

            // IMPORTANT: We need to retarget to the actual skeleton bones, not transform nodes
            const retargetedWalk = originalWalkGroup.clone(
                `${originalWalkGroup.name}-retargeted`,
                (oldTarget) => {
                    // Find the corresponding bone in the skeleton
                    const bone = avatarSkeleton.value?.bones.find(
                        (b) => b.name === oldTarget.name,
                    );
                    if (bone) {
                        // Return the bone's linked transform node if it exists,
                        // otherwise return the bone itself
                        return bone.getTransformNode() || bone;
                    }

                    // If no bone found, log and return null
                    console.warn(
                        `[BabylonMyAvatar] No bone found for animation target ${oldTarget.name}`,
                    );
                    return null;
                },
            );
            walkAnimation = retargetedWalk;
            walkAnimation.start(true, 1.0);
            walkAnimation.loopAnimation = true;
        }
    }

    // Initialize weights for smooth blending between idle and walk
    if (idleAnimation && walkAnimation) {
        idleAnimation.setWeightForAllAnimatables(1.0);
        walkAnimation.setWeightForAllAnimatables(0.0);
    }
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
let debugInterval: number | null = null;

// Lifecycle hooks
onMounted(async () => {
    // Watch for connection established
    if (vircadiaWorld.connectionInfo.value.status === "connected") {
        if (!(await avatarEntity.exists())) {
            await avatarEntity.executeCreate(
                "(general__entity_name, meta__data) VALUES ($1, $2) RETURNING general__entity_name",
                [
                    entityName.value,
                    {
                        type: "avatar",
                        sessionId: sessionId.value,
                        position: initialPosition.value,
                        rotation: initialRotation.value,
                        cameraOrientation: cameraOrientation.value,
                        jointTransformsLocal: {},
                        modelFileName: modelFileName.value,
                    },
                ],
            );
        }
        avatarEntity.executeRetrieve("general__entity_name, meta__data");
    } else {
        connectionStatusWatcher = watch(
            () => vircadiaWorld.connectionInfo.value.status,
            (status) => {
                if (status === "connected") {
                    avatarEntity.executeRetrieve(
                        "general__entity_name, meta__data",
                    );
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

                        // Note: GLTF skeletons don't expose bones as TransformNodes
                        // The animations will update the skeleton directly through the skeleton system

                        // Load animations
                        await loadAnimations();
                        setupBlendedAnimations();

                        // After animations are set up, check what they're targeting
                        setTimeout(() => {
                            if (idleAnimation) {
                                console.log("Idle animation details:");
                                console.log("- Name:", idleAnimation.name);
                                console.log(
                                    "- Is playing:",
                                    idleAnimation.isPlaying,
                                );
                                console.log(
                                    "- Target count:",
                                    idleAnimation.targetedAnimations.length,
                                );

                                // Check if any animations target the skeleton
                                let skeletonTargets = 0;
                                let boneTargets = 0;
                                for (const anim of idleAnimation.targetedAnimations) {
                                    if (anim.target === avatarSkeleton.value) {
                                        skeletonTargets++;
                                    } else if (
                                        anim.target.name &&
                                        avatarSkeleton.value?.bones.find(
                                            (b) => b.name === anim.target.name,
                                        )
                                    ) {
                                        boneTargets++;
                                    }
                                }
                                console.log(
                                    "- Skeleton targets:",
                                    skeletonTargets,
                                );
                                console.log("- Bone targets:", boneTargets);

                                // Log first few animation targets
                                console.log("First 5 animation targets:");
                                for (
                                    let i = 0;
                                    i <
                                    Math.min(
                                        5,
                                        idleAnimation.targetedAnimations.length,
                                    );
                                    i++
                                ) {
                                    const target =
                                        idleAnimation.targetedAnimations[i]
                                            .target;
                                    console.log(
                                        `  - ${target.name || target.constructor.name} (${target.constructor.name})`,
                                    );
                                }
                            }
                        }, 1000);

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

                        // Expose test functions to window for debugging
                        (window as DebugWindow).startLegRotationTest =
                            startLegRotationTest;
                        (window as DebugWindow).stopLegRotationTest =
                            stopLegRotationTest;
                        console.log(
                            "[LegTest] Test functions available: window.startLegRotationTest() and window.stopLegRotationTest()",
                        );

                        // Also add a debug function to check skeleton state
                        (
                            window as DebugWindow & {
                                debugSkeletonState?: () => void;
                            }
                        ).debugSkeletonState = () => {
                            if (!avatarSkeleton.value) {
                                console.log("No skeleton available");
                                return;
                            }

                            console.log("=== Skeleton Debug Info ===");
                            console.log(
                                `Bone count: ${avatarSkeleton.value.bones.length}`,
                            );
                            console.log(`Name: ${avatarSkeleton.value.name}`);
                            console.log(
                                `Needs initial skeleton matrix: ${avatarSkeleton.value.needInitialSkinMatrix}`,
                            );

                            // Find leg bone
                            const leftLegBone = avatarSkeleton.value.bones.find(
                                (bone) =>
                                    bone.name.toLowerCase().includes("left") &&
                                    (bone.name.toLowerCase().includes("leg") ||
                                        bone.name
                                            .toLowerCase()
                                            .includes("thigh") ||
                                        bone.name
                                            .toLowerCase()
                                            .includes("upleg")),
                            );

                            if (leftLegBone) {
                                console.log(
                                    `\nLeft leg bone: ${leftLegBone.name}`,
                                );
                                console.log(
                                    `- Has linked transform: ${!!leftLegBone.getTransformNode()}`,
                                );
                                console.log(
                                    `- Parent: ${leftLegBone.getParent()?.name || "none"}`,
                                );
                                console.log(
                                    `- Children: ${leftLegBone.children.map((c) => c.name).join(", ") || "none"}`,
                                );

                                // Check if animations are targeting this bone
                                let animTargets = 0;
                                if (idleAnimation) {
                                    for (const anim of idleAnimation.targetedAnimations) {
                                        if (
                                            anim.target === leftLegBone ||
                                            anim.target.name ===
                                                leftLegBone.name
                                        ) {
                                            animTargets++;
                                        }
                                    }
                                }
                                console.log(
                                    `- Animation targets: ${animTargets}`,
                                );
                            }

                            // Check meshes using this skeleton
                            const skinnedMeshes = meshes.value.filter(
                                (m) => m.skeleton === avatarSkeleton.value,
                            );
                            console.log(
                                `\nSkinned meshes: ${skinnedMeshes.length}`,
                            );
                            for (const mesh of skinnedMeshes) {
                                console.log(
                                    `- ${mesh.name} (bone influencers: ${mesh.numBoneInfluencers || "N/A"})`,
                                );
                            }
                        };

                        // Expose debug data function for overlay
                        (
                            window as DebugWindow & {
                                __debugMyAvatarData?: () => unknown;
                            }
                        ).__debugMyAvatarData = () => {
                            if (!avatarSkeleton.value) return null;

                            const joints: Record<
                                string,
                                {
                                    position: PositionObj;
                                    rotation: RotationObj;
                                    scale: PositionObj;
                                }
                            > = {};

                            // Only collect key joints: Hips, Spine bones, and leg bones
                            const keyJoints = [
                                "Hips",
                                "Spine",
                                "LeftUpLeg",
                                "RightUpLeg",
                            ];

                            for (const jointName of keyJoints) {
                                const bone = avatarSkeleton.value.bones.find(
                                    (b) =>
                                        b.name
                                            .toLowerCase()
                                            .includes(jointName.toLowerCase()),
                                );

                                if (bone) {
                                    const localMat = bone.getLocalMatrix();
                                    const pos = new Vector3();
                                    const rot = new Quaternion();
                                    const scale = new Vector3();
                                    localMat.decompose(scale, rot, pos);

                                    joints[bone.name] = {
                                        position: vectorToObj(pos),
                                        rotation: quatToObj(rot),
                                        scale: vectorToObj(scale),
                                    };
                                }
                            }

                            return {
                                sessionId: sessionId.value,
                                boneCount: avatarSkeleton.value.bones.length,
                                joints,
                            };
                        };

                        emit("ready");
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
            // Don't force skeleton matrix computation - let Babylon handle it naturally
            // This was interfering with other avatars' bone transforms:
            // avatarSkeleton.value.computeAbsoluteMatrices();

            // Debug skeleton data capture (enable with window.debugSkeleton = true)
            if (
                (window as DebugWindow).debugSkeleton &&
                !debugSkeletonData.value
            ) {
                debugSkeletonData.value = true;

                // Capture snapshot of skeleton state
                const snapshot: SkeletonSnapshot = {
                    timestamp: new Date().toISOString(),
                    boneCount: avatarSkeleton.value.bones.length,
                    animations: {
                        idle: idleAnimation?.isPlaying
                            ? `weight: ${(1 - blendWeight.value).toFixed(2)}`
                            : "not playing",
                        walk: walkAnimation?.isPlaying
                            ? `weight: ${blendWeight.value.toFixed(2)}`
                            : "not playing",
                    },
                    bones: {},
                };

                // Capture all bone transforms
                for (const bone of avatarSkeleton.value.bones) {
                    const localMat = bone.getLocalMatrix();
                    const pos = new Vector3();
                    const rot = new Quaternion();
                    const scale = new Vector3();
                    localMat.decompose(scale, rot, pos);

                    snapshot.bones[bone.name] = {
                        position: { x: pos.x, y: pos.y, z: pos.z },
                        rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
                        scale: { x: scale.x, y: scale.y, z: scale.z },
                    };
                }

                // Store in window for inspection
                (window as DebugWindow).lastSkeletonSnapshot = snapshot;
                console.log(
                    "[DEBUG] Skeleton snapshot captured. Access with: window.lastSkeletonSnapshot",
                );

                // Reset flag after 1 second
                setTimeout(() => {
                    debugSkeletonData.value = false;
                }, 1000);
            }
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

        // Update leg rotation test
        if (
            legRotationTest.isActive &&
            legRotationTest.targetBone &&
            legRotationTest.originalRotation
        ) {
            const elapsed = Date.now() - legRotationTest.startTime;
            const progress = Math.min(elapsed / legRotationTest.duration, 1.0);

            // Calculate rotation angle (0 to 360 degrees)
            const angle = progress * Math.PI * 2;

            // Create rotation around Y axis (up)
            const rotationDelta = Quaternion.RotationAxis(Vector3.Up(), angle);

            // Apply rotation: original * delta
            const newRotation =
                legRotationTest.originalRotation.multiply(rotationDelta);

            // Try multiple approaches to ensure the rotation is applied

            // Approach 1: Set rotation quaternion directly
            legRotationTest.targetBone.setRotationQuaternion(
                newRotation,
                Space.LOCAL,
            );

            // Approach 2: Update the bone's local matrix directly
            // Get current position and scale from the matrix
            const currentMatrix = legRotationTest.targetBone.getLocalMatrix();
            const pos = new Vector3();
            const oldRot = new Quaternion();
            const scale = new Vector3();
            currentMatrix.decompose(scale, oldRot, pos);

            // Create new matrix with our rotation
            const rotMatrix = Matrix.FromQuaternionToRef(
                newRotation,
                new Matrix(),
            );
            const translationMatrix = Matrix.Translation(pos.x, pos.y, pos.z);
            const scaleMatrix = Matrix.Scaling(scale.x, scale.y, scale.z);
            const newMatrix = scaleMatrix
                .multiply(rotMatrix)
                .multiply(translationMatrix);

            // Apply the new matrix
            legRotationTest.targetBone.updateMatrix(newMatrix, false, false);

            // CRITICAL: Force skeleton to update and propagate to mesh
            if (avatarSkeleton.value) {
                // Mark skeleton as dirty to force update
                avatarSkeleton.value.prepare();

                // If the bone has a linked TransformNode, update that too
                const linkedNode =
                    legRotationTest.targetBone.getTransformNode();
                if (linkedNode?.rotationQuaternion) {
                    linkedNode.rotationQuaternion = newRotation;
                }
            }

            // Log progress every ~10%
            const progressPercent = Math.floor(progress * 10) * 10;
            if (
                progressPercent % 10 === 0 &&
                Math.abs(progress * 100 - progressPercent) < 1
            ) {
                console.log(
                    `[LegTest] Progress: ${progressPercent}%, angle: ${((angle * 180) / Math.PI).toFixed(1)}°`,
                );

                // Get current bone transform
                const localMat = legRotationTest.targetBone.getLocalMatrix();
                const pos = new Vector3();
                const rot = new Quaternion();
                const scale = new Vector3();
                localMat.decompose(scale, rot, pos);

                console.log(
                    `[LegTest] Current rotation: x=${rot.x.toFixed(3)}, y=${rot.y.toFixed(3)}, z=${rot.z.toFixed(3)}, w=${rot.w.toFixed(3)}`,
                );

                // Also log if bone has a linked transform node
                const linkedNode =
                    legRotationTest.targetBone.getTransformNode();
                if (linkedNode) {
                    console.log(
                        `[LegTest] Bone has linked TransformNode: ${linkedNode.name}`,
                    );
                }
            }

            // Auto-stop after completion
            if (progress >= 1.0) {
                console.log("[LegTest] Rotation complete, auto-stopping");
                stopLegRotationTest();
            }
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

    // Start debug logging if enabled
    debugInterval = setInterval(() => {
        if (
            (window as DebugWindow).debugSkeletonLoop &&
            avatarSkeleton.value &&
            meshes.value.length > 0
        ) {
            const debugData: DebugData = {
                timestamp: new Date().toISOString().split("T")[1].split(".")[0],
                sessionId: sessionId.value || "",
                skeleton: {
                    boneCount: avatarSkeleton.value.bones.length,
                    animations: {
                        idle: idleAnimation?.isPlaying
                            ? 1 - blendWeight.value
                            : 0,
                        walk: walkAnimation?.isPlaying ? blendWeight.value : 0,
                    },
                },
                bones: {},
            };

            // Sample key bones to check movement
            const keyBones =
                legRotationTest.isActive && legRotationTest.targetBone
                    ? ["Hips", "Spine", "Head", legRotationTest.targetBone.name]
                    : ["Hips", "Spine", "Head"];

            // If leg test is active, mark animations as paused
            if (legRotationTest.isActive && legRotationTest.targetBone) {
                debugData.skeleton.animations.idle = "PAUSED (leg test)";
                debugData.skeleton.animations.walk = "PAUSED (leg test)";
            }

            debugData.bones = {};

            for (const boneName of keyBones) {
                const bone = avatarSkeleton.value.bones.find((b) =>
                    typeof boneName === "string"
                        ? b.name.includes(boneName)
                        : b.name === boneName,
                );
                if (bone) {
                    const localMat = bone.getLocalMatrix();
                    const pos = new Vector3();
                    const rot = new Quaternion();
                    const scale = new Vector3();
                    localMat.decompose(scale, rot, pos);

                    // For leg test bone, always log
                    const isLegTestBone =
                        legRotationTest.isActive &&
                        bone === legRotationTest.targetBone;

                    // Only log if not at identity OR if it's the leg test bone
                    if (
                        isLegTestBone ||
                        pos.lengthSquared() > 0.001 ||
                        Math.abs(rot.w - 1) > 0.001
                    ) {
                        debugData.bones[bone.name] = {
                            p: [
                                pos.x.toFixed(2),
                                pos.y.toFixed(2),
                                pos.z.toFixed(2),
                            ],
                            r: rot.w.toFixed(2),
                        };

                        // Add extra info for leg test bone
                        if (isLegTestBone) {
                            debugData.bones[bone.name].r =
                                `${rot.x.toFixed(2)},${rot.y.toFixed(2)},${rot.z.toFixed(2)},${rot.w.toFixed(2)}`;
                        }
                    }
                }
            }

            console.log("[MY_AVATAR]", JSON.stringify(debugData));
        }
    }, 1000); // Log every second
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
    if (debugInterval) {
        clearInterval(debugInterval);
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