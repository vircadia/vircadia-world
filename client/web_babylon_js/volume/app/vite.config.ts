import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
    plugins: [solidPlugin(), tailwindcss()],
    server: {
        port:
            Number.parseInt(
                process.env
                    .VRCA_CLIENT_WEB_BABYLON_JS_PORT_CONTAINER_INTERNAL as string,
            ) || 3000,
        // hmr: {
        //     overlay: true,
        //     // If you're working in a container or across network, you might need these:
        //     // protocol: 'ws', // use websocket protocol
        //     // host: '0.0.0.0', // uncomment if you need to access from other devices
        //     // port: 24678, // uncomment if you need a specific HMR port
        // },
        // watch: {
        //     usePolling: false, // set to true if hot reload isn't working in certain environments (like Docker)
        //     ignored: ["**/node_modules/**", "**/dist/**"],
        // },
    },
    preview: {
        port:
            Number.parseInt(
                process.env
                    .VRCA_CLIENT_WEB_BABYLON_JS_PORT_CONTAINER_INTERNAL as string,
            ) || 3000,
    },
    build: {
        target: "esnext",
    },
});
