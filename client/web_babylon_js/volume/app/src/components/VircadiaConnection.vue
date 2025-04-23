<script setup lang="ts">
import { computed, ref } from "vue";
import { useVircadia } from "../../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/provider/useVircadia";
import AssetExample from "./AssetExample.vue";

// Use the composable here, inside a descendant of VircadiaProvider
const { client, connectionInfo } = useVircadia();

const attemptConnect = async () => {
    try {
        await client.Utilities.Connection.connect();
    } catch (error) {
        console.error("Connection failed:", error);
        connectionError.value = error;
    }
};

const attemptDisconnect = async () => {
    try {
        await client.Utilities.Connection.disconnect();
    } catch (error) {
        console.error("Disconnection failed:", error);
        connectionError.value = error;
    }
};

const connectionError = ref<unknown | null>(null);
const status = computed(() => connectionInfo.value.status);
const connectionStatus = computed(() => connectionInfo.value);
const isConnected = computed(() => connectionInfo.value.isConnected);
const isConnecting = computed(() => connectionInfo.value.isConnecting);
</script>

<template>
  <div>
    <p>Status: {{ status }}</p>
    <p>Connected: {{ isConnected }}</p>
    <p>Connecting: {{ isConnecting }}</p>
    <p v-if="connectionError">Error: {{ connectionError }}</p>
  </div>
  <div>
    <button @click="attemptConnect" :disabled="isConnecting || isConnected">Connect</button>
    <button @click="attemptDisconnect" :disabled="!isConnected">Disconnect</button>
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