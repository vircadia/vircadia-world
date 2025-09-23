import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueJsx from "@vitejs/plugin-vue-jsx";
import vueDevTools from "vite-plugin-vue-devtools";
import vuetify from "vite-plugin-vuetify";

import { clientBrowserConfiguration } from "../../sdk/vircadia-world-sdk-ts/browser/src/config/vircadia.browser.config";
import packageJson from "./package.json"

// https://vite.dev/config/
export default defineConfig(({ command }) => {
    const isProd = command === "build";

    return {
        plugins: [
            vue(),
            vuetify({ autoImport: true }),
            vueJsx(),
            // Only include Vue DevTools in development
            !isProd && vueDevTools(),
        ].filter(Boolean),
        define: {
            __APP_VERSION__: JSON.stringify(packageJson.version || "0.0.0"),
            __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
        },
        resolve: {
            alias: {
                "@": fileURLToPath(new URL("./src", import.meta.url)),
                "@schemas": fileURLToPath(
                    new URL("./src/schemas.ts", import.meta.url),
                ),
            },
        },
        server: {
            host: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEV_HOST,
            port: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEV_PORT,
            strictPort: true,
        },
        preview: {
            host: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_PROD_HOST,
            port: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_PROD_PORT,
            strictPort: true,
        },
        envPrefix: "VRCA_CLIENT_",
        assetsInclude: ["**/*.vertex", "**/*.fragment"],
        build: {
            outDir: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_BUILD_OUTPUT_DIR,
            target: "esnext",
            chunkSizeWarningLimit: 3000, // Increased warning limit temporarily
            rollupOptions: {},
        },
        optimizeDeps: {
            exclude: [
                "@babylonjs/havok",
                "@babylonjs/core/Shaders/default.vertex",
                "@babylonjs/core/Shaders/default.fragment",
                "@babylonjs/core/Shaders/pbr.vertex",
                "@babylonjs/core/Shaders/pbr.fragment",
            ],
            esbuildOptions: {
                target: "esnext",
            },
        },
    };
});
