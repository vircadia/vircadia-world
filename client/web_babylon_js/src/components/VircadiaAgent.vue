<template>
    <!-- Renderless agent component -->
</template>

<script setup lang="ts">
import {
    Color3,
    Matrix,
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
});

// Node and controller
const agentRoot: Ref<TransformNode | null> = ref(null);
const characterController: Ref<PhysicsCharacterController | null> = ref(null);

// Simple hover effect
let hoverPhase = 0;

function createAgentGeometry(scene: Scene, root: TransformNode): void {
    // Body (capsule-ish / EVE-like)
    const body = MeshBuilder.CreateCapsule(
        "agentBody",
        { height: 1.1, radius: 0.38, tessellation: 16 },
        scene,
    );
    body.scaling = new Vector3(0.9, 1.15, 0.9);
    const bodyMat = new StandardMaterial("agentBodyMat", scene);
    bodyMat.diffuseColor = new Color3(1.0, 1.0, 1.0);
    bodyMat.specularColor = new Color3(0.2, 0.2, 0.2);
    body.material = bodyMat;
    body.setParent(root);

    // Visor (front face)
    const visor = MeshBuilder.CreateCylinder(
        "agentVisor",
        { diameter: 0.72, height: 0.025, tessellation: 32 },
        scene,
    );
    visor.position = new Vector3(0, 0.15, 0.45);
    const visorMat = new StandardMaterial("agentVisorMat", scene);
    visorMat.diffuseColor = new Color3(0.05, 0.1, 0.12);
    visorMat.emissiveColor = new Color3(0.05, 0.15, 0.2);
    visor.material = visorMat;
    visor.setParent(root);

    // Eyes (simple glowing dots)
    const eyeLeft = MeshBuilder.CreateSphere(
        "agentEyeL",
        { diameter: 0.08 },
        scene,
    );
    eyeLeft.position = new Vector3(-0.14, 0.18, 0.485);
    const eyeRight = eyeLeft.clone("agentEyeR");
    if (eyeRight) eyeRight.position = new Vector3(0.14, 0.18, 0.485);
    const eyeMat = new StandardMaterial("agentEyeMat", scene);
    eyeMat.emissiveColor = new Color3(0.2, 0.6, 1.0);
    eyeLeft.material = eyeMat;
    if (eyeRight) eyeRight.material = eyeMat;
    eyeLeft.setParent(root);
    if (eyeRight) eyeRight.setParent(root);
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
        // Build a lightweight hidden capsule for the physics shape
        const capsule = MeshBuilder.CreateCapsule(
            "agentCapsule",
            { height: 1.0, radius: 0.35, tessellation: 8 },
            scene,
        );
        capsule.isVisible = false;
        const physicsShape = PhysicsShapeCapsule.FromMesh(capsule);

        characterController.value = new PhysicsCharacterController(
            startPos.clone(),
            { shape: physicsShape, capsuleHeight: 1.0, capsuleRadius: 0.35 },
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

onMounted(() => {
    const scene = props.scene;
    if (!scene) return;

    const root = new TransformNode("VircadiaAgent", scene);
    agentRoot.value = root;
    // Start near the avatar if available
    const start = computeFollowTarget()?.position ?? new Vector3(0, 1, 0);
    root.position = start.clone();
    root.rotationQuaternion = Quaternion.Identity();

    createAgentGeometry(scene, root);

    // Hook frame updates
    let lastT = performance.now();
    beforeObs = scene.onBeforeRenderObservable.add(() => {
        const now = performance.now();
        const dt = (now - lastT) / 1000.0;
        lastT = now;

        // Ensure controller lazily once physics is available
        if (!characterController.value && props.physicsEnabled) {
            ensureController(scene, root.position);
        }

        // Desired follow target
        const target = computeFollowTarget();
        if (!target) return;

        // Hover animation (visual only)
        hoverPhase += dt * 2.0;
        const hover = Math.sin(hoverPhase) * 0.03;

        if (characterController.value) {
            const currentPos = getAgentPosition() ?? root.position;
            const toTarget = target.position.subtract(currentPos);

            // Split vertical control – keep floating around target height smoothly
            const horizontal = new Vector3(toTarget.x, 0, toTarget.z);
            const dist = Math.max(0.0001, horizontal.length());
            horizontal.normalize();
            const desiredSpeed = Math.min(props.maxSpeed, dist * 2.0);
            const desiredHorizontalVelocity = horizontal.scale(desiredSpeed);

            const desiredVerticalVelocity =
                (target.position.y + hover - currentPos.y) * 2.0;

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
            root.position = Vector3.Lerp(
                currentPos,
                target.position.add(new Vector3(0, hover, 0)),
                lerpT,
            );
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
});

onUnmounted(() => {
    const scene = props.scene;
    if (beforeObs && scene?.onBeforeRenderObservable?.remove) {
        scene.onBeforeRenderObservable.remove(beforeObs);
    }
    if (afterObs && scene?.onAfterRenderObservable?.remove) {
        scene.onAfterRenderObservable.remove(afterObs);
    }
    agentRoot.value?.dispose(false, true);
});
</script>
