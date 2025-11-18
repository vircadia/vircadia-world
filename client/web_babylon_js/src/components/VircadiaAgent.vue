<template>
    <!-- Renderless agent component -->
</template>

<script setup lang="ts">
import {
    Color3,
    Matrix,
    Mesh,
    MeshBuilder,
    type Observer,
    PhysicsCharacterController,
    PhysicsShapeCapsule,
    Quaternion,
    type Scene,
    StandardMaterial,
    TransformNode,
    Vector3,
} from "@babylonjs/core";
import { onMounted, onUnmounted, type Ref, ref } from "vue";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";

const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
    vircadiaWorld: {
        type: Object as () => VircadiaWorldInstance,
        required: true,
    },
    avatarNode: {
        type: Object as () => TransformNode | null,
        required: false,
        default: null,
    },
    physicsEnabled: { type: Boolean, required: true },
    physicsPluginName: { type: String, required: false, default: "" },
    gravity: {
        type: Array as unknown as () => [number, number, number],
        required: true,
    },
    // Desired follow offset in the AVATAR'S local space (x, y, z)
    followOffset: {
        type: Array as unknown as () => [number, number, number],
        required: true,
    },
    maxSpeed: { type: Number, required: true },
    // Talk state (from MainScene via BabylonTalkLevel slot)
    isTalking: { type: Boolean, required: true },
    talkLevel: { type: Number, required: true },
    talkThreshold: { type: Number, required: true },
    // Agent capabilities (from VircadiaCloudInferenceProvider)
    agentSttEnabled: { type: Boolean, required: true },
    agentTtsEnabled: { type: Boolean, required: true },
    agentLlmEnabled: { type: Boolean, required: true },
    // Agent working states (actively processing)
    agentSttWorking: { type: Boolean, required: true },
    agentTtsWorking: { type: Boolean, required: true },
    agentLlmWorking: { type: Boolean, required: true },
});

// Node and controller
const agentRoot: Ref<TransformNode | null> = ref(null);
const characterController: Ref<PhysicsCharacterController | null> = ref(null);
const capsuleMesh: Ref<Mesh | null> = ref(null);
// Materials to drive visual talk glow
const eyeMaterial: Ref<StandardMaterial | null> = ref(null);
const pupilMaterial: Ref<StandardMaterial | null> = ref(null);
const bottomGlowMaterial: Ref<StandardMaterial | null> = ref(null);
// Capability status indicators (billboarded discs above agent)
const sttStatusMesh: Ref<Mesh | null> = ref(null);
const ttsStatusMesh: Ref<Mesh | null> = ref(null);
const llmStatusMesh: Ref<Mesh | null> = ref(null);
const sttStatusMaterial: Ref<StandardMaterial | null> = ref(null);
const ttsStatusMaterial: Ref<StandardMaterial | null> = ref(null);
const llmStatusMaterial: Ref<StandardMaterial | null> = ref(null);
// Simple hover effect
let hoverPhase = 0;
// Wave bounce animation phase
let wavePhase = 0;

const STATUS_INDICATOR_Y = -0.8;
const FOLLOW_SNAP_DISTANCE = 4.0;
const FOLLOW_SNAP_DISTANCE_SQ = FOLLOW_SNAP_DISTANCE * FOLLOW_SNAP_DISTANCE;
const VERTICAL_SPEED_MULTIPLIER = 1.5; // Allow faster vertical movement to keep up with height changes

function createAgentGeometry(scene: Scene, root: TransformNode): void {
    // Body (extruded rounded square for rounded square-like form)
    function getRoundedSquareShape(
        side: number,
        cornerRadius: number,
        cornerSegments: number,
    ): Vector3[] {
        const path: Vector3[] = [];
        const h = side / 2;
        const r = cornerRadius;
        const l = h - r;
        // Bottom line
        path.push(new Vector3(-l, -h, 0));
        path.push(new Vector3(l, -h, 0));
        // Bottom right arc
        for (let i = 0; i <= cornerSegments; i++) {
            const angle = Math.PI * 1.5 + ((Math.PI / 2) * i) / cornerSegments;
            path.push(
                new Vector3(
                    l + r * Math.cos(angle),
                    -l + r * Math.sin(angle),
                    0,
                ),
            );
        }
        // Right line
        path.push(new Vector3(h, -l, 0));
        path.push(new Vector3(h, l, 0));
        // Top right arc
        for (let i = 0; i <= cornerSegments; i++) {
            const angle = 0 + ((Math.PI / 2) * i) / cornerSegments;
            path.push(
                new Vector3(
                    l + r * Math.cos(angle),
                    l + r * Math.sin(angle),
                    0,
                ),
            );
        }
        // Top line
        path.push(new Vector3(l, h, 0));
        path.push(new Vector3(-l, h, 0));
        // Top left arc
        for (let i = 0; i <= cornerSegments; i++) {
            const angle = Math.PI / 2 + ((Math.PI / 2) * i) / cornerSegments;
            path.push(
                new Vector3(
                    -l + r * Math.cos(angle),
                    l + r * Math.sin(angle),
                    0,
                ),
            );
        }
        // Left line
        path.push(new Vector3(-h, l, 0));
        path.push(new Vector3(-h, -l, 0));
        // Bottom left arc
        for (let i = 0; i <= cornerSegments; i++) {
            const angle = Math.PI + ((Math.PI / 2) * i) / cornerSegments;
            path.push(
                new Vector3(
                    -l + r * Math.cos(angle),
                    -l + r * Math.sin(angle),
                    0,
                ),
            );
        }
        // Close
        path.push(new Vector3(-l, -h, 0));
        return path;
    }

    const side = 0.15; // half size
    const cornerRadius = 0.02;
    const cornerSegments = 8;
    const depth = 0.15; // half size for cube-like, but extruded along z
    const shape = getRoundedSquareShape(side, cornerRadius, cornerSegments);
    const extrudePath = [
        new Vector3(0, 0, -depth / 2),
        new Vector3(0, 0, depth / 2),
    ];

    const body = MeshBuilder.ExtrudeShape(
        "agentBody",
        {
            shape,
            path: extrudePath,
            cap: Mesh.CAP_ALL,
            sideOrientation: Mesh.DOUBLESIDE,
        },
        scene,
    );
    body.position.y = 0; // centered
    const bodyMat = new StandardMaterial("agentBodyMat", scene);
    bodyMat.diffuseColor = new Color3(0.85, 0.85, 0.9); // brighter silver with slight blue tint
    bodyMat.specularColor = new Color3(0.95, 0.95, 1.0); // silver specular for metallic sheen
    body.material = bodyMat;
    body.setParent(root);

    // Attachments (scaled to half, adjusted for new body)
    const finLeft = MeshBuilder.CreateBox(
        "finLeft",
        { width: 0.025, height: 0.1, depth: 0.1 },
        scene,
    );
    finLeft.position = new Vector3(-0.085, 0, 0);
    finLeft.material = bodyMat;
    finLeft.setParent(root);

    const finRight = MeshBuilder.CreateBox(
        "finRight",
        { width: 0.025, height: 0.1, depth: 0.1 },
        scene,
    );
    finRight.position = new Vector3(0.085, 0, 0);
    finRight.material = bodyMat;
    finRight.setParent(root);

    const topExtension = MeshBuilder.CreateCylinder(
        "topExtension",
        { height: 0.02, diameter: 0.025 },
        scene,
    );
    topExtension.position = new Vector3(0, 0.1, 0);
    topExtension.material = bodyMat;
    topExtension.setParent(root);

    const bottomExtension = MeshBuilder.CreateCylinder(
        "bottomExtension",
        { height: 0.02, diameter: 0.025 },
        scene,
    );
    bottomExtension.position = new Vector3(0, -0.1, 0);
    bottomExtension.material = bodyMat;
    bottomExtension.setParent(root);

    // Eye (glowing disc with added detail: outer ring and inner pupil for more complexity)
    const eye = MeshBuilder.CreateDisc(
        "agentEye",
        { radius: 0.04, tessellation: 32 },
        scene,
    );
    eye.position = new Vector3(0, 0, 0.0755); // slightly protruding from front surface
    eye.rotation.y = 180 * Math.PI / 180; // adjusted orientation to face forward properly
    const eyeMat = new StandardMaterial("agentEyeMat", scene);
    eyeMat.emissiveColor = new Color3(0.1, 0.4, 0.8); // glowing blue, adjustable for "talking" (e.g., animate intensity or color)
    eyeMat.diffuseColor = new Color3(0, 0, 0); // no diffuse to emphasize glow
    eye.material = eyeMat;
    eye.setParent(root);
    eyeMaterial.value = eyeMat;

    // Eye ring (metallic border for added detail)
    const eyeRing = MeshBuilder.CreateTorus(
        "eyeRing",
        { diameter: 0.1, thickness: 0.01, tessellation: 32 },
        scene,
    );
    eyeRing.position = new Vector3(0, 0, 0.075);
    eyeRing.rotation.x = Math.PI / 2; // adjusted to align properly
    eyeRing.material = bodyMat;
    eyeRing.setParent(eye);

    // Pupil (smaller inner glow for detailed "eye" effect, can animate scale/color for talking)
    const pupil = MeshBuilder.CreateDisc(
        "pupil",
        { radius: 0.015, tessellation: 32 },
        scene,
    );
    pupil.position = new Vector3(0, 0, 0.076); // slightly in front of eye
    pupil.rotation.x = 180 * Math.PI / 180; // adjusted orientation
    const pupilMat = new StandardMaterial("pupilMat", scene);
    pupilMat.emissiveColor = new Color3(1, 1, 1); // bright white center, adjustable
    pupilMat.diffuseColor = new Color3(0, 0, 0);
    pupil.material = pupilMat;
    pupil.setParent(eye);
    pupilMaterial.value = pupilMat;

    // Optional bottom glow (for floating effect, though not canon, kept for simplicity)
    const bottomGlow = MeshBuilder.CreateDisc(
        "bottomGlow",
        { radius: 0.06, tessellation: 32 },
        scene,
    );
    bottomGlow.position = new Vector3(0, -0.075, 0);
    bottomGlow.rotation.x = Math.PI / 2; // flat on bottom
    const glowMat = new StandardMaterial("glowMat", scene);
    glowMat.emissiveColor = new Color3(0.1, 0.4, 0.8);
    glowMat.alpha = 0.7; // semi-transparent
    glowMat.diffuseColor = new Color3(0, 0, 0);
    bottomGlow.material = glowMat;
    bottomGlow.setParent(root);
    bottomGlowMaterial.value = glowMat;

    // Capability status indicators (floating above agent head)
    const statusRadius = 0.02;
    const statusOffsetX = 0.06; // Spread horizontally

    // STT indicator (microphone icon area)
    const sttStatus = MeshBuilder.CreateSphere("sttStatus", { diameter: statusRadius * 2, segments: 16 }, scene);
    sttStatus.position = new Vector3(-statusOffsetX, STATUS_INDICATOR_Y, 0.06);
    const sttMat = new StandardMaterial("sttStatusMat", scene);
    sttMat.emissiveColor = new Color3(0.9, 0.5, 0.2); // Orange
    sttMat.diffuseColor = new Color3(0, 0, 0);
    sttStatus.material = sttMat;
    sttStatus.setParent(root);
    sttStatusMesh.value = sttStatus;
    sttStatusMaterial.value = sttMat;

    // TTS indicator (speaker icon area)
    const ttsStatus = MeshBuilder.CreateSphere("ttsStatus", { diameter: statusRadius * 2, segments: 16 }, scene);
    ttsStatus.position = new Vector3(0, STATUS_INDICATOR_Y, 0.06);
    const ttsMat = new StandardMaterial("ttsStatusMat", scene);
    ttsMat.emissiveColor = new Color3(0.2, 0.9, 0.5); // Green
    ttsMat.diffuseColor = new Color3(0, 0, 0);
    ttsStatus.material = ttsMat;
    ttsStatus.setParent(root);
    ttsStatusMesh.value = ttsStatus;
    ttsStatusMaterial.value = ttsMat;

    // LLM indicator (brain icon area)
    const llmStatus = MeshBuilder.CreateSphere("llmStatus", { diameter: statusRadius * 2, segments: 16 }, scene);
    llmStatus.position = new Vector3(statusOffsetX, STATUS_INDICATOR_Y, 0.06);
    const llmMat = new StandardMaterial("llmStatusMat", scene);
    llmMat.emissiveColor = new Color3(0.5, 0.2, 0.9); // Purple
    llmMat.diffuseColor = new Color3(0, 0, 0);
    llmStatus.material = llmMat;
    llmStatus.setParent(root);
    llmStatusMesh.value = llmStatus;
    llmStatusMaterial.value = llmMat;
}

function getAgentPosition(): Vector3 | undefined {
    return characterController.value?.getPosition();
}

function setAgentVelocity(v: Vector3): void {
    characterController.value?.setVelocity(v);
}

function ensureController(scene: Scene, startPos: Vector3): void {
    if (!props.physicsEnabled || characterController.value) return;

    try {
        // Build a lightweight hidden capsule for the physics shape - half size
        const capsule = MeshBuilder.CreateCapsule(
            "agentCapsule",
            { height: 0.5, radius: 0.175, tessellation: 8 },
            scene,
        );
        capsule.isVisible = false;
        capsuleMesh.value = capsule;
        const physicsShape = PhysicsShapeCapsule.FromMesh(capsule);

        characterController.value = new PhysicsCharacterController(
            startPos.clone(),
            { shape: physicsShape, capsuleHeight: 0.5, capsuleRadius: 0.175 },
            scene,
        );

        // Floating robot – disable gravity effects by using zero gravity on integrate
        characterController.value.maxCastIterations = 10;
        characterController.value.keepContactTolerance = 0.1;
        characterController.value.keepDistance = 0.05;
        characterController.value.acceleration = 2.0;
        characterController.value.maxAcceleration = 8.0;
        characterController.value.maxCharacterSpeedForSolver = 10.0;
        characterController.value.staticFriction = 0.0;
        characterController.value.dynamicFriction = 0.2;
    } catch (e) {
        console.error(
            "[VircadiaAgent] Failed to create character controller",
            e,
        );
    }
}

function computeFollowTarget(): {
    position: Vector3;
    orientation: Quaternion;
} | null {
    const avatar = props.avatarNode;
    if (!avatar) return null;
    const offset = new Vector3(
        props.followOffset[0],
        props.followOffset[1],
        props.followOffset[2],
    );
    const rot = avatar.rotationQuaternion ?? Quaternion.Identity();
    const m = new Matrix();
    rot.toRotationMatrix(m);
    const worldOffset = Vector3.TransformCoordinates(offset, m);
    const pos = avatar.position.add(worldOffset);
    return { position: pos, orientation: rot };
}

let beforeObs: Observer<Scene> | null = null;
let afterObs: Observer<Scene> | null = null;
let avatarCheckInterval: ReturnType<typeof setInterval> | null = null;
let sceneDisposeObs: Observer<Scene> | null = null;
// Smoothed talk-driven glow intensity
let smoothedGlow = 0.25;

function disposeAgent(): void {
    const scene = props.scene;

    // Remove observers
    try {
        if (beforeObs && scene?.onBeforeRenderObservable?.remove) {
            scene.onBeforeRenderObservable.remove(beforeObs);
        }
    } catch {
        /* no-op */
    }
    beforeObs = null;
    try {
        if (afterObs && scene?.onAfterRenderObservable?.remove) {
            scene.onAfterRenderObservable.remove(afterObs);
        }
    } catch {
        /* no-op */
    }
    afterObs = null;

    // Remove scene dispose observer
    try {
        if (sceneDisposeObs && scene?.onDisposeObservable?.remove) {
            scene.onDisposeObservable.remove(sceneDisposeObs);
        }
    } catch {
        /* no-op */
    }
    sceneDisposeObs = null;

    // Clear interval
    if (avatarCheckInterval) {
        clearInterval(avatarCheckInterval);
        avatarCheckInterval = null;
    }

    // Dispose physics controller (if it supports dispose)
    try {
        // @ts-expect-error optional dispose
        characterController.value?.dispose?.();
    } catch {
        /* no-op */
    }
    characterController.value = null;

    // Dispose capsule mesh
    try {
        capsuleMesh.value?.dispose();
    } catch {
        /* no-op */
    }
    capsuleMesh.value = null;

    // Dispose status indicators
    try {
        sttStatusMesh.value?.dispose();
    } catch {
        /* no-op */
    }
    sttStatusMesh.value = null;
    try {
        ttsStatusMesh.value?.dispose();
    } catch {
        /* no-op */
    }
    ttsStatusMesh.value = null;
    try {
        llmStatusMesh.value?.dispose();
    } catch {
        /* no-op */
    }
    llmStatusMesh.value = null;

    // Dispose agent root and children
    try {
        agentRoot.value?.dispose(false, true);
    } catch {
        /* no-op */
    }
    agentRoot.value = null;
}

function initAgent(scene: Scene | null | undefined): void {
    if (!scene) return;

    const root = new TransformNode("VircadiaAgent", scene);
    agentRoot.value = root;
    // Start near the avatar if available, otherwise wait for avatar to be available
    const start = computeFollowTarget()?.position ?? new Vector3(0, 1, 0);
    root.position = start.clone();
    root.rotationQuaternion = Quaternion.Identity();

    createAgentGeometry(scene, root);

    // If avatarNode was not available initially, update position when it becomes available
    if (!props.avatarNode) {
        avatarCheckInterval = setInterval(() => {
            if (props.avatarNode) {
                const target = computeFollowTarget();
                if (target) {
                    root.position = target.position.clone();
                }
                if (avatarCheckInterval) {
                    clearInterval(avatarCheckInterval);
                    avatarCheckInterval = null;
                }
            }
        }, 100);
    }

    // Hook frame updates
    let lastT = performance.now();
    beforeObs = scene.onBeforeRenderObservable.add(() => {
        const now = performance.now();
        const dt = (now - lastT) / 1000.0;
        lastT = now;

        // Ensure controller lazily once physics is available
        // Wait for avatarNode to be available before creating controller
        if (
            !characterController.value &&
            props.physicsEnabled &&
            props.avatarNode
        ) {
            const initialTarget = computeFollowTarget();
            const startPos = initialTarget?.position ?? root.position;
            ensureController(scene, startPos);
        }

        // Desired follow target
        const target = computeFollowTarget();
        if (!target) return;

        // Hover animation (visual only)
        hoverPhase += dt * 2.0;
        const hover = Math.sin(hoverPhase) * 0.03;

        // Talk-level driven emissive intensity
        const talkingActive = props.isTalking || props.talkLevel >= props.talkThreshold;
        const targetGlow = talkingActive ? Math.min(2.5, 0.25 + props.talkLevel * 6.0) : 0.25;
        const lerpRate = Math.min(1, dt * 8.0);
        smoothedGlow += (targetGlow - smoothedGlow) * lerpRate;
        if (eyeMaterial.value) {
            const base = new Color3(0.1, 0.4, 0.8);
            eyeMaterial.value.emissiveColor = base.scale(smoothedGlow);
        }
        if (pupilMaterial.value) {
            const basePupil = new Color3(1, 1, 1);
            pupilMaterial.value.emissiveColor = basePupil.scale(Math.min(2.2, smoothedGlow * 1.4));
        }
        if (bottomGlowMaterial.value) {
            const baseGlow = new Color3(0.1, 0.4, 0.8);
            bottomGlowMaterial.value.emissiveColor = baseGlow.scale(Math.min(2.0, smoothedGlow));
        }

        // Update capability status indicators
        const isLlmOrTtsWorking = props.agentLlmWorking || props.agentTtsWorking;
        if (isLlmOrTtsWorking) {
            wavePhase += dt * 8.0; // Wave animation speed
        } else {
            wavePhase = 0; // Reset phase when not working
        }

        if (sttStatusMaterial.value) {
            const enabled = props.agentSttEnabled;
            sttStatusMaterial.value.emissiveColor = enabled ? new Color3(0.9, 0.5, 0.2) : new Color3(0.3, 0.3, 0.3);
            sttStatusMaterial.value.alpha = enabled ? 1.0 : 0.3;
        }
        if (ttsStatusMaterial.value) {
            const enabled = props.agentTtsEnabled;
            ttsStatusMaterial.value.emissiveColor = enabled ? new Color3(0.2, 0.9, 0.5) : new Color3(0.3, 0.3, 0.3);
            ttsStatusMaterial.value.alpha = enabled ? 1.0 : 0.3;
        }
        if (llmStatusMaterial.value) {
            const enabled = props.agentLlmEnabled;
            llmStatusMaterial.value.emissiveColor = enabled ? new Color3(0.5, 0.2, 0.9) : new Color3(0.3, 0.3, 0.3);
            llmStatusMaterial.value.alpha = enabled ? 1.0 : 0.3;
        }

        // Wave bounce animation for status indicators when LLM or TTS is working
        if (isLlmOrTtsWorking && agentRoot.value) {
            const bounceAmount = 0.05;
            const waveOffset = Math.PI * 2 / 3; // 120 degrees between each indicator

            // STT indicator bounce (left)
            if (sttStatusMesh.value) {
                const bounce = Math.sin(wavePhase + waveOffset * 0) * bounceAmount;
                sttStatusMesh.value.position.y = STATUS_INDICATOR_Y + bounce;
            }

            // TTS indicator bounce (center)
            if (ttsStatusMesh.value) {
                const bounce = Math.sin(wavePhase + waveOffset * 1) * bounceAmount;
                ttsStatusMesh.value.position.y = STATUS_INDICATOR_Y + bounce;
            }

            // LLM indicator bounce (right)
            if (llmStatusMesh.value) {
                const bounce = Math.sin(wavePhase + waveOffset * 2) * bounceAmount;
                llmStatusMesh.value.position.y = STATUS_INDICATOR_Y + bounce;
            }
        } else {
            // Reset positions when not bouncing
            if (sttStatusMesh.value) sttStatusMesh.value.position.y = STATUS_INDICATOR_Y;
            if (ttsStatusMesh.value) ttsStatusMesh.value.position.y = STATUS_INDICATOR_Y;
            if (llmStatusMesh.value) llmStatusMesh.value.position.y = STATUS_INDICATOR_Y;
        }

        const desiredPos = target.position.add(new Vector3(0, hover, 0));
        const currentPos = characterController.value
            ? getAgentPosition() ?? root.position
            : root.position;
        const followError = desiredPos.subtract(currentPos);

        if (followError.lengthSquared() > FOLLOW_SNAP_DISTANCE_SQ) {
            if (characterController.value) {
                const controller = characterController.value as PhysicsCharacterController & {
                    setPosition?: (pos: Vector3) => void;
                };
                controller.setPosition?.(desiredPos);
                setAgentVelocity(Vector3.Zero());
            }
            root.position = desiredPos.clone();
            root.rotationQuaternion = target.orientation.clone();
            return;
        }

        if (characterController.value) {
            const toTarget = target.position.subtract(currentPos);

            // Split vertical control – keep floating around target height smoothly
            const horizontal = new Vector3(toTarget.x, 0, toTarget.z);
            const dist = Math.max(0.0001, horizontal.length());
            horizontal.normalize();
            const desiredSpeed = Math.min(props.maxSpeed, dist * 2.0);
            const desiredHorizontalVelocity = horizontal.scale(desiredSpeed);

            // More responsive vertical following - use adaptive multiplier based on distance
            // Allow higher vertical speeds to keep up with quick height changes
            const verticalDistance = desiredPos.y - currentPos.y;
            const verticalMultiplier = Math.min(8.0, 2.0 + Math.abs(verticalDistance) * 2.0);
            const maxVerticalSpeed = props.maxSpeed * VERTICAL_SPEED_MULTIPLIER;
            const desiredVerticalVelocity = Math.max(
                -maxVerticalSpeed,
                Math.min(maxVerticalSpeed, verticalDistance * verticalMultiplier)
            );

            const newVel = new Vector3(
                desiredHorizontalVelocity.x,
                desiredVerticalVelocity,
                desiredHorizontalVelocity.z,
            );
            setAgentVelocity(newVel);

            // Face the same direction as avatar
            const currentRot = root.rotationQuaternion ?? Quaternion.Identity();
            const targetRot = target.orientation;
            const slerpT = Math.min(1, dt * 4.0);
            root.rotationQuaternion = Quaternion.Slerp(
                currentRot,
                targetRot,
                slerpT,
            );

            // Integrate with zero gravity (floating)
            const zeroG = Vector3.Zero();
            const support = characterController.value.checkSupport(
                dt,
                new Vector3(0, -1, 0),
            );
            characterController.value.integrate(dt, support, zeroG);
        } else {
            // No physics – directly interpolate position and orientation
            const currentPos = root.position;
            const lerpT = Math.min(1, dt * 4.0);
            root.position = Vector3.Lerp(currentPos, desiredPos, lerpT);
            const currentRot = root.rotationQuaternion ?? Quaternion.Identity();
            const targetRot = target.orientation;
            root.rotationQuaternion = Quaternion.Slerp(
                currentRot,
                targetRot,
                lerpT,
            );
        }
    });

    afterObs = scene.onAfterRenderObservable.add(() => {
        // Sync visual node with controller if present
        if (characterController.value && agentRoot.value) {
            const p = characterController.value.getPosition();
            if (p) agentRoot.value.position = p.clone();
            agentRoot.value.computeWorldMatrix(true);
        }
    });

    // Recreate agent if the scene itself gets disposed (e.g., HMR rebuild)
    sceneDisposeObs = scene.onDisposeObservable.add(() => {
        disposeAgent();
    });
}

onMounted(() => {
    initAgent(props.scene);
});

onUnmounted(() => {
    disposeAgent();
});

// Rebuild when the scene instance changes (e.g., HMR or canvas rebuild)
import { watch } from "vue";

watch(
    () => props.scene,
    (next, _prev) => {
        disposeAgent();
        if (next) initAgent(next);
    },
);
</script>
