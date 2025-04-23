<script setup lang="ts">
import { useVircadia } from "../../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/provider/useVircadia";
import AssetExample from "./AssetExample.vue";

// Use the composable here, inside a descendant of VircadiaProvider
const {
    status,
    isConnected,
    isConnecting,
    connect,
    disconnect,
    connectionError,
} = useVircadia();
</script>

<template>
  <div>
    <p>Status: {{ status }}</p>
    <p>Connected: {{ isConnected }}</p>
    <p>Connecting: {{ isConnecting }}</p>
    <p v-if="connectionError">Error: {{ connectionError.message }}</p>
  </div>
  <div>
    <button @click="connect" :disabled="isConnecting || isConnected">Connect</button>
    <button @click="disconnect" :disabled="!isConnected">Disconnect</button>
  </div>
  <!-- Conditionally render AssetExample based on connection status -->
  <AssetExample v-if="isConnected" />
  <p v-else>Please connect to view assets.</p>
</template>

<style scoped>
/* Add styles if needed, or keep them in App.vue */
div {
  margin-top: 0.5rem;
  margin-bottom: 0.5rem;
}

button {
  margin-right: 0.5rem;
}
</style>