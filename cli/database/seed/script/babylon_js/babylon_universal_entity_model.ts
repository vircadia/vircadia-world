import type { Entity } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import type { VircadiaBabylonScript } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/vircadia.babylon.core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import {
    Vector3,
    type Scene,
    type ISceneLoaderAsyncResult,
    AppendSceneAsync,
    ImportMeshAsync,
    type Mesh,
    type AbstractMesh,
} from "@babylonjs/core";
import { log } from "../../../../../sdk/vircadia-world-sdk-ts/module/general/log";
import { Communication } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";

// Define a WebSocket serialized buffer format
interface SerializedBuffer {
    type: string;
    data: number[];
}

interface Position {
    x?: number;
    y?: number;
    z?: number;
}

interface EntityModel {
    transform__position?: Position;
}

interface EntityMetaData {
    transform__position?: Position;
    entity_model?: EntityModel;
}

// Extended entity interface to store mesh reference and assets
interface EntityWithMesh extends Entity.I_Entity {
    _mesh?: Mesh | AbstractMesh;
    _assets?: Entity.Asset.I_Asset[];
    _assetMeshMap?: Map<string, Mesh | AbstractMesh>;
}

// Define a type for array-like object with numeric keys
interface ArrayLikeObject {
    [key: string]: number;
}

// Extend the Entity.Asset interface to handle browser-compatible binary data
declare module "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general" {
    namespace Entity {
        namespace Asset {
            interface I_Asset {
                asset__data__bytea?: unknown;
            }
        }
    }
}

// Use the new vircadiaScriptMain function name
function vircadiaScriptMain(
    context: VircadiaBabylonScript.I_Context,
): VircadiaBabylonScript.ScriptReturn {
    // Return the script structure directly
    return {
        hooks: {
            // Script state variables
            onScriptInitialize: (entityData: Entity.I_Entity): void => {
                registerBuiltInLoaders();
                // Store entity for later use
                const entity = entityData as EntityWithMesh;

                // Get assets for this entity
                log({
                    message: "Getting and loading entity assets",
                    debug: context.Vircadia.Debug,
                    suppress: context.Vircadia.Suppress,
                });
                getAndLoadEntityAssets(entity, context.Babylon.Scene, context);
            },

            onEntityUpdate: (updatedEntity: Entity.I_Entity): void => {
                const entityWithMesh = updatedEntity as EntityWithMesh;

                // Update position if entity data changed
                if (entityWithMesh._mesh) {
                    const metaData =
                        updatedEntity.meta__data as unknown as EntityMetaData;
                    const transformPosition = metaData.transform__position;
                    const entityModel = metaData.entity_model;
                    const position =
                        transformPosition || entityModel?.transform__position;

                    if (position) {
                        entityWithMesh._mesh.position.x = position.x || 0;
                        entityWithMesh._mesh.position.y = position.y || 0;
                        entityWithMesh._mesh.position.z = position.z || 0;
                    }
                }

                // Check for updated assets
                getAndLoadEntityAssets(
                    entityWithMesh,
                    context.Babylon.Scene,
                    context,
                );
            },

            onScriptUpdate: (scriptData: Entity.Script.I_Script): void => {
                log({
                    message: `Script updated: ${scriptData.general__script_file_name}`,
                    debug: context.Vircadia.Debug,
                    suppress: context.Vircadia.Suppress,
                });
            },

            onScriptTeardown: (): void => {
                // Dispose of any remaining meshes
                // Currently relying on entity reference cleanup by the system
            },
        },
    };
}

// Helper function to get and load entity assets
async function getAndLoadEntityAssets(
    entity: EntityWithMesh,
    scene: Scene,
    context: VircadiaBabylonScript.I_Context,
): Promise<void> {
    log({
        message: `Starting asset loading for entity ${entity.general__entity_id}`,
        debug: context.Vircadia.Debug,
        suppress: context.Vircadia.Suppress,
    });

    try {
        // Check if the entity has any asset names defined
        if (!entity.asset__names || entity.asset__names.length === 0) {
            log({
                message: "No asset names defined for entity",
                data: { entityId: entity.general__entity_id },
                type: "warning",
                debug: context.Vircadia.Debug,
                suppress: context.Vircadia.Suppress,
            });
            return;
        }

        // Query assets directly from the database
        const assetPromises = entity.asset__names.map(async (assetName) => {
            try {
                const queryResult =
                    await context.Vircadia.Utilities.Query.execute<
                        [
                            {
                                asset__data__bytea:
                                    | SerializedBuffer
                                    | ArrayBuffer;
                                asset__type: string;
                                general__asset_file_name: string;
                            },
                        ]
                    >({
                        query: `
                        SELECT asset__data__bytea, asset__type, general__asset_file_name
                        FROM entity.entity_assets 
                        WHERE general__asset_file_name = $1
                    `,
                        parameters: [assetName],
                        timeoutMs: 60000, // Increased timeout to 60 seconds for large assets
                    });

                log({
                    message: `Query result for asset: ${assetName}`,
                    data: {
                        entityId: entity.general__entity_id,
                        hasResults:
                            !!queryResult.result &&
                            queryResult.result.length > 0,
                        result: queryResult.result.slice(0, 100),
                        resultCount: queryResult.result
                            ? queryResult.result.length
                            : 0,
                    },
                    debug: context.Vircadia.Debug,
                    suppress: context.Vircadia.Suppress,
                });

                if (
                    !queryResult.result[0] ||
                    !Array.isArray(queryResult.result) ||
                    queryResult.result.length === 0
                ) {
                    log({
                        message: `No asset found in database: ${assetName}`,
                        data: { entityId: entity.general__entity_id },
                        type: "warning",
                        debug: context.Vircadia.Debug,
                        suppress: context.Vircadia.Suppress,
                    });
                    return null;
                }

                // Extract the raw data from the query result
                const rawData = queryResult.result[0];

                log({
                    message: "Processing query result",
                    data: {
                        assetName: rawData.general__asset_file_name,
                        assetType: rawData.asset__type,
                        hasData: !!rawData.asset__data__bytea,
                        dataType: typeof rawData.asset__data__bytea,
                    },
                    debug: context.Vircadia.Debug,
                    suppress: context.Vircadia.Suppress,
                });

                const assetData: Entity.Asset.I_Asset = {
                    asset__data__bytea: rawData.asset__data__bytea,
                    asset__type: rawData.asset__type,
                    general__asset_file_name: rawData.general__asset_file_name,
                };

                // Return the asset data from the query
                return assetData;
            } catch (error) {
                log({
                    message: `Failed to load asset: ${assetName}`,
                    data: {
                        error:
                            error instanceof Error
                                ? {
                                      message: error.message,
                                      name: error.name,
                                      stack: error.stack,
                                  }
                                : error,
                        entityId: entity.general__entity_id,
                        assetName: assetName,
                    },
                    type: "error",
                    debug: context.Vircadia.Debug,
                    suppress: context.Vircadia.Suppress,
                });
                return null;
            }
        });

        const assetsResults = await Promise.all(assetPromises);
        const newAssets: Entity.Asset.I_Asset[] = [];

        // Filter out null results and add valid assets to our array
        for (const asset of assetsResults) {
            if (asset) {
                newAssets.push(asset);
            }
        }

        if (newAssets.length === 0) {
            log({
                message: "No assets found for entity",
                data: {
                    entityId: entity.general__entity_id,
                    assetNames: entity.asset__names,
                },
                type: "warning",
                debug: context.Vircadia.Debug,
                suppress: context.Vircadia.Suppress,
            });
            return;
        }

        // Log the assets found
        log({
            message: `Found ${newAssets.length} assets for entity`,
            data: {
                entityId: entity.general__entity_id,
                assetTypes: newAssets.map((a) => a.asset__type),
                assetNames: newAssets.map((a) => a.general__asset_file_name),
            },
            debug: context.Vircadia.Debug,
            suppress: context.Vircadia.Suppress,
        });

        // Initialize asset mapping if needed
        if (!entity._assetMeshMap) {
            entity._assetMeshMap = new Map();
        }

        // Filter for model assets - expand supported types and handle case-insensitively
        const modelAssets = newAssets.filter((asset) => {
            if (!asset.asset__type) return false;

            const type = asset.asset__type.toLowerCase();
            return (
                type === "glb" ||
                type === "gltf" ||
                type === "obj" ||
                type === "model/gltf-binary" ||
                type === "model/gltf+json"
            );
        });

        if (modelAssets.length > 0) {
            log({
                message: `Processing ${modelAssets.length} model assets for entity`,
                data: { entityId: entity.general__entity_id },
                debug: context.Vircadia.Debug,
                suppress: context.Vircadia.Suppress,
            });

            for (const asset of modelAssets) {
                // Always load the asset - using the existing method
                await loadAsset(entity, asset, scene, context);
            }

            // Remove any assets that no longer exist
            const newAssetNames = new Set(
                modelAssets.map((a) => a.general__asset_file_name),
            );
            for (const currentAsset of entity._assets || []) {
                if (
                    !newAssetNames.has(currentAsset.general__asset_file_name) &&
                    entity._assetMeshMap?.has(
                        currentAsset.general__asset_file_name,
                    )
                ) {
                    // Asset has been removed, dispose of the mesh
                    const meshToRemove = entity._assetMeshMap.get(
                        currentAsset.general__asset_file_name,
                    );
                    if (meshToRemove) {
                        meshToRemove.dispose();
                        entity._assetMeshMap.delete(
                            currentAsset.general__asset_file_name,
                        );
                    }
                }
            }
        } else {
            log({
                message: "No model assets found for entity:",
                data: {
                    entityId: entity.general__entity_id,
                    assetTypes: newAssets.map((a) => a.asset__type),
                },
                type: "warning",
                debug: context.Vircadia.Debug,
                suppress: context.Vircadia.Suppress,
            });
        }

        // Store the new assets for future comparison
        entity._assets = newAssets;
    } catch (error) {
        log({
            message: "Error getting assets for entity:",
            data: {
                entityId: entity.general__entity_id,
                error:
                    error instanceof Error
                        ? {
                              message: error.message,
                              name: error.name,
                              stack: error.stack,
                          }
                        : error,
            },
            type: "error",
            debug: context.Vircadia.Debug,
            suppress: context.Vircadia.Suppress,
        });
    }
}

// Helper function to load a single asset
async function loadAsset(
    entity: EntityWithMesh,
    asset: Entity.Asset.I_Asset,
    scene: Scene,
    context: VircadiaBabylonScript.I_Context,
): Promise<void> {
    try {
        // Get the asset type
        const assetType = asset.asset__type?.toLowerCase();

        log({
            message: `Starting asset loading process for: ${asset.general__asset_file_name}`,
            data: {
                entityId: entity.general__entity_id,
                assetType: assetType,
                assetName: asset.general__asset_file_name,
            },
            debug: context.Vircadia.Debug,
            suppress: context.Vircadia.Suppress,
        });

        // Determine if this is a supported 3D model format
        const isGLB = assetType?.toLowerCase() === "glb";
        const isGLTF = assetType?.toLowerCase() === "gltf";
        const isModelGltfBinary =
            assetType?.toLowerCase() === "model/gltf-binary";
        const isModelGltfJson =
            assetType?.toLowerCase() === "model/gltf+json" ||
            assetType?.toLowerCase() === "model/gltf";

        // If we already have this asset loaded, dispose of it first
        if (entity._assetMeshMap?.has(asset.general__asset_file_name)) {
            const oldMesh = entity._assetMeshMap.get(
                asset.general__asset_file_name,
            );
            if (oldMesh) {
                oldMesh.dispose();
            }
        }

        // Get binary data from the asset - Browser compatible approach
        let modelData: ArrayBuffer;

        try {
            // Check if we have binary data in the asset
            if (!asset.asset__data__bytea) {
                throw new Error(
                    `No binary data for asset: ${asset.general__asset_file_name}`,
                );
            }

            // Handle direct ArrayBuffer
            if (asset.asset__data__bytea instanceof ArrayBuffer) {
                // Already an ArrayBuffer, use directly
                modelData = asset.asset__data__bytea;

                log({
                    message: "Using direct ArrayBuffer data",
                    data: {
                        entityId: entity.general__entity_id,
                        assetName: asset.general__asset_file_name,
                        byteLength: modelData.byteLength,
                    },
                    debug: context.Vircadia.Debug,
                    suppress: context.Vircadia.Suppress,
                });
            }
            // Handle { type: "Buffer", data: number[] } format (serialized buffer from WebSocket)
            else if (
                typeof asset.asset__data__bytea === "object" &&
                asset.asset__data__bytea !== null &&
                "type" in asset.asset__data__bytea &&
                asset.asset__data__bytea.type === "Buffer" &&
                "data" in asset.asset__data__bytea &&
                Array.isArray(asset.asset__data__bytea.data)
            ) {
                // Convert serialized buffer data to Uint8Array and then to ArrayBuffer
                const uint8Array = new Uint8Array(
                    (asset.asset__data__bytea as unknown as SerializedBuffer)
                        .data,
                );
                modelData = uint8Array.buffer;

                log({
                    message: "Converted serialized buffer data to ArrayBuffer",
                    data: {
                        entityId: entity.general__entity_id,
                        assetName: asset.general__asset_file_name,
                        dataLength: (
                            asset.asset__data__bytea as unknown as SerializedBuffer
                        ).data.length,
                        byteLength: modelData.byteLength,
                    },
                    debug: context.Vircadia.Debug,
                    suppress: context.Vircadia.Suppress,
                });
            }
            // Handle array-like object format with numeric keys ({"0": 103, "1": 108, ...})
            else if (
                typeof asset.asset__data__bytea === "object" &&
                asset.asset__data__bytea !== null &&
                // Check if all keys are numeric
                Object.keys(asset.asset__data__bytea as object).every(
                    (key) => !Number.isNaN(Number(key)),
                )
            ) {
                // Convert array-like object to an actual array of numbers
                const dataArray: number[] = [];
                const assetDataObj =
                    asset.asset__data__bytea as unknown as Record<
                        string,
                        number
                    >;
                const keys = Object.keys(assetDataObj).sort(
                    (a, b) => Number(a) - Number(b),
                );

                for (const key of keys) {
                    dataArray.push(assetDataObj[key]);
                }

                // Convert to Uint8Array and then to ArrayBuffer
                const uint8Array = new Uint8Array(dataArray);
                modelData = uint8Array.buffer;

                log({
                    message: "Converted array-like object data to ArrayBuffer",
                    data: {
                        entityId: entity.general__entity_id,
                        assetName: asset.general__asset_file_name,
                        dataLength: dataArray.length,
                        byteLength: modelData.byteLength,
                    },
                    debug: context.Vircadia.Debug,
                    suppress: context.Vircadia.Suppress,
                });
            }
            // Unknown binary data format
            else {
                log({
                    message: "Unknown binary data format",
                    data: {
                        entityId: entity.general__entity_id,
                        assetName: asset.general__asset_file_name,
                        dataType: typeof asset.asset__data__bytea,
                        dataPreview:
                            typeof asset.asset__data__bytea === "object"
                                ? `${JSON.stringify(asset.asset__data__bytea).substring(0, 100)}...`
                                : String(asset.asset__data__bytea).substring(
                                      0,
                                      100,
                                  ),
                    },
                    debug: context.Vircadia.Debug,
                    suppress: context.Vircadia.Suppress,
                });

                throw new Error(
                    `Unsupported binary data format for asset: ${asset.general__asset_file_name}`,
                );
            }
        } catch (error) {
            log({
                message: "Error processing asset binary data",
                data: {
                    entityId: entity.general__entity_id,
                    assetName: asset.general__asset_file_name,
                    error:
                        error instanceof Error
                            ? {
                                  message: error.message,
                                  name: error.name,
                                  stack: error.stack,
                              }
                            : error,
                },
                type: "error",
                debug: context.Vircadia.Debug,
                suppress: context.Vircadia.Suppress,
            });
            throw error;
        }

        // Convert the binary data to a base64 data URL for loading
        const base64Content = bytesToBase64(new Uint8Array(modelData));
        const base64ModelUrl = `data:model/gltf-binary;base64,${base64Content}`;

        log({
            message: "Created base64 data URL for model loading",
            data: {
                entityId: entity.general__entity_id,
                assetName: asset.general__asset_file_name,
                modelDataSize: modelData.byteLength,
                urlPreview: `${base64ModelUrl.substring(0, 50)}...`,
            },
            debug: context.Vircadia.Debug,
            suppress: context.Vircadia.Suppress,
        });

        if (isGLTF || isGLB || isModelGltfBinary || isModelGltfJson) {
            log({
                message: "Starting Babylon.js model append",
                data: {
                    entityId: entity.general__entity_id,
                    assetName: asset.general__asset_file_name,
                    assetType: assetType,
                },
                debug: context.Vircadia.Debug,
                suppress: context.Vircadia.Suppress,
            });

            try {
                // Use AppendSceneAsync with pluginExtension for better compatibility
                const importResult = await ImportMeshAsync(
                    base64ModelUrl,
                    scene,
                    { pluginExtension: ".glb" },
                );

                if (importResult.meshes.length === 0) {
                    throw new Error(
                        `No meshes loaded from asset: ${asset.general__asset_file_name}`,
                    );
                }

                const rootMesh = importResult.meshes[0];

                log({
                    message: "Babylon.js model append completed",
                    data: {
                        entityId: entity.general__entity_id,
                        assetName: asset.general__asset_file_name,
                        meshCount: importResult.meshes.length,
                        rootMeshName: rootMesh.name,
                    },
                    debug: context.Vircadia.Debug,
                    suppress: context.Vircadia.Suppress,
                });

                // Apply position from entity metadata
                const metaData = entity.meta__data as unknown as EntityMetaData;
                const transformPosition = metaData.transform__position;
                const entityModel = metaData.entity_model;
                const position =
                    transformPosition || entityModel?.transform__position;

                if (position) {
                    rootMesh.position = new Vector3(
                        position.x || 0,
                        position.y || 0,
                        position.z || 0,
                    );
                }

                // Store mesh in entity metadata for access in other hooks
                entity._mesh = rootMesh;

                // Also store in our asset map for reference
                if (entity._assetMeshMap) {
                    entity._assetMeshMap.set(
                        asset.general__asset_file_name,
                        rootMesh,
                    );
                }

                log({
                    message: "Mesh imported successfully for entity:",
                    data: {
                        entityId: entity.general__entity_id,
                        assetName: asset.general__asset_file_name,
                    },
                    debug: context.Vircadia.Debug,
                    suppress: context.Vircadia.Suppress,
                });
            } catch (importError) {
                log({
                    message: "Babylon.js model append failed",
                    data: {
                        entityId: entity.general__entity_id,
                        assetName: asset.general__asset_file_name,
                        error:
                            importError instanceof Error
                                ? {
                                      message: importError.message,
                                      name: importError.name,
                                      stack: importError.stack,
                                  }
                                : importError,
                    },
                    type: "error",
                    debug: context.Vircadia.Debug,
                    suppress: context.Vircadia.Suppress,
                });
                throw importError;
            }
        } else {
            throw new Error(`Unsupported asset type: ${assetType}`);
        }
    } catch (error) {
        log({
            message: "Error importing model for entity:",
            data: {
                entityId: entity.general__entity_id,
                asset: asset.general__asset_file_name,
                error:
                    error instanceof Error
                        ? {
                              message: error.message,
                              name: error.name,
                              stack: error.stack,
                          }
                        : error,
            },
            type: "error",
            debug: context.Vircadia.Debug,
            suppress: context.Vircadia.Suppress,
        });
    }
}

// Helper function to convert bytes to base64 string (works in browser)
function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    // Use browser's btoa function or fallback for Node.js
    return typeof btoa === "function"
        ? btoa(binary)
        : Buffer.from(binary, "binary").toString("base64");
}

// Make the function available in the global scope
// @ts-ignore - Adding to global scope for script system
globalThis.vircadiaScriptMain = vircadiaScriptMain;
