<template></template>

<script setup lang="ts">
import type {
    AbstractMesh,
    Observer,
    Scene,
    TransformNode,
} from "@babylonjs/core";
import {
    ArcRotateCamera,
    MeshBuilder,
    Quaternion,
    Vector3,
} from "@babylonjs/core";
import type { Ref } from "vue";
import { onMounted, onUnmounted, ref, watch } from "vue";

const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
    avatarNode: {
        type: Object as () => TransformNode | AbstractMesh | null,
        required: false,
        default: null,
    },
    capsuleHeight: { type: Number, required: true },
    initialAlpha: { type: Number, required: false, default: -Math.PI / 2 },
    initialBeta: { type: Number, required: false, default: Math.PI / 3 },
    initialRadius: { type: Number, required: false, default: 5 },
    initialRotationOffset: { type: Number, required: false, default: 180 },
    // Core ArcRotateCamera tuning (required; provided by parent)
    minZ: { type: Number, required: true },
    lowerRadiusLimit: { type: Number, required: true },
    upperRadiusLimit: { type: Number, required: true },
    lowerBetaLimit: { type: Number, required: true },
    upperBetaLimit: { type: Number, required: true },
    inertia: { type: Number, required: true },
    panningSensibility: { type: Number, required: true },
    wheelPrecision: { type: Number, required: true },
    // FOV-only smoothing (parent provides small delta based on movement)
    fovDelta: { type: Number, required: true },
    fovLerpSpeed: { type: Number, required: true },
    // Mouse button states (provided by controller)
    rightMouseDown: { type: Boolean, required: true },
});

const camera: Ref<ArcRotateCamera | null> = ref(null);
let beforeRenderObserver: Observer<Scene> | null = null;
let contextMenuHandler: ((e: MouseEvent) => void) | null = null;

let followTargetMesh: AbstractMesh | null = null;

// Interaction limits provided via props

// FOV smoothing state
const fovSmoothed = ref(0); // radians added to base FOV
let baseFov = 0.8; // will capture from camera on setup

function clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

function getAvatarTargetPosition(): Vector3 | null {
    if (!props.avatarNode) return null;
    const node = props.avatarNode;
    return new Vector3(
        node.position.x,
        node.position.y + props.capsuleHeight * 0.6,
        node.position.z,
    );
}

function ensureFollowTarget(): AbstractMesh | null {
    // Always use a dedicated hidden target anchored roughly at the avatar chest
    if (!props.avatarNode || !props.scene) return null;
    if (!followTargetMesh) {
        followTargetMesh = MeshBuilder.CreateSphere(
            "avatarFollowTarget",
            { diameter: 0.01, segments: 4 },
            props.scene,
        );
        followTargetMesh.isVisible = false;
        followTargetMesh.isPickable = false;
        followTargetMesh.setParent(props.avatarNode);
    }
    // Place near chest (about 60% up the capsule). Avatar node is at capsule center (y=0)
    followTargetMesh.position.set(0, props.capsuleHeight * 0.6, 0);
    return followTargetMesh;
}

function setupCamera(): void {
    if (!props.scene) return;
    const initialTarget =
        getAvatarTargetPosition() || new Vector3(0, props.capsuleHeight / 2, 0);
    const cam = new ArcRotateCamera(
        "desktop-third-person-arc-rotate",
        props.initialAlpha,
        props.initialBeta,
        props.initialRadius,
        initialTarget,
        props.scene,
    );
    cam.minZ = props.minZ;
    cam.lowerRadiusLimit = props.lowerRadiusLimit;
    cam.upperRadiusLimit = props.upperRadiusLimit;
    cam.lowerBetaLimit = props.lowerBetaLimit; // prevent flipping under ground
    cam.upperBetaLimit = props.upperBetaLimit; // allow overhead but not inverted
    cam.inertia = props.inertia;
    cam.panningSensibility = props.panningSensibility; // disable panning for MMO-style
    cam.wheelPrecision = props.wheelPrecision; // adjust zoom speed to taste

    // Lock to avatar when available and apply a slight vertical screen-space offset
    cam.lockedTarget = ensureFollowTarget();
    // Center target in screen; avoid large screen-space offsets that feel disconnected
    cam.targetScreenOffset.set(0, 0);

    // Activate camera and attach controls
    props.scene.activeCamera = cam;
    camera.value = cam;

    // Capture baseline FOV for smoothing
    baseFov = cam.fov;

    const canvas = props.scene.getEngine().getRenderingCanvas();
    if (!canvas) return;
    cam.attachControl(canvas, true);

    // Detach controls from any other cameras to avoid input conflicts
    for (const c of props.scene.cameras) {
        if (
            c !== cam &&
            typeof (c as unknown as { detachControl?: () => void })
                .detachControl === "function"
        ) {
            try {
                (c as unknown as { detachControl: () => void }).detachControl();
            } catch { }
        }
    }

    // Suppress browser context menu
    contextMenuHandler = (e: MouseEvent) => {
        e.preventDefault();
    };
    canvas.addEventListener("contextmenu", contextMenuHandler);

    // Before render: ensure lockedTarget always follows the current avatar
    beforeRenderObserver = props.scene.onBeforeRenderObservable.add(() => {
        if (camera.value && props.avatarNode) {
            const m = ensureFollowTarget();
            if (m) camera.value.lockedTarget = m;
        }

        // FOV-only smoothing
        if (camera.value) {
            const engine = props.scene.getEngine();
            const dtSec = engine.getDeltaTime() / 1000;
            const k = clamp(props.fovLerpSpeed, 0.1, 30);
            const t = 1 - Math.exp(-k * dtSec);
            const targetDelta = clamp(Math.abs(props.fovDelta), 0, 0.12);
            fovSmoothed.value =
                fovSmoothed.value + (targetDelta - fovSmoothed.value) * t;
            camera.value.fov = clamp(
                baseFov + fovSmoothed.value,
                0.1,
                Math.PI - 0.1,
            );
        }

        if (!props.rightMouseDown || !camera.value || !props.avatarNode)
            return;
        const lookDir = props.avatarNode.position
            .subtract(camera.value.position)
            .normalize();
        // Project onto XZ plane
        lookDir.y = 0;
        if (lookDir.lengthSquared() < 1e-6) return;
        lookDir.normalize();
        // Babylon yaw: atan2(x, z)
        const yaw = Math.atan2(lookDir.x, lookDir.z);
        props.avatarNode.rotationQuaternion = Quaternion.FromEulerAngles(
            0,
            yaw,
            0,
        );
        props.avatarNode.computeWorldMatrix(true);
    });
}

onMounted(() => {
    setupCamera();
});

watch(
    () => props.avatarNode,
    () => {
        // Lock camera when avatar mesh becomes available
        if (camera.value) {
            camera.value.lockedTarget = ensureFollowTarget();
        }
    },
);

onUnmounted(() => {
    if (beforeRenderObserver)
        props.scene.onBeforeRenderObservable.remove(beforeRenderObserver);
    const canvas = props.scene.getEngine().getRenderingCanvas();
    if (canvas && contextMenuHandler) {
        try {
            canvas.removeEventListener("contextmenu", contextMenuHandler);
        } catch { }
    }
    camera.value?.dispose();
    camera.value = null;
    if (followTargetMesh) {
        try {
            followTargetMesh.dispose();
        } catch { }
        followTargetMesh = null;
    }
});

defineExpose({ camera });

// no local DOM listener registry needed; using Babylon observables
</script>
