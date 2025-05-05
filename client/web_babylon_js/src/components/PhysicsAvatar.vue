<template>
    <!-- No visual output needed for this component -->
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, inject } from "vue";
import type {
    Scene,
    Mesh,
    Node,
    PhysicsAggregate,
    Camera,
} from "@babylonjs/core";
import {
    Vector3,
    Quaternion,
    TransformNode,
    MeshBuilder,
    PhysicsCharacterController,
    CharacterSupportedState,
    ArcRotateCamera,
    KeyboardEventTypes,
    StandardMaterial,
    Color3,
} from "@babylonjs/core";
import { useThrottleFn } from "@vueuse/core";
import { z } from "zod";

import {
    useVircadiaEntity_Vue,
    getVircadiaInstanceKey_Vue,
} from "@vircadia/world-sdk/browser";

// Define the props for the component
const props = defineProps<{
    scene: Scene;
    entityName: string;
    throttleInterval?: number;
    capsuleHeight?: number;
    capsuleRadius?: number;
    stepOffset?: number;
    slopeLimit?: number;
}>();

// Add emits for position and rotation updates
const emit = defineEmits<{
    ready: [];
}>();

// Reactive refs
const isLoading = ref(false);
const hasError = ref(false);
const errorMessage = ref("");
const physicsAggregate = ref<PhysicsAggregate | null>(null);
const avatarNode = ref<TransformNode | null>(null);
const characterController = ref<PhysicsCharacterController | null>(null);
// Temporary storage for initial state before controller exists
const initialPosition = ref({ x: 0, y: 0, z: 0 });
const initialRotation = ref({ x: 0, y: 0, z: 0, w: 1 });
const capsuleHeight = computed(() => props.capsuleHeight || 1.8);
const capsuleRadius = computed(() => props.capsuleRadius || 0.3);
const stepOffset = computed(() => props.stepOffset || 0.4);
const slopeLimit = computed(() => props.slopeLimit || 45);
// Add character orientation quaternion
const characterOrientation = ref(Quaternion.Identity());
// Add display capsule separate from character controller
const displayCapsule = ref<Mesh | null>(null);

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

// Entity name
const entityName = ref<string>(props.entityName);

// Define Zod schemas for validation
const Vector3Schema = z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
});

const QuaternionSchema = z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
    w: z.number(),
});

const CameraOrientationSchema = z.object({
    alpha: z.number(),
    beta: z.number(),
    radius: z.number(),
});

// Field value wrapper schema
const FieldValueSchema = <T extends z.ZodType>(valueSchema: T) =>
    z.object({
        value: valueSchema,
    });

// Combined avatar meta data schema with both transform and avatar data
const PhysicsAvatarMetaSchema = z.object({
    type: FieldValueSchema(z.literal(entityName.value)),
    position: FieldValueSchema(Vector3Schema),
    rotation: FieldValueSchema(QuaternionSchema),
    modelURL: FieldValueSchema(z.string()).optional(),
    cameraOrientation: FieldValueSchema(CameraOrientationSchema).optional(),
});

type PhysicsAvatarMetaData = z.infer<typeof PhysicsAvatarMetaSchema>;

// Initialize camera orientation with local defaults
const currentCameraOrientation = ref({
    alpha: -Math.PI / 2,
    beta: Math.PI / 3,
    radius: 5,
});

// Get Vircadia instance
const vircadia = inject(getVircadiaInstanceKey_Vue());
if (!vircadia) {
    throw new Error("Vircadia instance not found.");
}

// Get initial meta data with combined transform and avatar data
const getInitialMetaData = () => {
    // Get position and rotation from physics controller if available, otherwise use initial values
    const positionValue = characterController.value
        ? getPositionAsObject(characterController.value.getPosition())
        : initialPosition.value;

    const rotationValue = characterOrientation.value
        ? getQuaternionAsObject(characterOrientation.value)
        : initialRotation.value;

    const initialData: PhysicsAvatarMetaData = {
        type: { value: entityName.value },
        position: { value: positionValue },
        rotation: { value: rotationValue },
        cameraOrientation: { value: currentCameraOrientation.value },
    };

    console.log("Creating avatar entity with initial data:", initialData);
    return initialData;
};

// Helper functions to convert between Babylon objects and plain objects
const getPositionAsObject = (vector: Vector3) => {
    return {
        x: vector.x,
        y: vector.y,
        z: vector.z,
    };
};

const getQuaternionAsObject = (quaternion: Quaternion) => {
    return {
        x: quaternion.x,
        y: quaternion.y,
        z: quaternion.z,
        w: quaternion.w,
    };
};

// Initialize avatar entity with schema
const avatarEntity = useVircadiaEntity_Vue({
    entityName,
    selectClause: "general__entity_name, meta__data",
    insertClause:
        "(general__entity_name, meta__data) VALUES ($1, $2) RETURNING general__entity_name",
    insertParams: [entityName.value, JSON.stringify(getInitialMetaData())],
    metaDataSchema: PhysicsAvatarMetaSchema,
    defaultMetaData: getInitialMetaData(),
});

// Update loading state based on entity status
watch(
    [
        () => avatarEntity.retrieving.value,
        () => avatarEntity.creating.value,
        () => avatarEntity.updating.value,
    ],
    ([entityRetrieving, entityCreating, entityUpdating]) => {
        isLoading.value = entityRetrieving || entityCreating || entityUpdating;
    },
    { immediate: true },
);

// Throttled entity update function
const throttledEntityUpdate = useThrottleFn(async () => {
    if (!avatarEntity.entityData.value?.general__entity_name) {
        console.warn("Cannot update entity: No entity name available");
        return;
    }

    // Get position and rotation directly from sources of truth
    const positionValue = characterController.value
        ? getPositionAsObject(characterController.value.getPosition())
        : initialPosition.value;

    const rotationValue = characterOrientation.value
        ? getQuaternionAsObject(characterOrientation.value)
        : initialRotation.value;

    // Get the current meta__data to preserve non-transform fields
    const currentMetaData =
        avatarEntity.entityData.value.meta__data || getInitialMetaData();

    // Prepare the updated meta data with combined transform and avatar data
    const updatedMetaData: PhysicsAvatarMetaData = {
        type: { value: entityName.value },
        position: { value: positionValue },
        rotation: { value: rotationValue },
        cameraOrientation: { value: currentCameraOrientation.value },
    };

    // Preserve modelURL if it exists
    if (currentMetaData.modelURL) {
        updatedMetaData.modelURL = currentMetaData.modelURL;
    }

    console.log("Updating entity data:", updatedMetaData);
    avatarEntity.executeUpdate("meta__data = $1", [
        JSON.stringify(updatedMetaData),
    ]);
}, props.throttleInterval ?? 500);

// Watch for entity errors
watch(
    () => avatarEntity.error.value,
    (error) => {
        if (error) {
            console.error("Entity Error:", error);
            hasError.value = true;
            errorMessage.value = `Entity error: ${error}`;
        }
    },
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

        // Set parent relationship using a type assertion to work around TypeScript limitations
        // This is safe because TransformNode is a valid parent type in Babylon.js
        capsule.parent = avatarNode.value as unknown as Node;

        // Save reference to display capsule
        displayCapsule.value = capsule;

        // Use position from entity data or default
        const position = new Vector3(
            initialPosition.value.x,
            initialPosition.value.y,
            initialPosition.value.z,
        );
        avatarNode.value.position = position;

        // Use rotation from entity data or default
        characterOrientation.value = new Quaternion(
            initialRotation.value.x,
            initialRotation.value.y,
            initialRotation.value.z,
            initialRotation.value.w,
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

        console.log(
            "Character controller created successfully with position:",
            position,
        );

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

    // Default camera values - use saved values if available
    const alpha = currentCameraOrientation.value.alpha;
    const beta = currentCameraOrientation.value.beta;
    const radius = currentCameraOrientation.value.radius;

    // Create the camera
    camera.value = new ArcRotateCamera(
        "avatar-camera",
        alpha,
        beta,
        radius,
        new Vector3(
            avatarNode.value.position.x,
            avatarNode.value.position.y + (props.capsuleHeight ?? 1.8) / 2, // Target the middle of the capsule
            avatarNode.value.position.z,
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
    ) {
        console.info("Failed to update transforms.");
        return;
    }

    // Get position from character controller - single source of truth
    const position = characterController.value.getPosition();
    if (position) {
        // Update avatar node position to match controller position
        avatarNode.value.position = position.clone();
    }

    // Apply the current orientation to the avatar node
    avatarNode.value.rotationQuaternion = characterOrientation.value.clone();

    // Trigger throttled entity update when transforms change
    throttledEntityUpdate();
};

// Watch for camera orientation changes and add to throttled update
watch(
    () => currentCameraOrientation.value,
    () => {
        throttledEntityUpdate();
    },
    { deep: true },
);

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
    const controller = characterController.value;
    const cam = camera.value;
    if (!controller || !cam) return;

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

    // Normalize the movement direction before applying input
    inputDirection.normalize();

    // Get camera orientation for movement direction
    const cameraForward = cam.getTarget().subtract(cam.position);
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
    const support = controller.checkSupport(deltaTime, new Vector3(0, -1, 0));

    // Get current velocity
    const currentVelocity = controller.getVelocity();

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
        cam.alpha + Math.PI / 2,
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

        newVelocity = controller.calculateMovement(
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

        newVelocity = controller.calculateMovement(
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
    controller.setVelocity(newVelocity);

    // Integrate physics
    controller.integrate(deltaTime, support, gravity);

    // Update avatar transform to match physics
    updateTransforms();

    // Save camera orientation if it has changed
    if (
        cam &&
        (cam.alpha !== currentCameraOrientation.value.alpha ||
            cam.beta !== currentCameraOrientation.value.beta ||
            cam.radius !== currentCameraOrientation.value.radius)
    ) {
        currentCameraOrientation.value = {
            alpha: cam.alpha,
            beta: cam.beta,
            radius: cam.radius,
        };
    }
};

// Function to move the avatar in a specific direction (used for external control)
const moveAvatar = (direction: Vector3, deltaTime: number) => {
    const controller = characterController.value;
    if (!controller) return;

    // Apply speed based on mode and run state
    const moveSpeed = keyState.value.run ? 8 : 4;

    // Scale the direction by speed
    const scaledDirection = direction.normalize().scale(moveSpeed * deltaTime);

    // Calculate movement using calculateMovement instead of directly applying velocity
    const currentVelocity = controller.getVelocity();
    const upVector = new Vector3(0, 1, 0);
    const forwardVector = scaledDirection.normalize();

    // Check support
    const support = controller.checkSupport(deltaTime, new Vector3(0, -1, 0));

    let newVelocity: Vector3;

    if (
        characterState.value === "ON_GROUND" &&
        support?.supportedState === CharacterSupportedState.SUPPORTED
    ) {
        // On ground
        newVelocity = controller.calculateMovement(
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
        newVelocity = controller.calculateMovement(
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
    controller.setVelocity(newVelocity);

    if (support) {
        // Integrate physics
        controller.integrate(deltaTime, support, new Vector3(0, -9.8, 0));
    }

    // Update from physics controller - single source of truth
    updateTransforms();
};

// Function to rotate the avatar
const rotateAvatar = (yawAmount: number, pitchAmount = 0) => {
    if (!characterOrientation.value) return;

    // Create rotation quaternion for yaw (around Y axis)
    const yawRotation = Quaternion.RotationAxis(Vector3.Up(), yawAmount);

    // Apply rotation to current quaternion
    const newRotation = characterOrientation.value.multiply(yawRotation);
    characterOrientation.value = newRotation;

    // Update avatar to match
    updateTransforms();
};

// Watch for avatarEntity data changes to apply to local state
watch(
    [
        () => avatarEntity.entityData.value?.meta__data,
        () => avatarEntity.creating.value,
        () => avatarEntity.error.value,
    ],
    ([metaData, creating, error], [oldMetaData, wasCreating]) => {
        if (error) {
            console.error("Entity Error:", error);
            hasError.value = true;
            errorMessage.value = `Entity error: ${error}`;
        } else if (wasCreating && !creating && avatarEntity.entityData.value) {
            console.log(
                "Entity created successfully:",
                avatarEntity.entityData.value,
            );
            // Store the name if this was a newly created entity
            if (
                avatarEntity.entityData.value.general__entity_name &&
                !entityName.value
            ) {
                entityName.value =
                    avatarEntity.entityData.value.general__entity_name;
            }
        } else if (metaData && metaData !== oldMetaData) {
            console.log("Entity data updated:", metaData);

            // Store the name if we didn't have it before
            if (
                avatarEntity.entityData.value?.general__entity_name &&
                !entityName.value
            ) {
                entityName.value =
                    avatarEntity.entityData.value.general__entity_name;
            }

            try {
                // Create character controller if not already created
                if (!characterController.value) {
                    // Store initial position and rotation for controller creation
                    if (metaData.position?.value) {
                        console.log(
                            "Found initial position:",
                            metaData.position.value,
                        );
                        initialPosition.value = { ...metaData.position.value };
                    }

                    // Store initial rotation for controller creation
                    if (metaData.rotation?.value) {
                        console.log(
                            "Found initial rotation:",
                            metaData.rotation.value,
                        );
                        initialRotation.value = { ...metaData.rotation.value };
                    }

                    createCharacterController();
                } else {
                    // We have a character controller - use hard positioning when needed

                    // Hard-set position if available
                    if (metaData.position?.value) {
                        console.log(
                            "Hard-setting position from entity data:",
                            metaData.position.value,
                        );
                        const newPosition = new Vector3(
                            metaData.position.value.x,
                            metaData.position.value.y,
                            metaData.position.value.z,
                        );

                        // Use physics controller as source of truth - teleport to position
                        characterController.value.setPosition(newPosition);
                    }

                    // Update orientation if available
                    if (metaData.rotation?.value) {
                        console.log(
                            "Setting rotation from entity data:",
                            metaData.rotation.value,
                        );
                        characterOrientation.value = new Quaternion(
                            metaData.rotation.value.x,
                            metaData.rotation.value.y,
                            metaData.rotation.value.z,
                            metaData.rotation.value.w,
                        );
                    }

                    // Update transforms to reflect changes immediately
                    updateTransforms();
                }

                // Update camera orientation if available
                if (metaData.cameraOrientation?.value) {
                    console.log(
                        "Found camera orientation:",
                        metaData.cameraOrientation.value,
                    );
                    currentCameraOrientation.value = {
                        ...metaData.cameraOrientation.value,
                    };

                    // Update camera if it exists
                    if (camera.value) {
                        camera.value.alpha =
                            currentCameraOrientation.value.alpha;
                        camera.value.beta = currentCameraOrientation.value.beta;
                        camera.value.radius =
                            currentCameraOrientation.value.radius;
                    }
                }
            } catch (error) {
                console.error("Error processing entity data:", error);
            }
        }
    },
);

// Manage entity based on connection status
const manageEntity = () => {
    console.log("Managing entity for physics avatar...");

    console.log(`Retrieving physics avatar with name: ${entityName.value}`);
    avatarEntity.executeRetrieve();

    // Watch for retrieve completion
    const stopWatch = watch(
        [
            () => avatarEntity.retrieving.value,
            () => avatarEntity.error.value,
            () => avatarEntity.entityData.value,
        ],
        ([retrieving, error, entityData], [wasRetrieving]) => {
            if (wasRetrieving && !retrieving) {
                if (!entityData && !error) {
                    if (entityName.value) {
                        console.log(
                            `Physics avatar entity with name ${entityName.value} not found, creating new one...`,
                        );
                        avatarEntity.executeCreate().then((newName) => {
                            if (newName) {
                                console.log(
                                    `Created new physics avatar with name: ${newName}`,
                                );
                                avatarEntity.executeRetrieve();
                            } else {
                                console.error(
                                    "Failed to create entity with name:",
                                    entityName.value,
                                );
                                avatarEntity.executeRetrieve();
                            }
                        });
                    }
                }
                stopWatch();
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
                    "Vircadia connected, managing physics avatar entity",
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
    console.log(`${entityName.value} component unmounting. Cleaning up...`);

    avatarEntity.cleanup();

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
    currentPosition: initialPosition,
    currentRotation: initialRotation,
    isLoading,
    hasError,
    errorMessage,
    entityName,
    moveAvatar,
    rotateAvatar,
    characterController,
    camera,
    characterState,
});
</script>