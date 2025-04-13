import type { Entity } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import type { VircadiaThreeScript } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.three.script";
import {
    Group,
    PerspectiveCamera,
    Vector3,
    Quaternion,
    Raycaster,
    Clock,
} from "three";
import { log } from "../../../../../sdk/vircadia-world-sdk-ts/module/general/log";

// Define character controller configuration interface
interface CharacterControllerConfig {
    // Camera settings
    cameraHeight?: number;
    cameraOffset?: {
        x?: number;
        y?: number;
        z?: number;
    };
    cameraFov?: number;
    cameraNear?: number;
    cameraFar?: number;

    // Movement settings
    movementSpeed?: number;
    turnSpeed?: number;
    jumpHeight?: number;
    gravity?: number;

    // Collision settings
    enableCollisions?: boolean;
    characterHeight?: number;
    characterRadius?: number;

    // Control settings
    invertY?: boolean;
    enableMouseLook?: boolean;
    mouseSensitivity?: number;

    // Position settings
    position?: {
        x?: number;
        y?: number;
        z?: number;
    };
}

interface CharacterControllerMetaData {
    controller_config?: CharacterControllerConfig;
    [key: string]: unknown;
}

function vircadiaScriptMain(
    context: VircadiaThreeScript.I_Context,
): VircadiaThreeScript.ScriptReturn {
    // Store references for cleanup
    let characterGroup: Group | null = null;
    let camera: PerspectiveCamera | null = null;
    let raycaster: Raycaster | null = null;
    const clock = new Clock();

    // Movement state
    const keys: { [key: string]: boolean } = {};
    const moveDirection = new Vector3();
    const rotationQuaternion = new Quaternion();

    // Character state
    let isJumping = false;
    let velocity = new Vector3();
    let position = new Vector3();
    let config: CharacterControllerConfig = {};

    // Mouse look variables
    let mouseLookEnabled = false;
    let pointerLocked = false;
    let mouseX = 0;
    let mouseY = 0;

    // DOM element for event listeners
    let domElement: HTMLElement | null = null;

    // Initialize character controller
    async function initializeController(
        entity: Entity.I_Entity,
    ): Promise<void> {
        // Get configuration from metadata
        const metaData = entity.meta__data as CharacterControllerMetaData;
        config = metaData?.controller_config || {};

        // Create character group
        characterGroup = new Group();
        characterGroup.name = `${entity.general__entity_id}_character`;

        // Set initial position from entity properties if available
        // Using entity metadata or coordinates since position may not be directly on entity
        const initialPosition =
            (entity as any).position ||
            (metaData?.controller_config?.position
                ? {
                      x: metaData.controller_config.position.x || 0,
                      y: metaData.controller_config.position.y || 0,
                      z: metaData.controller_config.position.z || 0,
                  }
                : { x: 0, y: 0, z: 0 });

        position.set(
            initialPosition.x || 0,
            initialPosition.y || 0,
            initialPosition.z || 0,
        );
        characterGroup.position.copy(position);

        // Create camera
        const fov = config.cameraFov || 75;
        const near = config.cameraNear || 0.1;
        const far = config.cameraFar || 1000;
        camera = new PerspectiveCamera(
            fov,
            window.innerWidth / window.innerHeight,
            near,
            far,
        );

        // Set camera position
        const cameraHeight = config.cameraHeight || 1.6; // Typical eye height
        const cameraOffset = config.cameraOffset || { x: 0, y: 0, z: 0 };

        camera.position.set(
            cameraOffset.x || 0,
            cameraHeight + (cameraOffset.y || 0),
            cameraOffset.z || 0,
        );

        // Add camera to character group
        characterGroup.add(camera);

        // Create raycaster for collisions if enabled
        if (config.enableCollisions) {
            raycaster = new Raycaster();
        }

        // Add character to scene
        context.Three.Scene.add(characterGroup);

        // Set the active camera
        if (typeof context.Three.SetActiveCamera === "function") {
            context.Three.SetActiveCamera(camera);
        } else {
            // Fallback if SetActiveCamera is not available
            (context.Three as any).activeCamera = camera;
            log({
                message: "SetActiveCamera not available, using fallback method",
                debug: context.Vircadia.Debug,
                suppress: context.Vircadia.Suppress,
            });
        }

        // Initialize controls
        setupControls();

        // Initialize mouse look if enabled
        if (config.enableMouseLook !== false) {
            setupMouseLook();
        }

        log({
            message: "Character controller initialized successfully",
            data: {
                entityId: entity.general__entity_id,
            },
            debug: context.Vircadia.Debug,
            suppress: context.Vircadia.Suppress,
        });
    }

    // Set up keyboard controls
    function setupControls(): void {
        // Get DOM element for event listeners
        domElement = document.body;

        // Keyboard event listeners
        domElement.addEventListener("keydown", onKeyDown);
        domElement.addEventListener("keyup", onKeyUp);

        // Handle window resize
        window.addEventListener("resize", onWindowResize);
    }

    // Set up mouse look controls
    function setupMouseLook(): void {
        if (!domElement) return;

        mouseLookEnabled = config.enableMouseLook !== false;

        if (mouseLookEnabled) {
            // Click to enable pointer lock
            domElement.addEventListener("click", requestPointerLock);

            // Mouse move listener
            document.addEventListener("mousemove", onMouseMove);

            // Pointer lock change listeners
            document.addEventListener("pointerlockchange", onPointerLockChange);
            document.addEventListener("pointerlockerror", onPointerLockError);
        }
    }

    // Handle key down events
    function onKeyDown(event: KeyboardEvent): void {
        keys[event.code] = true;
    }

    // Handle key up events
    function onKeyUp(event: KeyboardEvent): void {
        keys[event.code] = false;

        // Handle jump
        if (event.code === "Space" && !isJumping && config.jumpHeight) {
            jump();
        }
    }

    // Handle mouse move events for camera control
    function onMouseMove(event: MouseEvent): void {
        if (!pointerLocked || !mouseLookEnabled) return;

        const sensitivity = config.mouseSensitivity || 0.002;
        const invertY = config.invertY || false;

        mouseX += event.movementX * sensitivity;
        mouseY += event.movementY * (invertY ? 1 : -1) * sensitivity;

        // Clamp vertical look to avoid camera flipping
        mouseY = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, mouseY));
    }

    // Request pointer lock for mouse look
    function requestPointerLock(): void {
        if (!mouseLookEnabled || !domElement) return;

        domElement.requestPointerLock();
    }

    // Handle pointer lock change
    function onPointerLockChange(): void {
        pointerLocked = document.pointerLockElement === domElement;
    }

    // Handle pointer lock errors
    function onPointerLockError(): void {
        console.error("Pointer lock error");
    }

    // Handle window resize
    function onWindowResize(): void {
        if (!camera) return;

        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
    }

    // Handle jumping
    function jump(): void {
        if (isJumping) return;

        isJumping = true;
        velocity.y = config.jumpHeight || 2;
    }

    // Update character movement and camera
    function updateCharacter(deltaTime: number): void {
        if (!characterGroup || !camera) return;

        // Get movement speed
        const movementSpeed = config.movementSpeed || 5;
        const turnSpeed = config.turnSpeed || 2;

        // Reset movement direction
        moveDirection.set(0, 0, 0);

        // Handle keyboard input
        if (keys.KeyW || keys.ArrowUp) moveDirection.z = -1;
        if (keys.KeyS || keys.ArrowDown) moveDirection.z = 1;
        if (keys.KeyA || keys.ArrowLeft) moveDirection.x = -1;
        if (keys.KeyD || keys.ArrowRight) moveDirection.x = 1;

        // Normalize movement direction to avoid faster diagonal movement
        if (moveDirection.length() > 0) {
            moveDirection.normalize();
        }

        // Get character's forward direction
        const forward = new Vector3(0, 0, -1);
        forward.applyQuaternion(characterGroup.quaternion);

        // Get character's right direction
        const right = new Vector3(1, 0, 0);
        right.applyQuaternion(characterGroup.quaternion);

        // Calculate movement vector
        const movement = new Vector3();
        movement.addScaledVector(
            forward,
            moveDirection.z * movementSpeed * deltaTime,
        );
        movement.addScaledVector(
            right,
            moveDirection.x * movementSpeed * deltaTime,
        );

        // Apply gravity
        const gravity = config.gravity || 9.8;

        if (isJumping) {
            velocity.y -= gravity * deltaTime;
            movement.y = velocity.y * deltaTime;

            // Check if landed
            if (characterGroup.position.y <= position.y) {
                characterGroup.position.y = position.y;
                isJumping = false;
                velocity.y = 0;
            }
        }

        // Update position
        characterGroup.position.add(movement);
        position.copy(characterGroup.position);

        // Update rotation from mouse if enabled
        if (mouseLookEnabled && pointerLocked) {
            // Rotate character horizontally (yaw)
            characterGroup.rotation.y = -mouseX;

            // Rotate camera vertically (pitch)
            camera.rotation.x = mouseY;
        }
        // Otherwise use keyboard for rotation
        else if (!mouseLookEnabled) {
            if (keys.KeyQ) {
                characterGroup.rotation.y += turnSpeed * deltaTime;
            }
            if (keys.KeyE) {
                characterGroup.rotation.y -= turnSpeed * deltaTime;
            }
        }
    }

    // Clean up resources
    function cleanup(): void {
        // Remove event listeners
        if (domElement) {
            domElement.removeEventListener("keydown", onKeyDown);
            domElement.removeEventListener("keyup", onKeyUp);
            domElement.removeEventListener("click", requestPointerLock);
        }

        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("pointerlockchange", onPointerLockChange);
        document.removeEventListener("pointerlockerror", onPointerLockError);
        window.removeEventListener("resize", onWindowResize);

        // Remove character from scene
        if (characterGroup) {
            context.Three.Scene.remove(characterGroup);
            characterGroup = null;
        }

        // Clear camera reference
        camera = null;
        raycaster = null;
    }

    return {
        hooks: {
            onScriptInitialize: async (
                entity: Entity.I_Entity,
            ): Promise<void> => {
                if (context.Vircadia.Debug) {
                    console.log(
                        "Character controller script initialized for entity:",
                        entity.general__entity_id,
                    );
                }

                try {
                    await initializeController(entity);
                } catch (error) {
                    log({
                        message: "Error initializing character controller",
                        data: {
                            entityId: entity.general__entity_id,
                            error,
                        },
                        type: "error",
                        debug: context.Vircadia.Debug,
                        suppress: context.Vircadia.Suppress,
                    });
                }
            },

            onScriptUpdate: (scriptData: Entity.Script.I_Script): void => {
                // Update character position and camera
                // Extract delta time from script data or use clock
                const deltaTime = clock.getDelta();
                updateCharacter(deltaTime);
            },

            onEntityUpdate: (updatedEntity: Entity.I_Entity): void => {
                if (context.Vircadia.Debug) {
                    console.log(
                        "Character entity updated:",
                        updatedEntity.general__entity_id,
                    );
                }

                // Update configuration if needed
                const metaData =
                    updatedEntity.meta__data as CharacterControllerMetaData;
                const newConfig = metaData?.controller_config || {};

                // Check if config has changed significantly
                const configChanged =
                    JSON.stringify(config) !== JSON.stringify(newConfig);

                if (configChanged) {
                    // Update config
                    config = newConfig;

                    // Update camera properties if they changed
                    if (camera) {
                        if (newConfig.cameraFov) {
                            camera.fov = newConfig.cameraFov;
                            camera.updateProjectionMatrix();
                        }

                        if (newConfig.cameraNear || newConfig.cameraFar) {
                            camera.near = newConfig.cameraNear || camera.near;
                            camera.far = newConfig.cameraFar || camera.far;
                            camera.updateProjectionMatrix();
                        }

                        // Update camera position if offset changed
                        if (newConfig.cameraHeight || newConfig.cameraOffset) {
                            const height =
                                newConfig.cameraHeight ||
                                config.cameraHeight ||
                                1.6;
                            const offset = newConfig.cameraOffset ||
                                config.cameraOffset || { x: 0, y: 0, z: 0 };

                            camera.position.set(
                                offset.x || 0,
                                height + (offset.y || 0),
                                offset.z || 0,
                            );
                        }
                    }

                    // Update mouse look settings
                    if (newConfig.enableMouseLook !== undefined) {
                        mouseLookEnabled = newConfig.enableMouseLook;
                    }
                }

                // Update position if entity position changed
                if (updatedEntity && characterGroup) {
                    // Get position from entity or metadata
                    const entityPosition =
                        (updatedEntity as any).position ||
                        ((
                            updatedEntity.meta__data as CharacterControllerMetaData
                        )?.controller_config?.position
                            ? {
                                  x:
                                      (
                                          updatedEntity.meta__data as CharacterControllerMetaData
                                      ).controller_config?.position?.x || 0,
                                  y:
                                      (
                                          updatedEntity.meta__data as CharacterControllerMetaData
                                      ).controller_config?.position?.y || 0,
                                  z:
                                      (
                                          updatedEntity.meta__data as CharacterControllerMetaData
                                      ).controller_config?.position?.z || 0,
                              }
                            : null);

                    if (entityPosition) {
                        // Only update if position actually changed
                        const newPosition = new Vector3(
                            entityPosition.x || 0,
                            entityPosition.y || 0,
                            entityPosition.z || 0,
                        );

                        if (!position.equals(newPosition)) {
                            position.copy(newPosition);
                            characterGroup.position.copy(position);
                        }
                    }
                }
            },

            onScriptTeardown: (): void => {
                if (context.Vircadia.Debug) {
                    console.log("Character controller script being torn down");
                }

                // Clean up resources
                cleanup();
            },
        },
    };
}

// Make the function available in the global scope
// @ts-ignore - Adding to global scope for script system
globalThis.vircadiaScriptMain = vircadiaScriptMain;
