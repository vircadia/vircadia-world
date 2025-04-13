import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { VircadiaConfig_BROWSER_CLIENT } from "../../../../sdk/vircadia-world-sdk-ts/config/vircadia.browser.client.config";

export default defineConfig({
    plugins: [solidPlugin(), tailwindcss()],
    server: {
        host: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEV_HOST,
        port: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEV_PORT,
        strictPort: true,
    },
    preview: {
        host: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_HOST_CONTAINER_BIND_EXTERNAL,
        port: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_PORT_CONTAINER_BIND_INTERNAL,
        strictPort: true,
    },
    envPrefix: "VRCA_CLIENT_",
    build: {
        target: "esnext",
    },
});
