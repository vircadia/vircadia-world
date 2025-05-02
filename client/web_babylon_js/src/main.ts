import { createApp } from "vue";
import App from "./App.vue";
import "./assets/main.css";

import {
    getInstanceKey,
    useVircadia,
} from "../../../sdk/vircadia-world-sdk-ts/src/client/framework/vue/provider/useVircadia";
import { VircadiaConfig_BROWSER_CLIENT } from "../../../sdk/vircadia-world-sdk-ts/src/client/config/browser/vircadia.browser.client.config";
import { Communication } from "../../../sdk/vircadia-world-sdk-ts/src/schema/schema.general";

// Initialize Vircadia before creating the app
const vircadiaWorld = useVircadia({
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
// Note: You need to use the same key in any components that need to access the Vircadia instance
app.provide(getInstanceKey("vircadiaWorld"), vircadiaWorld);

// Mount the app
app.mount("#app");

// Auto-connect to the domain server after mounting the app
vircadiaWorld.client.Utilities.Connection.connect();
