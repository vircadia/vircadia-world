<template>
    <div v-if="sceneInitialized && connectionStatus === 'connected'" class="inject-component">
        <v-chip color="success" class="floating-chip">
            Using Inject Approach
        </v-chip>
    </div>
</template>

<script setup lang="ts">
import { inject, type ComputedRef, type Ref } from "vue";
import type { Scene, WebGPUEngine } from "@babylonjs/core";
import type { useAppStore } from "@/stores/appStore";

// Inject the provided resources
const scene = inject<ComputedRef<Scene | null>>("babylonScene");
const engine = inject<ComputedRef<WebGPUEngine | null>>("babylonEngine");
const canvas = inject<Ref<HTMLCanvasElement | null>>("renderCanvas");
const appStore = inject<ReturnType<typeof useAppStore>>("appStore");
const vircadiaWorld = inject("vircadiaWorld");
const connectionStatus = inject<ComputedRef<string>>("connectionStatus");
const sessionId = inject<ComputedRef<string | null>>("sessionId");
const agentId = inject<ComputedRef<string | null>>("agentId");
const sceneInitialized = inject<Ref<boolean>>("sceneInitialized");

// Now you can use these injected values in your component
// For example:
console.log("Inject Scene available:", scene?.value);
console.log("Inject Store data:", appStore?.instanceId);
</script>

<style scoped>
.inject-component {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 999;
}

.floating-chip {
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
}
</style> 