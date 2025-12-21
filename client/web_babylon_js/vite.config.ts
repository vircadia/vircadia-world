import { fileURLToPath, URL } from "node:url";
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
                        src: fileURLToPath(
                            new URL(
                                "../../node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js",
                                import.meta.url,
                            ),
                        ),
                        dest: "vad",
                    },
                    {
                        src: fileURLToPath(
                            new URL(
                                "../../node_modules/@ricky0123/vad-web/dist/*.onnx",
                                import.meta.url,
                            ),
                        ),
                        dest: "vad",
                    },
                    {
                        src: fileURLToPath(
                            new URL(
                                "../../node_modules/onnxruntime-web/dist/*.wasm",
                                import.meta.url,
                            ),
                        ),
                        dest: "vad",
                    },
                    {
                        src: fileURLToPath(
                            new URL(
                                "../../node_modules/onnxruntime-web/dist/*.mjs",
                                import.meta.url,
                            ),
                        ),
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
            __APP_TITLE__: JSON.stringify(
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_META_TITLE_BASE,
            ),
            __USER_COMPONENTS_ROOT__: JSON.stringify(resolvedUserComponentsDir),
            __USER_COMPONENTS_RELATIVE_PATH__: JSON.stringify(
                resolvedUserComponentsDir.startsWith(
                    fileURLToPath(new URL(".", import.meta.url)).replace(
                        /\/$/,
                        "",
                    ),
                )
                    ? resolvedUserComponentsDir.replace(
                          fileURLToPath(new URL(".", import.meta.url)).replace(
                              /\/$/,
                              "",
                          ),
                          "",
                      )
                    : "",
            ),
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
                    manualChunks(id) {
                        if (id.includes("node_modules")) {
                            if (id.includes("vue") || id.includes("pinia")) {
                                return "vendor-vue";
                            }
                            if (id.includes("vuetify")) {
                                return "vendor-vuetify";
                            }
                            if (id.includes("@babylonjs")) {
                                if (id.includes("@babylonjs/inspector")) {
                                    return "vendor-babylon-inspector";
                                }
                                return "vendor-babylon";
                            }
                            if (
                                id.includes("onnxruntime-web") ||
                                id.includes("@huggingface/transformers")
                            ) {
                                return "vendor-ai";
                            }
                            return "vendor-others";
                        }
                        // Handle SDK workspace paths
                        if (id.includes("sdk/vircadia-world-sdk-ts")) {
                            return "vendor-vircadia-sdk";
                        }
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
                "@babylonjs/core/Shaders/geometry.fragment",
                "@babylonjs/core/Shaders/geometry.vertex",
                "@babylonjs/core/Shaders/shadowMap.vertex",
                "@babylonjs/core/Shaders/shadowMap.fragment",
                "@babylonjs/core/Shaders/depth.vertex",
                "@babylonjs/core/Shaders/depth.fragment",
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
