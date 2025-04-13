import type { Entity } from "../../../../vircadia-world-sdk-ts/schema/schema.general";
import type { Babylon } from "../../../../vircadia-world-sdk-ts/schema/schema.babylon.script";
import type { Mesh, AbstractMesh } from "@babylonjs/core";
import {
    Vector3,
    type Scene,
    type ISceneLoaderAsyncResult,
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

        // Retrieve assets in parallel using the Utilities function
        // The utility will handle checking for updates and downloading when needed
        const assetPromises = entity.asset__names.map((assetName) =>
            context.Vircadia.Utilities.Asset.getAsset({
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
        const newAssets = assetsResults.filter(
            (asset) => asset !== null,
        ) as Entity.Asset.I_Asset[];

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
                // Always load the asset - the utility has already handled version checking
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

        // If we already have this asset loaded, dispose of it first
        if (entity._assetMeshMap?.has(asset.general__asset_file_name)) {
            const oldMesh = entity._assetMeshMap.get(
                asset.general__asset_file_name,
            );
            if (oldMesh) {
                oldMesh.dispose();
            }
        }

        // Load the mesh using the appropriate utility
        let result: ISceneLoaderAsyncResult;
        if (isGLTF || isGLB) {
            result = await context.Vircadia.Utilities.Asset.loadGLTFAssetAsMesh(
                {
                    asset,
                    scene,
                },
            );
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
