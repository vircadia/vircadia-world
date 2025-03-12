import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
    plugins: [solidPlugin(), tailwindcss()],
    // server: {
    //     port: Number.parseInt(
    //         import.meta.env
    //             .VRCA_CLIENT_WEB_BABYLON_JS_DEV_PORT_CONTAINER_INTERNAL as string,
    //     ),
    // },
    // preview: {
    //     port: Number.parseInt(
    //         import.meta.env
    //             .VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_PORT_CONTAINER_INTERNAL as string,
    //     ),
    // },
    envPrefix: "VRCA_CLIENT_",
    build: {
        target: "esnext",
    },
});
