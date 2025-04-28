<template>
    <!-- No visual output needed for this component -->
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, inject, computed } from "vue";
import {
    type Scene,
    Vector3,
    Quaternion,
    TransformNode,
    MeshBuilder,
    type PhysicsAggregate,
    PhysicsCharacterController,
    CharacterSupportedState,
    ArcRotateCamera,
    KeyboardEventTypes,
    type Camera,
    StandardMaterial,
    Color3,
} from "@babylonjs/core";
import { useThrottleFn } from "@vueuse/core";

import { useVircadiaEntity } from "../../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/composable/useVircadiaEntity";
import { getInstanceKey } from "../../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/provider/useVircadia";

// Define the props for the component
const props = defineProps<{
    scene: Scene;
    position?: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number; w: number };
    throttleInterval?: number;
    capsuleHeight?: number;
    capsuleRadius?: number;
    stepOffset?: number;
    slopeLimit?: number;
    cameraOffset?: { x: number; y: number; z: number };
    cameraTarget?: { x: number; y: number; z: number };
    cameraRadius?: number;
    cameraAlpha?: number;
    cameraBeta?: number;
}>();

// Add emits for position and rotation updates
const emit = defineEmits<{
    "update:position": [{ x: number; y: number; z: number }];
    "update:rotation": [{ x: number; y: number; z: number; w: number }];
    ready: [];
}>();

// Reactive refs
const isLoading = ref(false);
const hasError = ref(false);
const errorMessage = ref("");
const currentPosition = ref(props.position || { x: 0, y: 0, z: 0 });
const currentRotation = ref(props.rotation || { x: 0, y: 0, z: 0, w: 1 });
const physicsAggregate = ref<PhysicsAggregate | null>(null);
const avatarNode = ref<TransformNode | null>(null);
const characterController = ref<PhysicsCharacterController | null>(null);
const capsuleHeight = computed(() => props.capsuleHeight || 1.8);
const capsuleRadius = computed(() => props.capsuleRadius || 0.3);
const stepOffset = computed(() => props.stepOffset || 0.4);
const slopeLimit = computed(() => props.slopeLimit || 45);
// Add character orientation quaternion
const characterOrientation = ref(Quaternion.Identity());
// Add display capsule separate from character controller
const displayCapsule = ref<TransformNode | null>(null);

// Add camera ref
const camera = ref<ArcRotateCamera | null>(null);

// Keyboard state
const keyState = ref({
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    run: false,
});

// Get Vircadia instance
const vircadia = inject(getInstanceKey("vircadiaWorld"));
if (!vircadia) {
    throw new Error("Vircadia instance not found.");
}

// Prepare initial meta data with position and rotation
const getInitialMetaData = () => {
    return JSON.stringify({
        type: { value: "PhysicsAvatar" },
        position: props.position
            ? {
                  value: props.position,
              }
            : undefined,
        rotation: props.rotation
            ? {
                  value: props.rotation,
              }
            : undefined,
    });
};

const entity = useVircadiaEntity({
    entityName: ref("PhysicsAvatar"),
    selectClause: "general__entity_id, general__entity_name, meta__data",
    insertClause:
        "(general__entity_name, meta__data) VALUES ($1, $2) RETURNING general__entity_id",
    insertParams: ["PhysicsAvatar", getInitialMetaData()],
    instance: vircadia,
});

// Update loading state based on entity status
watch(
    [
        () => entity.retrieving.value,
        () => entity.creating.value,
        () => entity.updating.value,
    ],
    ([entityRetrieving, entityCreating, entityUpdating]) => {
        isLoading.value = entityRetrieving || entityCreating || entityUpdating;
    },
    { immediate: true },
);

// Function to create and set up the character controller
const createCharacterController = () => {
    if (!props.scene || !props.scene.physicsEnabled) {
        console.warn(
            "Cannot create character controller: prerequisites not met",
        );
        return;
    }

    try {
        // Create a visible capsule mesh for display
        const capsule = MeshBuilder.CreateCapsule(
            "avatarCapsule",
            {
                height: capsuleHeight.value,
                radius: capsuleRadius.value,
            },
            props.scene,
        );

        // Apply a material to make it stand out
        const capsuleMaterial = new StandardMaterial(
            "capsuleMaterial",
            props.scene,
        );
        capsuleMaterial.diffuseColor = new Color3(0.2, 0.4, 0.8);
        capsule.material = capsuleMaterial;

        // Create a parent transform node
        avatarNode.value = new TransformNode("avatarNode", props.scene);
        // IMPORTANT: Set capsule as a child of avatarNode - this creates proper parent-child relationship
        capsule.setParent(avatarNode.value);
        // Save reference to display capsule
        displayCapsule.value = capsule;

        // Position the capsule
        const position = new Vector3(
            currentPosition.value.x,
            currentPosition.value.y,
            currentPosition.value.z,
        );
        avatarNode.value.position = position;

        // Initial rotation as quaternion
        characterOrientation.value = new Quaternion(
            currentRotation.value.x,
            currentRotation.value.y,
            currentRotation.value.z,
            currentRotation.value.w,
        );

        // Apply orientation to avatar node
        avatarNode.value.rotationQuaternion =
            characterOrientation.value.clone();

        // Initialize the PhysicsCharacterController with the correct parameters
        characterController.value = new PhysicsCharacterController(
            position,
            {
                capsuleHeight: capsuleHeight.value,
                capsuleRadius: capsuleRadius.value,
            },
            props.scene,
        );

        // Apply additional controller settings for better stability
        if (characterController.value) {
            // Set max slope angle (in cosine, lower values allow steeper slopes)
            characterController.value.maxSlopeCosine = Math.cos(
                (slopeLimit.value * Math.PI) / 180,
            );

            // Increase cast iterations to help with ground contact
            characterController.value.maxCastIterations = 20;
        }

        console.log("Character controller created successfully");

        // Create the camera once the character controller is ready
        createCamera();

        // Setup keyboard controls
        setupKeyboardControls();

        // Emit ready event
        emit("ready");
    } catch (error) {
        console.error("Error creating character controller:", error);
        hasError.value = true;
        errorMessage.value = `Error creating character controller: ${error}`;
    }
};

// Function to create and set up the third-person camera
const createCamera = () => {
    if (!props.scene || !avatarNode.value) return;

    // Default camera values
    const alpha = props.cameraAlpha ?? -Math.PI / 2; // horizontal rotation
    const beta = props.cameraBeta ?? Math.PI / 3; // vertical rotation
    const radius = props.cameraRadius ?? 5; // distance from target

    // Create the camera
    camera.value = new ArcRotateCamera(
        "avatar-camera",
        alpha,
        beta,
        radius,
        new Vector3(
            currentPosition.value.x,
            currentPosition.value.y + (props.capsuleHeight ?? 1.8) / 2, // Target the middle of the capsule
            currentPosition.value.z,
        ),
        props.scene,
    );

    // Configure camera
    camera.value.lowerRadiusLimit = 2; // Don't allow camera to go too close
    camera.value.upperRadiusLimit = 20; // Don't allow camera to go too far
    camera.value.wheelDeltaPercentage = 0.01; // Adjust zoom speed
    camera.value.panningSensibility = 0; // Disable panning

    // Configure camera collision
    camera.value.checkCollisions = true;
    camera.value.collisionRadius = new Vector3(0.5, 0.5, 0.5);

    // Attach camera controls to the canvas
    camera.value.attachControl(
        props.scene.getEngine().getRenderingCanvas(),
        true,
    );

    // Set as active camera with proper type casting
    props.scene.activeCamera = camera.value as unknown as Camera;

    console.log("Third-person camera created for avatar");
};

// Function to update camera target position
const updateCameraTarget = () => {
    if (!camera.value || !avatarNode.value) return;

    // Calculate target position - follow the avatar with an offset
    const targetHeight = (props.capsuleHeight ?? 1.8) / 2; // Target middle of capsule
    const targetPosition = new Vector3(
        avatarNode.value.position.x,
        avatarNode.value.position.y + targetHeight,
        avatarNode.value.position.z,
    );

    // Smoothly move the camera target
    camera.value.target = Vector3.Lerp(
        camera.value.target,
        targetPosition,
        0.1, // Adjust this value for smoother/faster camera following
    );
};

// Set up keyboard event listeners
const setupKeyboardControls = () => {
    if (!props.scene) return;

    props.scene.onKeyboardObservable.add((kbInfo) => {
        switch (kbInfo.type) {
            case KeyboardEventTypes.KEYDOWN:
                switch (kbInfo.event.code) {
                    case "KeyW":
                    case "ArrowUp":
                        keyState.value.forward = true;
                        break;
                    case "KeyS":
                    case "ArrowDown":
                        keyState.value.backward = true;
                        break;
                    case "KeyA":
                    case "ArrowLeft":
                        keyState.value.left = true;
                        break;
                    case "KeyD":
                    case "ArrowRight":
                        keyState.value.right = true;
                        break;
                    case "Space":
                        keyState.value.jump = true;
                        break;
                    case "ShiftLeft":
                    case "ShiftRight":
                        keyState.value.run = true;
                        break;
                }
                break;

            case KeyboardEventTypes.KEYUP:
                switch (kbInfo.event.code) {
                    case "KeyW":
                    case "ArrowUp":
                        keyState.value.forward = false;
                        break;
                    case "KeyS":
                    case "ArrowDown":
                        keyState.value.backward = false;
                        break;
                    case "KeyA":
                    case "ArrowLeft":
                        keyState.value.left = false;
                        break;
                    case "KeyD":
                    case "ArrowRight":
                        keyState.value.right = false;
                        break;
                    case "Space":
                        keyState.value.jump = false;
                        break;
                    case "ShiftLeft":
                    case "ShiftRight":
                        keyState.value.run = false;
                        break;
                }
                break;
        }
    });
};

// Function to update transforms based on physics controller
const updateTransforms = () => {
    if (
        !avatarNode.value ||
        !characterController.value ||
        !displayCapsule.value
    )
        return;

    // Get position from character controller
    const position = characterController.value.getPosition();
    if (position) {
        // Update avatar node position to match controller position
        avatarNode.value.position = position.clone();

        // Update current position
        currentPosition.value = {
            x: position.x,
            y: position.y,
            z: position.z,
        };
    }

    // Apply the current orientation to the avatar node
    avatarNode.value.rotationQuaternion = characterOrientation.value.clone();

    // Update current rotation from character orientation
    currentRotation.value = {
        x: characterOrientation.value.x,
        y: characterOrientation.value.y,
        z: characterOrientation.value.z,
        w: characterOrientation.value.w,
    };
};

// Create a throttled function to update the entity in the database
const throttledEntityUpdate = useThrottleFn(async () => {
    if (!entity.entityData.value?.general__entity_id) {
        console.warn("Cannot update entity: No entity ID available");
        return;
    }

    // Prepare the updated meta data
    let metaData: Record<string, Record<string, unknown>> = {};

    // If existing meta_data is a string, parse it first
    if (entity.entityData.value.meta__data) {
        if (typeof entity.entityData.value.meta__data === "string") {
            try {
                metaData = JSON.parse(entity.entityData.value.meta__data);
            } catch (e) {
                console.error("Failed to parse existing meta data:", e);
                // If parsing fails, use an empty object
                metaData = {};
            }
        } else if (typeof entity.entityData.value.meta__data === "object") {
            // If it's already an object, use it directly
            metaData = entity.entityData.value.meta__data as Record<
                string,
                Record<string, unknown>
            >;
        }
    }

    // Create clean update object with only needed properties
    const updatedMetaData = {
        type: { value: "PhysicsAvatar" },
        position: { value: currentPosition.value },
        rotation: { value: currentRotation.value },
    };

    // Preserve existing values if they exist
    if (metaData && typeof metaData === "object") {
        if (
            metaData.type &&
            typeof metaData.type === "object" &&
            typeof metaData.type.value === "string"
        ) {
            updatedMetaData.type = { value: metaData.type.value };
        }
    }

    // Update the entity with new meta data
    console.log("Updating entity position and rotation:", updatedMetaData);
    entity.executeUpdate("meta__data = $2", [JSON.stringify(updatedMetaData)]);
}, props.throttleInterval ?? 500);

// Character state machine
const characterState = ref("IN_AIR");

// Register scene before render to update positions if needed
const registerBeforeRender = () => {
    if (!props.scene) return;

    props.scene.registerBeforeRender(() => {
        if (characterController.value && avatarNode.value) {
            // Get the delta time
            const deltaTime = props.scene.getEngine().getDeltaTime() / 1000;

            // Process keyboard input for movement
            processMovement(deltaTime);

            // Update camera target to follow avatar
            updateCameraTarget();
        }
    });
};

// Process keyboard input and move character
const processMovement = (deltaTime: number) => {
    if (!characterController.value || !camera.value) return;

    // Calculate input direction based on key states
    const inputDirection = new Vector3(0, 0, 0);

    // Forward/backward movement
    if (keyState.value.forward) {
        inputDirection.z += 1;
    }
    if (keyState.value.backward) {
        inputDirection.z -= 1;
    }

    // Left/right movement
    if (keyState.value.left) {
        inputDirection.x -= 1;
    }
    if (keyState.value.right) {
        inputDirection.x += 1;
    }

    // If no movement, return early
    if (inputDirection.length() === 0) {
        return;
    }

    // Normalize the movement direction if moving in multiple directions
    inputDirection.normalize();

    // Get camera orientation for movement direction
    const cameraForward = camera.value
        .getTarget()
        .subtract(camera.value.position);
    cameraForward.y = 0; // Flatten direction
    cameraForward.normalize();

    // Get camera right direction
    const cameraRight = Vector3.Cross(Vector3.Up(), cameraForward).normalize();

    // Define speeds
    const onGroundSpeed = keyState.value.run ? 8 : 4;
    const inAirSpeed = 5;

    // Define gravity - stronger for better stability
    const gravity = new Vector3(0, -14.7, 0); // Stronger gravity for better stability

    // Check support state
    const support = characterController.value.checkSupport(
        deltaTime,
        new Vector3(0, -1, 0),
    );

    // Get current velocity
    const currentVelocity = characterController.value.getVelocity();

    // Update character state based on support
    const getNextState = () => {
        if (characterState.value === "IN_AIR") {
            if (support?.supportedState === CharacterSupportedState.SUPPORTED) {
                return "ON_GROUND";
            }
            return "IN_AIR";
        }

        if (characterState.value === "ON_GROUND") {
            if (support?.supportedState !== CharacterSupportedState.SUPPORTED) {
                return "IN_AIR";
            }
            if (keyState.value.jump) {
                return "START_JUMP";
            }
            return "ON_GROUND";
        }

        if (characterState.value === "START_JUMP") {
            return "IN_AIR";
        }

        return characterState.value;
    };

    // Update state
    const nextState = getNextState();
    if (nextState !== characterState.value) {
        characterState.value = nextState;
    }

    // Update character orientation from camera
    // This is key to prevent flopping - we control orientation directly
    Quaternion.FromEulerAnglesToRef(
        0,
        camera.value.alpha + Math.PI / 2,
        0,
        characterOrientation.value,
    );

    // Calculate desired velocity based on state
    let newVelocity: Vector3;
    const upVector = new Vector3(0, 1, 0);

    // Transform input direction into world space using character orientation
    const forwardWorld = new Vector3(0, 0, 1).applyRotationQuaternion(
        characterOrientation.value,
    );
    const finalDirection = inputDirection.applyRotationQuaternion(
        characterOrientation.value,
    );

    if (characterState.value === "IN_AIR") {
        // In air - simpler movement
        const desiredVelocity = finalDirection.scale(inAirSpeed);

        newVelocity = characterController.value.calculateMovement(
            deltaTime,
            forwardWorld,
            upVector,
            currentVelocity,
            Vector3.Zero(),
            desiredVelocity,
            upVector,
        );

        // Preserve vertical velocity (gravity will be applied in integrate)
        const currentVertical = currentVelocity.y;
        newVelocity.y = currentVertical + gravity.y * deltaTime;
    } else if (characterState.value === "ON_GROUND") {
        // On ground - move relative to surface
        const desiredVelocity = finalDirection.scale(onGroundSpeed);

        newVelocity = characterController.value.calculateMovement(
            deltaTime,
            forwardWorld,
            support.averageSurfaceNormal,
            currentVelocity,
            support.averageSurfaceVelocity,
            desiredVelocity,
            upVector,
        );
    } else if (characterState.value === "START_JUMP") {
        // Start jump - apply vertical impulse
        const jumpHeight = 1.2; // Slightly lower jump height for better control
        const jumpSpeed = Math.sqrt(2 * Math.abs(gravity.y) * jumpHeight);

        newVelocity = currentVelocity.clone();
        newVelocity.y = jumpSpeed;

        // Reset jump flag
        keyState.value.jump = false;
    } else {
        // Default case - maintain current velocity
        newVelocity = currentVelocity.clone();
    }

    // Set the new velocity
    characterController.value.setVelocity(newVelocity);

    // Integrate physics
    characterController.value.integrate(deltaTime, support, gravity);

    // Update avatar transform to match physics
    updateTransforms();

    // Emit updates
    throttledEntityUpdate();
    emit("update:position", currentPosition.value);
    emit("update:rotation", currentRotation.value);
};

// Function to move the avatar in a specific direction (used for external control)
const moveAvatar = (direction: Vector3, deltaTime: number) => {
    if (!characterController.value) return;

    // Apply speed based on mode and run state
    const moveSpeed = keyState.value.run ? 8 : 4;

    // Scale the direction by speed
    const scaledDirection = direction.normalize().scale(moveSpeed * deltaTime);

    // Calculate movement using calculateMovement instead of directly applying velocity
    const currentVelocity = characterController.value.getVelocity();
    const upVector = new Vector3(0, 1, 0);
    const forwardVector = scaledDirection.normalize();

    // Check support
    const support = characterController.value.checkSupport(
        deltaTime,
        new Vector3(0, -1, 0),
    );

    let newVelocity: Vector3;

    if (
        characterState.value === "ON_GROUND" &&
        support?.supportedState === CharacterSupportedState.SUPPORTED
    ) {
        // On ground
        newVelocity = characterController.value.calculateMovement(
            deltaTime,
            forwardVector,
            support.averageSurfaceNormal,
            currentVelocity,
            support.averageSurfaceVelocity,
            scaledDirection,
            upVector,
        );
    } else {
        // In air
        newVelocity = characterController.value.calculateMovement(
            deltaTime,
            forwardVector,
            upVector,
            currentVelocity,
            Vector3.Zero(),
            scaledDirection,
            upVector,
        );

        // Add gravity
        newVelocity.addInPlace(new Vector3(0, -9.8, 0).scale(deltaTime));
    }

    // Set the velocity
    characterController.value.setVelocity(newVelocity);

    if (support) {
        // Integrate physics
        characterController.value.integrate(
            deltaTime,
            support,
            new Vector3(0, -9.8, 0),
        );
    }

    // Update position and rotation
    updateTransforms();
    throttledEntityUpdate();
    emit("update:position", currentPosition.value);
    emit("update:rotation", currentRotation.value);
};

// Function to rotate the avatar
const rotateAvatar = (yawAmount: number, pitchAmount = 0) => {
    if (!characterOrientation.value) return;

    // Create rotation quaternion for yaw (around Y axis)
    const yawRotation = Quaternion.RotationAxis(Vector3.Up(), yawAmount);

    // Apply rotation to current quaternion
    const newRotation = characterOrientation.value.multiply(yawRotation);
    characterOrientation.value = newRotation;

    // Update current rotation
    currentRotation.value = {
        x: newRotation.x,
        y: newRotation.y,
        z: newRotation.z,
        w: newRotation.w,
    };

    // Update avatar to match
    updateTransforms();
    throttledEntityUpdate();
    emit("update:rotation", currentRotation.value);
};

// Watch for changes to currentPosition and currentRotation
watch(
    [currentPosition, currentRotation],
    () => {
        throttledEntityUpdate();
        emit("update:position", currentPosition.value);
        emit("update:rotation", currentRotation.value);
    },
    { deep: true },
);

// Watch for changes to props.position
watch(
    () => props.position,
    (newPosition) => {
        if (
            newPosition &&
            (newPosition.x !== currentPosition.value.x ||
                newPosition.y !== currentPosition.value.y ||
                newPosition.z !== currentPosition.value.z)
        ) {
            currentPosition.value = { ...newPosition };
        }
    },
    { deep: true },
);

// Watch for changes to props.rotation
watch(
    () => props.rotation,
    (newRotation) => {
        if (
            newRotation &&
            (newRotation.x !== currentRotation.value.x ||
                newRotation.y !== currentRotation.value.y ||
                newRotation.z !== currentRotation.value.z ||
                newRotation.w !== currentRotation.value.w)
        ) {
            currentRotation.value = { ...newRotation };
        }
    },
    { deep: true },
);

// Watch for entity data changes
watch(
    [
        () => entity.entityData.value,
        () => entity.creating.value,
        () => entity.error.value,
    ],
    ([entityData, creating, error], [oldEntityData, wasCreating]) => {
        if (error) {
            console.error("Entity Error (avatar):", error);
            hasError.value = true;
            errorMessage.value = `Entity error: ${error}`;
        } else if (wasCreating && !creating && entityData) {
            console.log("Entity created successfully for avatar:", entityData);
        } else if (entityData && entityData !== oldEntityData) {
            console.log("Entity data available for avatar:", entityData);

            // Check for updated position/rotation in entity data
            if (entityData.meta__data) {
                const metaData = entityData.meta__data;

                if (typeof metaData === "object" && metaData.position?.value) {
                    const newPosition = metaData.position.value;
                    // Only update if different to avoid circular updates
                    if (
                        newPosition.x !== currentPosition.value.x ||
                        newPosition.y !== currentPosition.value.y ||
                        newPosition.z !== currentPosition.value.z
                    ) {
                        currentPosition.value = { ...newPosition };
                    }
                }

                if (typeof metaData === "object" && metaData.rotation?.value) {
                    const newRotation = metaData.rotation.value;
                    // Only update if different to avoid circular updates
                    if (
                        newRotation.x !== currentRotation.value.x ||
                        newRotation.y !== currentRotation.value.y ||
                        newRotation.z !== currentRotation.value.z ||
                        newRotation.w !== currentRotation.value.w
                    ) {
                        currentRotation.value = { ...newRotation };
                    }
                }
            }
        }
    },
);

// Manage entity based on connection status
const manageEntity = () => {
    console.log("Managing entity for physics avatar...");

    // Retrieve entity, create if not found
    entity.executeRetrieve();

    // Watch for retrieve completion to create if needed
    const stopWatch = watch(
        [() => entity.retrieving.value, () => entity.error.value],
        ([retrieving, error], [wasRetrieving]) => {
            if (wasRetrieving && !retrieving) {
                if (!entity.entityData.value && !error) {
                    console.log("Physics avatar entity not found, creating...");
                    entity.executeCreate();
                } else if (entity.entityData.value) {
                    console.log(
                        "Physics avatar entity found, creating character controller",
                    );
                    createCharacterController();
                }
                stopWatch(); // Stop watching after entity retrieval completes
            }
        },
        { immediate: false },
    );
};

onMounted(() => {
    watch(
        () => vircadia.connectionInfo.value.status,
        (newStatus, oldStatus) => {
            if (newStatus === "connected" && oldStatus !== "connected") {
                console.log(
                    "Vircadia connected, managing entity for physics avatar",
                );
                manageEntity();
            } else if (newStatus !== "connected") {
                console.log(
                    "Vircadia disconnected, cleaning up physics avatar resources",
                );
                if (physicsAggregate.value) {
                    physicsAggregate.value.dispose();
                    physicsAggregate.value = null;
                }
                if (characterController.value) {
                    characterController.value = null;
                }
                if (avatarNode.value) {
                    avatarNode.value.dispose();
                    avatarNode.value = null;
                }
            }
        },
        { immediate: true },
    );

    // Register scene before render callback
    registerBeforeRender();
});

onUnmounted(() => {
    console.log("PhysicsAvatar component unmounting. Cleaning up...");

    entity.cleanup();

    // Clean up physics
    if (physicsAggregate.value) {
        physicsAggregate.value.dispose();
    }

    // Clean up avatar node
    if (avatarNode.value) {
        avatarNode.value.dispose();
    }

    // Clean up display capsule
    if (displayCapsule.value) {
        displayCapsule.value.dispose();
    }

    console.log("Cleanup complete for physics avatar.");
});

// Expose methods and properties for parent components
defineExpose({
    isLoading,
    hasError,
    errorMessage,
    position: currentPosition,
    rotation: currentRotation,
    moveAvatar,
    rotateAvatar,
    characterController,
    camera,
    characterState,
});
</script>