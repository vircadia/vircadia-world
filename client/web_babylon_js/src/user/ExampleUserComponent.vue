<template>
    <div v-if="sceneInitialized && connectionStatus === 'connected'" class="user-component">
        <v-card class="floating-card">
            <v-card-title>User Component Example</v-card-title>
            <v-card-text>
                <p><strong>Session ID:</strong> {{ sessionId }}</p>
                <p><strong>Agent ID:</strong> {{ agentId }}</p>
                <p><strong>Connection:</strong> {{ connectionStatus }}</p>
                <p><strong>Canvas Size:</strong> {{ canvasSize }}</p>
                <p><strong>Instance ID:</strong> {{ appStore?.instanceId }}</p>
                <p><strong>Scene Active Indices:</strong> {{ sceneActiveIndices }}</p>
                <p><strong>Engine:</strong> {{ engine?.name }}</p>
                <p><strong>FPS:</strong> {{ fps }}</p>
                <p><strong>Perf Mode:</strong> {{ performanceMode }}</p>
                
                <v-btn @click="createTestCube" color="primary" class="mt-2">
                    Create Test Cube
                </v-btn>
                
                <v-btn @click="logStoreData" color="secondary" class="mt-2 ml-2">
                    Log Store Data
                </v-btn>
            </v-card-text>
        </v-card>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from "vue";
import type { Scene, WebGPUEngine } from "@babylonjs/core";
import { MeshBuilder, StandardMaterial, Color3 } from "@babylonjs/core";
import type { useAppStore } from "@/stores/appStore";

// Define props that will be passed from the main App component
interface Props {
    scene?: Scene | null;
    engine?: WebGPUEngine | null;
    canvas?: HTMLCanvasElement | null;
    appStore?: ReturnType<typeof useAppStore>;
    vircadiaWorld?: any;
    connectionStatus?: string;
    sessionId?: string | null;
    agentId?: string | null;
    sceneInitialized?: boolean;
    fps?: number;
    performanceMode?: "normal" | "low";
}

const props = withDefaults(defineProps<Props>(), {
    scene: null,
    engine: null,
    canvas: null,
    connectionStatus: "disconnected",
    sessionId: null,
    agentId: null,
    sceneInitialized: false,
    fps: 0,
    performanceMode: "low",
});

// Create a reactive reference for scene statistics
const sceneStats = ref({
    activeIndices: 0,
    lastUpdateTime: Date.now(),
});

// Watch for scene changes and set up observables
let renderObserver: any = null;

watch(
    () => props.scene,
    (newScene, oldScene) => {
        // Clean up previous observer
        if (renderObserver && oldScene) {
            oldScene.onAfterRenderObservable.remove(renderObserver);
            renderObserver = null;
        }

        // Set up new observer for the new scene
        if (newScene) {
            renderObserver = newScene.onAfterRenderObservable.add(() => {
                // Update scene statistics reactively
                // Handle PerfCounter type properly - it has a .current property
                const activeIndices = newScene._activeIndices;
                sceneStats.value = {
                    activeIndices: activeIndices?.current || 0,
                    lastUpdateTime: Date.now(),
                };
            });
        }
    },
    { immediate: true },
);

// Clean up observer when component is unmounted
onUnmounted(() => {
    if (renderObserver && props.scene) {
        props.scene.onAfterRenderObservable.remove(renderObserver);
        renderObserver = null;
    }
});

// Now this computed property will be properly reactive
const sceneActiveIndices = computed(() => sceneStats.value.activeIndices);

// Computed properties for reactive data
const canvasSize = computed(() => {
    if (!props.canvas) return "N/A";
    return `${props.canvas.width}x${props.canvas.height}`;
});

// Example function using the Babylon scene
const createTestCube = () => {
    if (!props.scene) {
        console.warn("Scene not available");
        return;
    }

    // Create a test cube in the scene
    const cube = MeshBuilder.CreateBox(
        "userTestCube",
        { size: 2 },
        props.scene,
    );
    cube.position.y = 2;
    cube.position.x = Math.random() * 10 - 5;
    cube.position.z = Math.random() * 10 - 5;

    // Add a colorful material
    const material = new StandardMaterial("userCubeMaterial", props.scene);
    material.diffuseColor = new Color3(
        Math.random(),
        Math.random(),
        Math.random(),
    );
    cube.material = material;

    console.log("Created test cube:", cube.name);
};

// Example function using the app store
const logStoreData = () => {
    if (!props.appStore) {
        console.warn("App store not available");
        return;
    }

    console.log("App Store Data:", {
        instanceId: props.appStore.instanceId,
        fullSessionId: props.appStore.fullSessionId,
        modelDefinitions: props.appStore.modelDefinitions,
        pollingIntervals: props.appStore.pollingIntervals,
    });
};
</script>

<style scoped>
.user-component {
    position: fixed;
    bottom: 16px;
    left: 16px;
    z-index: 1000;
}

.floating-card {
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    background: rgba(255, 255, 255, 0.9) !important;
    border: 1px solid rgba(255, 255, 255, 0.2);
    max-width: 300px;
}
</style> 