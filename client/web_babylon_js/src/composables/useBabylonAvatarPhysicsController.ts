import { ref, type Ref } from "vue";
import type { Scene } from "@babylonjs/core";
import {
    Vector3,
    CharacterSupportedState,
    Quaternion,
    TransformNode,
    MeshBuilder,
    PhysicsCharacterController,
    StandardMaterial,
    Color3,
} from "@babylonjs/core";

// Helper types for positions and rotations
export type PositionObj = { x: number; y: number; z: number };
export type RotationObj = { x: number; y: number; z: number; w: number };

/**
 * Composable for managing a physics-based character controller
 */
export function useBabylonAvatarPhysicsController(
    scene: Scene | undefined,
    initialPosition: Ref<PositionObj>,
    initialRotation: Ref<RotationObj>,
    capsuleHeight: Ref<number>,
    capsuleRadius: Ref<number>,
    slopeLimit: Ref<number>,
) {
    const avatarNode = ref<TransformNode | null>(null);
    const characterController = ref<PhysicsCharacterController | null>(null);
    const characterOrientation = ref(Quaternion.Identity());

    /**
     * Create the visual capsule and physics controller
     */
    function createController() {
        if (!scene || !scene.physicsEnabled) return;

        // Create visual capsule
        const capsule = MeshBuilder.CreateCapsule(
            "avatarCapsule",
            { height: capsuleHeight.value, radius: capsuleRadius.value },
            scene,
        );
        const material = new StandardMaterial("capsuleMaterial", scene);
        material.diffuseColor = new Color3(0.2, 0.4, 0.8);
        capsule.material = material;

        // Create parent transform node
        const node = new TransformNode("avatarNode", scene);
        avatarNode.value = node;
        // Parent capsule under avatarNode using setParent to avoid TS Node mismatch
        capsule.setParent(node);

        // Initialize transform
        avatarNode.value.position = new Vector3(
            initialPosition.value.x,
            initialPosition.value.y,
            initialPosition.value.z,
        );
        characterOrientation.value = new Quaternion(
            initialRotation.value.x,
            initialRotation.value.y,
            initialRotation.value.z,
            initialRotation.value.w,
        );
        avatarNode.value.rotationQuaternion =
            characterOrientation.value.clone();

        // Create the physics character controller
        characterController.value = new PhysicsCharacterController(
            avatarNode.value.position.clone(),
            {
                capsuleHeight: capsuleHeight.value,
                capsuleRadius: capsuleRadius.value,
            },
            scene,
        );

        // Configure slope limit and iterations
        if (characterController.value) {
            characterController.value.maxSlopeCosine = Math.cos(
                (slopeLimit.value * Math.PI) / 180,
            );
            characterController.value.maxCastIterations = 20;
        }
    }

    /**
     * Synchronize the avatarNode's transform with physics
     */
    function updateTransforms() {
        if (!avatarNode.value || !characterController.value) return;
        const pos = characterController.value.getPosition();
        if (pos) {
            avatarNode.value.position = pos.clone();
        }
        avatarNode.value.rotationQuaternion =
            characterOrientation.value.clone();
    }

    /**
     * Move the avatar in a direction with physics integration
     */
    function moveAvatar(direction: Vector3) {
        if (!characterController.value) return;

        // Apply simple horizontal movement
        const speed = 4;
        const displacement = direction.normalize().scale(speed);
        const currentVel = characterController.value.getVelocity();
        currentVel.x = displacement.x;
        currentVel.z = displacement.z;
        characterController.value.setVelocity(currentVel);
    }

    /**
     * Step the physics simulation: apply gravity and update transforms.
     */
    function stepSimulation(deltaTime: number) {
        if (!characterController.value) return;
        // Apply manual gravity to vertical velocity
        const gravity = -9.8;
        const vel = characterController.value.getVelocity();
        vel.y += gravity * deltaTime;
        characterController.value.setVelocity(vel);
        // Perform support check and integrate the controller
        const support = characterController.value.checkSupport(
            deltaTime,
            new Vector3(0, -1, 0),
        );
        characterController.value.integrate(
            deltaTime,
            support,
            new Vector3(0, gravity, 0),
        );
        // Sync visual transform
        updateTransforms();
    }

    /**
     * Rotate the avatar by a yaw amount
     */
    function rotateAvatar(yawAmount: number) {
        const yawQuat = Quaternion.RotationAxis(Vector3.Up(), yawAmount);
        characterOrientation.value =
            characterOrientation.value.multiply(yawQuat);
        updateTransforms();
    }

    /**
     * Apply a jump impulse if on the ground
     */
    function jump(deltaTime: number, jumpSpeed = 5) {
        if (!characterController.value) return;
        const support = characterController.value.checkSupport(
            deltaTime,
            new Vector3(0, -1, 0),
        );
        if (support.supportedState === CharacterSupportedState.SUPPORTED) {
            const vel = characterController.value.getVelocity();
            vel.y = jumpSpeed;
            characterController.value.setVelocity(vel);
        }
    }

    return {
        avatarNode,
        characterController,
        characterOrientation,
        createController,
        updateTransforms,
        moveAvatar,
        rotateAvatar,
        stepSimulation,
        jump,
    };
}
