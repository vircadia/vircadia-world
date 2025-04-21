import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VircadiaConfig_BROWSER_CLIENT } from "../../../../sdk/vircadia-world-sdk-ts/config/vircadia.browser.client.config";

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        host: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEV_HOST,
        port: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEV_PORT,
        strictPort: true,
    },
    preview: {
        host: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_PRODUCTION_HOST_CONTAINER_BIND_EXTERNAL,
        port: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_PRODUCTION_PORT_CONTAINER_BIND_EXTERNAL,
        strictPort: true,
    },
    envPrefix: "VRCA_CLIENT_",
    build: {
        target: "esnext",
    },
});
