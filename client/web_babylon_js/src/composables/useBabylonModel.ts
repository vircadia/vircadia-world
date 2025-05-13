import { ref, onUnmounted, watch, inject } from "vue";
import {
    type Scene,
    ImportMeshAsync,
    type AbstractMesh,
    PBRMaterial,
    Texture,
    type BaseTexture,
    type Nullable,
    Quaternion,
    PhysicsAggregate,
    PhysicsShapeType,
    type Mesh,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF"; // Import the GLTF loader
import { useDebounceFn } from "@vueuse/core";

import {
    useAsset,
    useEntity,
    useVircadiaInstance,
} from "@vircadia/world-sdk/browser/vue";

namespace glTF {
    export interface MetadataInterface {
        // LOD
        vircadia_lod_mode: LOD.Mode | null;
        vircadia_lod_auto: boolean | null;
        vircadia_lod_distance: number | null;
        vircadia_lod_size: number | null;
        vircadia_lod_hide: number | null;
        // Billboard
        vircadia_billboard_mode: string | null;
        // Lightmap
        vircadia_lightmap: string | null;
        vircadia_lightmap_level: number | null;
        vircadia_lightmap_color_space: Texture.ColorSpace | null;
        vircadia_lightmap_texcoord: number | null;
        vircadia_lightmap_use_as_shadowmap: boolean | null;
        vircadia_lightmap_mode: Light.LightmapMode | null;
        // Script
        vircadia_script: string | null;
    }

    export class Metadata implements MetadataInterface {
        [key: string]:
            | LOD.Mode
            | Light.LightmapMode
            | boolean
            | number
            | string
            | null;

        // LOD
        public vircadia_lod_mode = null;
        public vircadia_lod_auto = null;
        public vircadia_lod_distance = null;
        public vircadia_lod_size = null;
        public vircadia_lod_hide = null;
        // Billboard
        public vircadia_billboard_mode = null;
        // Lightmap
        public vircadia_lightmap = null;
        public vircadia_lightmap_level = null;
        public vircadia_lightmap_color_space = null;
        public vircadia_lightmap_texcoord = null;
        public vircadia_lightmap_use_as_shadowmap = null;
        public vircadia_lightmap_mode = null;
        // Script
        public vircadia_script = null;

        constructor(metadata?: Partial<NonNullable<MetadataInterface>>) {
            if (metadata) {
                Object.assign(this, metadata);
            }
        }
    }

    export namespace LOD {
        export enum Mode {
            DISTANCE = "distance",
            SIZE = "size",
        }

        export enum Level {
            LOD0 = "LOD0",
            LOD1 = "LOD1",
            LOD2 = "LOD2",
            LOD3 = "LOD3",
            LOD4 = "LOD4",
        }
    }

    export enum BillboardMode {
        BILLBOARDMODE_NONE = 0,
        BILLBOARDMODE_X = 1,
        BILLBOARDMODE_Y = 2,
        BILLBOARDMODE_Z = 4,
        BILLBOARDMODE_ALL = 7,
    }

    export namespace Texture {
        export enum ColorSpace {
            LINEAR = "linear",
            SRGB = "sRGB",
            GAMMA = "gamma",
        }
    }

    export namespace Lightmap {
        export const DATA_MESH_NAME = "vircadia_lightmapData";
    }

    export namespace Light {
        export enum LightmapMode {
            DEFAULT = "default",
            SHADOWSONLY = "shadowsOnly",
            SPECULAR = "specular",
        }
    }
}

export interface BabylonModelDefinition {
    fileName: string;
    entityName?: string;
    position?: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number; w: number };
    throttleInterval?: number;
    enablePhysics?: boolean;
    // Physics properties
    physicsType?: "box" | "convexHull" | "mesh";
    physicsOptions?: {
        mass?: number;
        friction?: number;
        restitution?: number;
        isKinematic?: boolean;
    };
}

export function useBabylonModel(def: BabylonModelDefinition) {
    // Local scene reference to be set when load() is called
    let scene: Scene | null = null;

    // Expose loading state to parent
    const isLoading = ref(false);
    const hasError = ref(false);
    const errorMessage = ref("");

    // Reactive refs for position and rotation
    const currentPosition = ref(def.position || { x: 0, y: 0, z: 0 });
    const currentRotation = ref(def.rotation || { x: 0, y: 0, z: 0, w: 1 });

    // Get Vircadia instance
    const vircadiaWorld = inject(useVircadiaInstance());

    if (!vircadiaWorld) {
        throw new Error("Vircadia instance not found");
    }

    // Entity management
    const meshes = ref<AbstractMesh[]>([]);

    // Add ref for entity name
    const entityName = ref<string | null>(def.entityName || def.fileName);

    // Initialize asset and entity composables
    const asset = useAsset({
        fileName: ref(def.fileName),
        useCache: true,
    });

    // Prepare initial meta data with position and rotation
    const getInitialMetaData = () => {
        return JSON.stringify({
            type: { value: "Model" },
            modelURL: { value: def.fileName },
            position: def.position
                ? {
                      value: def.position,
                  }
                : undefined,
            rotation: def.rotation
                ? {
                      value: def.rotation,
                  }
                : undefined,
        });
    };

    const entity = useEntity({
        entityName,
        selectClause: "general__entity_name, meta__data",
        insertClause:
            "(general__entity_name, meta__data) VALUES ($1, $2) RETURNING general__entity_name",
        insertParams: [entityName.value, getInitialMetaData()],
    });

    // Update loading state based on asset and entity status
    watch(
        [
            () => asset.loading.value,
            () => entity.retrieving.value,
            () => entity.creating.value,
            () => entity.updating.value,
        ],
        ([assetLoading, entityRetrieving, entityCreating, entityUpdating]) => {
            isLoading.value =
                assetLoading ||
                entityRetrieving ||
                entityCreating ||
                entityUpdating;
        },
        { immediate: true },
    );

    // Function to update mesh positions
    const updateMeshPositions = () => {
        if (meshes.value.length === 0) return;

        for (const mesh of meshes.value) {
            if (!mesh.parent) {
                mesh.position.set(
                    currentPosition.value.x,
                    currentPosition.value.y,
                    currentPosition.value.z,
                );
            }
        }
    };

    // Function to update mesh rotations
    const updateMeshRotations = () => {
        if (meshes.value.length === 0) return;

        for (const mesh of meshes.value) {
            if (!mesh.parent) {
                const rotation = new Quaternion(
                    currentRotation.value.x,
                    currentRotation.value.y,
                    currentRotation.value.z,
                    currentRotation.value.w,
                );
                mesh.rotationQuaternion = rotation;
            }
        }
    };

    // FIRST_EDIT: add a safeExecuteUpdate helper that retries when the entity is busy
    const safeExecuteUpdate = (
        query: string,
        params: unknown[],
        retryInterval: number = def.throttleInterval ?? 1000,
    ): void => {
        if (
            entity.retrieving.value ||
            entity.creating.value ||
            entity.updating.value
        ) {
            console.warn(`Entity busy, retrying update in ${retryInterval}ms`);
            setTimeout(
                () => safeExecuteUpdate(query, params, retryInterval),
                retryInterval,
            );
            return;
        }
        entity.executeUpdate(query, params).catch((e: unknown) => {
            console.error("Entity update failed:", e);
            if (e instanceof Error && e.message.includes("Another operation")) {
                console.warn(
                    `Retrying update after failure in ${retryInterval}ms`,
                );
                setTimeout(
                    () => safeExecuteUpdate(query, params, retryInterval),
                    retryInterval,
                );
            }
        });
    };

    const debouncedEntityUpdate = useDebounceFn(async () => {
        if (!entity.entityData.value?.general__entity_name) {
            console.warn("Cannot update entity: No entity name available");
            return;
        }

        // Prepare the updated meta data
        const metaData = entity.entityData.value.meta__data || {};
        const updatedMetaData = {
            ...metaData,
            position: { value: currentPosition.value },
            rotation: { value: currentRotation.value },
        };

        // Update the entity with new meta data
        console.log("Updating entity position and rotation:", updatedMetaData);
        console.log(
            "Current position:",
            currentPosition.value,
            "Current rotation:",
            currentRotation.value,
        );
        safeExecuteUpdate("meta__data = $2", [JSON.stringify(updatedMetaData)]);
    }, def.throttleInterval ?? 1000);

    // Watch for changes to currentPosition
    watch(
        currentPosition,
        (newPosition) => {
            updateMeshPositions();
            debouncedEntityUpdate();
        },
        { deep: true },
    );

    // Watch for changes to currentRotation
    watch(
        currentRotation,
        (newRotation) => {
            updateMeshRotations();
            debouncedEntityUpdate();
        },
        { deep: true },
    );

    // Watch for changes to def.position
    watch(
        () => def.position,
        (newPosition) => {
            if (
                newPosition &&
                (newPosition.x !== currentPosition.value.x ||
                    newPosition.y !== currentPosition.value.y ||
                    newPosition.z !== currentPosition.value.z)
            ) {
                currentPosition.value = { ...newPosition };
            }
        },
        { deep: true },
    );

    // Watch for changes to def.rotation
    watch(
        () => def.rotation,
        (newRotation) => {
            if (
                newRotation &&
                (newRotation.x !== currentRotation.value.x ||
                    newRotation.y !== currentRotation.value.y ||
                    newRotation.z !== currentRotation.value.z ||
                    newRotation.w !== currentRotation.value.w)
            ) {
                currentRotation.value = { ...newRotation };
            }
        },
        { deep: true },
    );

    // Load model when asset data is available
    const loadModel = async () => {
        console.log("Loading model... ", def.fileName);

        // Ensure asset is ready and scene is set
        const s = scene;
        if (!asset.assetData.value || !s) {
            console.warn(
                `Asset: ${asset.assetData.value ? "Ready" : "Not ready"}.`,
            );
            console.warn(`Scene: ${s ? "Ready" : "Not ready"}.`);
            return;
        }

        const assetData = asset.assetData.value;

        if (!assetData.blobUrl) {
            console.warn("Asset blob URL not available.");
            return;
        }

        if (meshes.value.length > 0) {
            console.log(`Model '${def.fileName}' already loaded. Skipping.`);
            return;
        }

        try {
            const pluginExtension =
                assetData.mimeType === "model/gltf-binary" ? ".glb" : ".gltf";
            console.log(`Loading model '${def.fileName}' using blob URL...`);

            // Using ImportMeshAsync with correct parameter usage
            const result = await ImportMeshAsync(assetData.blobUrl, s, {
                pluginExtension,
            });

            const hasLightmapData = result.meshes.some((mesh) =>
                mesh.name.startsWith(glTF.Lightmap.DATA_MESH_NAME),
            );
            let processedMeshes: AbstractMesh[];
            if (hasLightmapData) {
                console.log(`Processing lightmaps for '${def.fileName}'...`);
                processedMeshes = await loadLightmap(result.meshes, s);
            } else {
                console.log(
                    `No lightmap data found for '${def.fileName}'... skipping lightmap processing.`,
                );
                processedMeshes = result.meshes;
            }
            meshes.value = processedMeshes;

            // Extract position and rotation from entity data if available
            if (entity.entityData.value?.meta__data) {
                const entityMetaData = entity.entityData.value.meta__data;
                if (
                    typeof entityMetaData === "object" &&
                    entityMetaData.position?.value
                ) {
                    currentPosition.value = {
                        ...entityMetaData.position.value,
                    };
                }

                if (
                    typeof entityMetaData === "object" &&
                    entityMetaData.rotation?.value
                ) {
                    currentRotation.value = {
                        ...entityMetaData.rotation.value,
                    };
                }
            } else {
                // Use def values as defaults
                if (def.position) {
                    currentPosition.value = { ...def.position };
                }

                if (def.rotation) {
                    currentRotation.value = { ...def.rotation };
                }
            }

            // Apply position and rotation to meshes
            updateMeshPositions();
            updateMeshRotations();

            // Apply physics if enabled
            if (def.enablePhysics) {
                applyPhysics();
            }

            console.log(
                `Model '${def.fileName}' loaded successfully (${meshes.value.length} meshes).`,
            );
        } catch (error) {
            console.error(`Error loading model '${def.fileName}':`, error);
            hasError.value = true;
            errorMessage.value = `Error loading model: ${error}`;
        }
    };

    /**
     * Loads and applies lightmaps to meshes in a scene
     * @param meshes The meshes to process for lightmaps
     * @param scene The Babylon.js scene
     * @returns The processed meshes
     */
    const loadLightmap = async (
        meshes: AbstractMesh[],
        scene: Scene,
    ): Promise<AbstractMesh[]> => {
        // Find global lightmap settings
        let lightmapColorSpace = null;
        let lightmapLevel = null;
        let lightmapMode = null;

        // Look for the special lightmap data mesh
        const foundLightmapMesh = meshes.find((m) =>
            m.name.startsWith(glTF.Lightmap.DATA_MESH_NAME),
        );

        if (foundLightmapMesh) {
            console.log(`Found lightmap mesh: ${foundLightmapMesh.name}`);

            // Extract metadata from the lightmap mesh
            const metadataExtras =
                foundLightmapMesh?.metadata?.gltf?.extras ??
                foundLightmapMesh?.parent?.metadata?.gltf?.extras;
            const metadata = new glTF.Metadata(
                metadataExtras as Partial<glTF.MetadataInterface>,
            );

            // Get global lightmap settings
            if (metadata.vircadia_lightmap_mode) {
                console.log(
                    `Found lightmap mode for all meshes as ${metadata.vircadia_lightmap_mode}`,
                );
                lightmapMode = String(
                    metadata.vircadia_lightmap_mode,
                ) as unknown as glTF.Light.LightmapMode;
            }

            if (metadata.vircadia_lightmap_level) {
                console.log(
                    `Found lightmap level for all meshes as ${metadata.vircadia_lightmap_level}`,
                );
                lightmapLevel = 2; // Number(metadata.vircadia_lightmap_level);
            }

            if (metadata.vircadia_lightmap_color_space) {
                console.log(
                    `Found lightmap color space for all meshes as ${metadata.vircadia_lightmap_color_space}`,
                );
                lightmapColorSpace = String(
                    metadata.vircadia_lightmap_color_space,
                ) as unknown as glTF.Texture.ColorSpace;
            }

            // Remove the data mesh as it's no longer needed
            foundLightmapMesh.dispose(true, false);
            console.log(
                `Deleting lightmap data mesh: ${foundLightmapMesh.name}`,
            );
        }

        // Apply lightmap mode to all lights in the scene
        for (const light of scene.lights) {
            switch (lightmapMode) {
                case glTF.Light.LightmapMode.DEFAULT:
                    light.lightmapMode = 0;
                    break;
                case glTF.Light.LightmapMode.SHADOWSONLY:
                    light.lightmapMode = 1;
                    break;
                case glTF.Light.LightmapMode.SPECULAR:
                    light.lightmapMode = 2;
                    break;
                default:
                    light.lightmapMode = 0;
                    break;
            }
            console.log(
                `Setting lightmap mode for ${light.name}: ${light.lightmapMode}`,
            );
        }

        // Process each mesh for lightmap application
        for (const mesh of meshes) {
            // Extract mesh-specific metadata
            const metadataExtras =
                mesh?.metadata?.gltf?.extras ??
                mesh?.parent?.metadata?.gltf?.extras;
            const metadata = new glTF.Metadata(
                metadataExtras as Partial<glTF.MetadataInterface>,
            );

            // If mesh has lightmap data, apply it
            if (
                metadata.vircadia_lightmap &&
                metadata.vircadia_lightmap_texcoord
            ) {
                const lightmapMaterialName = metadata.vircadia_lightmap;

                // Find the referenced material by name
                const material = scene.materials.find(
                    (m) => m.name === lightmapMaterialName,
                );

                // Check if the mesh material is compatible
                if (!(mesh.material instanceof PBRMaterial)) {
                    console.error(
                        `Material type of ${JSON.stringify(mesh.material)} 
                        for: ${mesh.name} is not supported for lightmap application. Need PBRMaterial. Skipping...`,
                    );
                    continue;
                }

                const materialToUse = material as PBRMaterial;

                // Apply lightmap if material and texture are valid
                if (
                    materialToUse?.albedoTexture &&
                    mesh.material &&
                    Boolean(metadata.vircadia_lightmap_texcoord)
                ) {
                    // Wait for texture to be ready before applying
                    await new Promise<void>((resolve) => {
                        if (!materialToUse.albedoTexture) {
                            throw new Error(
                                `Albedo texture not found for material: ${materialToUse.name}`,
                            );
                        }

                        Texture.WhenAllReady(
                            [materialToUse.albedoTexture],
                            () => {
                                try {
                                    const lightmapTexture: Nullable<BaseTexture> =
                                        materialToUse.albedoTexture;

                                    if (lightmapTexture) {
                                        (
                                            mesh.material as PBRMaterial
                                        ).lightmapTexture = lightmapTexture;
                                        (
                                            mesh.material as PBRMaterial
                                        ).useLightmapAsShadowmap =
                                            metadata.vircadia_lightmap_use_as_shadowmap ??
                                            true;

                                        if (
                                            (mesh.material as PBRMaterial)
                                                .lightmapTexture &&
                                            metadata.vircadia_lightmap_texcoord
                                        ) {
                                            const currentMeshMaterialAsPBRMaterial =
                                                (mesh.material as PBRMaterial)
                                                    .lightmapTexture;
                                            // Only proceed if the lightmap texture exists
                                            if (
                                                currentMeshMaterialAsPBRMaterial
                                            ) {
                                                currentMeshMaterialAsPBRMaterial.coordinatesIndex =
                                                    metadata.vircadia_lightmap_texcoord;
                                            } else {
                                                console.warn(
                                                    `No lightmap texture found for mesh: ${mesh.name}`,
                                                );
                                            }
                                        }
                                    }
                                    resolve();
                                } catch (e) {
                                    console.error(
                                        `Error setting lightmap texture for: ${mesh.name}, error: ${e}`,
                                    );
                                    resolve();
                                }
                            },
                        );
                    });
                } else {
                    console.error(
                        `Could not find material or albedo texture for: ${mesh.name}`,
                    );
                }

                // Apply texture settings if available
                if (mesh.material) {
                    const activeTextures = mesh.material.getActiveTextures();
                    for (const texture of activeTextures) {
                        if (texture instanceof Texture) {
                            // Apply color space settings
                            if (lightmapColorSpace) {
                                switch (lightmapColorSpace) {
                                    case glTF.Texture.ColorSpace.LINEAR:
                                        console.log(
                                            `Setting color space for ${mesh.name} to linear.`,
                                        );
                                        texture.gammaSpace = false;
                                        break;
                                    case glTF.Texture.ColorSpace.GAMMA:
                                    case glTF.Texture.ColorSpace.SRGB:
                                        console.log(
                                            `Setting color space for ${mesh.name} to ${lightmapColorSpace}.`,
                                        );
                                        texture.gammaSpace = true;
                                        break;
                                    default:
                                        console.log(
                                            `Setting color space for ${mesh.name} to gamma.`,
                                        );
                                        texture.gammaSpace = true;
                                        break;
                                }
                            }

                            // Apply lightmap level
                            if (lightmapLevel) {
                                texture.level = lightmapLevel;
                            }
                        }
                    }
                }
            }
        }

        return meshes;
    };

    // Physics-related refs
    const physicsAggregates = ref<PhysicsAggregate[]>([]);

    // Apply physics to model based on mesh shape
    const applyPhysics = () => {
        // Ensure scene is ready and physics is enabled
        const s = scene;
        if (
            !def.enablePhysics ||
            meshes.value.length === 0 ||
            !s ||
            !s.physicsEnabled
        ) {
            return;
        }

        // Remove any existing physics
        removePhysics();

        // Default physics properties
        const mass = def.physicsOptions?.mass ?? 0;
        const friction = def.physicsOptions?.friction ?? 0.2;
        const restitution = def.physicsOptions?.restitution ?? 0.2;

        console.log(
            `Applying physics type ${def.physicsType || "mesh"} to model ${def.fileName}`,
        );

        // Determine physics type - default to mesh impostor for precision
        const physicsType = def.physicsType || "mesh";
        let shapeType: PhysicsShapeType;

        switch (physicsType) {
            case "mesh":
                shapeType = PhysicsShapeType.MESH;
                break;
            case "convexHull":
                shapeType = PhysicsShapeType.CONVEX_HULL;
                break;
            default:
                shapeType = PhysicsShapeType.BOX;
                break;
        }

        // Apply physics to each mesh that can have physics applied
        for (const mesh of meshes.value) {
            // Skip helper or utility meshes
            if (
                mesh.name.includes("__root__") ||
                mesh.name.includes("__point__") ||
                !mesh.getClassName ||
                mesh.getClassName() !== "Mesh"
            ) {
                continue;
            }

            try {
                // Create physics aggregate for this mesh
                const aggregate = new PhysicsAggregate(
                    mesh as unknown as Mesh,
                    shapeType,
                    { mass, friction, restitution },
                    s,
                );

                physicsAggregates.value.push(aggregate);

                console.log(
                    `Applied ${physicsType} physics to mesh: ${mesh.name}`,
                );
            } catch (error) {
                console.error(
                    `Failed to apply physics to mesh ${mesh.name}:`,
                    error,
                );
            }
        }

        // Update entity metadata to include physics properties
        updateEntityPhysicsData();
    };

    // Remove physics from model
    function removePhysics() {
        // Remove all physics aggregates
        for (const aggregate of physicsAggregates.value) {
            if (aggregate) {
                aggregate.dispose();
            }
        }
        physicsAggregates.value = [];
    }

    // Update entity metadata with physics data
    function updateEntityPhysicsData() {
        if (!entity.entityData.value?.general__entity_name) {
            console.warn(
                "Cannot update entity physics: No entity name available",
            );
            return;
        }

        // Get current metadata
        const metaData = entity.entityData.value.meta__data || {};

        // Add physics properties
        const updatedMetaData = {
            ...metaData,
            physics: {
                value: {
                    enabled: def.enablePhysics,
                    type: def.physicsType || "mesh",
                    options: def.physicsOptions || {
                        mass: 0,
                        friction: 0.2,
                        restitution: 0.2,
                    },
                },
            },
        };

        // Update entity metadata
        console.log("Updating entity physics data:", updatedMetaData);
        safeExecuteUpdate("meta__data = $2", [JSON.stringify(updatedMetaData)]);
    }

    // Watch for changes in physics props
    watch(
        [
            () => def.enablePhysics,
            () => def.physicsType,
            () => def.physicsOptions,
        ],
        () => {
            if (meshes.value.length > 0) {
                if (def.enablePhysics) {
                    applyPhysics();
                } else {
                    removePhysics();
                }

                // Update entity metadata
                updateEntityPhysicsData();
            }
        },
        { deep: true },
    );

    // Watch for asset data to load model
    watch(
        () => asset.assetData.value,
        (assetData, oldAssetData) => {
            if (assetData?.blobUrl && meshes.value.length === 0) {
                console.log(
                    `Asset data ready for ${def.fileName}, loading model.`,
                );
                loadModel();
            }
        },
    );

    // Watch for asset errors
    watch(
        () => asset.error.value,
        (error) => {
            if (error) {
                console.error(`Asset Error (${def.fileName}):`, error);
                hasError.value = true;
                errorMessage.value = `Asset error: ${error}`;
            }
        },
    );

    // Watch for entity data changes
    watch(
        [
            () => entity.entityData.value,
            () => entity.creating.value,
            () => entity.error.value,
        ],
        ([entityData, creating, error], [oldEntityData, wasCreating]) => {
            if (error) {
                console.error(`Entity Error (${def.fileName}):`, error);
                hasError.value = true;
                errorMessage.value = `Entity error: ${error}`;
            } else if (wasCreating && !creating && entityData) {
                console.log(
                    `Entity created successfully for ${def.fileName}:`,
                    entityData,
                );
                // Store the name if this was a newly created entity
                if (entityData.general__entity_name && !entityName.value) {
                    entityName.value = entityData.general__entity_name;
                    console.log(
                        `Set entityName to ${entityName.value} after creation`,
                    );
                }
            } else if (entityData && entityData !== oldEntityData) {
                console.log(
                    `Entity data available for ${def.fileName}:`,
                    entityData,
                );

                // Store the name if we didn't have it before
                if (entityData.general__entity_name && !entityName.value) {
                    entityName.value = entityData.general__entity_name;
                    console.log(
                        `Set entityName to ${entityName.value} from retrieved entity`,
                    );
                }

                // Check for updated position/rotation in entity data
                if (entityData.meta__data) {
                    const metaData = entityData.meta__data;

                    if (
                        typeof metaData === "object" &&
                        metaData.position?.value
                    ) {
                        const newPosition = metaData.position.value;
                        // Only update if different to avoid circular updates
                        if (
                            newPosition.x !== currentPosition.value.x ||
                            newPosition.y !== currentPosition.value.y ||
                            newPosition.z !== currentPosition.value.z
                        ) {
                            currentPosition.value = { ...newPosition };
                        }
                    }

                    if (
                        typeof metaData === "object" &&
                        metaData.rotation?.value
                    ) {
                        const newRotation = metaData.rotation.value;
                        // Only update if different to avoid circular updates
                        if (
                            newRotation.x !== currentRotation.value.x ||
                            newRotation.y !== currentRotation.value.y ||
                            newRotation.z !== currentRotation.value.z ||
                            newRotation.w !== currentRotation.value.w
                        ) {
                            currentRotation.value = { ...newRotation };
                        }
                    }
                }
            }
        },
    );

    // Manage asset and entity based on connection status
    const manageAssetAndEntity = () => {
        console.log(`Managing asset and entity for ${def.fileName}...`);

        // 1. Load asset
        asset.executeLoad();

        // 2. Check if we have an entityName
        if (entityName.value) {
            // Try to retrieve the entity by name
            console.log(
                `Retrieving model entity with name: ${entityName.value}`,
            );
            entity.executeRetrieve();
        } else {
            // This shouldn't happen but set a default name if somehow it got cleared
            console.error("Entity name should never be null at this point");
            entityName.value = def.fileName;
            entity.executeRetrieve();
        }

        // Watch for retrieve completion to handle not found case
        const stopWatch = watch(
            [
                () => entity.retrieving.value,
                () => entity.error.value,
                () => entity.entityData.value,
            ],
            ([retrieving, error, entityData], [wasRetrieving]) => {
                if (wasRetrieving && !retrieving) {
                    if (!entityData && !error && entityName.value) {
                        // Entity with provided name not found, create a new one
                        console.log(
                            `Entity ${def.fileName} with name ${entityName.value} not found, creating new one...`,
                        );
                        entity.executeCreate().then((newName) => {
                            if (newName) {
                                console.log(
                                    `Created new entity with name: ${newName} for ${def.fileName}`,
                                );
                                entity.executeRetrieve();
                            } else {
                                console.error(
                                    "Failed to create entity with name:",
                                    entityName.value,
                                );
                                // The creation failed, but we still have the name
                                entity.executeRetrieve();
                            }
                        });
                    }
                    stopWatch(); // Stop watching after entity retrieval completes
                }
            },
            { immediate: false },
        );
    };

    // Manage connection status changes immediately
    watch(
        () => vircadiaWorld.connectionInfo.value.status,
        (newStatus, oldStatus) => {
            if (newStatus === "connected" && oldStatus !== "connected") {
                console.log(
                    `Vircadia connected, managing asset and entity for ${def.fileName}.`,
                );
                manageAssetAndEntity();
            } else if (newStatus !== "connected") {
                console.log(
                    `Vircadia disconnected, clearing meshes for ${def.fileName}.`,
                );
                for (const mesh of meshes.value) {
                    mesh.dispose();
                }
                meshes.value = [];
            }
        },
        { immediate: true },
    );

    onUnmounted(() => {
        console.log(
            `StaticBabylonEntity component for ${def.fileName} unmounting. Cleaning up...`,
        );

        handleUnload();

        console.log(`Cleanup complete for ${def.fileName}.`);
    });

    // Add global error handler to force cleanup on errors
    const handleError = (error: Error | string | unknown) => {
        console.error(`Error in BabylonModel (${def.fileName}):`, error);

        // Clean up resources on error
        handleUnload();
    };

    // Monitor for errors
    watch(
        [
            () => asset.error.value,
            () => entity.error.value,
            () => hasError.value,
        ],
        ([assetError, entityError, componentError]) => {
            if (assetError || entityError || componentError) {
                handleError(assetError || entityError || errorMessage.value);
            }
        },
    );

    // Immediately after importing, add this to ensure all URLs are released
    window.addEventListener("unload", () => {
        handleUnload();

        window.removeEventListener("unload", handleUnload);
    });

    const handleUnload = () => {
        console.log("Unloading page, cleaning up...");
        entity.cleanup();
        asset.cleanup();
        removePhysics();

        // Force release all object URLs when page unloads
        if (meshes.value.length > 0) {
            for (const mesh of meshes.value) {
                mesh.dispose();
            }
            meshes.value = [];
        }
    };

    // Expose composable API
    return {
        isLoading,
        hasError,
        errorMessage,
        position: currentPosition,
        rotation: currentRotation,
        entityName,
        meshes,
        load: (s: Scene) => {
            scene = s;
            manageAssetAndEntity();
        },
        unload: handleUnload,
        applyPhysics,
        removePhysics,
        updateEntityPhysicsData,
    };
}
