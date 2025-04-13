import type { Entity } from "../../../../vircadia-world-sdk-ts/schema/schema.general";
import type { Babylon } from "../../../../vircadia-world-sdk-ts/schema/schema.babylon.script";
import type { Mesh, AbstractMesh } from "@babylonjs/core";
import {
    Vector3,
    type Scene,
    type ISceneLoaderAsyncResult,
    ImportMeshAsync,
} from "@babylonjs/core";
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
    context: Babylon.I_Context,
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

        // Use getAssetFromServer directly to always fetch from server
        const assetPromises = entity.asset__names.map((assetName) =>
            context.Vircadia.Utilities.Asset.getAssetFromServer({
                assetName,
            }).catch((error) => {
                log({
                    message: `Failed to load asset: ${assetName}`,
                    data: { error, entityId: entity.general__entity_id },
                    type: "error",
                    debug: context.Vircadia.Debug,
                    suppress: context.Vircadia.Suppress,
                });
                return null;
            }),
        );

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
        // Get the asset type
        const assetType = asset.asset__type?.toLowerCase();

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

        // Load the mesh directly using database query and Babylon's SceneLoader
        let result: ISceneLoaderAsyncResult;
        if (isGLTF || isGLB || isModelGltfBinary || isModelGltfJson) {
            // Query the database to get the asset data directly
            const assetQuery = `
                SELECT asset__data__bytea, asset__type 
                FROM entity.entity_assets 
                WHERE general__asset_file_name = $1
            `;

            // Define the type alias for the asset query result
            type AssetQueryResult = {
                asset__data__bytea: Uint8Array;
                asset__type: string;
            };

            // Execute the query
            const queryResult = await context.Vircadia.Utilities.Query.execute({
                query: assetQuery,
                parameters: [asset.general__asset_file_name],
            });

            // Check if we got any results
            if (
                !queryResult.result ||
                !Array.isArray(queryResult.result) ||
                queryResult.result.length === 0
            ) {
                throw new Error(
                    `Asset not found in database: ${asset.general__asset_file_name}`,
                );
            }

            // Access the first result and extract the binary data
            const assetData = (queryResult.result[0] as AssetQueryResult)
                .asset__data__bytea;
            if (!assetData) {
                throw new Error(
                    `No binary data for asset: ${asset.general__asset_file_name}`,
                );
            }

            // Convert the bytea data to a Blob that Babylon can use
            const blob = new Blob([assetData]);
            const blobURL = URL.createObjectURL(blob);

            // Use Babylon's SceneLoader to import the mesh directly
            result = await ImportMeshAsync(blobURL, scene, {
                pluginExtension: ".glb",
            });

            // Clean up the blob URL after importing
            // URL.revokeObjectURL(blobURL);
        } else {
            throw new Error(`Unsupported asset type: ${assetType}`);
        }

        if (!result || !result.meshes || result.meshes.length === 0) {
            throw new Error(
                `No meshes loaded from asset: ${asset.general__asset_file_name}`,
            );
        }

        // Get the root mesh
        const rootMesh = result.meshes[0];

        // Apply position from entity metadata
        const metaData = entity.meta__data as unknown as EntityMetaData;
        const transformPosition = metaData.transform__position;
        const entityModel = metaData.entity_model;
        const position = transformPosition || entityModel?.transform__position;

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
            entity._assetMeshMap.set(asset.general__asset_file_name, rootMesh);
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
