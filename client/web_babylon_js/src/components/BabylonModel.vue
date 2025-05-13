<template>
  <!-- BabylonModel is a renderless component -->
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted, inject } from "vue";
import type { Scene } from "@babylonjs/core";
import type { BabylonModelDefinition } from "../composables/types";
import { useAsset, useVircadiaInstance } from "@vircadia/world-sdk/browser/vue";
import { useBabylonModelEntity } from "../composables/useBabylonModelEntity";
import { useBabylonModelLoader } from "../composables/useBabylonModelLoader";
import { useBabylonModelPhysics } from "../composables/useBabylonModelPhysics";

const props = defineProps<{
    def: BabylonModelDefinition;
    scene: Scene | null;
}>();

// --- Set up Babylon model pipelines ---
// Reactive local transform state
const position = ref(props.def.position ?? { x: 0, y: 0, z: 0 });
const rotation = ref(props.def.rotation ?? { x: 0, y: 0, z: 0, w: 1 });

// 1. Asset loader
const asset = useAsset({ fileName: ref(props.def.fileName), useCache: true });

// 2. Entity synchronization
const { entityName, entity, debouncedUpdate } = useBabylonModelEntity(
    props.def,
    position,
    rotation,
);

// 3. Model loader
const { meshes, loadModel } = useBabylonModelLoader(props.def);

// 4. Physics application
const sceneRef = ref<Scene | null>(null);
const { applyPhysics, removePhysics } = useBabylonModelPhysics(
    sceneRef,
    meshes,
    props.def,
);

// Vircadia connection manager
const vircadia = inject(useVircadiaInstance());
if (!vircadia) {
    throw new Error("Vircadia instance not found");
}

// --- Orchestration ---
// When scene becomes available, store it and load asset/entity
watch(
    () => props.scene,
    (s) => {
        if (s) {
            sceneRef.value = s;
            asset.executeLoad();
            // Retrieve or create entity
            if (entityName.value) {
                entity.executeRetrieve();
            } else {
                entity.executeCreate().then(() => entity.executeRetrieve());
            }
        }
    },
    { immediate: true },
);

// When asset blob URL is ready, load the 3D model
watch(
    () => asset.assetData.value,
    (assetData) => {
        const scene = sceneRef.value;
        if (assetData?.blobUrl && scene) {
            loadModel(scene, assetData);
        }
    },
);

// Connection status: clear meshes on disconnect
watch(
    () => vircadia.connectionInfo.value.status,
    (status) => {
        if (status !== "connected") {
            for (const m of meshes.value) {
                m.dispose();
            }
            meshes.value = [];
        }
    },
);

// When transforms change, update entity metadata
watch(position, debouncedUpdate, { deep: true });
watch(rotation, debouncedUpdate, { deep: true });

// Clean up on unmount
onUnmounted(() => {
    entity.cleanup();
    asset.cleanup();
    removePhysics();
    for (const m of meshes.value) {
        m.dispose();
    }
});
</script>
