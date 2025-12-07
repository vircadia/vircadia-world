<template>
    <template v-if="isDev && !headless">
        <v-tooltip bottom>
            <template v-slot:activator="{ props }">
                <v-btn v-bind="props" fab small color="info" class="toolbar-btn" :disabled="!scene"
                    @click="toggleInspector">
                    <v-icon>{{ isInspectorVisible ? "mdi-file-tree" : "mdi-file-tree-outline" }}</v-icon>
                </v-btn>
            </template>
            <span>Toggle Babylon Inspector (T)</span>
        </v-tooltip>
    </template>
</template>

<script setup lang="ts">
import type { Scene } from "@babylonjs/core";
import { Inspector } from "@babylonjs/inspector";
import { onKeyStroke } from "@vueuse/core";
import { onUnmounted, type PropType, ref, watch } from "vue";

const props = defineProps({
    scene: { type: Object as PropType<Scene | null>, default: null },
    headless: { type: Boolean, default: false },
});

const emit = defineEmits<(e: "visible-change", value: boolean) => void>();

const isDev = import.meta.env.DEV;
const isInspectorVisible = ref(false);

async function toggleInspector(): Promise<void> {
    if (!props.scene) return;
    if (!isInspectorVisible.value) {
        if (isDev) {
            Inspector.Show(props.scene, { embedMode: true });
            isInspectorVisible.value = true;
            emit("visible-change", true);
        } else {
            // no-op outside dev
        }
    } else {
        Inspector.Hide();
        isInspectorVisible.value = false;
        emit("visible-change", false);
    }
}

// Hotkey: "t" to toggle inspector
onKeyStroke(
    ["t", "T"],
    (event) => {
        if (event.repeat) return;
        event.preventDefault();
        toggleInspector();
    },
    { target: window, eventName: "keydown", passive: false },
);

onUnmounted(() => {
    if (isInspectorVisible.value) {
        Inspector.Hide();
        isInspectorVisible.value = false;
        emit("visible-change", false);
    }
});

defineExpose({ toggleInspector, isInspectorVisible });
</script>

<style scoped></style>
