<template>
    <template v-if="isDev">
        <v-tooltip bottom>
            <template v-slot:activator="{ props }">
                <v-btn
                    v-bind="props"
                    fab
                    small
                    color="info"
                    class="toolbar-btn"
                    :disabled="!scene"
                    @click="toggleInspector"
                >
                    <v-icon>{{ isInspectorVisible ? "mdi-file-tree" : "mdi-file-tree-outline" }}</v-icon>
                </v-btn>
            </template>
            <span>Toggle Babylon Inspector (T)</span>
        </v-tooltip>
    </template>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from "vue";
import type { Scene } from "@babylonjs/core";
import { Inspector } from "@babylonjs/inspector";
import { onKeyStroke } from "@vueuse/core";

const props = defineProps<{ scene: Scene | null }>();

const isDev = import.meta.env.DEV;
const isInspectorVisible = ref(false);

async function toggleInspector(): Promise<void> {
    if (!props.scene) return;
    if (!isInspectorVisible.value) {
        if (isDev) {
            Inspector.Show(props.scene, { embedMode: true });
            isInspectorVisible.value = true;
        } else {
            // no-op outside dev
        }
    } else {
        Inspector.Hide();
        isInspectorVisible.value = false;
    }
}

// Hotkey: "t" to toggle inspector
onKeyStroke(
    ["t", "T"],
    (event) => {
        // avoid key repeat spam
        if (event.repeat) return;
        // prevent other handlers if needed
        event.preventDefault();
        toggleInspector();
    },
    { target: window, eventName: "keydown", passive: false },
);

onUnmounted(() => {
    if (isInspectorVisible.value) {
        Inspector.Hide();
        isInspectorVisible.value = false;
    }
});
</script>

<style scoped>
</style>


