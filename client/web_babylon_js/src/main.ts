import { createApp } from "vue";
import App from "./App.vue";
// Vuetify styles should load before custom styles
import "@mdi/font/css/materialdesignicons.css";
import "vuetify/styles";
import "./assets/main.css";
import { createPinia } from "pinia";

import {
    useVircadia,
    DEFAULT_VIRCADIA_INSTANCE_KEY,
    Communication,
} from "@vircadia/world-sdk/browser/vue";

import { clientBrowserConfiguration } from "./vircadia.browser.config";

// Vuetify setup
import { createVuetify } from "vuetify";

// App setup
const app = createApp(App);

// Pinia setup
const pinia = createPinia();
app.use(pinia);

// Auto-import and register all components from the @/user folder
const components = import.meta.glob("./user/*.vue", { eager: true });

Object.entries(components).forEach(([path, definition]) => {
    const componentName = path
        .split("/")
        .pop()
        ?.replace(/\.\w+$/, "");
    if (
        componentName &&
        definition &&
        typeof definition === "object" &&
        "default" in definition
    ) {
        app.component(componentName, (definition as { default: any }).default);
    }
});

// create and register Vuetify instance
const vuetify = createVuetify({
    icons: {
        defaultSet: "mdi", // This is already the default value - only for display purposes
    },
});
app.use(vuetify);

// Initialize Vircadia
console.log("[Main] Initializing Vircadia client with config", {
    ssl: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI_USING_SSL,
    apiUri: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI,
    wsPath: Communication.WS_UPGRADE_PATH,
    hasDebugToken:
        !!clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN,
    debugProvider:
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER,
    debug: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG,
});

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
    },
});

// Make the Vircadia instance available to all components
app.provide(DEFAULT_VIRCADIA_INSTANCE_KEY, vircadiaWorld);

// Mount the app
app.mount("#app");
