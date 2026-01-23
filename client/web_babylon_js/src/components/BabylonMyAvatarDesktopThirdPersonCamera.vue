<template></template>

<script setup lang="ts">
import type {
    AbstractMesh,
    Observer,
    Scene,
    TransformNode,
    PhysicsEngine,
} from "@babylonjs/core";
import {
    ArcRotateCamera,
    MeshBuilder,
    Quaternion,
    Vector3,
    Ray,
    PhysicsRaycastResult,
    RayHelper,
    Color3,
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
    // Core ArcRotateCamera tuning
    minZ: { type: Number, required: true },
    lowerRadiusLimit: { type: Number, required: true },
    upperRadiusLimit: { type: Number, required: true },
    lowerBetaLimit: { type: Number, required: true },
    upperBetaLimit: { type: Number, required: true },
    inertia: { type: Number, required: true },
    panningSensibility: { type: Number, required: true },
    wheelPrecision: { type: Number, required: true },
    // FOV-only smoothing
    fovDelta: { type: Number, required: true },
    fovLerpSpeed: { type: Number, required: true },
    // Mouse follow
    mouseLockCameraRotateToggle: { type: Boolean, required: true },
    mouseLockCameraAvatarRotateToggle: { type: Boolean, required: true },
    overrideMouseLockCameraAvatarRotate: { type: Boolean, required: true },
    // Snap Preference
    snapStrategy: { type: String as () => "vertical-first" | "horizontal-first" | "vertical-only", required: false, default: "vertical-only" },
    debug: { type: Boolean, required: false, default: false },
});

// Single Camera
const camera: Ref<ArcRotateCamera | null> = ref(null);

// State Memory: Tracks the "Ideal" user-desired position
// This acts as the "Ghost" state without a second camera
const idealState = ref({
    alpha: props.initialAlpha,
    beta: props.initialBeta,
    radius: props.initialRadius
});

// Tracks the actual render state from the previous frame
// Used to calculate user input deltas
const lastRenderState = ref({
    alpha: props.initialAlpha,
    beta: props.initialBeta,
    radius: props.initialRadius
});

let beforeRenderObserver: Observer<Scene> | null = null;
let contextMenuHandler: ((e: MouseEvent) => void) | null = null;

let followTargetMesh: AbstractMesh | null = null;

// Smoothing
const currentRenderPosition = new Vector3();
const smoothTime = 0.15; // Damping time

// FOV
const fovSmoothed = ref(0);
let baseFov = 0.8;

// Debug
const debugRays = false;

function clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

function getAvatarTargetPosition(): Vector3 | null {
    if (!props.avatarNode) return null;
    const node = props.avatarNode;
    return new Vector3(
        node.absolutePosition.x,
        node.absolutePosition.y + props.capsuleHeight * 0.75, // Chest/Head height
        node.absolutePosition.z,
    );
}

function ensureFollowTarget(): AbstractMesh | null {
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
    followTargetMesh.position.set(0, props.capsuleHeight * 0.75, 0);
    return followTargetMesh;
}

function generateProbeGrid(alpha: number, beta: number, radius: number) {
    const candidates = [];
    candidates.push({ alpha, beta, radius }); // Ideal

    const arcStep = Math.PI / 12;
    const upStep = Math.PI / 16;
    const safeBetaUp = Math.max(0.1, beta - upStep);
    const hasUpAction = Math.abs(safeBetaUp - beta) > 0.01;

    const horizontalCandidates = [
        { alpha: alpha + arcStep, beta, radius },
        { alpha: alpha - arcStep, beta, radius }
    ];

    const verticalCandidates = [];
    if (hasUpAction) {
        verticalCandidates.push({ alpha, beta: safeBetaUp, radius });
    }

    const cornerCandidates = [];
    if (hasUpAction) {
        cornerCandidates.push({ alpha: alpha + arcStep, beta: safeBetaUp, radius });
        cornerCandidates.push({ alpha: alpha - arcStep, beta: safeBetaUp, radius });
    }

    if (props.snapStrategy === "vertical-only") {
        candidates.push(...verticalCandidates);
        // implicit: no horizontal or corner candidates
    } else if (props.snapStrategy === "vertical-first") {
        candidates.push(...verticalCandidates);
        candidates.push(...horizontalCandidates);
        candidates.push(...cornerCandidates);
    } else {
        candidates.push(...horizontalCandidates);
        candidates.push(...verticalCandidates);
        candidates.push(...cornerCandidates);
    }

    return candidates;
}

function checkVisibility(from: Vector3, to: Vector3, scene: Scene) {
    const engine = scene.getPhysicsEngine();
    if (!engine) return { hasHit: false, hitPoint: null };

    const direction = to.subtract(from);
    const length = direction.length();
    direction.normalize();

    // Raycast
    const raycastResult = engine.raycast(from, to, { collideWith: 1 });

    if (raycastResult.hasHit) {
        const hitDist = raycastResult.hitPoint.subtract(from).length();
        if (hitDist < 0.5) return { hasHit: false, hitPoint: null }; // Self-collision check
        if (hitDist < length - 0.2) return { hasHit: true, hitPoint: raycastResult.hitPoint };
    }
    return { hasHit: false, hitPoint: null };
}

function setupCamera(): void {
    if (!props.scene) return;

    // Standard ArcRotateCamera
    const cam = new ArcRotateCamera(
        "desktop-third-person-arc-rotate",
        props.initialAlpha,
        props.initialBeta,
        props.initialRadius,
        new Vector3(0, 0, 0),
        props.scene,
    );

    cam.minZ = props.minZ;
    cam.lowerRadiusLimit = props.lowerRadiusLimit;
    cam.upperRadiusLimit = props.upperRadiusLimit;
    cam.lowerBetaLimit = props.lowerBetaLimit;
    cam.upperBetaLimit = props.upperBetaLimit;
    cam.inertia = props.inertia;
    cam.panningSensibility = 0;
    cam.wheelPrecision = props.wheelPrecision;
    cam.checkCollisions = false;

    // Attach Control
    const canvas = props.scene.getEngine().getRenderingCanvas();
    if (canvas) cam.attachControl(canvas, true);

    props.scene.activeCamera = cam;
    camera.value = cam;

    baseFov = cam.fov;

    followTargetMesh = ensureFollowTarget();
    if (followTargetMesh) cam.lockedTarget = followTargetMesh;

    // Initialize State
    idealState.value = {
        alpha: cam.alpha,
        beta: cam.beta,
        radius: cam.radius
    };
    lastRenderState.value = { ...idealState.value };

    // Detach others
    for (const c of props.scene.cameras) {
        if (c !== cam && typeof (c as any).detachControl === "function") {
            (c as any).detachControl();
        }
    }

    contextMenuHandler = (e) => e.preventDefault();
    canvas?.addEventListener("contextmenu", contextMenuHandler);

    beforeRenderObserver = props.scene.onBeforeRenderObservable.add(() => {
        if (!camera.value || !props.avatarNode) return;
        const dt = props.scene.getEngine().getDeltaTime() / 1000;

        // 1. Capture User Input (Delta)
        // The camera may have been moved by the user since the last frame
        // But it was ALSO potentially moved by our collision logic last frame.
        // We compare Current vs Last Render to get the TRUE delta.
        // Wait: ArcRotateCamera inputs modify alpha/beta/radius directly.
        // So `camera.alpha` (now) = `lastRenderAlpha` (set by us frame -1) + `userDelta` (input).
        // Therefore: `userDelta = camera.alpha - lastRenderState.alpha`.

        const deltaAlpha = camera.value.alpha - lastRenderState.value.alpha;
        const deltaBeta = camera.value.beta - lastRenderState.value.beta;
        const deltaRadius = camera.value.radius - lastRenderState.value.radius;

        const hasInput = Math.abs(deltaAlpha) > 1e-4 || Math.abs(deltaBeta) > 1e-4 || Math.abs(deltaRadius) > 1e-4;

        // Check if the visual camera was displaced from the ideal state (snapped/collision)
        // We check if the previous Frame's Render State (which was the result of collision logic)
        // deviated significantly from the Ideal State.
        const distAlpha = Math.abs(lastRenderState.value.alpha - idealState.value.alpha);
        const distBeta = Math.abs(lastRenderState.value.beta - idealState.value.beta);
        const distRadius = Math.abs(lastRenderState.value.radius - idealState.value.radius);

        const isDisplaced = distAlpha > 0.01 || distBeta > 0.01 || distRadius > 0.1;

        // Standard accumulation - Always track user input into Ideal State
        // This ensures that if we are "Squashed" by a wall, we remember the
        // original distance and return to it when the wall is gone.
        idealState.value.alpha += deltaAlpha;
        idealState.value.beta += deltaBeta;
        idealState.value.radius += deltaRadius;

        // Clamp Ideal Radius/Beta to limits (so it doesn't drift infinitely)
        // Note: ArcRotateCamera has limits, but we are accumulating deltas, so we should respect them.
        // Ideally we read limits from camera
        idealState.value.radius = clamp(idealState.value.radius, props.lowerRadiusLimit, props.upperRadiusLimit);
        idealState.value.beta = clamp(idealState.value.beta, props.lowerBetaLimit, props.upperBetaLimit);

        // 3. Collision Logic (on Ideal State)
        const targetPos = followTargetMesh ? followTargetMesh.absolutePosition : getAvatarTargetPosition();
        if (!targetPos) return;

        const candidates = generateProbeGrid(idealState.value.alpha, idealState.value.beta, idealState.value.radius);
        let bestCandidate = candidates[0]; // Default to ideal
        let bestPos = null;

        if (props.debug) {
            clearDebugVisuals();
            // Draw Ideal Line (Blue)
            if (targetPos) {
                const idealPos = targetPos.add(new Vector3(
                    idealState.value.radius * Math.sin(idealState.value.beta) * Math.cos(idealState.value.alpha),
                    idealState.value.radius * Math.cos(idealState.value.beta),
                    idealState.value.radius * Math.sin(idealState.value.beta) * Math.sin(idealState.value.alpha)
                ));
                drawDebugRay(targetPos, idealPos, new Color3(0, 0, 1), props.scene);
            }
        }

        for (const cand of candidates) {
            // Compute Cartesian
            // Standard Spherical -> Cartesian
            // Babylon: Alpha (Y rot), Beta (X rot from Y axis)
            const x = cand.radius * Math.sin(cand.beta) * Math.cos(cand.alpha);
            const z = cand.radius * Math.sin(cand.beta) * Math.sin(cand.alpha);
            const y = cand.radius * Math.cos(cand.beta);

            const pos = targetPos.add(new Vector3(x, y, z));
            const vis = checkVisibility(targetPos, pos, props.scene);

            if (props.debug) {
                // Visualize Candidate
                // Red if blocked, Green if clear
                const color = !vis.hasHit ? new Color3(0, 1, 0) : new Color3(1, 0, 0);
                drawDebugRay(targetPos, pos, color, props.scene);
            }

            if (!vis.hasHit) {
                bestPos = pos;
                bestCandidate = cand;
                break;
            }
        }

        // Fallback: Zoom In
        if (!bestPos) {
            const center = candidates[0];
            const x = Math.sin(center.beta) * Math.cos(center.alpha);
            const z = Math.sin(center.beta) * Math.sin(center.alpha);
            const y = Math.cos(center.beta);
            const dir = new Vector3(x, y, z).normalize();

            // Raycast on center line
            const fullPos = targetPos.add(dir.scale(center.radius));
            const vis = checkVisibility(targetPos, fullPos, props.scene);
            if (vis.hasHit && vis.hitPoint) {
                const dist = vis.hitPoint.subtract(targetPos).length();
                const safe = Math.max(0.5, dist - 0.2);
                bestPos = targetPos.add(dir.scale(safe));
                // We must update the candidate radius for correct alpha/beta syncing
                bestCandidate = { ...center, radius: safe };
            } else {
                bestPos = fullPos;
            }
        }

        if (props.debug && bestPos) {
            // Draw Snapped Choice (Yellow)
            drawDebugRay(targetPos, bestPos, new Color3(1, 1, 0), props.scene);
        }

        // 4. Smooth & Apply
        // We want to smooth the *Visual* transition, but we must set the camera's state precisely
        // so `setPosition` works.
        // Actually, ArcRotateCamera is tricky: if we setPosition, it updates alpha/beta/radius.
        // This is what we want for rendering.
        // But next frame, we rely on `camera.alpha` being the starting point.
        // This works perfectly: `camera.alpha` will be `bestPos`'s alpha.
        // And `lastRenderState` will be `bestPos`'s alpha.
        // So `delta` will successfully be 0 if user doesn't move.
        // If user moves, `camera.alpha` changes by Input.

        // Wait, smoothing might interfere.
        // If we lerp the position, the updated `camera.alpha` will be the lerped value.
        // That's fine, as long as `lastRenderState` records that lerped value.
        // The delta will still be correct relative to what was rendered `t-1`.

        if (currentRenderPosition.lengthSquared() < 0.1) currentRenderPosition.copyFrom(bestPos);

        const distToTarget = Vector3.Distance(currentRenderPosition, bestPos);
        const isColliding = distToTarget > 0.5 && bestPos.subtract(targetPos).length() < idealState.value.radius - 0.5;
        const t = 1.0 - Math.pow(0.01, dt / (isColliding ? 0.05 : 0.3)); // Fast snap on collide, smooth recover

        currentRenderPosition.copyFrom(Vector3.Lerp(currentRenderPosition, bestPos, t));

        // Force Camera to Render Position
        camera.value.setPosition(currentRenderPosition);

        // 5. Store Render State for Next Frame
        lastRenderState.value = {
            alpha: camera.value.alpha,
            beta: camera.value.beta,
            radius: camera.value.radius
        };

        // FOV Smoothing
        const k = clamp(props.fovLerpSpeed, 0.1, 30);
        const ft = 1 - Math.exp(-k * dt);
        const targetDelta = clamp(Math.abs(props.fovDelta), 0, 0.12);
        fovSmoothed.value = fovSmoothed.value + (targetDelta - fovSmoothed.value) * ft;
        camera.value.fov = clamp(baseFov + fovSmoothed.value, 0.1, Math.PI - 0.1);

        // Avatar Rotation
        if (!props.mouseLockCameraAvatarRotateToggle || props.overrideMouseLockCameraAvatarRotate) return;
        const lookDir = props.avatarNode.position.subtract(camera.value.position).normalize();
        lookDir.y = 0;
        if (lookDir.lengthSquared() > 1e-6) {
            const yaw = Math.atan2(lookDir.x, lookDir.z);
            props.avatarNode.rotationQuaternion = Quaternion.FromEulerAngles(0, yaw, 0);
            props.avatarNode.computeWorldMatrix(true);
        }
    });
}

// Debug Visuals
const rayLines: Array<{ dispose: () => void }> = [];
const debugCamera: Ref<ArcRotateCamera | null> = ref(null);

function clearDebugVisuals() {
    rayLines.forEach((r) => r.dispose());
    rayLines.length = 0;
}

function drawDebugRay(from: Vector3, to: Vector3, color: Color3, scene: Scene) {
    const points = [from, to];
    const line = MeshBuilder.CreateLines("debugRay", { points }, scene);
    line.color = color;
    rayLines.push(line);
}

function updateDebugMode() {
    if (!props.scene) return;

    if (props.debug) {
        // Enable Debug: Switch to Free Camera
        if (!debugCamera.value) {
            // Create a free camera at a high vantage point
            const freeCam = new ArcRotateCamera(
                "debug-free-camera",
                camera.value?.alpha ?? 0,
                (camera.value?.beta ?? Math.PI / 3) - 0.5,
                (camera.value?.radius ?? 10) + 10,
                camera.value?.target ?? Vector3.Zero(),
                props.scene
            );
            freeCam.attachControl(props.scene.getEngine().getRenderingCanvas(), true);
            debugCamera.value = freeCam;
            props.scene.activeCamera = freeCam;

            // Detach main camera control
            camera.value?.detachControl();
        }
    } else {
        // Disable Debug: Restore Main Camera
        if (debugCamera.value) {
            debugCamera.value.dispose();
            debugCamera.value = null;
        }
        if (camera.value) {
            props.scene.activeCamera = camera.value;
            camera.value.attachControl(props.scene.getEngine().getRenderingCanvas(), true);
        }
        clearDebugVisuals();
    }
}

watch(() => props.debug, updateDebugMode);

onMounted(() => {
    setupCamera();
    updateDebugMode();
});

watch(() => props.avatarNode, () => {
    if (camera.value) camera.value.lockedTarget = ensureFollowTarget();
});

onUnmounted(() => {
    if (beforeRenderObserver) props.scene.onBeforeRenderObservable.remove(beforeRenderObserver);
    const canvas = props.scene.getEngine().getRenderingCanvas();
    if (canvas && contextMenuHandler) canvas.removeEventListener("contextmenu", contextMenuHandler);

    camera.value?.dispose();
    debugCamera.value?.dispose();
    clearDebugVisuals();
    followTargetMesh?.dispose();
});

defineExpose({ camera });

</script>
