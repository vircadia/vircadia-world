import { fileURLToPath, URL } from "node:url";
import { execSync } from "node:child_process";
import vue from "@vitejs/plugin-vue";
import vueJsx from "@vitejs/plugin-vue-jsx";
import { defineConfig } from "vite";
import vueDevTools from "vite-plugin-vue-devtools";
import vuetify from "vite-plugin-vuetify";

import { visualizer } from "rollup-plugin-visualizer";
import { compression } from "vite-plugin-compression2";

import { viteStaticCopy } from "vite-plugin-static-copy";
import { clientBrowserConfiguration } from "../../sdk/vircadia-world-sdk-ts/browser/src/config/vircadia.browser.config";
import packageJson from "./package.json";

// Get git commit hash
const commitHash = execSync("git rev-parse --short HEAD").toString().trim();

// https://vite.dev/config/
export default defineConfig(({ command }) => {
    const isProd = command === "build";

    const userComponentsPathAbsolute =
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_USER_COMPONENTS_PATH_ABSOLUTE;
    const userComponentsPathRelative =
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_USER_COMPONENTS_PATH_RELATIVE;

    const resolvedUserComponentsDir = userComponentsPathAbsolute
        ? userComponentsPathAbsolute
        : fileURLToPath(
              new URL(
                  `./src/user/${userComponentsPathRelative}`,
                  import.meta.url,
              ),
          );

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
            viteStaticCopy({
                targets: [
                    {
                        src: "../../node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js",
                        dest: "vad",
                    },
                    {
                        src: "../../node_modules/@ricky0123/vad-web/dist/*.onnx",
                        dest: "vad",
                    },
                    {
                        src: "../../node_modules/onnxruntime-web/dist/*.wasm",
                        dest: "vad",
                    },
                    {
                        src: "../../node_modules/onnxruntime-web/dist/*.mjs",
                        dest: "vad",
                    },
                ],
            }),
            // Only include Vue DevTools in development
            !isProd && vueDevTools(),
            // Compression for production
            isProd && (compression() as any),
            isProd && (compression({ algorithms: ["brotliCompress"] }) as any),
            // Visualizer for bundle analysis
            // isProd &&
            //     visualizer({
            //         filename: "stats.html",
            //         gzipSize: true,
            //         brotliSize: true,
            //         open: false,
            //     }),
        ].filter(Boolean),
        define: {
            __APP_VERSION__: JSON.stringify(packageJson.version || "0.0.0"),
            __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
            __COMMIT_HASH__: JSON.stringify(commitHash),
            __APP_TITLE__: JSON.stringify(
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_META_TITLE_BASE,
            ),
            __USER_COMPONENTS_ROOT__: JSON.stringify(resolvedUserComponentsDir),
            __USER_COMPONENTS_RELATIVE_PATH__: JSON.stringify((() => {
                // Normalize paths to use forward slashes for cross-platform compatibility
                const normalizeSlashes = (p: string) => p.replace(/\\/g, "/");
                const basePath = normalizeSlashes(
                    fileURLToPath(new URL(".", import.meta.url))
                ).replace(/\/$/, "");
                const resolvedPath = normalizeSlashes(resolvedUserComponentsDir);
                
                return resolvedPath.startsWith(basePath)
                    ? resolvedPath.replace(basePath, "")
                    : "";
            })()),
            global: "globalThis",
        },
        resolve: {
            alias: {
                "@": fileURLToPath(new URL("./src", import.meta.url)),
                "@schemas": fileURLToPath(
                    new URL("./src/schemas.ts", import.meta.url),
                ),
                "@user-components": resolvedUserComponentsDir,
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
            chunkSizeWarningLimit: 2000,
            sourcemap: !isProd, // Disable sourcemaps in production for smaller builds
            minify: "esbuild",
            reportCompressedSize: true,
            cssCodeSplit: true,
            rollupOptions: {
                output: {
                    // Manual chunking removed to simplify build
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
                "@babylonjs/core",
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
