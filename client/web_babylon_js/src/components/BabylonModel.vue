<template>
  <!-- Renderless: expose model context via scoped slot -->
  <slot :meshes="meshes" :def="props.def" />
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted, computed, shallowRef, markRaw } from "vue";
import type { Scene, AbstractMesh } from "@babylonjs/core";
import {
    ImportMeshAsync,
    PBRMaterial,
    Texture,
    type BaseTexture,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import type {
    BabylonModelDefinition,
    ModelMetadata,
} from "../composables/schemas";
import { ModelMetadataSchema } from "../composables/schemas";

import { useDebounceFn } from "@vueuse/core";
// TODO: Move entity updates synchronization into their own component.
import { useAsset, type useVircadia } from "@vircadia/world-sdk/browser/vue";

const props = defineProps<{
    def: BabylonModelDefinition;
    scene: Scene | null;
    vircadiaWorld: ReturnType<typeof useVircadia>;
}>();

// --- Set up Babylon model pipelines ---

// 1. Asset loader is now managed by useBabylonModelLoader
// 2. Entity synchronization (generic metadata)
// Define metadata schema & type

// Initialize generic entity sync
const entityNameRef = ref(props.def.entityName || props.def.fileName);

// Vircadia connection manager
const vircadia = props.vircadiaWorld;

// Get current sessionId from vircadia connection
const sessionId = computed(
    () => vircadia.connectionInfo.value.sessionId ?? null,
);

// Entity state management
const entityMetadata = ref<ModelMetadata | null>(null);
const isRetrieving = ref(false);
const isCreating = ref(false);
const isUpdating = ref(false);

// Setup model entity inline (similar to BabylonMyAvatar.vue)
const getInitialMeta: () => ModelMetadata = () => ({
    type: "Model" as const,
    modelFileName: props.def.fileName,
    position: props.def.position ?? { x: 0, y: 0, z: 0 },
    rotation: props.def.rotation ?? { x: 0, y: 0, z: 0, w: 1 },
    ownerSessionId: props.def.ownerSessionId ?? null,
});

// Helper function to retrieve metadata for an entity
async function retrieveEntityMetadata(
    entityName: string,
): Promise<Map<string, unknown> | null> {
    if (!vircadia) {
        console.error("Vircadia instance not found");
        return null;
    }

    try {
        // Fetch all metadata for this entity
        const metadataResult = await vircadia.client.Utilities.Connection.query(
            {
                query: "SELECT metadata__key, metadata__value FROM entity.entity_metadata WHERE general__entity_name = $1",
                parameters: [entityName],
            },
        );

        if (Array.isArray(metadataResult.result)) {
            // Reconstruct metadata map from rows
            const metadataMap = new Map<string, unknown>();
            for (const row of metadataResult.result) {
                metadataMap.set(row.metadata__key, row.metadata__value);
            }
            return metadataMap;
        }
    } catch (e) {
        console.error("Failed to retrieve metadata:", e);
    }
    return null;
}

// Debounced update function using metadata table for granular updates
const debouncedUpdate = useDebounceFn(async () => {
    if (!entityMetadata.value || !entityNameRef.value) {
        console.warn("Cannot update entity: No entity data available");
        return;
    }

    const currentMeta = entityMetadata.value;
    const newPos = props.def.position ?? { x: 0, y: 0, z: 0 };
    const newRot = props.def.rotation ?? { x: 0, y: 0, z: 0, w: 1 };

    try {
        isUpdating.value = true;

        // Helper function to update metadata
        const updateMetadata = async (key: string, value: unknown) => {
            await vircadia.client.Utilities.Connection.query({
                query: `INSERT INTO entity.entity_metadata (general__entity_name, metadata__key, metadata__value, group__sync)
                        VALUES ($1, $2, $3, $4)
                        ON CONFLICT (general__entity_name, metadata__key) 
                        DO UPDATE SET metadata__value = EXCLUDED.metadata__value`,
                parameters: [entityNameRef.value, key, value, "public.NORMAL"],
            });
        };

        // Update position if changed
        if (
            currentMeta.position &&
            (currentMeta.position.x !== newPos.x ||
                currentMeta.position.y !== newPos.y ||
                currentMeta.position.z !== newPos.z)
        ) {
            await updateMetadata("position", newPos);
        }

        // Update rotation if changed
        if (
            currentMeta.rotation &&
            (currentMeta.rotation.x !== newRot.x ||
                currentMeta.rotation.y !== newRot.y ||
                currentMeta.rotation.z !== newRot.z ||
                currentMeta.rotation.w !== newRot.w)
        ) {
            await updateMetadata("rotation", newRot);
        }

        // Update type if changed
        if (currentMeta.type !== "Model") {
            await updateMetadata("type", "Model");
        }

        // Update modelFileName if changed
        if (currentMeta.modelFileName !== props.def.fileName) {
            await updateMetadata("modelFileName", props.def.fileName);
        }

        // Update ownerSessionId if changed
        const currentOwnerSessionId = props.def.ownerSessionId ?? null;
        if (currentMeta.ownerSessionId !== currentOwnerSessionId) {
            await updateMetadata("ownerSessionId", currentOwnerSessionId);
        }
    } catch (e: unknown) {
        console.error("Entity update failed:", e);
    } finally {
        isUpdating.value = false;
    }
}, props.def.throttleInterval ?? 1000);

// 3. Model loader and asset management (inlined)
// glTF metadata definitions (copied from original useBabylonModelLoader)
namespace glTF {
    export interface MetadataInterface {
        vircadia_lod_mode: LOD.Mode | null;
        vircadia_lod_auto: boolean | null;
        vircadia_lod_distance: number | null;
        vircadia_lod_size: number | null;
        vircadia_lod_hide: number | null;
        vircadia_billboard_mode: string | null;
        vircadia_lightmap: string | null;
        vircadia_lightmap_level: number | null;
        vircadia_lightmap_color_space: Texture.ColorSpace | null;
        vircadia_lightmap_texcoord: number | null;
        vircadia_lightmap_use_as_shadowmap: boolean | null;
        vircadia_lightmap_mode: Light.LightmapMode | null;
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
        public vircadia_lod_mode = null;
        public vircadia_lod_auto = null;
        public vircadia_lod_distance = null;
        public vircadia_lod_size = null;
        public vircadia_lod_hide = null;
        public vircadia_billboard_mode = null;
        public vircadia_lightmap = null;
        public vircadia_lightmap_level = null;
        public vircadia_lightmap_color_space = null;
        public vircadia_lightmap_texcoord = null;
        public vircadia_lightmap_use_as_shadowmap = null;
        public vircadia_lightmap_mode = null;
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

// only track top-level array changes, never recurse into mesh properties
const meshes = shallowRef<AbstractMesh[]>([]);
const fileNameRef = ref(props.def.fileName);
const asset = useAsset({
    fileName: fileNameRef,
    useCache: true,
    debug: false,
    instance: vircadia,
});

async function loadModel(scene: Scene) {
    if (!scene) {
        console.warn("No scene provided to loadModel");
        return;
    }

    // trigger asset fetch
    await asset.executeLoad();
    const assetData = asset.assetData.value;
    if (!assetData?.blobUrl) {
        console.warn(
            `Asset blob URL not available for '${props.def.fileName}'`,
        );
        return;
    }
    console.log("Loading model... ", props.def.fileName);
    if (meshes.value.length > 0) {
        console.log(`Model '${props.def.fileName}' already loaded. Skipping.`);
        return;
    }
    try {
        console.log(
            `Loading model '${props.def.fileName}' using blob URL with plugin extension ${asset.fileExtension.value}...`,
        );
        const result = await ImportMeshAsync(assetData.blobUrl, scene, {
            pluginExtension: asset.fileExtension.value,
        });
        const hasLightmapData = result.meshes.some((m) =>
            m.name.startsWith(glTF.Lightmap.DATA_MESH_NAME),
        );
        let processed: AbstractMesh[];
        if (hasLightmapData) {
            console.log(`Processing lightmaps for '${props.def.fileName}'...`);
            processed = await loadLightmap(result.meshes, scene);
        } else {
            console.log(
                `No lightmap data found for '${props.def.fileName}'... skipping lightmap processing.`,
            );
            processed = result.meshes;
        }
        meshes.value = processed.map((m) => markRaw(m));
    } catch (e) {
        console.error(`Error loading model '${props.def.fileName}':`, e);
        throw e;
    }
}

async function loadLightmap(
    meshesArr: AbstractMesh[],
    scene: Scene,
): Promise<AbstractMesh[]> {
    let lightmapColorSpace: glTF.Texture.ColorSpace | null = null;
    let lightmapLevel: number | null = null;
    let lightmapMode: glTF.Light.LightmapMode | null = null;

    // Find ALL lightmap data meshes, not just the first one
    const dataMeshes = meshesArr.filter((m) =>
        m.name.startsWith(glTF.Lightmap.DATA_MESH_NAME),
    );

    console.log(`Found ${dataMeshes.length} lightmap data meshes`);

    // Process the first data mesh for global metadata
    const dataMesh = dataMeshes[0];
    if (dataMesh) {
        console.log(`Processing lightmap metadata from: ${dataMesh.name}`);
        const extras =
            // @ts-ignore
            dataMesh?.metadata?.gltf?.extras ||
            dataMesh?.parent?.metadata?.gltf?.extras;
        const metadata = new glTF.Metadata(
            extras as Partial<glTF.MetadataInterface>,
        );

        if (metadata.vircadia_lightmap_mode) {
            lightmapMode =
                metadata.vircadia_lightmap_mode as glTF.Light.LightmapMode;
            console.log(`Found lightmap mode: ${lightmapMode}`);
        }
        if (metadata.vircadia_lightmap_level) {
            lightmapLevel = Number(metadata.vircadia_lightmap_level);
            console.log(`Found lightmap level: ${lightmapLevel}`);
        }
        if (metadata.vircadia_lightmap_color_space) {
            lightmapColorSpace = metadata.vircadia_lightmap_color_space;
            console.log(`Found lightmap color space: ${lightmapColorSpace}`);
        }
    }

    // Dispose of ALL lightmap data meshes
    for (const mesh of dataMeshes) {
        mesh.dispose(true, false);
        console.log(`Deleted lightmap data mesh: ${mesh.name}`);
    }

    // Set global lightmap mode on scene lights
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
        }
        console.log(
            `Setting lightmap mode for ${light.name}: ${light.lightmapMode}`,
        );
    }

    // Apply per-mesh lightmaps
    const nonDataMeshes = meshesArr.filter(
        (m) => !m.name.startsWith(glTF.Lightmap.DATA_MESH_NAME),
    );
    console.log(
        `Processing ${nonDataMeshes.length} non-data meshes for lightmap application`,
    );

    for (const mesh of nonDataMeshes) {
        const extras =
            // @ts-ignore
            mesh?.metadata?.gltf?.extras ||
            mesh?.parent?.metadata?.gltf?.extras;

        const metadata = new glTF.Metadata(
            extras as Partial<glTF.MetadataInterface>,
        );

        if (
            metadata.vircadia_lightmap &&
            metadata.vircadia_lightmap_texcoord !== null
        ) {
            const material = scene.materials.find(
                (m) => m.name === metadata.vircadia_lightmap,
            );

            if (!mesh.material) {
                console.warn(`Mesh ${mesh.name} has no material. Skipping.`);
                continue;
            }

            if (!(mesh.material instanceof PBRMaterial)) {
                console.warn(
                    `Material for mesh ${mesh.name} is not PBRMaterial (it's ${mesh.material.getClassName()}). Skipping.`,
                );
                continue;
            }

            if (!material) {
                console.warn(
                    `Lightmap material ${metadata.vircadia_lightmap} not found in scene. Skipping mesh ${mesh.name}.`,
                );
                continue;
            }

            if (!(material instanceof PBRMaterial)) {
                console.warn(
                    `Lightmap material ${metadata.vircadia_lightmap} is not PBRMaterial (it's ${material.getClassName()}). Skipping mesh ${mesh.name}.`,
                );
                continue;
            }

            const mat = material as PBRMaterial;

            await new Promise<void>((resolve) => {
                if (!mat.albedoTexture) {
                    console.warn(
                        `Lightmap material ${mat.name} has no albedo texture. Skipping mesh ${mesh.name}.`,
                    );
                    resolve();
                    return;
                }

                // @ts-ignore: albedoTexture may be nullable, but guarded above
                Texture.WhenAllReady([mat.albedoTexture as BaseTexture], () => {
                    if (
                        mat.albedoTexture &&
                        metadata.vircadia_lightmap_texcoord != null
                    ) {
                        const lightmapTexture =
                            mat.albedoTexture as BaseTexture;
                        const meshMaterial = mesh.material as PBRMaterial;

                        // Create a clone of the texture for lightmap use
                        const lightmapClone = lightmapTexture.clone();
                        if (!lightmapClone) {
                            console.warn(
                                `Failed to clone lightmap texture for mesh ${mesh.name}`,
                            );
                            resolve();
                            return;
                        }
                        lightmapClone.coordinatesIndex =
                            metadata.vircadia_lightmap_texcoord;

                        meshMaterial.lightmapTexture = lightmapClone;
                        meshMaterial.useLightmapAsShadowmap =
                            metadata.vircadia_lightmap_use_as_shadowmap ??
                            false;

                        console.log(
                            `✅ Lightmap applied to mesh: ${mesh.name} with texcoord ${metadata.vircadia_lightmap_texcoord}`,
                        );
                    } else {
                        console.warn(
                            `❌ Failed to apply lightmap to mesh ${mesh.name}: albedo=${!!mat.albedoTexture}, texcoord=${metadata.vircadia_lightmap_texcoord}`,
                        );
                    }
                    resolve();
                });
            });
            // Apply texture settings to lightmap texture specifically
            const meshMaterial = mesh.material as PBRMaterial;
            if (meshMaterial.lightmapTexture instanceof Texture) {
                const lightmapTex = meshMaterial.lightmapTexture as Texture;
                if (lightmapColorSpace !== null) {
                    lightmapTex.gammaSpace =
                        lightmapColorSpace !== glTF.Texture.ColorSpace.LINEAR;
                }
                if (lightmapLevel !== null) {
                    lightmapTex.level = lightmapLevel;
                }
            }
        }
    }

    // Return only non-lightmap-data meshes since data meshes were disposed
    return nonDataMeshes;
}

// --- Orchestration ---
// When scene becomes available, load asset and retrieve entity metadata
watch(
    () => props.scene,
    async (s) => {
        if (s) {
            await loadModel(s);

            // Always attempt to retrieve existing entity
            isRetrieving.value = true;
            try {
                // First check if entity exists
                const entityResult =
                    await vircadia.client.Utilities.Connection.query({
                        query: "SELECT general__entity_name FROM entity.entities WHERE general__entity_name = $1",
                        parameters: [entityNameRef.value],
                    });

                if (
                    Array.isArray(entityResult.result) &&
                    entityResult.result.length > 0
                ) {
                    // Fetch all metadata for this entity
                    const metadata = await retrieveEntityMetadata(
                        entityNameRef.value,
                    );
                    if (metadata) {
                        // Convert Map to object for validation
                        const metaObj = Object.fromEntries(metadata);
                        // Validate with schema
                        const parsed = ModelMetadataSchema.safeParse(metaObj);
                        if (parsed.success) {
                            entityMetadata.value = parsed.data;
                        } else {
                            console.warn(
                                "Invalid model metadata:",
                                parsed.error,
                            );
                            entityMetadata.value = null;
                        }
                    }
                } else {
                    entityMetadata.value = null;
                }
            } catch (e) {
                console.error("Entity retrieve failed:", e);
            } finally {
                isRetrieving.value = false;
            }
            // Physics application moved to renderless component via slot
        }
    },
    { immediate: true },
);

// Computed properties to access metadata values
const isPusher = computed(() => {
    return entityMetadata.value?.ownerSessionId === sessionId.value;
});

// Ensure entity exists: if retrieve completes with no data, create then retrieve again (push mode only)
watch(
    [isPusher, () => isRetrieving.value, () => entityMetadata.value],
    async ([isPush, retrieving, metadata], [, wasRetrieving]) => {
        if (isPush && wasRetrieving && !retrieving) {
            if (!metadata) {
                // Create entity
                isCreating.value = true;
                try {
                    // First create the entity
                    await vircadia.client.Utilities.Connection.query({
                        query: "INSERT INTO entity.entities (general__entity_name, group__sync, general__expiry__delete_since_updated_at_ms) VALUES ($1, $2, $3) RETURNING general__entity_name",
                        parameters: [
                            entityNameRef.value,
                            "public.NORMAL",
                            120000, // 120 seconds timeout for inactivity
                        ],
                    });

                    // Then insert metadata rows
                    const initialMeta = getInitialMeta();
                    const metadataInserts = [
                        { key: "type", value: initialMeta.type },
                        {
                            key: "modelFileName",
                            value: initialMeta.modelFileName,
                        },
                        { key: "position", value: initialMeta.position },
                        { key: "rotation", value: initialMeta.rotation },
                        {
                            key: "ownerSessionId",
                            value: initialMeta.ownerSessionId,
                        },
                    ];

                    for (const { key, value } of metadataInserts) {
                        await vircadia.client.Utilities.Connection.query({
                            query: `INSERT INTO entity.entity_metadata (general__entity_name, metadata__key, metadata__value, group__sync)
                                    VALUES ($1, $2, $3, $4)`,
                            parameters: [
                                entityNameRef.value,
                                key,
                                value,
                                "public.NORMAL",
                            ],
                        });
                    }

                    // Retrieve again to get the created entity
                    const metadata = await retrieveEntityMetadata(
                        entityNameRef.value,
                    );
                    if (metadata) {
                        const metaObj = Object.fromEntries(metadata);
                        const parsed = ModelMetadataSchema.safeParse(metaObj);
                        if (parsed.success) {
                            entityMetadata.value = parsed.data;
                        }
                    }
                } catch (e) {
                    console.error("Entity create failed:", e);
                } finally {
                    isCreating.value = false;
                }
            }
        }
    },
    { immediate: false },
);

// When asset blob URL is ready, load the 3D model and apply physics if enabled
// Asset loading and model loading is handled inside useBabylonModelLoader

// React to enablePhysics toggles moved to renderless physics component

// When transforms change, update entity metadata (push mode only)
watch(
    [isPusher, () => props.def.position, () => props.def.rotation],
    ([isPush, pos, rot]) => {
        if (isPush && pos && rot && entityMetadata.value) {
            debouncedUpdate();
        }
    },
    { deep: true },
);

// Clean up on unmount
onUnmounted(() => {
    asset.cleanup();
    for (const m of meshes.value) {
        m.dispose();
    }
});

// Expose loading state for parent tracking
// isLoading combines asset loading and initial entity retrieval/creation only
defineExpose({
    isAssetLoading: asset.loading,
    isEntityRetrieving: isRetrieving,
    isEntityCreating: isCreating,
    isEntityUpdating: isUpdating,
    meshes,
    entityMetadata,
    isPusher,
});
</script>
