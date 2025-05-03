import { createApp } from "vue";
import App from "./App.vue";
import "./assets/main.css";

import {
    useVircadia_Vue,
    VircadiaConfig_BROWSER_CLIENT,
    Communication,
    VUE_DEFAULT_INSTANCE_KEY,
} from "@vircadia/world-sdk-ts/browser";

// Initialize Vircadia before creating the app
const vircadiaWorld = useVircadia_Vue({
    config: {
        serverUrl:
            VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI_USING_SSL
                ? `https://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`
                : `http://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`,
        authToken:
            VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN,
        authProvider:
            VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER,
        debug: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG,
        suppress:
            VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_SUPPRESS,
        reconnectAttempts: 5,
        reconnectDelay: 5000,
    },
});

const app = createApp(App);

// Make the Vircadia instance available to all components
app.provide(VUE_DEFAULT_INSTANCE_KEY, vircadiaWorld);

// Mount the app
app.mount("#app");

// Auto-connect to the domain server after mounting the app
vircadiaWorld.client.Utilities.Connection.connect();
