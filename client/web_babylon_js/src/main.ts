import { createApp } from "vue";
import App from "./App.vue";
import "./assets/main.css";
import { createPinia } from "pinia";

import {
    useVircadia,
    DEFAULT_VIRCADIA_INSTANCE_KEY,
    Communication,
} from "@vircadia/world-sdk/browser/vue";

import { clientBrowserConfiguration } from "./vircadia.browser.config";

// Initialize Vircadia before creating the app
const vircadiaWorld = useVircadia({
    config: {
        serverUrl:
            clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI_USING_SSL
                ? `https://${clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`
                : `http://${clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`,
        authToken:
            clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN,
        authProvider:
            clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER,
        debug: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG,
        suppress:
            clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_SUPPRESS,
        reconnectAttempts: 5,
        reconnectDelay: 5000,
    },
});

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

// Make the Vircadia instance available to all components
app.provide(DEFAULT_VIRCADIA_INSTANCE_KEY, vircadiaWorld);

// Mount the app
app.mount("#app");

// Auto-connect to the domain server after mounting the app
vircadiaWorld.client.Utilities.Connection.connect();
