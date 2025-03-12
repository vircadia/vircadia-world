import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { VircadiaConfig } from "../vircadia-world-sdk-ts/config/vircadia.config";

export default defineConfig({
    plugins: [solidPlugin(), tailwindcss()],
    server: {
        port: VircadiaConfig.CLIENT
            .VRCA_CLIENT_WEB_BABYLON_JS_DEV_PORT_CONTAINER_INTERNAL,
        strictPort: true,
    },
    preview: {
        port: VircadiaConfig.CLIENT
            .VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_PORT_CONTAINER_INTERNAL,
        strictPort: true,
    },
    envPrefix: "VRCA_CLIENT_",
    build: {
        target: "esnext",
    },
});
