import { shallowRef, markRaw, ref, type Ref } from "vue";
import type {
    Scene,
    AbstractMesh,
    Skeleton,
    AnimationGroup,
} from "@babylonjs/core";
import { ImportMeshAsync } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { useAsset } from "@vircadia/world-sdk/browser/vue";

export interface AvatarModelDefinition {
    /** Filename of the avatar model (e.g. 'hero.glb') */
    fileName: string;
}

/**
 * Composable to load an avatar model and expose its meshes, skeletons, and animation groups.
 * @param def - definition containing the model filename
 */
export function useBabylonAvatarModelLoader(def: AvatarModelDefinition) {
    const meshes = shallowRef<AbstractMesh[]>([]);
    const skeletons = shallowRef<Skeleton[]>([]);
    const animationGroups = shallowRef<AnimationGroup[]>([]);

    // Track filename for the asset loader
    const fileNameRef: Ref<string> = ref(def.fileName);
    const asset = useAsset({
        fileName: fileNameRef,
        useCache: true,
        debug: false,
    });

    /**
     * Load the model into the given scene
     */
    async function loadModel(scene: Scene) {
        // fetch the blob URL via useAsset
        await asset.executeLoad();
        const assetData = asset.assetData.value;
        if (!assetData?.blobUrl) {
            console.warn(`Asset blob URL not available for '${def.fileName}'`);
            return;
        }

        if (meshes.value.length > 0) {
            console.log(`Model '${def.fileName}' already loaded. Skipping.`);
            return;
        }

        try {
            // import meshes, skeletons, and animation groups
            console.info(
                `Loading model '${def.fileName}' using blob URL with plugin extension ${asset.fileExtension.value}...`,
            );
            const result = await ImportMeshAsync(assetData.blobUrl, scene, {
                pluginExtension: asset.fileExtension.value,
            });

            // Debug: log imported meshes and skeletons
            console.info(`Imported model '${def.fileName}' contents:`, {
                meshes: result.meshes.map((m) => m.name),
                skeletons: result.skeletons.map((s) => s.name),
                animationGroups: result.animationGroups.map((g) => g.name),
            });
            // Removed parenting logic: composable only loads meshes; parenting to be handled externally
            meshes.value = result.meshes.map((m) => markRaw(m));
            skeletons.value = result.skeletons.map((s) => markRaw(s));
            animationGroups.value = result.animationGroups.map((g) =>
                markRaw(g),
            );
        } catch (e) {
            console.error(`Error loading model '${def.fileName}':`, e);
            throw e;
        }
    }

    return {
        meshes,
        skeletons,
        animationGroups,
        loadModel,
        // expose raw asset in case you need mimeType or other data
        asset,
    };
}
