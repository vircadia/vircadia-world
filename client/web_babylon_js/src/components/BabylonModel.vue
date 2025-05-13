<template>
  <!-- BabylonModel is a renderless component -->
</template>

<script setup lang="ts">
import { watch, onUnmounted } from "vue";
import type { Scene } from "@babylonjs/core";
import type { BabylonModelDefinition } from "../composables/useBabylonModel";
import { useBabylonModel } from "../composables/useBabylonModel";

const props = defineProps<{
    def: BabylonModelDefinition;
    scene: Scene | null;
}>();

// Initialize the model composable
const modelApi = useBabylonModel(props.def);

// Load when scene becomes available
watch(
    () => props.scene,
    (s) => {
        if (s) {
            modelApi.load(s);
        }
    },
    { immediate: true },
);

// Clean up on unmount
onUnmounted(() => {
    modelApi.unload();
});
</script>
