<template>
  <!-- Pass the configuration object to the provider -->
  <VircadiaProvider :config="vircadiaConfig">
    <header>
      <h1>Vircadia World Assets</h1>
      <!-- Connection status and buttons are now handled inside ConnectionStatus -->
    </header>

    <main>
      <!-- Use the new component here -->
      <ConnectionStatus />
    </main>
  </VircadiaProvider>
</template>

<script setup lang="ts">
import VircadiaProvider from "../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/provider/VircadiaProvider.vue";
import { Communication } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { VircadiaConfig_BROWSER_CLIENT } from "../../../../../sdk/vircadia-world-sdk-ts/config/vircadia.browser.client.config";

import ConnectionStatus from "./components/VircadiaConnection.vue";
import type { VircadiaClientCoreConfig } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/core/vircadia.client.core";

// Configure server settings
const vircadiaConfig: VircadiaClientCoreConfig = {
    serverUrl:
        VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI_USING_SSL
            ? `https://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`
            : `http://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`,
    authToken:
        VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN,
    authProvider:
        VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER,
    debug: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG,
    suppress: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_SUPPRESS,
    reconnectAttempts: 5,
    reconnectDelay: 5000,
};
</script>

<style>
/* Keep general styles here */
header {
  background-color: #2c3e50;
  color: white;
  padding: 1rem;
  text-align: center;
}

main {
  padding: 1rem;
}
</style>
