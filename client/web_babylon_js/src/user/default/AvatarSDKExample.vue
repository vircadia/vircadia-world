<template>
</template>

<script setup lang="ts">
import { ImportMeshAsync, Scene, TransformNode, Vector3, WebGPUEngine } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { onUnmounted, ref, watch } from "vue";
import { type VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";

const props = defineProps({
    scene: { type: Object as () => Scene, default: null },
    engine: { type: Object as () => WebGPUEngine, default: null },
    canvas: { type: Object as () => HTMLCanvasElement, default: null },
    vircadiaWorld: { type: Object as () => VircadiaWorldInstance, default: null },
});

import sampleAvatarUrl from "./example/sample_avatar.glb?url";

const rootNode = ref<TransformNode | null>(null);
const isLoaded = ref(false);

async function loadSampleAvatar(targetScene: Scene) {
    if (!targetScene || isLoaded.value) return;

    const result = await ImportMeshAsync(sampleAvatarUrl, targetScene, {
        pluginExtension: ".glb",
    });

    const root = new TransformNode("sample_avatar_root", targetScene);
    rootNode.value = root;
    root.position = new Vector3(28, 0, -5);

    const meshes = result.meshes || [];
    const transformNodes = result.transformNodes || [];
    for (const t of transformNodes) {
        if (!t.parent) t.parent = root;
    }
    for (const m of meshes) {
        if (!m.parent) m.parent = root;
    }

    isLoaded.value = true;
    console.log("[AvatarSDKExample] Sample avatar loaded", {
        url: sampleAvatarUrl,
    });
}

watch(
    () => props.scene?.isReady(),
    async (ready) => {
        if (ready && props.scene && !isLoaded.value) {
            await loadSampleAvatar(props.scene);
        }
    },
    { immediate: true },
);

onUnmounted(() => {
    if (rootNode.value) {
        try {
            rootNode.value.dispose();
        } catch { }
        rootNode.value = null;
    }
});
</script>

<style scoped></style>