<template>
    <!-- No visual output needed for this component -->
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, inject, type PropType } from "vue";
import type {
    Scene,
    Vector3 as BabylonVector3,
    Quaternion as BabylonQuaternion,
} from "@babylonjs/core";
import { Vector3, Quaternion, ArcRotateCamera } from "@babylonjs/core";
import { z } from "zod";
import { useVircadiaInstance } from "@vircadia/world-sdk/browser/vue";

import { useBabylonAvatarKeyboardControls } from "../composables/useBabylonAvatarKeyboardControls";
import { useBabylonAvatarEntity } from "../composables/useBabylonAvatarEntity";
import { useBabylonAvatarPhysicsController } from "../composables/useBabylonAvatarPhysicsController";
import { useBabylonAvatarCameraController } from "../composables/useBabylonAvatarCameraController";
import type {
    PositionObj,
    RotationObj,
} from "../composables/useBabylonAvatarPhysicsController";

// Define component props with defaults
const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
    entityName: { type: String, required: true },
    throttleInterval: { type: Number, default: 500 },
    capsuleHeight: { type: Number, default: 1.8 },
    capsuleRadius: { type: Number, default: 0.3 },
    slopeLimit: { type: Number, default: 45 },
    jumpSpeed: { type: Number, default: 5 },
    initialPosition: {
        type: Object as PropType<PositionObj>,
        default: () => ({ x: 3, y: 0.3, z: -8 }),
    },
    initialRotation: {
        type: Object as PropType<RotationObj>,
        default: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    },
    initialCameraOrientation: {
        type: Object as PropType<{
            alpha: number;
            beta: number;
            radius: number;
        }>,
        default: () => ({ alpha: -Math.PI / 2, beta: Math.PI / 3, radius: 5 }),
    },
});
const emit = defineEmits<{ ready: [] }>();

// Local state for transforms
const initialPosition = ref<PositionObj>(props.initialPosition);
const initialRotation = ref<RotationObj>(props.initialRotation);
const cameraOrientation = ref(props.initialCameraOrientation);

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
    type: z.literal(props.entityName),
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
    characterOrientation: charOrient,
    createController,
    updateTransforms,
    moveAvatar,
    rotateAvatar,
    stepSimulation,
    jump,
} = useBabylonAvatarPhysicsController(
    props.scene,
    initialPosition,
    initialRotation,
    ref(props.capsuleHeight),
    ref(props.capsuleRadius),
    ref(props.slopeLimit),
);
const { keyState } = useBabylonAvatarKeyboardControls(props.scene);
const { avatarEntity, isLoading, hasError, errorMessage, throttledUpdate } =
    useBabylonAvatarEntity<PhysicsAvatarMeta>(
        ref(props.entityName),
        props.throttleInterval,
        PhysicsAvatarMetaSchema,
        () => ({
            type: props.entityName,
            position: initialPosition.value,
            rotation: initialRotation.value,
            cameraOrientation: cameraOrientation.value,
        }),
        () => ({
            type: props.entityName,
            position: characterController.value
                ? vectorToObj(characterController.value.getPosition())
                : initialPosition.value,
            rotation: quatToObj(charOrient.value),
            cameraOrientation: cameraOrientation.value,
        }),
    );

// Camera controller
const { camera, setupCamera, updateCameraFromMeta } =
    useBabylonAvatarCameraController(
        props.scene,
        avatarNode,
        cameraOrientation,
        ref(props.capsuleHeight),
        throttledUpdate,
    );

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
        (data) => {
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
                setupCamera();
                emit("ready");
            } else if (meta && characterController.value) {
                // Remote update, apply if present
                if (meta.position) {
                    const p = meta.position;
                    characterController.value.setPosition(
                        new Vector3(p.x, p.y, p.z),
                    );
                }
                if (meta.rotation) {
                    const r = meta.rotation;
                    charOrient.value = new Quaternion(r.x, r.y, r.z, r.w);
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
    props.scene.onBeforePhysicsObservable.add(() => {
        if (!characterController.value) return;
        const dt = props.scene.getEngine().getDeltaTime() / 1000;
        // Compute movement direction
        const dir = new Vector3(
            (keyState.value.right ? 1 : 0) - (keyState.value.left ? 1 : 0),
            0,
            (keyState.value.forward ? 1 : 0) -
                (keyState.value.backward ? 1 : 0),
        );
        if (dir.lengthSquared() > 0) {
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
            moveAvatar(transformedDir);
        } else {
            // Stop horizontal sliding
            const vel = characterController.value.getVelocity();
            vel.x = 0;
            vel.z = 0;
            characterController.value.setVelocity(vel);
        }
        // Apply jump impulse if requested
        if (keyState.value.jump) {
            jump(dt, props.jumpSpeed);
        }
    });
    // After the physics engine updates, integrate the character and sync transforms
    props.scene.onAfterPhysicsObservable.add(() => {
        if (!characterController.value) return;
        const dt = props.scene.getEngine().getDeltaTime() / 1000;
        stepSimulation(dt);
        throttledUpdate();
        // update camera target to follow the avatar
        if (camera.value && avatarNode.value) {
            const node = avatarNode.value;
            camera.value.setTarget(
                new Vector3(
                    node.position.x,
                    node.position.y + props.capsuleHeight / 2,
                    node.position.z,
                ),
            );
        }
    });
});

onUnmounted(() => {
    avatarNode.value?.dispose();
    avatarEntity.cleanup();
    // camera is disposed by useAvatarCameraController composable
});

defineExpose({ isLoading, hasError, errorMessage, moveAvatar, rotateAvatar });
</script>