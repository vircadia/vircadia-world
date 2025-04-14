import type { Entity } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import type { VircadiaBabylonScript } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/vircadia.babylon.core";
import {
    MeshBuilder,
    Vector3,
    UniversalCamera,
    ActionManager,
    ExecuteCodeAction,
    type Mesh,
    type Scene,
} from "@babylonjs/core";
import { Inspector } from "@babylonjs/inspector";
import { log } from "../../../../../sdk/vircadia-world-sdk-ts/module/general/log";

interface Position {
    x?: number;
    y?: number;
    z?: number;
}

interface Rotation {
    x?: number;
    y?: number;
    z?: number;
}

interface EntityModel {
    transform__position?: Position;
    transform__rotation?: Rotation;
}

interface EntityMetaData {
    transform__position?: Position;
    transform__rotation?: Rotation;
    entity_model?: EntityModel;
}

// Extended entity interface to store character components
interface CharacterEntity extends Entity.I_Entity {
    _characterMesh?: Mesh;
    _camera?: UniversalCamera;
    _moveForward: boolean;
    _moveBackward: boolean;
    _moveRight: boolean;
    _moveLeft: boolean;
    _jump: boolean;
    _speed: number;
    _rotationSpeed: number;
    _jumpForce: number;
    _gravity: number;
    _grounded: boolean;
    _yVelocity: number;
    _logInterval?: number;
}

// Extend Scene to include our custom property
interface ExtendedScene extends Scene {
    alreadyLocked?: boolean;
}

function vircadiaScriptMain(
    context: VircadiaBabylonScript.I_Context,
): VircadiaBabylonScript.ScriptReturn {
    return {
        hooks: {
            onScriptInitialize: (entityData: Entity.I_Entity): void => {
                if (context.Vircadia.Debug) {
                    console.log(
                        "Character controller initialized for entity:",
                        entityData.general__entity_id,
                    );
                }

                const characterEntity = entityData as CharacterEntity;
                const scene = context.Babylon.Scene as ExtendedScene;

                // Get canvas - we need to get it differently as Engine is not directly accessible
                const canvas = scene.getEngine().getRenderingCanvas();

                // Initialize movement state
                characterEntity._moveForward = false;
                characterEntity._moveBackward = false;
                characterEntity._moveRight = false;
                characterEntity._moveLeft = false;
                characterEntity._jump = false;
                characterEntity._speed = 0.15;
                characterEntity._rotationSpeed = 0.05;
                characterEntity._jumpForce = 0.2;
                characterEntity._gravity = 0.01;
                characterEntity._grounded = true;
                characterEntity._yVelocity = 0;

                // Create character mesh
                characterEntity._characterMesh = MeshBuilder.CreateCapsule(
                    "character",
                    { radius: 0.5, height: 1.8 },
                    scene,
                );

                // Set initial position based on entity data
                const metaData =
                    entityData.meta__data as unknown as EntityMetaData;
                const transformPosition = metaData.transform__position;
                const entityModel = metaData.entity_model;
                const position =
                    transformPosition || entityModel?.transform__position;

                if (position) {
                    characterEntity._characterMesh.position = new Vector3(
                        position.x || 0,
                        position.y || 0,
                        position.z || 0,
                    );
                }

                // Create and setup camera
                characterEntity._camera = new UniversalCamera(
                    "playerCamera",
                    new Vector3(0, 1.7, 0),
                    scene,
                );
                characterEntity._camera.parent = characterEntity._characterMesh;

                // Only attach control if canvas exists
                if (canvas) {
                    characterEntity._camera.attachControl(canvas, true);

                    // Lock pointer for better controls
                    scene.onPointerDown = () => {
                        if (!scene.alreadyLocked) {
                            canvas.requestPointerLock();
                            scene.alreadyLocked = true;
                        } else {
                            canvas.requestPointerLock();
                        }
                    };
                }

                // Setup keyboard controls
                scene.actionManager = new ActionManager(scene);

                // Key down events
                scene.actionManager.registerAction(
                    new ExecuteCodeAction(
                        ActionManager.OnKeyDownTrigger,
                        (evt) => {
                            const sourceEvent =
                                evt.sourceEvent as KeyboardEvent;
                            switch (sourceEvent.key.toLowerCase()) {
                                case "w":
                                    characterEntity._moveForward = true;
                                    break;
                                case "s":
                                    characterEntity._moveBackward = true;
                                    break;
                                case "a":
                                    characterEntity._moveLeft = true;
                                    break;
                                case "d":
                                    characterEntity._moveRight = true;
                                    break;
                                case " ":
                                    if (characterEntity._grounded) {
                                        characterEntity._jump = true;
                                    }
                                    break;
                                case "/": {
                                    log({
                                        message: "Toggling debug layer",
                                        debug: context.Vircadia.Debug,
                                        suppress: context.Vircadia.Suppress,
                                    });
                                    if (!Inspector.IsVisible) {
                                        Inspector.Show(scene, {
                                            overlay: true,
                                            showExplorer: true,
                                            showInspector: true,
                                            embedMode: true,
                                        });
                                    } else {
                                        Inspector.Hide();
                                    }
                                    break;
                                }
                            }
                        },
                    ),
                );

                // Key up events
                scene.actionManager.registerAction(
                    new ExecuteCodeAction(
                        ActionManager.OnKeyUpTrigger,
                        (evt) => {
                            const sourceEvent =
                                evt.sourceEvent as KeyboardEvent;
                            switch (sourceEvent.key.toLowerCase()) {
                                case "w":
                                    characterEntity._moveForward = false;
                                    break;
                                case "s":
                                    characterEntity._moveBackward = false;
                                    break;
                                case "a":
                                    characterEntity._moveLeft = false;
                                    break;
                                case "d":
                                    characterEntity._moveRight = false;
                                    break;
                                case "/":
                                    break;
                            }
                        },
                    ),
                );

                // Setup position logging - using window.setInterval for browser context
                // Using a number type for the interval ID instead of NodeJS.Timeout
                characterEntity._logInterval = window.setInterval(() => {
                    if (characterEntity._characterMesh) {
                        const pos = characterEntity._characterMesh.position;
                        const rot = characterEntity._camera
                            ? characterEntity._camera.rotation
                            : new Vector3(0, 0, 0);
                        console.log(
                            `Position: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}) | Rotation: (${rot.x.toFixed(2)}, ${rot.y.toFixed(2)}, ${rot.z.toFixed(2)})`,
                        );
                    }
                }, 1000); // Log every second

                // Register for before render to handle movement
                scene.registerBeforeRender(() => {
                    if (
                        characterEntity._characterMesh &&
                        characterEntity._camera
                    ) {
                        // Get forward and right directions based on camera rotation
                        const cameraDirection =
                            characterEntity._camera.getDirection(
                                Vector3.Forward(),
                            );
                        cameraDirection.y = 0; // Keep movement on horizontal plane
                        cameraDirection.normalize();

                        const cameraRight =
                            characterEntity._camera.getDirection(
                                Vector3.Right(),
                            );
                        cameraRight.y = 0;
                        cameraRight.normalize();

                        // Apply movement based on key states
                        const moveVector = new Vector3(0, 0, 0);

                        if (characterEntity._moveForward) {
                            moveVector.addInPlace(
                                cameraDirection.scale(characterEntity._speed),
                            );
                        }
                        if (characterEntity._moveBackward) {
                            moveVector.addInPlace(
                                cameraDirection.scale(-characterEntity._speed),
                            );
                        }
                        if (characterEntity._moveRight) {
                            moveVector.addInPlace(
                                cameraRight.scale(characterEntity._speed),
                            );
                        }
                        if (characterEntity._moveLeft) {
                            moveVector.addInPlace(
                                cameraRight.scale(-characterEntity._speed),
                            );
                        }

                        // Apply jump and gravity
                        if (
                            characterEntity._jump &&
                            characterEntity._grounded
                        ) {
                            characterEntity._yVelocity =
                                characterEntity._jumpForce;
                            characterEntity._grounded = false;
                            characterEntity._jump = false;
                        }

                        // Apply gravity
                        characterEntity._yVelocity -= characterEntity._gravity;

                        // Move character
                        characterEntity._characterMesh.position.x +=
                            moveVector.x;
                        characterEntity._characterMesh.position.z +=
                            moveVector.z;
                        characterEntity._characterMesh.position.y +=
                            characterEntity._yVelocity;

                        // Simple ground check (assuming y=0 is ground)
                        if (characterEntity._characterMesh.position.y <= 0) {
                            characterEntity._characterMesh.position.y = 0;
                            characterEntity._yVelocity = 0;
                            characterEntity._grounded = true;
                        }
                    }
                });
            },

            onScriptTeardown: (): void => {
                if (context.Vircadia.Debug) {
                    console.log("Character controller being torn down");
                }

                // We can't access the entity directly in onScriptTeardown as it's not provided
                // So we'll need to do any cleanup that doesn't require the entity
                // The entity references will be cleaned up by the system
            },
        },
    };
}

// Make the function available in the global scope
// @ts-ignore - Adding to global scope for script system
globalThis.vircadiaScriptMain = vircadiaScriptMain;
