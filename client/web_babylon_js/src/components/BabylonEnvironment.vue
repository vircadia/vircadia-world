<template>
    <slot :isLoading="isLoading"></slot>
    
    
</template>
<script setup lang="ts">
import { ref, watch, toRef } from "vue";
import { HDRCubeTexture, type Scene } from "@babylonjs/core";
import { useAsset } from "@vircadia/world-sdk/browser/vue";

const props = defineProps<{
    scene: Scene;
    vircadiaWorld: any;
    hdrFiles: string[];
}>();

const sceneRef = toRef(props, "scene");
const vircadiaRef = toRef(props, "vircadiaWorld");
const hdrFilesRef = toRef(props, "hdrFiles");

const isLoading = ref(false);
const hasLoaded = ref(false);

async function loadAll(scene: Scene) {
    if (!scene) {
        console.error("[BabylonEnvironment] Scene not found");
        return;
    }
    if (!vircadiaRef.value) {
        console.error("[BabylonEnvironment] Vircadia instance not provided");
        return;
    }
    if (isLoading.value) {
        // prevent overlapping loads
        return;
    }

    isLoading.value = true;
    try {
        for (const fileName of hdrFilesRef.value || []) {
            const asset = useAsset({
                fileName: ref(fileName),
                instance: vircadiaRef.value,
                useCache: true,
            });
            await asset.executeLoad();
            const url = asset.assetData.value?.blobUrl;
            if (!url)
                throw new Error(
                    `[BabylonEnvironment] Failed to load ${fileName}`,
                );

            const hdr = new HDRCubeTexture(
                url,
                scene,
                512,
                false,
                true,
                false,
                true,
            );
            await new Promise<void>((resolve) =>
                hdr.onLoadObservable.addOnce(() => resolve()),
            );

            scene.environmentTexture = hdr;
            scene.environmentIntensity = 1.2;
            scene.createDefaultSkybox(hdr, true, 1000);
        }
        hasLoaded.value = true;
    } catch (e) {
        console.error(e);
    } finally {
        isLoading.value = false;
    }
}

// Automatically load once when scene and vircadia are available
watch(
    () => ({
        scene: sceneRef.value,
        v: vircadiaRef.value,
        files: hdrFilesRef.value,
    }),
    ({ scene }) => {
        if (
            scene &&
            vircadiaRef.value &&
            (hdrFilesRef.value?.length ?? 0) > 0 &&
            !hasLoaded.value
        ) {
            // fire and forget
            void loadAll(scene);
        }
    },
    { immediate: true, deep: true },
);

defineExpose({ isLoading, loadAll });
</script>
