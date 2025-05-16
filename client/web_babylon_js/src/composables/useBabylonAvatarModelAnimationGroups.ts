import { shallowRef, ref, markRaw } from "vue";
import type { Scene, AnimationGroup } from "@babylonjs/core";
import { ImportMeshAsync } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { useAsset } from "@vircadia/world-sdk/browser/vue";
import type { BabylonAnimationDefinition } from "./types";

/**
 * Composable to load avatar animations based on provided definitions.
 * @param definitions Array of animation definitions with fileName and optional loop.
 */
export function useBabylonAvatarModelAnimationGroups(
    definitions: BabylonAnimationDefinition[],
) {
    const animationGroupsMap = shallowRef<Record<string, AnimationGroup[]>>({});
    const assets = definitions.map((def) => ({
        def,
        asset: useAsset({
            fileName: ref(def.fileName),
            useCache: true,
            debug: false,
        }),
    }));

    /**
     * Loads all animations into the scene.
     * @param scene Babylon.js scene to import animations into.
     */
    async function loadAnimations(scene: Scene) {
        for (const { def, asset } of assets) {
            await asset.executeLoad();
            const assetData = asset.assetData.value;
            if (!assetData?.blobUrl) {
                console.warn(
                    `Asset blob URL not available for '${def.fileName}'`,
                );
                continue;
            }
            try {
                // Load animation GLB using blob URL
                const result = await ImportMeshAsync(assetData.blobUrl, scene, {
                    pluginExtension: asset.fileExtension.value,
                });
                console.info(`Imported model '${def.fileName}' contents:`, {
                    meshes: result.meshes.map((m) => m.name),
                    skeletons: result.skeletons.map((s) => s.name),
                    animationGroups: result.animationGroups.map((g) => g.name),
                });
                // convert to raw and filter by def.groupNames if provided
                const rawGroups = result.animationGroups.map((g) => markRaw(g));
                let groups = rawGroups;
                if (def.groupNames && def.groupNames.length > 0) {
                    const names = def.groupNames;
                    groups = rawGroups.filter((g) => names.includes(g.name));
                }
                animationGroupsMap.value[def.fileName] = groups;
            } catch (e) {
                console.error(`Error loading animation '${def.fileName}':`, e);
                throw e;
            }
        }
    }

    return {
        animationGroupsMap,
        loadAnimations,
    };
}
