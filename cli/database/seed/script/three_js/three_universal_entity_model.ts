import type { Entity } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import type { VircadiaThreeScript } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/vircadia.three.core";
import type { Communication } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import {
    Group,
    type Object3D,
    type Mesh,
    MeshStandardMaterial,
    Color,
    REVISION as THREE_REVISION,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { log } from "../../../../../sdk/vircadia-world-sdk-ts/module/general/log";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

// Log Three.js version for debugging multiple instances
console.log(
    `[three_universal_entity_model] Loaded Three.js r${THREE_REVISION}`,
);
// Log the module object to check if it's the same instance
console.log("[three_universal_entity_model] Three module:", {
    three: { Group, MeshStandardMaterial, Color, GLTFLoader },
});

// Define model configuration interface
interface ModelConfig {
    // Asset config
    assetName?: string;
    castShadow?: boolean;
    receiveShadow?: boolean;

    // Position
    position?: {
        x?: number;
        y?: number;
        z?: number;
    };

    // Rotation (in radians)
    rotation?: {
        x?: number;
        y?: number;
        z?: number;
    };

    // Scale
    scale?: {
        x?: number;
        y?: number;
        z?: number;
    };

    // Material overrides
    material?: {
        color?: {
            r?: number;
            g?: number;
            b?: number;
        };
        metalness?: number;
        roughness?: number;
        emissive?: {
            r?: number;
            g?: number;
            b?: number;
        };
        emissiveIntensity?: number;
    };
}

interface EntityModelMetaData {
    model_config?: ModelConfig;
    [key: string]: unknown;
}

// Define the asset fields we need from the DB response
type AssetDataFields = Pick<
    Entity.Asset.I_Asset,
    "asset__data__bytea" | "asset__data__base64"
>;

function vircadiaScriptMain(
    context: VircadiaThreeScript.I_Context,
): VircadiaThreeScript.ScriptReturn {
    // Store references for cleanup
    let modelGroup: Group | null = null;

    // Flag to track if model is loaded
    let modelLoaded = false;

    // Store asset name for later reference
    let currentAssetName = "";

    /**
     * Helper function to convert asset data to ArrayBuffer
     */
    async function assetDataToArrayBuffer(
        assetData: unknown,
    ): Promise<ArrayBuffer | null> {
        try {
            // Case 1: Already an ArrayBuffer
            if (assetData instanceof ArrayBuffer) {
                return assetData;
            }

            // Case 2: Buffer format with type and data array
            if (
                typeof assetData === "object" &&
                assetData !== null &&
                "type" in assetData &&
                assetData.type === "Buffer" &&
                "data" in assetData &&
                Array.isArray(assetData.data)
            ) {
                return new Uint8Array(assetData.data).buffer;
            }

            // Case 3: Base64 string
            if (typeof assetData === "string") {
                // Remove any potential URL prefix (like data:application/octet-stream;base64,)
                const commaIndex = assetData.indexOf(",");
                const base64String =
                    commaIndex !== -1
                        ? assetData.substring(commaIndex + 1)
                        : assetData;

                const binary = atob(base64String);
                const bytes = new Uint8Array(binary.length);

                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }

                return bytes.buffer;
            }

            // Case 4: Array-like object with numeric keys
            if (typeof assetData === "object" && assetData !== null) {
                const keys = Object.keys(assetData);
                const isArrayLike = keys.every(
                    (key) => !Number.isNaN(Number(key)),
                );

                if (isArrayLike) {
                    const dataArray: number[] = [];
                    const sortedKeys = keys.sort(
                        (a, b) => Number(a) - Number(b),
                    );

                    for (const key of sortedKeys) {
                        dataArray.push(
                            (assetData as Record<string, number>)[key],
                        );
                    }

                    return new Uint8Array(dataArray).buffer;
                }
            }

            log({
                message: "Unknown asset data format",
                data: {
                    type: typeof assetData,
                    preview: JSON.stringify(assetData).substring(0, 100),
                },
                type: "error",
                debug: context.Vircadia.Debug,
                suppress: context.Vircadia.Suppress,
            });
            return null;
        } catch (error) {
            log({
                message: "Error converting asset data to ArrayBuffer",
                data: { error },
                type: "error",
                debug: context.Vircadia.Debug,
                suppress: context.Vircadia.Suppress,
            });
            return null;
        }
    }

    /**
     * Loads a model from asset data
     */
    async function loadModelFromAssetData(
        entity: Entity.I_Entity,
        assetName: string,
        config: ModelConfig,
    ): Promise<Group | null> {
        if (!assetName) {
            log({
                message: "No asset name specified for model",
                data: { entityId: entity.general__entity_id },
                type: "warn",
                debug: context.Vircadia.Debug,
                suppress: context.Vircadia.Suppress,
            });
            return null;
        }

        try {
            // Query the asset data from the database
            const response = await context.Vircadia.Utilities.Query.execute<
                AssetDataFields[]
            >({
                query: `
                    SELECT 
                        asset__data__bytea, 
                        asset__data__base64
                    FROM entity.entity_assets 
                    WHERE general__asset_file_name = $1
                `,
                parameters: [assetName],
            });

            if ("errorMessage" in response && response.errorMessage) {
                throw new Error(
                    `Database query error: ${response.errorMessage}`,
                );
            }

            if (
                !("result" in response) ||
                !response.result ||
                !Array.isArray(response.result) ||
                response.result.length === 0
            ) {
                throw new Error(`Asset not found: ${assetName}`);
            }

            // Since we've verified result exists and has elements, it's safe to access
            const assetData = response.result[0] as unknown as AssetDataFields;
            let modelData: ArrayBuffer | null = null;

            // Try to convert asset data to ArrayBuffer
            if (assetData?.asset__data__bytea) {
                modelData = await assetDataToArrayBuffer(
                    assetData.asset__data__bytea,
                );
            } else if (assetData?.asset__data__base64) {
                modelData = await assetDataToArrayBuffer(
                    assetData.asset__data__base64,
                );
            }

            if (!modelData) {
                throw new Error(
                    `Failed to process asset data for: ${assetName}`,
                );
            }

            // Create a new group to hold the model
            const group = new Group();
            group.name = `${entity.general__entity_id}_model`;

            // Load the model using GLTFLoader
            const model = await loadGLTF(modelData);

            if (!model) {
                throw new Error(`Failed to load model: ${assetName}`);
            }

            // Apply configuration
            group.add(model);

            // Apply position
            if (config.position) {
                group.position.set(
                    config.position.x || 0,
                    config.position.y || 0,
                    config.position.z || 0,
                );
            }

            // Apply rotation
            if (config.rotation) {
                group.rotation.set(
                    config.rotation.x || 0,
                    config.rotation.y || 0,
                    config.rotation.z || 0,
                );
            }

            // Apply scale
            if (config.scale) {
                group.scale.set(
                    config.scale.x !== undefined ? config.scale.x : 1,
                    config.scale.y !== undefined ? config.scale.y : 1,
                    config.scale.z !== undefined ? config.scale.z : 1,
                );
            }

            // Apply shadows recursively
            if (
                config.castShadow !== undefined ||
                config.receiveShadow !== undefined
            ) {
                group.traverse((object) => {
                    if ((object as Mesh).isMesh) {
                        const mesh = object as Mesh;
                        if (config.castShadow !== undefined) {
                            mesh.castShadow = config.castShadow;
                        }
                        if (config.receiveShadow !== undefined) {
                            mesh.receiveShadow = config.receiveShadow;
                        }
                    }
                });
            }

            // Apply material overrides if specified
            if (config.material) {
                group.traverse((object) => {
                    if ((object as Mesh).isMesh) {
                        const mesh = object as Mesh;
                        const materials = Array.isArray(mesh.material)
                            ? mesh.material
                            : [mesh.material];

                        for (const material of materials) {
                            if (material instanceof MeshStandardMaterial) {
                                // Apply material properties
                                if (config.material?.color) {
                                    const color = config.material.color;
                                    material.color = new Color(
                                        color.r !== undefined ? color.r : 1.0,
                                        color.g !== undefined ? color.g : 1.0,
                                        color.b !== undefined ? color.b : 1.0,
                                    );
                                }

                                if (config.material?.metalness !== undefined) {
                                    material.metalness =
                                        config.material.metalness;
                                }

                                if (config.material?.roughness !== undefined) {
                                    material.roughness =
                                        config.material.roughness;
                                }

                                if (config.material?.emissive) {
                                    const emissive = config.material.emissive;
                                    material.emissive = new Color(
                                        emissive.r !== undefined
                                            ? emissive.r
                                            : 0.0,
                                        emissive.g !== undefined
                                            ? emissive.g
                                            : 0.0,
                                        emissive.b !== undefined
                                            ? emissive.b
                                            : 0.0,
                                    );
                                }

                                if (
                                    config.material?.emissiveIntensity !==
                                    undefined
                                ) {
                                    material.emissiveIntensity =
                                        config.material.emissiveIntensity;
                                }
                            }
                        }
                    }
                });
            }

            return group;
        } catch (error: unknown) {
            log({
                message: "Error loading model from asset data",
                data: {
                    entityId: entity.general__entity_id,
                    assetName,
                    error,
                },
                type: "error",
                debug: context.Vircadia.Debug,
                suppress: context.Vircadia.Suppress,
            });
            return null;
        }
    }

    /**
     * Load GLTF/GLB model
     */
    async function loadGLTF(data: ArrayBuffer): Promise<Object3D> {
        return new Promise((resolve, reject) => {
            try {
                const loader = new GLTFLoader();
                const dracoLoader = new DRACOLoader();
                dracoLoader.setDecoderPath("/examples/jsm/libs/draco/");
                loader.setDRACOLoader(dracoLoader);

                // Log data size for debugging
                log({
                    message: "Attempting to load GLTF model",
                    data: { bufferSize: data.byteLength },
                    debug: context.Vircadia.Debug,
                    suppress: context.Vircadia.Suppress,
                });

                loader.parse(
                    data,
                    "",
                    (gltf) => {
                        log({
                            message: "GLTF model loaded successfully",
                            debug: context.Vircadia.Debug,
                            suppress: context.Vircadia.Suppress,
                        });
                        const model = gltf.scene;
                        resolve(model);
                    },
                    (error) => {
                        log({
                            message: "GLTF loader error",
                            data: {
                                errorMessage: error.message || String(error),
                                errorStack:
                                    "stack" in error ? error.stack : undefined,
                                errorType: error.constructor?.name,
                            },
                            type: "error",
                            debug: context.Vircadia.Debug,
                            suppress: context.Vircadia.Suppress,
                        });
                        reject(
                            new Error(
                                `GLTF parsing error: ${error.message || String(error)}`,
                            ),
                        );
                    },
                );
            } catch (error: unknown) {
                const errorObj =
                    error instanceof Error
                        ? {
                              message: error.message,
                              stack: error.stack,
                              name: error.name,
                          }
                        : String(error);

                log({
                    message: "Exception during GLTF loader setup",
                    data: { error: errorObj },
                    type: "error",
                    debug: context.Vircadia.Debug,
                    suppress: context.Vircadia.Suppress,
                });
                reject(
                    new Error(
                        `GLTF loader setup error: ${error instanceof Error ? error.message : String(error)}`,
                    ),
                );
            }
        });
    }

    return {
        hooks: {
            onScriptInitialize: async (
                entity: Entity.I_Entity,
            ): Promise<void> => {
                if (context.Vircadia.Debug) {
                    console.log(
                        "Entity model script initialized for entity:",
                        entity.general__entity_id,
                    );
                }

                try {
                    const scene = context.Three.Scene;

                    // Get configuration from metadata
                    const metaData = entity.meta__data as EntityModelMetaData;
                    const config = metaData?.model_config || {};

                    // Get asset name from config or entity assets
                    const assetName =
                        config.assetName ||
                        (entity.asset__names && entity.asset__names.length > 0
                            ? entity.asset__names[0]
                            : "");
                    currentAssetName = assetName;

                    if (!assetName) {
                        log({
                            message: "No asset specified for entity model",
                            data: { entityId: entity.general__entity_id },
                            type: "warn",
                            debug: context.Vircadia.Debug,
                            suppress: context.Vircadia.Suppress,
                        });
                        return;
                    }

                    // Load the model
                    modelGroup = await loadModelFromAssetData(
                        entity,
                        assetName,
                        config,
                    );

                    if (!modelGroup) {
                        return;
                    }

                    // Add model to scene
                    scene.add(modelGroup);

                    // Set flag
                    modelLoaded = true;

                    log({
                        message: "Entity model loaded successfully",
                        data: {
                            entityId: entity.general__entity_id,
                            assetName,
                        },
                        debug: context.Vircadia.Debug,
                        suppress: context.Vircadia.Suppress,
                    });
                } catch (error) {
                    log({
                        message: "Error initializing entity model",
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

            onEntityUpdate: (updatedEntity: Entity.I_Entity): void => {
                if (context.Vircadia.Debug) {
                    console.log(
                        "Model entity updated:",
                        updatedEntity.general__entity_id,
                    );
                }

                // Check if asset names have changed
                const metaData =
                    updatedEntity.meta__data as EntityModelMetaData;
                const config = metaData?.model_config || {};
                const newAssetName =
                    config.assetName ||
                    (updatedEntity.asset__names &&
                    updatedEntity.asset__names.length > 0
                        ? updatedEntity.asset__names[0]
                        : "");

                // If asset has changed, reload model
                if (newAssetName && newAssetName !== currentAssetName) {
                    // Remove old model
                    if (modelGroup) {
                        context.Three.Scene.remove(modelGroup);
                        modelGroup = null;
                    }

                    // Reload model
                    currentAssetName = newAssetName;

                    // Load new model asynchronously
                    loadModelFromAssetData(updatedEntity, newAssetName, config)
                        .then((newModel) => {
                            if (newModel) {
                                modelGroup = newModel;
                                context.Three.Scene.add(modelGroup);
                                modelLoaded = true;

                                log({
                                    message:
                                        "Entity model reloaded successfully",
                                    data: {
                                        entityId:
                                            updatedEntity.general__entity_id,
                                        assetName: newAssetName,
                                    },
                                    debug: context.Vircadia.Debug,
                                    suppress: context.Vircadia.Suppress,
                                });
                            }
                        })
                        .catch((error) => {
                            log({
                                message: "Error reloading entity model",
                                data: {
                                    entityId: updatedEntity.general__entity_id,
                                    error,
                                },
                                type: "error",
                                debug: context.Vircadia.Debug,
                                suppress: context.Vircadia.Suppress,
                            });
                        });
                }
                // Otherwise, update model properties from config
                else if (modelLoaded && modelGroup) {
                    // Update position
                    if (config.position) {
                        modelGroup.position.set(
                            config.position.x !== undefined
                                ? config.position.x
                                : modelGroup.position.x,
                            config.position.y !== undefined
                                ? config.position.y
                                : modelGroup.position.y,
                            config.position.z !== undefined
                                ? config.position.z
                                : modelGroup.position.z,
                        );
                    }

                    // Update rotation
                    if (config.rotation) {
                        modelGroup.rotation.set(
                            config.rotation.x !== undefined
                                ? config.rotation.x
                                : modelGroup.rotation.x,
                            config.rotation.y !== undefined
                                ? config.rotation.y
                                : modelGroup.rotation.y,
                            config.rotation.z !== undefined
                                ? config.rotation.z
                                : modelGroup.rotation.z,
                        );
                    }

                    // Update scale
                    if (config.scale) {
                        modelGroup.scale.set(
                            config.scale.x !== undefined
                                ? config.scale.x
                                : modelGroup.scale.x,
                            config.scale.y !== undefined
                                ? config.scale.y
                                : modelGroup.scale.y,
                            config.scale.z !== undefined
                                ? config.scale.z
                                : modelGroup.scale.z,
                        );
                    }
                }
            },

            onScriptTeardown: (): void => {
                if (context.Vircadia.Debug) {
                    console.log("Entity model script being torn down");
                }

                // Clean up resources
                const scene = context.Three.Scene;

                // Remove model from scene
                if (modelGroup) {
                    scene.remove(modelGroup);
                    modelGroup.traverse((object) => {
                        const meshObject = object as Partial<Mesh>;

                        if (meshObject.geometry) {
                            meshObject.geometry.dispose();
                        }

                        if (meshObject.material) {
                            const materials = Array.isArray(meshObject.material)
                                ? meshObject.material
                                : [meshObject.material];

                            for (const material of materials) {
                                for (const key in material) {
                                    const value =
                                        material[key as keyof typeof material];
                                    if (
                                        value &&
                                        typeof value === "object" &&
                                        "dispose" in value
                                    ) {
                                        (
                                            value as { dispose: () => void }
                                        ).dispose();
                                    }
                                }
                                material.dispose();
                            }
                        }
                    });
                    modelGroup = null;
                }

                modelLoaded = false;
            },
        },
    };
}

// Make the function available in the global scope
// @ts-ignore - Adding to global scope for script system
globalThis.vircadiaScriptMain = vircadiaScriptMain;
