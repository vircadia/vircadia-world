<template>
    <slot :isLoading="isLoading"></slot>
    
    
</template>
<script setup lang="ts">
import { ref, watch, toRef } from "vue";
import { HDRCubeTexture, type Scene } from "@babylonjs/core";
import { useAsset } from "@vircadia/world-sdk/browser/vue";
import type { useVircadia } from "@vircadia/world-sdk/browser/vue";

const props = defineProps<{
    scene: Scene;
    vircadiaWorld: ReturnType<typeof useVircadia>;
    environmentEntityName: string; // name of the environment entity in the DB
}>();

const sceneRef = toRef(props, "scene");
const vircadiaRef = toRef(props, "vircadiaWorld");
const envEntityNameRef = toRef(props, "environmentEntityName");

const isLoading = ref(false);
const hasLoaded = ref(false);

async function loadHdrFiles(
    scene: Scene,
    instance: ReturnType<typeof useVircadia>,
    hdrFiles: string[],
) {
    for (const fileName of hdrFiles) {
        const asset = useAsset({
            fileName: ref(fileName),
            instance,
            useCache: true,
        });
        await asset.executeLoad();
        const url = asset.assetData.value?.blobUrl;
        if (!url)
            throw new Error(`[BabylonEnvironment] Failed to load ${fileName}`);

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
}

async function loadAll(scene: Scene) {
    if (!scene) {
        console.error("[BabylonEnvironment] Scene not found");
        return;
    }
    if (!vircadiaRef.value) {
        console.error("[BabylonEnvironment] Vircadia instance not provided");
        return;
    }
    if (!envEntityNameRef.value) {
        console.error(
            "[BabylonEnvironment] environmentEntityName not provided",
        );
        return;
    }
    if (isLoading.value) {
        return;
    }

    isLoading.value = true;
    try {
        // Fetch all metadata for this environment entity
        const instance = vircadiaRef.value;
        if (!instance) {
            console.error("[BabylonEnvironment] Vircadia instance missing");
            return;
        }
        const metadataResult = await instance.client.Utilities.Connection.query(
            {
                query: "SELECT metadata__key, metadata__value FROM entity.entity_metadata WHERE general__entity_name = $1",
                parameters: [envEntityNameRef.value],
            },
        );

        const metadataMap = new Map<string, unknown>();
        if (Array.isArray(metadataResult.result)) {
            for (const row of metadataResult.result) {
                metadataMap.set(
                    row.metadata__key as string,
                    row.metadata__value as unknown,
                );
            }
        }

        const entityType = metadataMap.get("type");
        if (entityType !== "Environment") {
            console.warn(
                `[BabylonEnvironment] Entity '${envEntityNameRef.value}' is not of type 'Environment' (type=${String(entityType)})`,
            );
        }

        const hdrFilesMeta = metadataMap.get("hdrFiles");
        const hdrFiles = Array.isArray(hdrFilesMeta)
            ? (hdrFilesMeta as unknown[]).filter(
                  (v): v is string => typeof v === "string",
              )
            : [];
        if (hdrFiles.length === 0) {
            console.warn(
                `[BabylonEnvironment] No hdrFiles defined for '${envEntityNameRef.value}'`,
            );
        }

        await loadHdrFiles(scene, instance, hdrFiles);
        hasLoaded.value = true;
    } catch (e) {
        console.error(e);
    } finally {
        isLoading.value = false;
    }
}

// Automatically load once when scene, vircadia, and entity are available
watch(
    () => ({
        scene: sceneRef.value,
        v: vircadiaRef.value,
        name: envEntityNameRef.value,
    }),
    ({ scene }) => {
        if (
            scene &&
            vircadiaRef.value &&
            envEntityNameRef.value &&
            !hasLoaded.value
        ) {
            void loadAll(scene);
        }
    },
    { immediate: true, deep: true },
);

defineExpose({ isLoading, loadAll });
</script>
