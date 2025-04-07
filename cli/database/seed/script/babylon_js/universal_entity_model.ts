import type { Entity } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import type { Babylon } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.babylon.script";
import {
    type Mesh,
    Vector3,
    ImportMeshAsync,
    type AbstractMesh,
} from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
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
                                    // Try to determine the type and convert to ArrayBuffer
                                    if (
                                        Array.isArray(
                                            assetResult.asset__data__bytea,
                                        )
                                    ) {
                                        // Array of numbers - convert to Uint8Array and then to ArrayBuffer
                                        meshData = new Uint8Array(
                                            assetResult.asset__data__bytea,
                                        ).buffer;
                                    } else if (
                                        assetResult.asset__data__bytea instanceof
                                        ArrayBuffer
                                    ) {
                                        // Use it directly if it's already an ArrayBuffer
                                        meshData =
                                            assetResult.asset__data__bytea;
                                    } else if (
                                        typeof assetResult.asset__data__bytea ===
                                        "object"
                                    ) {
                                        // Check if it has a data property
                                        const bytea =
                                            assetResult.asset__data__bytea as unknown as {
                                                data?: ArrayBuffer;
                                                [key: string]: unknown;
                                            };
                                        if (bytea.data instanceof ArrayBuffer) {
                                            meshData = bytea.data;
                                        } else if (Array.isArray(bytea.data)) {
                                            meshData = new Uint8Array(
                                                bytea.data,
                                            ).buffer;
                                        } else if (
                                            typeof assetResult.asset__data__bytea ===
                                                "object" &&
                                            assetResult.asset__data__bytea !==
                                                null
                                        ) {
                                            // Handle array-like object with numeric indices
                                            // This covers cases where the object acts like an array but isn't an actual Array instance
                                            const objectData =
                                                assetResult.asset__data__bytea as unknown as Record<
                                                    string,
                                                    unknown
                                                >;
                                            const isArrayLike = Object.keys(
                                                objectData,
                                            ).every(
                                                (key) =>
                                                    !Number.isNaN(Number(key)),
                                            );

                                            if (isArrayLike) {
                                                const numericArray: number[] =
                                                    [];
                                                for (
                                                    let i = 0;
                                                    i <
                                                    Object.keys(objectData)
                                                        .length;
                                                    i++
                                                ) {
                                                    if (
                                                        typeof objectData[i] ===
                                                        "number"
                                                    ) {
                                                        numericArray.push(
                                                            objectData[
                                                                i
                                                            ] as number,
                                                        );
                                                    } else if (
                                                        typeof objectData[i] ===
                                                        "string"
                                                    ) {
                                                        numericArray.push(
                                                            Number.parseInt(
                                                                objectData[
                                                                    i
                                                                ] as string,
                                                                10,
                                                            ),
                                                        );
                                                    }
                                                }
                                                meshData = new Uint8Array(
                                                    numericArray,
                                                ).buffer;
                                            } else {
                                                // Last resort: try using Object.values
                                                const values =
                                                    Object.values(objectData);
                                                if (
                                                    values.every(
                                                        (val) =>
                                                            typeof val ===
                                                                "number" ||
                                                            (typeof val ===
                                                                "string" &&
                                                                !Number.isNaN(
                                                                    Number(val),
                                                                )),
                                                    )
                                                ) {
                                                    const numericValues =
                                                        values.map((v) =>
                                                            typeof v ===
                                                            "number"
                                                                ? v
                                                                : Number.parseInt(
                                                                      v as string,
                                                                      10,
                                                                  ),
                                                        );
                                                    meshData = new Uint8Array(
                                                        numericValues,
                                                    ).buffer;
                                                }
                                            }
                                        }
                                    }

                                    // Check if conversion was successful
                                    if (!meshData) {
                                        throw new Error(
                                            "Failed to convert asset data to a usable format",
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
