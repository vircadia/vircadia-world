import type { Entity } from "../../../../vircadia-world-sdk-ts/schema/schema.general";
import type { Babylon } from "../../../../vircadia-world-sdk-ts/schema/schema.babylon.script";
import {
    type Mesh,
    Vector3,
    ImportMeshAsync,
    type AbstractMesh,
} from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { log } from "../../../../vircadia-world-sdk-ts/module/general/log";

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

                registerBuiltInLoaders();

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
                            // Query the asset data from the server
                            const assetData =
                                await context.Vircadia.Query.execute<
                                    {
                                        asset__data__bytea: Buffer | null;
                                    }[]
                                >(
                                    "SELECT asset__data__bytea FROM entity.entity_assets WHERE general__asset_file_name = $1",
                                    [asset.general__asset_file_name],
                                );

                            if (!assetData?.result?.[0]) {
                                log({
                                    message: "No asset data found for entity:",
                                    data: {
                                        entityId: entity.general__entity_id,
                                        asset: asset.general__asset_file_name,
                                        retrievedData: assetData,
                                    },
                                    type: "error",
                                    debug: context.Vircadia.Debug,
                                    suppress: context.Vircadia.Suppress,
                                });
                                continue;
                            }

                            const assetResult = assetData.result[0];
                            let meshData: ArrayBuffer | null = null;

                            // Check if asset data is available and properly format it
                            if (assetResult.asset__data__bytea) {
                                try {
                                    // We know the data is an object with a data property that's an array
                                    const bytea =
                                        assetResult.asset__data__bytea as unknown as {
                                            data: number[];
                                        };

                                    if (
                                        !bytea.data ||
                                        !Array.isArray(bytea.data)
                                    ) {
                                        throw new Error(
                                            "Asset data is not in the expected format (object with data array)",
                                        );
                                    }

                                    meshData = new Uint8Array(bytea.data)
                                        .buffer;

                                    if (!meshData) {
                                        throw new Error(
                                            "Failed to convert asset data to ArrayBuffer",
                                        );
                                    }
                                } catch (err) {
                                    console.error(
                                        "Failed to process asset data:",
                                        err,
                                        "asset__data__bytea type:",
                                        typeof assetResult.asset__data__bytea,
                                        "isArray:",
                                        Array.isArray(
                                            assetResult.asset__data__bytea,
                                        ),
                                    );
                                    throw new Error(
                                        `Cannot convert asset data to usable format: ${asset.general__asset_file_name}`,
                                    );
                                }
                            } else {
                                throw new Error(
                                    `Binary data not available for asset: ${asset.general__asset_file_name}`,
                                );
                            }

                            // Load the mesh from memory using file URL
                            if (!meshData) {
                                throw new Error(
                                    `Failed to process binary data for asset: ${asset.general__asset_file_name}`,
                                );
                            }

                            const file = new File(
                                [meshData],
                                asset.general__asset_file_name,
                                {
                                    type: "model/glb",
                                },
                            );

                            const result = await ImportMeshAsync(file, scene, {
                                pluginExtension: ".glb",
                            });

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
                                    "Mesh imported successfully for entity:",
                                data: {
                                    entityId: entity.general__entity_id,
                                    assetName: asset.general__asset_file_name,
                                },
                            });
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
                        message: "No model assets found for entity:",
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
