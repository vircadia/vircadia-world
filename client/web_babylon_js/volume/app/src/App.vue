<template>
  <!-- Add a template ref 'vircadiaProviderRef' -->
  <VircadiaProvider :config="vircadiaConfig" ref="vircadiaProviderRef">
    <main>
      <!-- Canvas for Babylon.js -->
      <canvas ref="renderCanvas" id="renderCanvas"></canvas>
      <!-- Use the new component here -->
    </main>
  </VircadiaProvider>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue"; // Import watch
import {
    Scene,
    ArcRotateCamera,
    Vector3,
    HemisphericLight,
    WebGPUEngine,
} from "@babylonjs/core";
// biome-ignore lint/style/useImportType: FIXME: Vue requires this to not be a TYPE import, Biome is mistaken. We need to fix this.
import VircadiaProvider from "../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/provider/VircadiaProvider.vue";
import { Communication } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { VircadiaConfig_BROWSER_CLIENT } from "../../../../../sdk/vircadia-world-sdk-ts/config/vircadia.browser.client.config";
import type { VircadiaClientCoreConfig } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/core/vircadia.client.core";

// Configure server settings
const vircadiaConfig: VircadiaClientCoreConfig = {
    serverUrl:
        VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI_USING_SSL
            ? `https://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`
            : `http://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`,
    authToken:
        VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN,
    authProvider:
        VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER,
    debug: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG,
    suppress: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_SUPPRESS,
    reconnectAttempts: 5,
    reconnectDelay: 5000,
};

// Template ref for the provider
const vircadiaProviderRef = ref<InstanceType<typeof VircadiaProvider> | null>(
    null,
);

// BabylonJS setup
const renderCanvas = ref<HTMLCanvasElement | null>(null);
let engine: WebGPUEngine | null = null;
let scene: Scene | null = null;

const initializeBabylon = async () => {
    if (renderCanvas.value) {
        // Check for WebGPU support
        if (!navigator.gpu) {
            console.error("WebGPU is not supported on this browser.");
            // Fallback or error message
            return;
        }

        engine = new WebGPUEngine(renderCanvas.value, {
            antialias: true,
            adaptToDeviceRatio: true, // Adjust for high DPI displays
        });
        await engine.initAsync();

        scene = new Scene(engine);

        // Add a camera
        const camera = new ArcRotateCamera(
            "camera",
            -Math.PI / 2,
            Math.PI / 2.5,
            10,
            Vector3.Zero(),
            scene,
        );
        camera.attachControl(renderCanvas.value, true);

        // Add a light
        new HemisphericLight("light", new Vector3(1, 1, 0), scene);

        // Start the render loop
        engine.runRenderLoop(() => {
            if (scene) {
                scene.render();
            }
        });

        // Handle window resize
        window.addEventListener("resize", handleResize);
    }
};

const handleResize = () => {
    if (engine) {
        engine.resize();
    }
};

onMounted(async () => {
    initializeBabylon();

    // Access exposed properties after mount
    if (vircadiaProviderRef.value) {
        // Example: Watch the connectionInfo exposed by the provider
        watch(
            () => vircadiaProviderRef.value?.connectionInfo,
            (newInfo, oldInfo) => {
                if (newInfo) {
                    console.log(
                        "Connection info changed in App.vue:",
                        newInfo.status,
                    );
                    // You can react to connection status changes here
                }
            },
            { deep: true }, // Use deep watch if needed for nested properties
        );

        // Example: Call a method on the client
        const connect =
            await vircadiaProviderRef.value.client.Utilities.Connection.connect();
    }
});

onUnmounted(() => {
    window.removeEventListener("resize", handleResize);
    if (engine) {
        engine.dispose();
        engine = null;
    }
    if (scene) {
        scene.dispose();
        scene = null;
    }
});
</script>

<style>
/* Keep general styles here */
header {
  background-color: #2c3e50;
  color: white;
  padding: 1rem;
  text-align: center;
}

main {
  padding: 0; /* Remove padding if canvas should touch edges */
  margin: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden; /* Prevent scrollbars */
  position: relative; /* Needed for absolute positioning of children */
}

#renderCanvas {
  width: 100%;
  height: 100%;
  display: block; /* Remove extra space below canvas */
  touch-action: none; /* Prevent default touch actions */
  position: absolute; /* Take up full space of main */
  top: 0;
  left: 0;
  z-index: 0; /* Ensure canvas is behind other UI elements if needed */
}

/* Example: Position VircadiaConnection on top */
:deep(.vircadia-connection-container) { /* Adjust selector based on VircadiaConnection's root element/class */
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 1; /* Ensure it's above the canvas */
    background-color: rgba(44, 62, 80, 0.7); /* Example styling */
    padding: 10px;
    border-radius: 5px;
    color: white;
}

</style>
