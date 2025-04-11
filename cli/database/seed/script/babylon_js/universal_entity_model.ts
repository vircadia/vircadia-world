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
    console.log("vircadiaScriptMain: Script starting initialization");
    // Return the script structure directly
    return {
        hooks: {
            // Script state variables
            onScriptInitialize: (entityData: Entity.I_Entity): void => {
                console.log(
                    "onScriptInitialize: Starting for entity",
                    entityData.general__entity_id,
                );
                if (context.Vircadia.Debug) {
                    console.log(
                        "Script initialized for entity:",
                        entityData.general__entity_id,
                    );
                }

                // Store entity for later use
                const entity = entityData as EntityWithMesh;

                // Get assets for this entity
                console.log(
                    "onScriptInitialize: Getting and loading entity assets",
                );
                getAndLoadEntityAssets(entity, context.Babylon.Scene, context);
                console.log(
                    "onScriptInitialize: Completed initialization for entity",
                    entityData.general__entity_id,
                );
            },

            onEntityUpdate: (updatedEntity: Entity.I_Entity): void => {
                console.log(
                    "onEntityUpdate: Starting for entity",
                    updatedEntity.general__entity_id,
                );
                if (context.Vircadia.Debug) {
                    console.log(
                        "Entity updated:",
                        updatedEntity.general__entity_id,
                    );
                }

                const entityWithMesh = updatedEntity as EntityWithMesh;

                // Update position if entity data changed
                if (entityWithMesh._mesh) {
                    console.log(
                        "onEntityUpdate: Entity has mesh, updating position",
                    );
                    const metaData =
                        updatedEntity.meta__data as unknown as EntityMetaData;
                    const transformPosition = metaData.transform__position;
                    const entityModel = metaData.entity_model;
                    const position =
                        transformPosition || entityModel?.transform__position;

                    if (position) {
                        console.log(
                            "onEntityUpdate: Setting mesh position to",
                            position,
                        );
                        entityWithMesh._mesh.position.x = position.x || 0;
                        entityWithMesh._mesh.position.y = position.y || 0;
                        entityWithMesh._mesh.position.z = position.z || 0;
                    } else {
                        console.log(
                            "onEntityUpdate: No position data found in entity",
                        );
                    }
                } else {
                    console.log(
                        "onEntityUpdate: Entity doesn't have a mesh yet",
                    );
                }

                // Check for updated assets
                console.log(
                    "onEntityUpdate: Getting and loading entity assets",
                );
                getAndLoadEntityAssets(
                    entityWithMesh,
                    context.Babylon.Scene,
                    context,
                );
                console.log(
                    "onEntityUpdate: Completed update for entity",
                    updatedEntity.general__entity_id,
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
    console.log(
        "getAndLoadEntityAssets: Starting for entity",
        entity.general__entity_id,
    );
    try {
        // Check if the entity has any asset names defined
        console.log(
            "getAndLoadEntityAssets: Checking for asset names",
            entity.asset__names,
        );
        if (!entity.asset__names || entity.asset__names.length === 0) {
            console.log(
                "getAndLoadEntityAssets: No asset names defined for entity",
                entity.general__entity_id,
            );
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
        console.log(
            "getAndLoadEntityAssets: Retrieving assets in parallel",
            entity.asset__names,
        );
        const assetPromises = entity.asset__names.map((assetName) =>
            context.Vircadia.Utilities.Asset.getAsset({
                assetName,
            }).catch((error) => {
                console.log(
                    "getAndLoadEntityAssets: Failed to load asset",
                    assetName,
                    error,
                );
                log({
                    message: `Failed to load asset: ${assetName}`,
                    data: { error },
                    type: "error",
                    debug: context.Vircadia.Debug,
                    suppress: context.Vircadia.Suppress,
                });
                return null;
            }),
        );

        console.log(
            "getAndLoadEntityAssets: Waiting for all asset promises to resolve",
        );
        const assetsResults = await Promise.all(assetPromises);
        const newAssets = assetsResults.filter(
            (asset) => asset !== null,
        ) as Entity.Asset.I_Asset[];

        console.log(
            "getAndLoadEntityAssets: Retrieved assets count",
            newAssets.length,
        );
        if (newAssets.length === 0) {
            console.log(
                "getAndLoadEntityAssets: No assets found for entity",
                entity.general__entity_id,
            );
            log({
                message: "No assets found for entity",
                data: { entityId: entity.general__entity_id },
                type: "warning",
                debug: context.Vircadia.Debug,
                suppress: context.Vircadia.Suppress,
            });
            return;
        }

        // Initialize asset mapping if needed
        if (!entity._assetMeshMap) {
            console.log("getAndLoadEntityAssets: Initializing asset map");
            entity._assetMeshMap = new Map();
        }

        // Check if assets have changed by comparing with previously stored assets
        const currentAssets = entity._assets || [];
        console.log(
            "getAndLoadEntityAssets: Current asset count",
            currentAssets.length,
        );

        // Filter for model assets
        console.log("getAndLoadEntityAssets: Filtering for model assets");
        const modelAssets = newAssets.filter(
            (asset) =>
                asset.asset__type?.toLocaleLowerCase() === "glb" ||
                asset.asset__type?.toLocaleLowerCase() === "gltf" ||
                asset.asset__type?.toLocaleLowerCase() === "obj",
        );
        console.log(
            "getAndLoadEntityAssets: Model assets count",
            modelAssets.length,
        );

        if (modelAssets.length > 0) {
            console.log("getAndLoadEntityAssets: Processing model assets");
            for (const asset of modelAssets) {
                console.log(
                    "getAndLoadEntityAssets: Processing asset",
                    asset.general__asset_file_name,
                );
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

                console.log("getAndLoadEntityAssets: Asset status", {
                    assetName: asset.general__asset_file_name,
                    isNew,
                    hasChanged,
                });

                if (isNew || hasChanged) {
                    console.log(
                        "getAndLoadEntityAssets: Loading new or changed asset",
                        asset.general__asset_file_name,
                    );
                    await loadAsset(entity, asset, scene, context);
                } else {
                    console.log(
                        "getAndLoadEntityAssets: Asset unchanged, skipping",
                        asset.general__asset_file_name,
                    );
                }
            }

            // Remove any assets that no longer exist
            console.log(
                "getAndLoadEntityAssets: Checking for assets to remove",
            );
            const newAssetNames = new Set(
                modelAssets.map((a) => a.general__asset_file_name),
            );
            for (const currentAsset of currentAssets) {
                console.log(
                    "getAndLoadEntityAssets: Checking if asset still exists",
                    currentAsset.general__asset_file_name,
                );
                if (
                    !newAssetNames.has(currentAsset.general__asset_file_name) &&
                    entity._assetMeshMap?.has(
                        currentAsset.general__asset_file_name,
                    )
                ) {
                    // Asset has been removed, dispose of the mesh
                    console.log(
                        "getAndLoadEntityAssets: Disposing removed asset",
                        currentAsset.general__asset_file_name,
                    );
                    const meshToRemove = entity._assetMeshMap.get(
                        currentAsset.general__asset_file_name,
                    );
                    if (meshToRemove) {
                        meshToRemove.dispose();
                        entity._assetMeshMap.delete(
                            currentAsset.general__asset_file_name,
                        );
                        console.log(
                            "getAndLoadEntityAssets: Asset disposed and removed from map",
                            currentAsset.general__asset_file_name,
                        );
                    }
                }
            }
        } else {
            console.log(
                "getAndLoadEntityAssets: No model assets found for entity",
                entity.general__entity_id,
            );
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
        console.log(
            "getAndLoadEntityAssets: Storing new assets for future comparison",
        );
        entity._assets = newAssets;
        console.log(
            "getAndLoadEntityAssets: Completed processing for entity",
            entity.general__entity_id,
        );
    } catch (error) {
        console.log(
            "getAndLoadEntityAssets: Error getting assets for entity",
            entity.general__entity_id,
            error,
        );
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
    console.log(
        "loadAsset: Starting for asset",
        asset.general__asset_file_name,
        "entity",
        entity.general__entity_id,
    );
    try {
        // Get the asset type
        const assetType = asset.asset__type?.toLowerCase();
        console.log("loadAsset: Asset type is", assetType);

        // Determine if this is a supported 3D model format
        const isGLB = assetType?.toLowerCase() === "glb";
        const isGLTF = assetType?.toLowerCase() === "gltf";
        console.log(
            "loadAsset: Asset format check - isGLB:",
            isGLB,
            "isGLTF:",
            isGLTF,
        );

        // If we already have this asset loaded, dispose of it first
        if (entity._assetMeshMap?.has(asset.general__asset_file_name)) {
            console.log(
                "loadAsset: Asset already loaded, disposing old mesh",
                asset.general__asset_file_name,
            );
            const oldMesh = entity._assetMeshMap.get(
                asset.general__asset_file_name,
            );
            if (oldMesh) {
                oldMesh.dispose();
                console.log("loadAsset: Old mesh disposed");
            }
        }

        // Load the mesh using the appropriate utility
        let result: ISceneLoaderAsyncResult;
        if (isGLTF || isGLB) {
            console.log(
                "loadAsset: Loading GLTF/GLB asset",
                asset.general__asset_file_name,
            );
            result = await context.Vircadia.Utilities.Asset.loadGLTFAssetAsMesh(
                {
                    asset,
                    scene,
                },
            );
            console.log("loadAsset: GLTF/GLB asset loaded successfully");
        } else {
            console.log("loadAsset: Unsupported asset type", assetType);
            throw new Error(`Unsupported asset type: ${assetType}`);
        }

        if (!result || !result.meshes || result.meshes.length === 0) {
            console.log(
                "loadAsset: No meshes loaded from asset",
                asset.general__asset_file_name,
            );
            throw new Error(
                `No meshes loaded from asset: ${asset.general__asset_file_name}`,
            );
        }

        // Get the root mesh
        const rootMesh = result.meshes[0];
        console.log("loadAsset: Got root mesh from loaded asset");

        // Apply position from entity metadata
        const metaData = entity.meta__data as unknown as EntityMetaData;
        const transformPosition = metaData.transform__position;
        const entityModel = metaData.entity_model;
        const position = transformPosition || entityModel?.transform__position;
        console.log("loadAsset: Position data from metadata", position);

        if (position) {
            console.log("loadAsset: Setting mesh position to", {
                x: position.x || 0,
                y: position.y || 0,
                z: position.z || 0,
            });
            rootMesh.position = new Vector3(
                position.x || 0,
                position.y || 0,
                position.z || 0,
            );
        } else {
            console.log("loadAsset: No position data found for mesh");
        }

        // Store mesh in entity metadata for access in other hooks
        console.log("loadAsset: Storing mesh in entity metadata");
        entity._mesh = rootMesh;

        // Also store in our asset map for reference
        if (entity._assetMeshMap) {
            console.log(
                "loadAsset: Storing mesh in asset map",
                asset.general__asset_file_name,
            );
            entity._assetMeshMap.set(asset.general__asset_file_name, rootMesh);
        }

        console.log(
            "loadAsset: Mesh import completed successfully",
            asset.general__asset_file_name,
        );
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
        console.log(
            "loadAsset: Error importing model",
            asset.general__asset_file_name,
            error,
        );
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
