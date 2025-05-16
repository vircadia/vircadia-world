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

// Add SupportType alias
export type SupportType = ReturnType<
    PhysicsCharacterController["checkSupport"]
>;

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
        // Hide the physics capsule so the avatar model is visible instead
        capsule.isVisible = false;

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

    // Low-level primitives
    function getPosition(): Vector3 | undefined {
        return characterController.value?.getPosition();
    }
    function setPosition(pos: Vector3) {
        const node = avatarNode.value;
        const controller = characterController.value;
        if (!node || !controller) return;
        node.position = pos.clone();
        controller.setPosition(pos.clone());
    }
    function getOrientation(): Quaternion {
        return characterOrientation.value.clone();
    }
    function setOrientation(q: Quaternion) {
        characterOrientation.value = q.clone();
        if (avatarNode.value) {
            avatarNode.value.rotationQuaternion = q.clone();
        }
    }
    function getVelocity(): Vector3 | undefined {
        return characterController.value?.getVelocity();
    }
    function setVelocity(v: Vector3) {
        characterController.value?.setVelocity(v);
    }
    function checkSupport(deltaTime: number): SupportType | undefined {
        return characterController.value?.checkSupport(
            deltaTime,
            new Vector3(0, -1, 0),
        );
    }
    function integrate(deltaTime: number, support: SupportType) {
        const controller = characterController.value;
        if (!controller || !support) return;
        // default gravity vector Y = -9.8
        controller.integrate(deltaTime, support, new Vector3(0, -9.8, 0));
    }

    return {
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
    };
}
