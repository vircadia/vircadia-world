<template>
    <main>
        <div v-if="connectionStatus === 'connecting'" class="connection-status">
            Connecting to Vircadia server...
        </div>
        <div v-if="connectionStatus === 'disconnected'" class="connection-status">
            Disconnected from Vircadia server. Will attempt to reconnect...
        </div>
        <canvas ref="renderCanvas" id="renderCanvas"></canvas>
        
        <!-- Entities loading indicator (moved from Room component) -->
        <div v-if="isLoading" class="overlay loading-indicator">
            Loading assets or creating entities...
        </div>
        
        <!-- Only render entities when scene is available -->
        <template v-if="scene">
            <StaticBabylonEntity
                v-for="(entity, index) in entityDefinitions"
                :key="entity.fileName"
                :scene="scene"
                :fileName="entity.fileName"
                :position="entity.position"
                :ref="el => entityRefs[index] = el"
            />
        </template>
    </main>
</template>

<script setup lang="ts">
import { inject, computed, watch, ref, onMounted, onUnmounted } from "vue";
import { getInstanceKey } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/provider/useVircadia";
import StaticBabylonEntity from "./components/StaticBabylonEntity.vue";
import {
    Scene,
    ArcRotateCamera,
    Vector3,
    HemisphericLight,
    WebGPUEngine,
    type Engine,
} from "@babylonjs/core";
// Make sure the importers are included
import "@babylonjs/loaders/glTF";

// Get the existing Vircadia connection from main.ts with proper typing
const vircadiaWorld = inject(getInstanceKey("vircadiaWorld"));

// Safely compute the connection status with a fallback
const connectionStatus = computed(
    () => vircadiaWorld?.connectionInfo?.value?.status || "disconnected",
);

// BabylonJS Setup
const renderCanvas = ref<HTMLCanvasElement | null>(null);
const engine = ref<WebGPUEngine | null>(null);
const scene = ref<Scene | null>(null);

// Entity definitions - moved from Room component
interface EntityDefinition {
    fileName: string;
    position?: { x: number; y: number; z: number };
    // Add other properties as needed
}

const entityDefinitions = ref<EntityDefinition[]>([
    {
        fileName: "telekom.model.LandscapeWalkwayLOD.glb",
        position: { x: 0, y: 0, z: 0 },
    },
    // Add more assets here
]);

// Store references to entity components - moved from Room component
const entityRefs = ref<(InstanceType<typeof StaticBabylonEntity> | null)[]>([]);

// Simplified loading state from all entity components - moved from Room component
const isLoading = computed(() => {
    return entityRefs.value.some((ref) => ref?.isLoading);
});

// Initialize BabylonJS
const initializeBabylon = async () => {
    if (!renderCanvas.value || !navigator.gpu) {
        console.error("WebGPU not supported or canvas not found.");
        return false;
    }

    console.log("Initializing BabylonJS with WebGPU...");
    try {
        engine.value = new WebGPUEngine(renderCanvas.value, {
            antialias: true,
            adaptToDeviceRatio: true,
        });
        await engine.value.initAsync();

        // Create scene with properly typed engine
        const babylonEngine = engine.value;
        scene.value = new Scene(babylonEngine);

        const camera = new ArcRotateCamera(
            "camera",
            -Math.PI / 2,
            Math.PI / 2.5,
            10,
            Vector3.Zero(),
            scene.value,
        );
        camera.attachControl(renderCanvas.value, true);

        // Create light with properly typed scene
        const babylonScene = scene.value;
        new HemisphericLight("light", new Vector3(1, 1, 0), babylonScene);

        engine.value.runRenderLoop(() => scene.value?.render());
        window.addEventListener("resize", handleResize);
        console.log("BabylonJS initialized successfully.");
        return true;
    } catch (error) {
        console.error("Error initializing BabylonJS:", error);
        return false;
    }
};

const handleResize = () => engine.value?.resize();

onMounted(async () => {
    await initializeBabylon();

    // Initialize entity refs array - moved from Room component
    entityRefs.value = Array(entityDefinitions.value.length).fill(null);
});

onUnmounted(() => {
    window.removeEventListener("resize", handleResize);
    console.log("Disposing BabylonJS scene and engine...");
    scene.value?.dispose();
    engine.value?.dispose();
    scene.value = null;
    engine.value = null;
});

watch(
    () => connectionStatus.value,
    (newStatus) => {
        if (newStatus === "connected") {
            console.log("Connected to Vircadia server");
        } else if (newStatus === "disconnected") {
            console.log("Disconnected from Vircadia server");
        } else if (newStatus === "connecting") {
            console.log("Connecting to Vircadia server...");
        }
    },
);
</script>

<style>
html, body {
    margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background-color: #202020;
}
main {
    padding: 0; margin: 0; width: 100vw; height: 100vh; overflow: hidden; display: flex; position: relative;
}
#renderCanvas {
    width: 100%; height: 100%; display: block; touch-action: none; outline: none;
}
.connection-status {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background-color: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 20px;
    border-radius: 5px;
    font-family: sans-serif;
    text-align: center;
}
.connection-status.error {
    background-color: rgba(120, 0, 0, 0.7);
}
.overlay {
    position: absolute; left: 10px; color: white; background: rgba(0,0,0,0.7); padding: 8px; border-radius: 4px; font-family: sans-serif; font-size: 14px; z-index: 10; /* Ensure overlay is on top */
}
.loading-indicator {
    top: 10px;
}
</style>
