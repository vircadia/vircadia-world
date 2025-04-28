import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueJsx from "@vitejs/plugin-vue-jsx";
import vueDevTools from "vite-plugin-vue-devtools";

import { VircadiaConfig_BROWSER_CLIENT } from "../../../../sdk/vircadia-world-sdk-ts/config/vircadia.browser.client.config";

// https://vite.dev/config/
export default defineConfig({
    plugins: [vue(), vueJsx(), vueDevTools()],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    server: {
        host: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEV_HOST,
        port: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEV_PORT,
        strictPort: true,
    },
    preview: {
        host: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_HOST_CONTAINER_BIND_EXTERNAL,
        port: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_PORT_CONTAINER_BIND_EXTERNAL,
        strictPort: true,
    },
    envPrefix: "VRCA_CLIENT_",
    build: {
        target: "esnext",
    },
    optimizeDeps: {
        exclude: ["@babylonjs/havok"],
    },
});
