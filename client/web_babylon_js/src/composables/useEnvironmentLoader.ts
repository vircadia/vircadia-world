import { inject, ref } from "vue";

import { HDRCubeTexture, type Scene } from "@babylonjs/core";

import { useAsset, useVircadiaInstance } from "@vircadia/world-sdk/browser/vue";
//  ^ Vircadia’s Vue SDK:
//    - useAsset: composable to fetch an asset and process from Vircadia’s database.
//    - useVircadiaInstance: composable to get the Vircadia World client instance.

// ───────── Environment loader composable ─────────
// Loads multiple HDR environments into a Babylon.js scene.
// - Reactive loading state
// - Handles Vircadia asset fetching
// - Applies HDR textures to the scene
export function useEnvironmentLoader(
    hdrFiles: string[], // list of HDR file names on the Vircadia server in the entity.entity_assets table
) {
    const isLoading = ref(false);
    // ^ tracks whether we’re already loading—prevents duplicate calls

    const vircadiaWorld = inject(useVircadiaInstance());

    if (!vircadiaWorld) {
        throw new Error("Vircadia instance not found");
    }
    // ^ Vircadia World client instance used by useAsset

    async function loadAll(scene: Scene) {
        // ^ the main entry point: loads each HDR file in sequence

        if (!scene) {
            console.error("Scene not found");
            return;
        }

        if (isLoading.value) {
            console.error("Environment loader already in progress");
            return;
        }

        isLoading.value = true;

        try {
            for (const fileName of hdrFiles) {
                // ───────── Vircadia asset fetch ─────────
                const asset = useAsset({
                    fileName: ref(fileName), // reactively watch the file name
                    instance: vircadiaWorld, // the Vircadia World client connection
                    useCache: true, // cache the download in IndexedDB
                });
                await asset.executeLoad(); // actually fetches the blob from Vircadia’s assets

                // once loaded, the SDK exposes a blob URL we can feed into Babylon
                const url = asset.assetData.value?.blobUrl;
                if (!url) throw new Error(`Failed to load ${fileName}`);

                // ───────── Babylon.js HDR setup ─────────
                const hdr = new HDRCubeTexture(
                    url, // the blob URL
                    scene, // attach to our scene
                    512, // size of each cube face
                    false, // no generateMipMaps
                    true, // invertY
                    false, // no async generation
                    true, // prefiltered
                );
                // wait for the texture to finish loading internally
                await new Promise<void>((resolve) =>
                    hdr.onLoadObservable.addOnce(() => resolve()),
                );

                // apply it as the scene’s environment (lighting + skybox)
                scene.environmentTexture = hdr;
                scene.environmentIntensity = 1.2;
                scene.createDefaultSkybox(hdr, true, 1000);
            }
        } catch (e) {
            console.error(e); // log any Vircadia-load or Babylon errors
        } finally {
            isLoading.value = false;
        }
    }

    return { isLoading, loadAll };
    // ^ expose to your component so you can trigger loadAll() and react to isLoading
}
