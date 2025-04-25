<template>
    <main>
        <div v-if="connectionStatus === 'connecting'" class="connection-status">
            Connecting to Vircadia server...
        </div>
        <div v-if="connectionStatus === 'disconnected'" class="connection-status">
            Disconnected from Vircadia server. Will attempt to reconnect...
        </div>
        <Room v-if="connectionStatus === 'connected'" />
    </main>
</template>

<script setup lang="ts">
import { inject, computed, watch } from "vue";
import { getInstanceKey } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/provider/useVircadia";
import Room from "./components/Room.vue";

// Get the existing Vircadia connection from main.ts with proper typing
const vircadiaWorld = inject(getInstanceKey("vircadiaWorld"));

// Safely compute the connection status with a fallback
const connectionStatus = computed(
    () => vircadiaWorld?.connectionInfo?.value?.status || "disconnected",
);

watch(
    () => connectionStatus.value,
    (newStatus) => {
        if (newStatus === "connected") {
            console.log("Connected to Vircadia server");
        } else if (newStatus === "disconnected") {
            console.log("Disconnected from Vircadia server");
        } else if (newStatus === "connecting") {
            console.log("Connecting to Vircadia server...");
        }
    },
);
</script>

<style>
html, body {
    margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background-color: #202020;
}
main {
    padding: 0; margin: 0; width: 100vw; height: 100vh; overflow: hidden; display: flex; position: relative;
}
.connection-status {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background-color: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 20px;
    border-radius: 5px;
    font-family: sans-serif;
    text-align: center;
}
.connection-status.error {
    background-color: rgba(120, 0, 0, 0.7);
}
</style>
