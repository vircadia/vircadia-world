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
    FollowCamera,
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

const camera: Ref<FollowCamera | null> = ref(null);
let beforeRenderObserver: Observer<Scene> | null = null;

const isRightMouseDown = ref(false);
const isLeftMouseDown = ref(false);
let lastPointerX = 0;
let lastPointerY = 0;
let followTargetMesh: AbstractMesh | null = null;

// Interaction sensitivities and limits
const rotateSensitivityDegPerPixel = 0.2;
const heightSensitivityUnitsPerPixel = 0.01;
const zoomSensitivityUnitsPerDelta = 0.01;
const minRadius = 1.2;
const maxRadius = 25;

function getAvatarTargetPosition(): Vector3 | null {
    if (!props.avatarNode) return null;
    const node = props.avatarNode;
    return new Vector3(
        node.position.x,
        node.position.y + props.capsuleHeight / 2,
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
    // Try to use an existing mesh under the node
    const mesh = getAvatarMesh();
    if (mesh) return mesh;
    // Fallback: create a tiny invisible mesh parented to avatarNode so the FollowCamera can lock to it
    if (props.avatarNode && !followTargetMesh) {
        followTargetMesh = MeshBuilder.CreateSphere(
            "avatarFollowTarget",
            { diameter: 0.01, segments: 4 },
            props.scene,
        );
        followTargetMesh.isVisible = false;
        followTargetMesh.isPickable = false;
        followTargetMesh.setParent(props.avatarNode);
        followTargetMesh.position.set(0, props.capsuleHeight / 2, 0);
    }
    return followTargetMesh;
}

function setupCamera(): void {
    if (!props.scene) return;
    const target =
        getAvatarTargetPosition() || new Vector3(0, props.capsuleHeight / 2, 0);
    const cam = new FollowCamera(
        "desktop-third-person-follow",
        target,
        props.scene,
    );
    cam.radius = props.initialRadius;
    cam.heightOffset = props.capsuleHeight * 0.5;
    cam.rotationOffset = props.initialRotationOffset; // degrees
    cam.cameraAcceleration = 0.05; // smoothing
    cam.maxCameraSpeed = 4;
    cam.minZ = 0.1;

    // Lock to avatar when available
    cam.lockedTarget = ensureFollowTarget();

    props.scene.activeCamera = cam;
    camera.value = cam;

    const canvas = props.scene.getEngine().getRenderingCanvas();
    if (!canvas) return;

    // Mouse interaction using VueUse
    const stopPointerDown = useEventListener(
        canvas,
        "pointerdown",
        (e: PointerEvent) => {
            if (e.button === 0) isLeftMouseDown.value = true;
            if (e.button === 2) {
                isRightMouseDown.value = true;
                // Best-effort to avoid context menu
                e.preventDefault();
            }
            lastPointerX = e.clientX;
            lastPointerY = e.clientY;
            // Only attempt capture for primary button if supported
            if (
                e.button === 0 &&
                typeof (canvas as HTMLElement).setPointerCapture === "function"
            ) {
                try {
                    (canvas as HTMLElement).setPointerCapture(e.pointerId);
                } catch {}
            }
        },
    );

    const stopPointerUp = useEventListener(
        canvas,
        "pointerup",
        (e: PointerEvent) => {
            if (e.button === 0) isLeftMouseDown.value = false;
            if (e.button === 2) isRightMouseDown.value = false;
            const el = canvas as HTMLElement & {
                hasPointerCapture?: (id: number) => boolean;
            };
            if (
                e.button === 0 &&
                typeof el.releasePointerCapture === "function" &&
                typeof el.hasPointerCapture === "function" &&
                el.hasPointerCapture(e.pointerId)
            ) {
                try {
                    el.releasePointerCapture(e.pointerId);
                } catch {}
            }
        },
    );

    const stopContextMenu = useEventListener(
        canvas,
        "contextmenu",
        (e: MouseEvent) => {
            e.preventDefault();
        },
    );

    const stopPointerMove = useEventListener(
        canvas,
        "pointermove",
        (e: PointerEvent) => {
            if (!camera.value) return;
            if (!isLeftMouseDown.value && !isRightMouseDown.value) return;
            const dx = e.clientX - lastPointerX;
            const dy = e.clientY - lastPointerY;
            lastPointerX = e.clientX;
            lastPointerY = e.clientY;

            // Horizontal orbit
            camera.value.rotationOffset =
                (camera.value.rotationOffset +
                    dx * rotateSensitivityDegPerPixel) %
                360;
            if (camera.value.rotationOffset < 0)
                camera.value.rotationOffset += 360;

            // Vertical orbit as height adjustment
            const minHeight = 0.1;
            const maxHeight = props.capsuleHeight * 1.5;
            camera.value.heightOffset = Math.min(
                maxHeight,
                Math.max(
                    minHeight,
                    camera.value.heightOffset -
                        dy * heightSensitivityUnitsPerPixel,
                ),
            );
        },
    );

    const stopWheel = useEventListener(
        canvas,
        "wheel",
        (e: WheelEvent) => {
            if (!camera.value) return;
            // Zoom
            camera.value.radius = Math.min(
                maxRadius,
                Math.max(
                    minRadius,
                    camera.value.radius +
                        e.deltaY * zoomSensitivityUnitsPerDelta,
                ),
            );
            e.preventDefault();
        },
        { passive: false },
    );

    // Store stops for cleanup
    cleanupListeners.push(
        stopPointerDown,
        stopPointerUp,
        stopPointerMove,
        stopWheel,
        stopContextMenu,
    );

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


