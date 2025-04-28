<template>
    <!-- No visual output needed for this component -->
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, inject, computed } from "vue";
import {
    type Scene,
    ImportMeshAsync,
    type AbstractMesh,
    Vector3,
    Quaternion,
    TransformNode,
    MeshBuilder,
    PhysicsAggregate,
    PhysicsShapeType,
    PhysicsMotionType,
    PhysicsCharacterController,
    CharacterSupportedState,
    ArcRotateCamera,
    KeyboardEventTypes,
    type Camera,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF"; // Import the GLTF loader
import { useThrottleFn } from "@vueuse/core";

import { useVircadiaAsset } from "../../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/composable/useVircadiaAsset";
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

// Constants
const AVATAR_MODEL = "telekom.model.DefaultAvatar.glb";

// Reactive refs
const isLoading = ref(false);
const hasError = ref(false);
const errorMessage = ref("");
const currentPosition = ref(props.position || { x: 0, y: 0, z: 0 });
const currentRotation = ref(props.rotation || { x: 0, y: 0, z: 0, w: 1 });
const avatarMeshes = ref<AbstractMesh[]>([]);
const characterController = ref<PhysicsCharacterController | null>(null);
const physicsAggregate = ref<PhysicsAggregate | null>(null);
const avatarNode = ref<TransformNode | null>(null);
const capsuleHeight = computed(() => props.capsuleHeight || 1.8);
const capsuleRadius = computed(() => props.capsuleRadius || 0.3);

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
    fly: false,
    up: false,
    down: false,
});

// Get Vircadia instance
const vircadia = inject(getInstanceKey("vircadiaWorld"));
if (!vircadia) {
    throw new Error("Vircadia instance not found.");
}

// Initialize asset and entity composables
const asset = useVircadiaAsset({
    fileName: ref(AVATAR_MODEL),
    instance: vircadia,
});

// Prepare initial meta data with position and rotation
const getInitialMetaData = () => {
    return JSON.stringify({
        type: { value: "Avatar" },
        modelURL: { value: AVATAR_MODEL },
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

// Update loading state based on asset and entity status
watch(
    [
        () => asset.loading.value,
        () => entity.retrieving.value,
        () => entity.creating.value,
        () => entity.updating.value,
    ],
    ([assetLoading, entityRetrieving, entityCreating, entityUpdating]) => {
        isLoading.value =
            assetLoading ||
            entityRetrieving ||
            entityCreating ||
            entityUpdating;
    },
    { immediate: true },
);

// Function to load the avatar model
const loadAvatarModel = async () => {
    if (!asset.assetData.value || !props.scene) {
        console.warn(
            `Asset: ${asset.assetData.value ? "Ready" : "Not ready"}.`,
        );
        console.warn(`Scene: ${props.scene ? "Ready" : "Not ready"}.`);
        return;
    }

    const assetData = asset.assetData.value;
    if (!assetData.blobUrl) {
        console.warn("Asset blob URL not available.");
        return;
    }

    if (avatarMeshes.value.length > 0) {
        console.log("Avatar model already loaded. Skipping.");
        return;
    }

    try {
        const pluginExtension =
            assetData.mimeType === "model/gltf-binary" ? ".glb" : ".gltf";
        console.log("Loading avatar model using blob URL...");

        // Load the avatar model
        const result = await ImportMeshAsync(assetData.blobUrl, props.scene, {
            pluginExtension,
        });

        avatarMeshes.value = result.meshes;

        // Create a parent transform node for the avatar
        avatarNode.value = new TransformNode("avatarNode", props.scene);

        // Parent all meshes to the transform node
        for (const mesh of avatarMeshes.value) {
            mesh.parent = avatarNode.value;
        }

        // Extract position and rotation from entity data if available
        if (entity.entityData.value?.meta__data) {
            const entityMetaData = entity.entityData.value.meta__data;
            if (
                typeof entityMetaData === "object" &&
                entityMetaData.position?.value
            ) {
                currentPosition.value = { ...entityMetaData.position.value };
            }

            if (
                typeof entityMetaData === "object" &&
                entityMetaData.rotation?.value
            ) {
                currentRotation.value = { ...entityMetaData.rotation.value };
            }
        } else {
            // Use props values as defaults
            if (props.position) {
                currentPosition.value = { ...props.position };
            }

            if (props.rotation) {
                currentRotation.value = { ...props.rotation };
            }
        }

        // Create and set up the physics character controller
        createCharacterController();

        console.log(
            `Avatar model loaded successfully (${avatarMeshes.value.length} meshes).`,
        );
    } catch (error) {
        console.error("Error loading avatar model:", error);
        hasError.value = true;
        errorMessage.value = `Error loading avatar model: ${error}`;
    }
};

// Function to create and set up the character controller
const createCharacterController = () => {
    if (!props.scene || !props.scene.physicsEnabled || !avatarNode.value) {
        console.warn(
            "Cannot create character controller: prerequisites not met",
        );
        return;
    }

    try {
        // Create invisible capsule mesh for physics
        const capsule = MeshBuilder.CreateCapsule(
            "avatarCapsule",
            {
                height: capsuleHeight.value,
                radius: capsuleRadius.value,
            },
            props.scene,
        );
        capsule.isVisible = false; // Make capsule invisible

        // Position the capsule
        const position = new Vector3(
            currentPosition.value.x,
            currentPosition.value.y,
            currentPosition.value.z,
        );
        capsule.position = position;

        // Initial rotation
        const rotation = new Quaternion(
            currentRotation.value.x,
            currentRotation.value.y,
            currentRotation.value.z,
            currentRotation.value.w,
        );
        capsule.rotationQuaternion = rotation;

        // Initialize the PhysicsCharacterController with the correct parameters
        characterController.value = new PhysicsCharacterController(
            position,
            {
                capsuleHeight: capsuleHeight.value,
                capsuleRadius: capsuleRadius.value,
            },
            props.scene,
        );

        // Create physics aggregate for the capsule
        physicsAggregate.value = new PhysicsAggregate(
            capsule,
            PhysicsShapeType.CAPSULE,
            { mass: 1, restitution: 0.2 },
            props.scene,
        );

        // Set motion type to dynamic
        physicsAggregate.value.body.setMotionType(PhysicsMotionType.DYNAMIC);

        // Set avatar position and rotation to match capsule
        updateAvatarTransform();

        console.log("Character controller created successfully");

        // Create the camera once the character controller is ready
        createCamera();

        // Setup keyboard controls
        setupKeyboardControls();
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
            currentPosition.value.y + (props.capsuleHeight ?? 1.8) / 2, // Target the middle of the avatar
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

    // Emit the ready event to notify the parent component
    emit("ready");
};

// Function to update camera target position
const updateCameraTarget = () => {
    if (!camera.value || !avatarNode.value) return;

    // Calculate target position - follow the avatar with an offset
    const targetHeight = (props.capsuleHeight ?? 1.8) / 2; // Target middle of avatar
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
                        if (keyState.value.fly) {
                            keyState.value.up = true;
                        }
                        break;
                    case "ShiftLeft":
                    case "ShiftRight":
                        keyState.value.run = true;
                        if (keyState.value.fly) {
                            keyState.value.down = true;
                        }
                        break;
                    case "KeyF":
                        keyState.value.fly = !keyState.value.fly;
                        console.log(
                            `Fly mode ${keyState.value.fly ? "enabled" : "disabled"}`,
                        );
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
                        if (keyState.value.fly) {
                            keyState.value.up = false;
                        }
                        break;
                    case "ShiftLeft":
                    case "ShiftRight":
                        keyState.value.run = false;
                        if (keyState.value.fly) {
                            keyState.value.down = false;
                        }
                        break;
                }
                break;
        }
    });
};

// Function to update avatar position and rotation based on physics capsule
const updateAvatarTransform = () => {
    if (!avatarNode.value || !characterController.value) return;

    // Get position from character controller
    const position = characterController.value.getPosition();
    if (position) {
        // Update avatar node to match controller position
        avatarNode.value.position = position.clone();

        // Update current position
        currentPosition.value = {
            x: position.x,
            y: position.y,
            z: position.z,
        };
    }

    // For rotation, we need to handle it separately as character controller doesn't manage rotation
    if (physicsAggregate.value) {
        const capsule = physicsAggregate.value.transformNode as AbstractMesh;
        if (capsule?.rotationQuaternion) {
            avatarNode.value.rotationQuaternion =
                capsule.rotationQuaternion.clone();

            // Update current rotation
            currentRotation.value = {
                x: capsule.rotationQuaternion.x,
                y: capsule.rotationQuaternion.y,
                z: capsule.rotationQuaternion.z,
                w: capsule.rotationQuaternion.w,
            };
        }
    }
};

// Function to update capsule based on current position and rotation
const updateCapsuleTransform = () => {
    if (!physicsAggregate.value) return;

    // Get capsule reference directly
    const capsule = physicsAggregate.value.transformNode as AbstractMesh;
    if (!capsule) return;

    // Update capsule position
    capsule.position = new Vector3(
        currentPosition.value.x,
        currentPosition.value.y,
        currentPosition.value.z,
    );

    // Update capsule rotation
    capsule.rotationQuaternion = new Quaternion(
        currentRotation.value.x,
        currentRotation.value.y,
        currentRotation.value.z,
        currentRotation.value.w,
    );

    // Apply physics changes
    if (physicsAggregate.value.body) {
        physicsAggregate.value.body.computeMassProperties();
    }
};

// Create a throttled function to update the entity in the database
const throttledEntityUpdate = useThrottleFn(async () => {
    if (!entity.entityData.value?.general__entity_id) {
        console.warn("Cannot update entity: No entity ID available");
        return;
    }

    // Prepare the updated meta data
    let metaData = {};

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
            metaData = entity.entityData.value.meta__data;
        }
    }

    // Create clean update object with only needed properties
    const updatedMetaData = {
        type: { value: "Avatar" },
        modelURL: { value: AVATAR_MODEL },
        position: { value: currentPosition.value },
        rotation: { value: currentRotation.value },
    };

    // Preserve existing values if they exist
    if (metaData && typeof metaData === "object") {
        if (
            metaData &&
            "type" in metaData &&
            metaData.type &&
            "value" in metaData.type
        ) {
            updatedMetaData.type = { value: metaData.type.value };
        }
        if (
            metaData &&
            "modelURL" in metaData &&
            metaData.modelURL &&
            "value" in metaData.modelURL
        ) {
            updatedMetaData.modelURL = { value: metaData.modelURL.value };
        }
    }

    // Update the entity with new meta data
    console.log("Updating entity position and rotation:", updatedMetaData);
    entity.executeUpdate("meta__data = $2", [JSON.stringify(updatedMetaData)]);
}, props.throttleInterval ?? 500);

// Register scene before render to update positions if needed
const registerBeforeRender = () => {
    if (!props.scene) return;

    props.scene.registerBeforeRender(() => {
        if (characterController.value && avatarNode.value) {
            // Get the delta time
            const deltaTime = props.scene.getEngine().getDeltaTime() / 1000;

            // Process keyboard input for movement
            processMovement(deltaTime);

            // Check support
            const support = characterController.value.checkSupport(
                deltaTime,
                new Vector3(0, -1, 0),
            );

            // Integrate physics with gravity in normal mode, without gravity in fly mode
            characterController.value.integrate(
                deltaTime,
                support,
                keyState.value.fly ? Vector3.Zero() : new Vector3(0, -9.8, 0),
            );

            // Sync avatar mesh with physics capsule
            updateAvatarTransform();

            // Update camera target to follow avatar
            updateCameraTarget();
        }
    });
};

// Process keyboard input and move character
const processMovement = (deltaTime: number) => {
    if (!characterController.value || !camera.value) return;

    // Calculate movement direction based on key states
    const moveDirection = new Vector3(0, 0, 0);

    // Forward/backward movement
    if (keyState.value.forward) {
        moveDirection.z += 1;
    }
    if (keyState.value.backward) {
        moveDirection.z -= 1;
    }

    // Left/right movement
    if (keyState.value.left) {
        moveDirection.x -= 1;
    }
    if (keyState.value.right) {
        moveDirection.x += 1;
    }

    // Add vertical movement in fly mode
    if (keyState.value.fly) {
        if (keyState.value.up) {
            moveDirection.y += 1;
        }
        if (keyState.value.down) {
            moveDirection.y -= 1;
        }
    }

    // If no movement, return early
    if (moveDirection.length() === 0) {
        return;
    }

    // Normalize the movement direction if moving in multiple directions
    moveDirection.normalize();

    // Apply camera rotation to movement direction
    // Get camera forward direction
    const cameraForward = camera.value
        .getTarget()
        .subtract(camera.value.position);

    // In fly mode, use the actual camera direction including Y component
    // Otherwise in walking mode, ignore Y (flatten the direction)
    if (!keyState.value.fly) {
        cameraForward.y = 0;
    }
    cameraForward.normalize();

    // Get camera right direction
    const cameraRight = Vector3.Cross(Vector3.Up(), cameraForward).normalize();

    // Calculate final direction based on camera orientation
    const finalDirection = cameraForward
        .scale(moveDirection.z)
        .add(cameraRight.scale(moveDirection.x));

    // In fly mode, add vertical movement relative to world up
    if (keyState.value.fly && (keyState.value.up || keyState.value.down)) {
        finalDirection.addInPlace(Vector3.Up().scale(moveDirection.y));
    }

    // Normalize and scale the final direction
    finalDirection.normalize();

    // Apply speed based on mode and run state
    let moveSpeed: number;
    if (keyState.value.fly) {
        // Faster speeds in fly mode
        moveSpeed = keyState.value.run ? 25 : 15; // Fly run or normal fly speed
    } else {
        // Normal walking speeds
        moveSpeed = keyState.value.run ? 8 : 4; // Run or walk speed
    }
    finalDirection.scaleInPlace(moveSpeed * deltaTime);

    // Current velocity
    const currentVelocity = characterController.value.getVelocity();

    // Get upward direction (opposite to gravity)
    const upVector = new Vector3(0, 1, 0);

    // Check if we're on the ground - only needed in non-fly mode
    const support = !keyState.value.fly
        ? characterController.value.checkSupport(
              deltaTime,
              new Vector3(0, -1, 0),
          )
        : null;

    // Direction for movement calculation
    const forwardVector = finalDirection.normalize();

    // Calculate movement
    let newVelocity: Vector3;

    if (keyState.value.fly) {
        // In fly mode, we have direct control without gravity effects
        newVelocity = characterController.value.calculateMovement(
            deltaTime,
            forwardVector,
            upVector,
            currentVelocity,
            Vector3.Zero(),
            finalDirection,
            upVector,
        );
    } else if (support?.supportedState === CharacterSupportedState.SUPPORTED) {
        // On ground (normal walking mode)
        newVelocity = characterController.value.calculateMovement(
            deltaTime,
            forwardVector,
            support.averageSurfaceNormal,
            currentVelocity,
            support.averageSurfaceVelocity,
            finalDirection,
            upVector,
        );
    } else {
        // In air - simpler movement with gravity (normal walking mode)
        newVelocity = characterController.value.calculateMovement(
            deltaTime,
            forwardVector,
            upVector,
            currentVelocity,
            Vector3.Zero(),
            finalDirection,
            upVector,
        );

        // Add gravity if in the air and not in fly mode
        newVelocity.addInPlace(new Vector3(0, -9.8, 0).scale(deltaTime));
    }

    // Apply jumping if requested - only in walk mode
    if (
        !keyState.value.fly &&
        keyState.value.jump &&
        support?.supportedState === CharacterSupportedState.SUPPORTED
    ) {
        // Add jump velocity
        newVelocity.y = 5; // Jump strength

        // Reset jump flag to prevent continuous jumping
        keyState.value.jump = false;
    }

    // Set the new velocity
    characterController.value.setVelocity(newVelocity);

    // Rotate the avatar to face movement direction - Only when there's actual movement
    if (physicsAggregate.value && moveDirection.length() > 0) {
        const capsule = physicsAggregate.value.transformNode as AbstractMesh;
        if (capsule?.rotationQuaternion) {
            // Calculate target rotation
            const targetRotation = Quaternion.FromLookDirectionLH(
                forwardVector,
                Vector3.Up(),
            );

            // Smoothly interpolate rotation
            Quaternion.SlerpToRef(
                capsule.rotationQuaternion,
                targetRotation,
                deltaTime * 10, // Adjust rotation speed
                capsule.rotationQuaternion,
            );
        }
    }
};

// Function to move the avatar in a specific direction (used for external control)
const moveAvatar = (direction: Vector3, deltaTime: number) => {
    if (!characterController.value) return;

    // Apply speed based on mode and run state
    let moveSpeed: number;
    if (keyState.value.fly) {
        // Faster speeds in fly mode
        moveSpeed = keyState.value.run ? 25 : 15; // Fly run or normal fly speed
    } else {
        // Normal walking speeds
        moveSpeed = keyState.value.run ? 8 : 4; // Run or walk speed
    }

    // Scale the direction by speed
    const scaledDirection = direction.normalize().scale(moveSpeed * deltaTime);

    // Calculate movement using calculateMovement instead of directly applying velocity
    const currentVelocity = characterController.value.getVelocity();
    const upVector = new Vector3(0, 1, 0);
    const forwardVector = scaledDirection.normalize();

    // Check support - only relevant in non-fly mode
    const support = !keyState.value.fly
        ? characterController.value.checkSupport(
              deltaTime,
              new Vector3(0, -1, 0),
          )
        : null;

    let newVelocity: Vector3;
    if (keyState.value.fly) {
        // In fly mode, direct control without gravity
        newVelocity = characterController.value.calculateMovement(
            deltaTime,
            forwardVector,
            upVector,
            currentVelocity,
            Vector3.Zero(),
            scaledDirection,
            upVector,
        );
    } else if (support?.supportedState === CharacterSupportedState.SUPPORTED) {
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

        // Add gravity when not in fly mode
        if (!keyState.value.fly) {
            newVelocity.addInPlace(new Vector3(0, -9.8, 0).scale(deltaTime));
        }
    }

    // Set the velocity
    characterController.value.setVelocity(newVelocity);

    if (support) {
        // Integrate physics - no gravity in fly mode
        characterController.value.integrate(
            deltaTime,
            support,
            keyState.value.fly ? Vector3.Zero() : new Vector3(0, -9.8, 0),
        );
    }

    // Update position and rotation
    updateAvatarTransform();
    throttledEntityUpdate();
    emit("update:position", currentPosition.value);
    emit("update:rotation", currentRotation.value);
};

// Function to rotate the avatar
const rotateAvatar = (yawAmount: number, pitchAmount = 0) => {
    if (!physicsAggregate.value) return;

    // Get capsule reference directly
    const capsule = physicsAggregate.value.transformNode as AbstractMesh;
    if (!capsule?.rotationQuaternion) return;

    // Create rotation quaternion for yaw (around Y axis)
    const yawRotation = Quaternion.RotationAxis(Vector3.Up(), yawAmount);

    // Apply rotation to current quaternion
    const newRotation = capsule.rotationQuaternion.multiply(yawRotation);
    capsule.rotationQuaternion = newRotation;

    // Update current rotation
    currentRotation.value = {
        x: newRotation.x,
        y: newRotation.y,
        z: newRotation.z,
        w: newRotation.w,
    };

    // Update avatar to match
    updateAvatarTransform();
    throttledEntityUpdate();
    emit("update:rotation", currentRotation.value);
};

// Watch for changes to currentPosition
watch(
    currentPosition,
    (newPosition) => {
        updateCapsuleTransform();
        throttledEntityUpdate();
        emit("update:position", newPosition);
    },
    { deep: true },
);

// Watch for changes to currentRotation
watch(
    currentRotation,
    (newRotation) => {
        updateCapsuleTransform();
        throttledEntityUpdate();
        emit("update:rotation", newRotation);
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

// Watch for asset data to load model
watch(
    () => asset.assetData.value,
    (assetData) => {
        if (assetData?.blobUrl && avatarMeshes.value.length === 0) {
            console.log("Asset data ready for avatar, loading model.");
            loadAvatarModel();
        }
    },
);

// Watch for asset errors
watch(
    () => asset.error.value,
    (error) => {
        if (error) {
            console.error("Asset Error (avatar):", error);
            hasError.value = true;
            errorMessage.value = `Asset error: ${error}`;
        }
    },
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

// Manage asset and entity based on connection status
const manageAssetAndEntity = () => {
    console.log("Managing asset and entity for avatar...");

    // 1. Load asset
    asset.executeLoad();

    // 2. Retrieve entity, create if not found
    entity.executeRetrieve();

    // Watch for retrieve completion to create if needed
    const stopWatch = watch(
        [() => entity.retrieving.value, () => entity.error.value],
        ([retrieving, error], [wasRetrieving]) => {
            if (wasRetrieving && !retrieving) {
                if (!entity.entityData.value && !error) {
                    console.log("Avatar entity not found, creating...");
                    entity.executeCreate();
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
                    "Vircadia connected, managing asset and entity for avatar.",
                );
                manageAssetAndEntity();
            } else if (newStatus !== "connected") {
                console.log(
                    "Vircadia disconnected, cleaning up avatar resources.",
                );
                for (const mesh of avatarMeshes.value) {
                    mesh.dispose();
                }
                avatarMeshes.value = [];
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
    asset.cleanup();

    // Dispose all meshes
    for (const mesh of avatarMeshes.value) {
        mesh.dispose();
    }
    avatarMeshes.value = [];

    // Clean up physics
    if (physicsAggregate.value) {
        physicsAggregate.value.dispose();
    }

    // Clean up avatar node
    if (avatarNode.value) {
        avatarNode.value.dispose();
    }

    console.log("Cleanup complete for avatar.");
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
    flyMode: computed(() => keyState.value.fly),
});
</script>