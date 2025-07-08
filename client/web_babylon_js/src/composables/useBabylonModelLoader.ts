import { shallowRef, markRaw, ref } from "vue";
import {
    type Scene,
    ImportMeshAsync,
    type AbstractMesh,
    PBRMaterial,
    Texture,
    type BaseTexture,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import type { BabylonModelDefinition } from "./schemas";
import { useAsset } from "@vircadia/world-sdk/browser/vue";

// glTF metadata definitions (copied from useBabylonModel)
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

// Composable for loading a 3D model and processing lightmaps
export function useBabylonModelLoader(def: BabylonModelDefinition) {
    // only track top-level array changes, never recurse into mesh properties
    const meshes = shallowRef<AbstractMesh[]>([]);
    const fileNameRef = ref(def.fileName);
    const asset = useAsset({
        fileName: fileNameRef,
        useCache: true,
        debug: false,
    });

    // Load mesh blobs into the scene, apply lightmaps if present
    async function loadModel(scene: Scene) {
        if (!scene) {
            console.warn("No scene provided to loadModel");
            return;
        }

        // trigger asset fetch
        await asset.executeLoad();
        const assetData = asset.assetData.value;
        if (!assetData?.blobUrl) {
            console.warn(`Asset blob URL not available for '${def.fileName}'`);
            return;
        }
        console.log("Loading model... ", def.fileName);
        if (meshes.value.length > 0) {
            console.log(`Model '${def.fileName}' already loaded. Skipping.`);
            return;
        }
        try {
            console.log(
                `Loading model '${def.fileName}' using blob URL with plugin extension ${asset.fileExtension.value}...`,
            );
            const result = await ImportMeshAsync(assetData.blobUrl, scene, {
                pluginExtension: asset.fileExtension.value,
            });
            const hasLightmapData = result.meshes.some((m) =>
                m.name.startsWith(glTF.Lightmap.DATA_MESH_NAME),
            );
            let processed: AbstractMesh[];
            if (hasLightmapData) {
                console.log(`Processing lightmaps for '${def.fileName}'...`);
                processed = await loadLightmap(result.meshes, scene);
            } else {
                console.log(
                    `No lightmap data found for '${def.fileName}'... skipping lightmap processing.`,
                );
                processed = result.meshes;
            }
            meshes.value = processed.map((m) => markRaw(m));
        } catch (e) {
            console.error(`Error loading model '${def.fileName}':`, e);
            throw e;
        }
    }

    // Process and apply lightmaps to the meshes
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
                console.log(
                    `Found lightmap color space: ${lightmapColorSpace}`,
                );
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
                    console.warn(
                        `Mesh ${mesh.name} has no material. Skipping.`,
                    );
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
                    Texture.WhenAllReady(
                        [mat.albedoTexture as BaseTexture],
                        () => {
                            if (
                                mat.albedoTexture &&
                                metadata.vircadia_lightmap_texcoord != null
                            ) {
                                const lightmapTexture =
                                    mat.albedoTexture as BaseTexture;
                                const meshMaterial =
                                    mesh.material as PBRMaterial;

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
                        },
                    );
                });
                // Apply texture settings to lightmap texture specifically
                const meshMaterial = mesh.material as PBRMaterial;
                if (meshMaterial.lightmapTexture instanceof Texture) {
                    const lightmapTex = meshMaterial.lightmapTexture as Texture;
                    if (lightmapColorSpace !== null) {
                        lightmapTex.gammaSpace =
                            lightmapColorSpace !==
                            glTF.Texture.ColorSpace.LINEAR;
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

    return { meshes, loadModel, asset };
}
