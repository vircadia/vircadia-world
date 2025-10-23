import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import vueJsx from "@vitejs/plugin-vue-jsx";
import { defineConfig } from "vite";
import vueDevTools from "vite-plugin-vue-devtools";
import vuetify from "vite-plugin-vuetify";

import { clientBrowserConfiguration } from "../../sdk/vircadia-world-sdk-ts/browser/src/config/vircadia.browser.config";
import packageJson from "./package.json";

// https://vite.dev/config/
export default defineConfig(({ command }) => {
    const isProd = command === "build";

    return {
        css: {
            preprocessorOptions: {
                scss: {
                    additionalData: '@use "src/styles.scss" as *;',
                },
            },
        },
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
            __APP_TITLE__: JSON.stringify(
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_META_TITLE_BASE,
            ),
            global: "globalThis",
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
            headers: {
                // WebGPU requires cross-origin isolation
                "Cross-Origin-Embedder-Policy": "require-corp",
                "Cross-Origin-Opener-Policy": "same-origin",
            },
        },
        preview: {
            host: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_PROD_HOST,
            port: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_PROD_PORT,
            strictPort: true,
            headers: {
                // WebGPU requires cross-origin isolation
                "Cross-Origin-Embedder-Policy": "require-corp",
                "Cross-Origin-Opener-Policy": "same-origin",
            },
        },
        envPrefix: "VRCA_CLIENT_",
        assetsInclude: ["**/*.vertex", "**/*.fragment"],
        build: {
            target: "esnext",
            chunkSizeWarningLimit: 3000, // Increased warning limit temporarily
            sourcemap: true,
            minify: true,
            reportCompressedSize: true,
            cssCodeSplit: true,
            rollupOptions: {
                output: {
                    manualChunks: {
                        vendor_vue: ["vue", "vue-router", "pinia", "vuetify"],
                        vendor_babylon: [
                            "@babylonjs/core",
                            "@babylonjs/inspector",
                            "@babylonjs/loaders",
                            "@babylonjs/havok",
                        ],
                        // vendor_auth: ["@azure/msal-browser"],
                        // vendor_lodash: ["lodash-es"],
                        // vendor_ai: ["@huggingface/transformers", "kokoro-js"],
                        // vendor_sdk: ["@vircadia/world-sdk/browser/vue"],
                    },
                },
            },
        },
        worker: {
            // Ensure workers are built as ES modules to support code-splitting
            format: "es",
            rollupOptions: {
                output: {
                    format: "es",
                },
            },
        },
        optimizeDeps: {
            include: ["buffer"],
            exclude: [
                "@babylonjs/havok",
                "@babylonjs/core/Shaders/default.vertex",
                "@babylonjs/core/Shaders/default.fragment",
                "@babylonjs/core/Shaders/pbr.vertex",
                "@babylonjs/core/Shaders/pbr.fragment",
                // Exclude libraries that are incompatible with Vite's dep optimizer
                "@huggingface/transformers",
                "kokoro-js",
            ],
            esbuildOptions: {
                target: "esnext",
            },
        },
    };
});
