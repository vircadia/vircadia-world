<template>
</template>

<script setup lang="ts">
import type { Scene } from "@babylonjs/core";
import { onKeyStroke } from "@vueuse/core";
import { onUnmounted, type PropType, ref } from "vue";

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
            // Dynamically import the inspector to reduce initial bundle size
            const { Inspector } = await import("@babylonjs/inspector");
            Inspector.Show(props.scene, { embedMode: true });
            isInspectorVisible.value = true;
            emit("visible-change", true);
        } else {
            // no-op outside dev
        }
    } else {
        const { Inspector } = await import("@babylonjs/inspector");
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

onUnmounted(async () => {
    if (isInspectorVisible.value) {
        const { Inspector } = await import("@babylonjs/inspector");
        Inspector.Hide();
        isInspectorVisible.value = false;
        emit("visible-change", false);
    }
});

defineExpose({ toggleInspector, isInspectorVisible });
</script>

<style scoped></style>
