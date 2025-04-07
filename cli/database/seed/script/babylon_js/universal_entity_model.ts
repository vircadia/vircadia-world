import { Entity } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import type { Babylon } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.babylon.script";
import {
    type Mesh,
    Vector3,
    ImportMeshAsync,
    type AbstractMesh,
    SceneLoader,
} from "@babylonjs/core";
import { log } from "../../../../../sdk/vircadia-world-sdk-ts/module/general/log";

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

// Extended entity interface to store mesh reference
interface EntityWithMesh extends Entity.I_Entity {
    _mesh?: Mesh | AbstractMesh;
}

// Use the new vircadiaScriptMain function name
function vircadiaScriptMain(context: Babylon.I_Context): Babylon.ScriptReturn {
    // Return the script structure directly
    return {
        hooks: {
            // Script state variables
            onScriptInitialize: async (
                entity: Entity.I_Entity,
                assets: Entity.Asset.I_Asset[],
            ): Promise<void> => {
                if (context.Vircadia.Debug) {
                    console.log(
                        "Script initialized for entity:",
                        entity.general__entity_id,
                    );
                }

                const modelAssets = assets.filter(
                    (asset) =>
                        asset.asset__type?.toLocaleLowerCase() === "glb" ||
                        asset.asset__type?.toLocaleLowerCase() === "gltf" ||
                        asset.asset__type?.toLocaleLowerCase() === "obj",
                );

                const scene = context.Babylon.Scene;

                if (modelAssets.length > 0) {
                    for (const asset of modelAssets) {
                        try {
                            // Try to load from binary data first
                            const binaryData =
                                context.Vircadia.AssetManager.getBinaryData(
                                    asset.general__asset_file_name,
                                );

                            if (binaryData) {
                                // Load from binary data
                                const result =
                                    await SceneLoader.ImportMeshAsync(
                                        "",
                                        "data:",
                                        new Uint8Array(binaryData),
                                        scene,
                                    );

                                const myMesh = result.meshes[0];

                                const metaData =
                                    entity.meta__data as unknown as EntityMetaData;
                                const transformPosition =
                                    metaData.transform__position;
                                const entityModel = metaData.entity_model;
                                const position =
                                    transformPosition ||
                                    entityModel?.transform__position;

                                if (position) {
                                    myMesh.position = new Vector3(
                                        position.x || 0,
                                        position.y || 0,
                                        position.z || 0,
                                    );
                                }

                                // Store mesh in entity metadata for access in other hooks
                                (entity as EntityWithMesh)._mesh = myMesh;

                                log({
                                    message:
                                        "Mesh imported from binary data for entity:",
                                    data: {
                                        entityId: entity.general__entity_id,
                                        assetName:
                                            asset.general__asset_file_name,
                                    },
                                });
                            }
                            // Fall back to base64 if binary not available
                            else if (asset.asset__data__base64) {
                                console.info(
                                    "Falling back to base64 data for asset:",
                                    asset.general__asset_file_name,
                                );

                                const importedMesh = await ImportMeshAsync(
                                    `${asset.asset__data__base64}`,
                                    scene,
                                ).finally(() => {
                                    log({
                                        message:
                                            "Mesh imported from base64 for entity:",
                                        data: {
                                            entityId: entity.general__entity_id,
                                            assetName:
                                                asset.general__asset_file_name,
                                        },
                                    });
                                });

                                // Existing position code remains the same
                                const myMesh = importedMesh.meshes[0];

                                const metaData =
                                    entity.meta__data as unknown as EntityMetaData;
                                const transformPosition =
                                    metaData.transform__position;
                                const entityModel = metaData.entity_model;
                                const position =
                                    transformPosition ||
                                    entityModel?.transform__position;

                                if (position) {
                                    myMesh.position = new Vector3(
                                        position.x || 0,
                                        position.y || 0,
                                        position.z || 0,
                                    );
                                }

                                // Store mesh in entity metadata for access in other hooks
                                (entity as EntityWithMesh)._mesh = myMesh;
                            } else {
                                log({
                                    message: "No asset data found for entity:",
                                    data: {
                                        entityId: entity.general__entity_id,
                                        asset,
                                    },
                                    type: "error",
                                    debug: context.Vircadia.Debug,
                                    suppress: context.Vircadia.Suppress,
                                });
                            }
                        } catch (error) {
                            log({
                                message: "Error importing model for entity:",
                                data: {
                                    entityId: entity.general__entity_id,
                                    asset: asset.general__asset_file_name,
                                    error,
                                },
                                type: "error",
                                debug: context.Vircadia.Debug,
                                suppress: context.Vircadia.Suppress,
                            });
                        }
                    }
                } else {
                    log({
                        message: "Model assets found for entity:",
                        data: {
                            entityId: entity.general__entity_id,
                            modelAssets,
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
                        "Entity updated:",
                        updatedEntity.general__entity_id,
                    );
                }

                // Update position if entity data changed
                const entityWithMesh = updatedEntity as EntityWithMesh;
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
            },

            onAssetUpdate(assetData) {
                console.info("assetData", assetData);
            },

            onScriptUpdate(scriptData) {
                console.info("scriptData", scriptData);
            },

            onScriptTeardown: (): void => {
                if (context.Vircadia.Debug) {
                    console.log("Script being torn down");
                }

                // This could be improved with a better mesh tracking mechanism
                // Currently relying on entity reference cleanup by the system
            },
        },
    };
}

// Make the function available in the global scope
// @ts-ignore - Adding to global scope for script system
globalThis.vircadiaScriptMain = vircadiaScriptMain;
