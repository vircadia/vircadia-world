import type { Entity } from "../../../../vircadia-world-sdk-ts/schema/schema.general";
import type { Babylon } from "../../../../vircadia-world-sdk-ts/schema/schema.babylon.script";
import type { Mesh, AbstractMesh } from "@babylonjs/core";
import { Vector3, ImportMeshAsync, type Scene } from "@babylonjs/core";
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

// Extended entity interface to store mesh reference and assets
interface EntityWithMesh extends Entity.I_Entity {
    _mesh?: Mesh | AbstractMesh;
    _assets?: Entity.Asset.I_Asset[];
    _assetMeshMap?: Map<string, Mesh | AbstractMesh>;
}

// Use the new vircadiaScriptMain function name
function vircadiaScriptMain(context: Babylon.I_Context): Babylon.ScriptReturn {
    // Return the script structure directly
    return {
        hooks: {
            // Script state variables
            onScriptInitialize: (entityData: Entity.I_Entity): void => {
                if (context.Vircadia.Debug) {
                    console.log(
                        "Script initialized for entity:",
                        entityData.general__entity_id,
                    );
                }

                registerBuiltInLoaders();

                // Store entity for later use
                const entity = entityData as EntityWithMesh;

                // Get assets for this entity
                getAndLoadEntityAssets(entity, context.Babylon.Scene, context);
            },

            onEntityUpdate: (updatedEntity: Entity.I_Entity): void => {
                if (context.Vircadia.Debug) {
                    console.log(
                        "Entity updated:",
                        updatedEntity.general__entity_id,
                    );
                }

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
                console.info(
                    "Script updated:",
                    scriptData.general__script_file_name,
                );
            },

            onScriptTeardown: (): void => {
                if (context.Vircadia.Debug) {
                    console.log("Script being torn down");
                }

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
    context: Babylon.I_Context,
): Promise<void> {
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

        // Query for assets belonging to this entity by matching asset names
        const assetsQuery = await context.Vircadia.Query.execute<
            Entity.Asset.I_Asset[]
        >(
            "SELECT * FROM entity.entity_assets WHERE general__asset_file_name = ANY($1)",
            [entity.asset__names],
        );

        if (!assetsQuery?.result || assetsQuery.result.length === 0) {
            log({
                message: "No assets found for entity",
                data: { entityId: entity.general__entity_id },
                type: "warning",
                debug: context.Vircadia.Debug,
                suppress: context.Vircadia.Suppress,
            });
            return;
        }

        const newAssets = assetsQuery.result;

        // Initialize asset mapping if needed
        if (!entity._assetMeshMap) {
            entity._assetMeshMap = new Map();
        }

        // Check if assets have changed by comparing with previously stored assets
        const currentAssets = entity._assets || [];

        // Filter for model assets
        const modelAssets = newAssets.filter(
            (asset) =>
                asset.asset__type?.toLocaleLowerCase() === "glb" ||
                asset.asset__type?.toLocaleLowerCase() === "gltf" ||
                asset.asset__type?.toLocaleLowerCase() === "obj",
        );

        if (modelAssets.length > 0) {
            for (const asset of modelAssets) {
                // Check if this asset has changed or is new
                const currentAsset = currentAssets.find(
                    (a) =>
                        a.general__asset_file_name ===
                        asset.general__asset_file_name,
                );

                const isNew = !currentAsset;
                const hasChanged =
                    currentAsset &&
                    currentAsset.general__updated_at !==
                        asset.general__updated_at;

                if (isNew || hasChanged) {
                    await loadAsset(entity, asset, scene, context);
                }
            }

            // Remove any assets that no longer exist
            const newAssetNames = new Set(
                modelAssets.map((a) => a.general__asset_file_name),
            );
            for (const currentAsset of currentAssets) {
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
                error,
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
    context: Babylon.I_Context,
): Promise<void> {
    try {
        // Query the asset data from the server
        const assetData = await context.Vircadia.Query.execute<
            { asset__data__bytea: Buffer | null }[]
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
            return;
        }

        const assetResult = assetData.result[0];
        let meshData: ArrayBuffer | null = null;

        // Check if asset data is available and properly format it
        if (assetResult.asset__data__bytea) {
            try {
                // We know the data is an object with a data property that's an array
                const bytea = assetResult.asset__data__bytea as unknown as {
                    data: number[];
                };

                if (!bytea.data || !Array.isArray(bytea.data)) {
                    throw new Error(
                        "Asset data is not in the expected format (object with data array)",
                    );
                }

                meshData = new Uint8Array(bytea.data).buffer;

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
                    Array.isArray(assetResult.asset__data__bytea),
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

        // If we already have this asset loaded, dispose of it first
        if (entity._assetMeshMap?.has(asset.general__asset_file_name)) {
            const oldMesh = entity._assetMeshMap.get(
                asset.general__asset_file_name,
            );
            if (oldMesh) {
                oldMesh.dispose();
            }
        }

        const file = new File([meshData], asset.general__asset_file_name, {
            type: "model/glb",
        });

        const result = await ImportMeshAsync(file, scene, {
            pluginExtension: ".glb",
        });

        const myMesh = result.meshes[0];

        const metaData = entity.meta__data as unknown as EntityMetaData;
        const transformPosition = metaData.transform__position;
        const entityModel = metaData.entity_model;
        const position = transformPosition || entityModel?.transform__position;

        if (position) {
            myMesh.position = new Vector3(
                position.x || 0,
                position.y || 0,
                position.z || 0,
            );
        }

        // Store mesh in entity metadata for access in other hooks
        entity._mesh = myMesh;

        // Also store in our asset map for reference
        if (entity._assetMeshMap) {
            entity._assetMeshMap.set(asset.general__asset_file_name, myMesh);
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

// Make the function available in the global scope
// @ts-ignore - Adding to global scope for script system
globalThis.vircadiaScriptMain = vircadiaScriptMain;
