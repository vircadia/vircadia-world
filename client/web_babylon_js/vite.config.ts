import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueJsx from "@vitejs/plugin-vue-jsx";
import vueDevTools from "vite-plugin-vue-devtools";

import { ClientBrowserConfiguration } from "../../sdk/vircadia-world-sdk-ts/src/client/core/vircadia.client.browser.config";

// https://vite.dev/config/
export default defineConfig(({ command }) => {
    const isProd = command === "build";

    return {
        plugins: [
            vue(),
            vueJsx(),
            // Only include Vue DevTools in development
            !isProd && vueDevTools(),
        ].filter(Boolean),
        resolve: {
            alias: {
                "@": fileURLToPath(new URL("./src", import.meta.url)),
            },
        },
        server: {
            host: ClientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEV_HOST,
            port: ClientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEV_PORT,
            strictPort: true,
        },
        preview: {
            host: ClientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_PROD_HOST,
            port: ClientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_PROD_PORT,
            strictPort: true,
        },
        envPrefix: "VRCA_CLIENT_",
        build: {
            target: "esnext",
            chunkSizeWarningLimit: 3000, // Increased warning limit temporarily
            rollupOptions: {
                // output: {
                //     manualChunks: (id) => {
                //         // Only include inspector in development builds
                //         if (id.includes("@babylonjs/inspector") && isProd) {
                //             return; // Skip in production
                //         }
                //         if (
                //             id.includes("@babylonjs/core") ||
                //             id.includes("@babylonjs/loaders") ||
                //             (!isProd && id.includes("@babylonjs/inspector"))
                //         ) {
                //             return "babylon";
                //         }
                //         if (id.includes("@babylonjs/havok")) {
                //             return "havok";
                //         }
                //         if (
                //             id.includes("vue") ||
                //             id.includes("@vueuse/core") ||
                //             id.includes("lodash-es")
                //         ) {
                //             return "vendor";
                //         }
                //     },
                // },
            },
        },
        optimizeDeps: {
            exclude: ["@babylonjs/havok"],
            esbuildOptions: {
                target: "esnext",
            },
        },
    };
});
