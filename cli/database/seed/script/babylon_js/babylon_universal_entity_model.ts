import type { Entity } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import type { VircadiaBabylonScript } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/vircadia.babylon.core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import {
    Vector3,
    type Scene,
    MeshBuilder,
    SceneLoader,
    AbstractMesh,
} from "@babylonjs/core";

// Basic interface for handling position
interface Position {
    x?: number;
    y?: number;
    z?: number;
}

// Interface for entity metadata
interface EntityMetaData {
    transform__position?: Position;
    entity_model?: {
        transform__position?: Position;
    };
}

// Extended entity interface to store mesh reference
interface EntityWithMesh extends Entity.I_Entity {
    _mesh?: AbstractMesh; // Use AbstractMesh instead of any
}

// Main script function
function vircadiaScriptMain(
    context: VircadiaBabylonScript.I_Context,
): VircadiaBabylonScript.ScriptReturn {
    return {
        hooks: {
            onScriptInitialize: (entityData: Entity.I_Entity): void => {
                // Register loaders
                registerBuiltInLoaders();

                const entity = entityData as EntityWithMesh;
                console.log("Entity initialized:", entity.general__entity_id);

                // Create a placeholder sphere for testing
                const sphere = MeshBuilder.CreateSphere(
                    "sphere",
                    { diameter: 1 },
                    context.Babylon.Scene,
                );

                // Apply position from entity metadata
                const metaData = entity.meta__data as unknown as EntityMetaData;
                const position =
                    metaData.transform__position ||
                    metaData.entity_model?.transform__position;

                if (position) {
                    sphere.position = new Vector3(
                        position.x || 0,
                        position.y || 0,
                        position.z || 0,
                    );
                }

                // Store mesh reference
                entity._mesh = sphere;

                // Try loading asset as well
                if (entity.asset__names && entity.asset__names.length > 0) {
                    console.log(
                        "Will attempt to load assets:",
                        entity.asset__names,
                    );
                    loadEntityAssets(entity, context.Babylon.Scene, context);
                }
            },

            onEntityUpdate: (updatedEntity: Entity.I_Entity): void => {
                const entityWithMesh = updatedEntity as EntityWithMesh;

                // Update position if mesh exists
                if (entityWithMesh._mesh) {
                    const metaData =
                        updatedEntity.meta__data as unknown as EntityMetaData;
                    const position =
                        metaData.transform__position ||
                        metaData.entity_model?.transform__position;

                    if (position) {
                        entityWithMesh._mesh.position.x = position.x || 0;
                        entityWithMesh._mesh.position.y = position.y || 0;
                        entityWithMesh._mesh.position.z = position.z || 0;
                    }
                }
            },

            onScriptTeardown: (): void => {
                // Minimal cleanup
                console.log("Script teardown");
            },
        },
    };
}

// Simplified function to load entity assets
async function loadEntityAssets(
    entity: EntityWithMesh,
    scene: Scene,
    context: VircadiaBabylonScript.I_Context,
): Promise<void> {
    try {
        // Check if the entity has any asset names defined
        if (!entity.asset__names || entity.asset__names.length === 0) {
            console.log("No asset names defined for entity");
            return;
        }

        console.log("Loading assets for entity:", entity.general__entity_id);

        // Get the first asset for simplicity
        const assetName = entity.asset__names[0];

        // Query asset data from the database
        const queryResult = await context.Vircadia.Utilities.Query.execute({
            query: `
                SELECT asset__data__bytea, asset__type, general__asset_file_name
                FROM entity.entity_assets 
                WHERE general__asset_file_name = $1
            `,
            parameters: [assetName],
            timeoutMs: 30000,
        });

        if (
            !queryResult.result ||
            !Array.isArray(queryResult.result) ||
            queryResult.result.length === 0
        ) {
            console.log("No asset found in database:", assetName);
            return;
        }

        const assetData = queryResult.result[0];
        console.log("Asset data found:", {
            assetName: assetData.general__asset_file_name,
            assetType: assetData.asset__type,
            hasData: !!assetData.asset__data__bytea,
            dataType: typeof assetData.asset__data__bytea,
            isArrayBuffer: assetData.asset__data__bytea instanceof ArrayBuffer,
            isObject: typeof assetData.asset__data__bytea === "object",
            objectProps:
                typeof assetData.asset__data__bytea === "object"
                    ? Object.keys(assetData.asset__data__bytea).slice(0, 5)
                    : null,
            bufferType:
                assetData.asset__data__bytea &&
                typeof assetData.asset__data__bytea === "object" &&
                "type" in assetData.asset__data__bytea
                    ? assetData.asset__data__bytea.type
                    : null,
        });

        // Process the asset data to get an ArrayBuffer
        if (assetData.asset__data__bytea) {
            // Convert the asset data to an ArrayBuffer for loading
            const arrayBuffer = await assetDataToArrayBuffer(
                assetData.asset__data__bytea,
            );

            if (arrayBuffer) {
                console.log(
                    "Successfully converted asset data to ArrayBuffer of size:",
                    arrayBuffer.byteLength,
                );

                // Determine file extension based on asset type
                const fileExt = determineFileExtension(assetData.asset__type);

                if (fileExt) {
                    try {
                        // Use the ImportMeshAsync approach for async/await pattern
                        const importResult = await SceneLoader.ImportMeshAsync(
                            "", // meshNames (empty to load all)
                            "file:", // rootUrl - just a prefix
                            new Uint8Array(arrayBuffer), // data - our model data as Uint8Array
                            scene, // scene
                            null, // onProgress
                            fileExt, // fileExtension
                        );

                        const meshes = importResult.meshes;

                        if (meshes && meshes.length > 0) {
                            console.log(
                                "Model loaded successfully! Meshes:",
                                meshes.map((m) => m.name),
                            );

                            // Remove placeholder sphere and use the loaded model
                            if (entity._mesh) {
                                entity._mesh.dispose();
                            }

                            // Set the first mesh as the main entity mesh
                            entity._mesh = meshes[0];

                            // Apply position from entity metadata
                            const metaData =
                                entity.meta__data as unknown as EntityMetaData;
                            const position =
                                metaData.transform__position ||
                                metaData.entity_model?.transform__position;

                            if (position) {
                                entity._mesh.position = new Vector3(
                                    position.x || 0,
                                    position.y || 0,
                                    position.z || 0,
                                );
                            }
                        } else {
                            console.error(
                                "No meshes were loaded from the model data",
                            );
                        }
                    } catch (error) {
                        console.error("Error loading model:", error);
                    }
                } else {
                    console.error(
                        "Could not determine file extension from asset type:",
                        assetData.asset__type,
                    );
                }
            } else {
                console.error("Could not convert asset data to ArrayBuffer");
            }
        } else {
            console.error("No asset data available");
        }
    } catch (error) {
        console.error("Error loading assets:", error);
    }
}

// Helper function to determine file extension from asset type
function determineFileExtension(assetType: string | undefined): string | null {
    if (!assetType) return null;

    const type = assetType.toLowerCase();

    if (type === "glb" || type === "model/gltf-binary") {
        return ".glb";
    }
    if (
        type === "gltf" ||
        type === "model/gltf+json" ||
        type === "model/gltf"
    ) {
        return ".gltf";
    }
    if (type === "obj") {
        return ".obj";
    }
    if (type === "babylon") {
        return ".babylon";
    }

    return null;
}

// Helper function to convert asset data to ArrayBuffer
async function assetDataToArrayBuffer(
    assetData: any,
): Promise<ArrayBuffer | null> {
    try {
        // Case 1: Already an ArrayBuffer
        if (assetData instanceof ArrayBuffer) {
            console.log("Asset data is already an ArrayBuffer");
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
            console.log("Asset data is a serialized Buffer object");
            return new Uint8Array(assetData.data).buffer;
        }

        // Case 3: Array-like object with numeric keys
        if (typeof assetData === "object" && assetData !== null) {
            const keys = Object.keys(assetData);
            const isArrayLike = keys.every((key) => !Number.isNaN(Number(key)));

            if (isArrayLike) {
                console.log("Asset data is an array-like object");
                const dataArray: number[] = [];
                const sortedKeys = keys.sort((a, b) => Number(a) - Number(b));

                for (const key of sortedKeys) {
                    dataArray.push(assetData[key]);
                }

                return new Uint8Array(dataArray).buffer;
            }
        }

        console.error(
            "Unknown asset data format:",
            typeof assetData,
            assetData,
        );
        return null;
    } catch (error) {
        console.error("Error converting asset data to ArrayBuffer:", error);
        return null;
    }
}

// Make the function available in the global scope
// @ts-ignore - Adding to global scope for script system
globalThis.vircadiaScriptMain = vircadiaScriptMain;
