<template>
    <!-- No visual output needed for this component -->
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, inject, toRefs } from "vue";
import { useVircadiaInstance, useAsset } from "@vircadia/world-sdk/browser/vue";

import { useAppStore } from "@/stores/appStore";

import {
    Vector3,
    Quaternion,
    ArcRotateCamera,
    CharacterSupportedState,
    ImportMeshAsync,
    type AnimationGroup,
    type Scene,
    type TransformNode,
    type Observer,
    type Node,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

import { z } from "zod";

import { useBabylonAvatarKeyboardControls } from "../composables/useBabylonAvatarKeyboardControls";
import { useBabylonAvatarEntity } from "../composables/useBabylonAvatarEntity";
import { useBabylonAvatarPhysicsController } from "../composables/useBabylonAvatarPhysicsController";
import { useBabylonAvatarCameraController } from "../composables/useBabylonAvatarCameraController";
import { useBabylonAvatarModelLoader } from "../composables/useBabylonAvatarModelLoader";
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
                    // Parent skeleton bones to avatarNode so the skeleton moves with the mesh
                    for (const skeleton of skeletons.value) {
                        for (const bone of skeleton.bones) {
                            // This works, don't know why. FIXME: why is this needed?
                            bone.linkTransformNode();
                        }
                    }
                    // Ensure skinned meshes have enough bone influencers
                    for (const mesh of meshes.value.filter((m) => m.skeleton)) {
                        mesh.numBoneInfluencers = Math.max(
                            mesh.numBoneInfluencers,
                            4,
                        );
                    }
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
                    // Simplified animation loading: load and assign animations without auto-play
                    const avatarSkeleton =
                        skeletons.value[0] ??
                        meshes.value.find((m) => m.skeleton)?.skeleton;
                    if (!avatarSkeleton) {
                        console.warn(
                            "No skeleton found on avatar meshes, skipping animation load.",
                        );
                    } else {
                        localAnimGroups.clear();
                        for (const def of animations.value) {
                            const asset = useAsset({
                                fileName: ref(def.fileName),
                                useCache: true,
                                debug: false,
                                instance: vircadiaWorld,
                            });
                            await asset.executeLoad();
                            const blobUrl = asset.assetData.value?.blobUrl;
                            if (!blobUrl) {
                                console.warn(
                                    `Animation asset blob URL not available for '${def.fileName}'`,
                                );
                                continue;
                            }
                            try {
                                const result = await ImportMeshAsync(
                                    blobUrl,
                                    props.scene,
                                    {
                                        pluginExtension:
                                            asset.fileExtension.value,
                                    },
                                );
                                for (const mesh of result.meshes) {
                                    mesh.dispose();
                                }
                                if (result.skeletons) {
                                    for (const skel of result.skeletons) {
                                        skel.dispose();
                                    }
                                }
                                for (const sourceGroup of result.animationGroups) {
                                    const clonedGroup = sourceGroup.clone(
                                        `${def.fileName}-${sourceGroup.name}`,
                                        (originalTarget) => {
                                            const targetBone =
                                                avatarSkeleton.bones.find(
                                                    (bone) =>
                                                        bone.name ===
                                                        originalTarget.name,
                                                );
                                            if (!targetBone) {
                                                console.warn(
                                                    `Retarget: Bone '${originalTarget.name}' not found on avatar skeleton`,
                                                );
                                            }
                                            return targetBone ?? null;
                                        },
                                    );
                                    if (
                                        clonedGroup.targetedAnimations.length >
                                        0
                                    ) {
                                        localAnimGroups.set(
                                            clonedGroup.name,
                                            clonedGroup,
                                        );
                                        console.info(
                                            `Loaded animation group '${clonedGroup.name}'`,
                                        );
                                    } else {
                                        clonedGroup.dispose();
                                    }
                                    sourceGroup.dispose();
                                }
                            } catch (e) {
                                console.error(
                                    `Error loading animation '${def.fileName}':`,
                                    e,
                                );
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
        // Play idle animation when no movement input
        if (dir.lengthSquared() === 0) {
            const idleName = localAnimGroups.keys().next().value;
            // console.info(`▷ idleName: ${idleName}`);
            if (idleName && currentAnimName !== idleName) {
                // console.info(`▷ playing idle animation: ${idleName}`);
                playAnimation(idleName);
            }
        } else {
        }
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
    if (beforePhysicsObserver) {
        props.scene.onBeforePhysicsObservable.remove(beforePhysicsObserver);
    }
    if (afterPhysicsObserver) {
        props.scene.onAfterPhysicsObservable.remove(afterPhysicsObserver);
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