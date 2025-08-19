<template></template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import type { Ref } from "vue";
import { useEventListener } from "@vueuse/core";
import type {
    Scene,
    Observer,
    TransformNode,
    AbstractMesh,
} from "@babylonjs/core";
import {
    ArcRotateCamera,
    Vector3,
    Quaternion,
    Mesh,
    MeshBuilder,
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

function getAvatarMesh(): AbstractMesh | null {
    const node = props.avatarNode;
    if (!node) return null;
    if (node instanceof Mesh) return node as AbstractMesh;
    // Prefer the physics capsule if present
    const meshes = (node as TransformNode).getChildMeshes(
        true,
    ) as AbstractMesh[];
    const capsule = meshes.find((m) => m.name === "avatarCapsule");
    if (capsule) return capsule;
    // Try to resolve a child mesh (first one)
    return meshes.length > 0 ? meshes[0] : null;
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

    // Minimal RMB handling for "face camera" behavior and to suppress context menu
    const stopPointerDown = useEventListener(
        canvas,
        "pointerdown",
        (e: PointerEvent) => {
            if (e.button === 2) {
                isRightMouseDown.value = true;
                e.preventDefault();
            }
        },
    );
    const stopPointerUp = useEventListener(
        canvas,
        "pointerup",
        (e: PointerEvent) => {
            if (e.button === 2) isRightMouseDown.value = false;
        },
    );
    const stopContextMenu = useEventListener(
        canvas,
        "contextmenu",
        (e: MouseEvent) => {
            e.preventDefault();
        },
    );

    cleanupListeners.push(stopPointerDown, stopPointerUp, stopContextMenu);

    // Before render: ensure lockedTarget is resolved; RMB yaw to face camera
    beforeRenderObserver = props.scene.onBeforeRenderObservable.add(() => {
        if (camera.value && !camera.value.lockedTarget && props.avatarNode) {
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
    camera.value?.dispose();
    camera.value = null;
    for (const stop of cleanupListeners) {
        try {
            stop();
        } catch {}
    }
    if (followTargetMesh) {
        try {
            followTargetMesh.dispose();
        } catch {}
        followTargetMesh = null;
    }
});

defineExpose({ camera });

// Local listener cleanup registry
const cleanupListeners: (() => void)[] = [];
</script>


