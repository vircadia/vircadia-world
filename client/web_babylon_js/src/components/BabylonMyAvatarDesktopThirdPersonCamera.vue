<template></template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import type { Ref } from "vue";
import type {
    Scene,
    Observer,
    TransformNode,
    AbstractMesh,
    PointerInfo,
} from "@babylonjs/core";
import {
    ArcRotateCamera,
    Vector3,
    Quaternion,
    MeshBuilder,
    PointerEventTypes,
} from "@babylonjs/core";

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
});

const camera: Ref<ArcRotateCamera | null> = ref(null);
let beforeRenderObserver: Observer<Scene> | null = null;
let pointerObserver: Observer<PointerInfo> | null = null;
let contextMenuHandler: ((e: MouseEvent) => void) | null = null;

const isRightMouseDown = ref(false);
let followTargetMesh: AbstractMesh | null = null;

// Interaction sensitivities and limits
const minRadius = 1.2;
const maxRadius = 25;

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
    cam.minZ = 0.1;
    cam.lowerRadiusLimit = minRadius;
    cam.upperRadiusLimit = maxRadius;
    cam.lowerBetaLimit = 0.1; // prevent flipping under ground
    cam.upperBetaLimit = Math.PI * 0.95; // allow overhead but not inverted
    cam.inertia = 0.6;
    cam.panningSensibility = 0; // disable panning for MMO-style
    cam.wheelPrecision = 50; // adjust zoom speed to taste

    // Lock to avatar when available and apply a slight vertical screen-space offset
    cam.lockedTarget = ensureFollowTarget();
    // Center target in screen; avoid large screen-space offsets that feel disconnected
    cam.targetScreenOffset.set(0, 0);

    // Activate camera and attach controls
    props.scene.activeCamera = cam;
    camera.value = cam;

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
            } catch {}
        }
    }

    // Right mouse handling via Babylon pointer pipeline; suppress browser context menu
    pointerObserver = props.scene.onPointerObservable.add((info) => {
        const evt = info.event as MouseEvent;
        switch (info.type) {
            case PointerEventTypes.POINTERDOWN:
                if (evt.button === 2) {
                    isRightMouseDown.value = true;
                    evt.preventDefault();
                }
                break;
            case PointerEventTypes.POINTERUP:
                if (evt.button === 2) {
                    isRightMouseDown.value = false;
                }
                break;
        }
    });

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

        if (!isRightMouseDown.value || !camera.value || !props.avatarNode)
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
    if (pointerObserver)
        props.scene.onPointerObservable.remove(pointerObserver);
    const canvas = props.scene.getEngine().getRenderingCanvas();
    if (canvas && contextMenuHandler) {
        try {
            canvas.removeEventListener("contextmenu", contextMenuHandler);
        } catch {}
    }
    camera.value?.dispose();
    camera.value = null;
    if (followTargetMesh) {
        try {
            followTargetMesh.dispose();
        } catch {}
        followTargetMesh = null;
    }
});

defineExpose({ camera });

// no local DOM listener registry needed; using Babylon observables
</script>


