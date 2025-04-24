<template>
  <!-- Add a template ref 'vircadiaProviderRef' -->
  <VircadiaProvider :config="vircadiaConfig" ref="vircadiaProviderRef">
    <main>
      <!-- Canvas for Babylon.js -->
      <canvas ref="renderCanvas" id="renderCanvas"></canvas>
      <!-- Use VircadiaAsset to load the model data -->
      <!-- Conditionally render VircadiaAsset only when connected -->
      <VircadiaAsset
        v-if="vircadiaProviderRef?.connectionInfo.status === 'connected'"
        :file-name="modelFileName"
        v-slot="{ assetData, loading, error }"
      >
        <!-- We don't need to render anything specific here, -->
        <!-- but we use the slot to trigger the loading logic below -->
        <div v-if="loading">Loading asset...</div>
        <div v-if="error">Error loading asset: {{ error.message }}</div>
        <!-- Store assetData in a ref when available -->
        <template v-if="assetData">{{ setAssetDataRef(assetData) }}</template>
      </VircadiaAsset>
      <!-- Optional: Show a message while connecting -->
      <div v-else-if="vircadiaProviderRef?.connectionInfo.status === 'connecting'">
        Connecting to server...
      </div>
      <div v-else>
        Not connected. State: {{ vircadiaProviderRef?.connectionInfo.status }}
      </div>
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
    ImportMeshAsync,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF"; // Import the GLTF loader

// biome-ignore lint/style/useImportType: FIXME: Vue requires this to not be a TYPE import, Biome is mistaken. We need to fix this.
import VircadiaProvider from "../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/provider/VircadiaProvider.vue";
import { Communication } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { VircadiaConfig_BROWSER_CLIENT } from "../../../../../sdk/vircadia-world-sdk-ts/config/vircadia.browser.client.config";
import type { VircadiaClientCoreConfig } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/core/vircadia.client.core";
// Import VircadiaAsset and its data type
import VircadiaAsset, {
    type VircadiaAssetData,
} from "../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/component/VircadiaAsset.vue";

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

// Asset loading setup
const modelFileName = ref("telekom.model.LandscapeWalkwayLOD.glb");
const loadedAssetData = ref<VircadiaAssetData | null>(null);
let modelLoaded = false; // Flag to prevent multiple loads

// Function called from the template to update the ref
const setAssetDataRef = (data: VircadiaAssetData) => {
    loadedAssetData.value = data;
    return null; // Don't render anything
};

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

// Watch for changes in the loaded asset data
watch(
    loadedAssetData,
    async (newData) => {
        // Change condition to check for the raw data instead of blobUrl
        if (newData?.arrayBuffer) {
            console.log(
                "Asset data received, checking if ready to load model from data buffer...",
            );
            // Ensure scene is ready and data exists, and model not already loaded
            if (scene && loadedAssetData.value?.arrayBuffer && !modelLoaded) {
                try {
                    // Use "data:" as the root URL to indicate loading from buffer

                    const pluginExtension =
                        loadedAssetData.value.mimeType === "model/gltf-binary"
                            ? ".glb"
                            : ".gltf";

                    console.log(
                        `Attempting to load model from blob URL (url: ${loadedAssetData.value.blobUrl}) (size: ${loadedAssetData.value.arrayBuffer.byteLength} bytes) (${loadedAssetData.value.mimeType}:${pluginExtension})`,
                    );

                    const result = await ImportMeshAsync(
                        loadedAssetData.value.blobUrl, // Pass the ArrayBuffer
                        scene,
                        {
                            pluginExtension,
                        },
                    );
                    console.log(
                        "Model loaded successfully from blob url:",
                        result.meshes,
                    );
                    modelLoaded = true; // Set flag to prevent reloading
                } catch (error) {
                    console.error(
                        "Error loading model from blob url buffer:",
                        error,
                    );
                }
            } else {
                // Log why loading didn't proceed
                if (!scene) console.log("Scene not ready yet.");
                if (modelLoaded) console.log("Model already loaded.");
            }
        }
    },
    {
        immediate: true, // Keep immediate to attempt loading once data is available
        deep: true, // Use deep watch if assetData structure is complex (optional but safe)
    },
);

const handleResize = () => {
    if (engine) {
        engine.resize();
    }
};

onMounted(async () => {
    // It's generally better to initialize Babylon regardless of connection status
    await initializeBabylon();

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
                    // Asset loading will now be triggered by the v-if in the template
                    // when status becomes 'connected'
                }
            },
            { deep: true, immediate: true }, // Use immediate to log initial status
        );

        // Example: Call a method on the client - This should ideally happen
        // AFTER connection is confirmed, or be handled internally by the SDK method.
        // If connect() is idempotent or handles its own state, this might be okay.
        // Otherwise, consider moving this call into the connectionInfo watcher
        // when status becomes 'connected'.
        try {
            const connectResult =
                await vircadiaProviderRef.value.client.Utilities.Connection.connect();
            console.log("Manual connect attempt result:", connectResult);
        } catch (error) {
            console.error("Error during manual connect attempt:", error);
        }
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
    modelLoaded = false; // Reset flag on unmount
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

/* Styling for asset loading/error messages (optional) */
/* Adjust positioning if needed */
main > div[v-if],
main > div[v-else-if],
main > div[v-else] {
    position: absolute;
    top: 50px; /* Position below connection info */
    left: 10px;
    z-index: 1;
    background-color: rgba(44, 62, 80, 0.7); /* Default background */
    padding: 5px 10px;
    border-radius: 3px;
    color: white;
    font-family: sans-serif;
    font-size: 0.9em;
}
main > div[v-if*="Error"] {
    background-color: rgba(255, 0, 0, 0.7); /* Example error styling */
}
main > div[v-if*="Loading"] {
    background-color: rgba(255, 165, 0, 0.7); /* Example loading styling */
}
main > div[v-else-if*="Connecting"] {
    background-color: rgba(0, 100, 255, 0.7); /* Example connecting styling */
}

</style>
