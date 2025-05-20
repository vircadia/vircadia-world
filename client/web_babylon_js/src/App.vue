<template>
    <v-app>
        <main>
            <canvas ref="renderCanvas" id="renderCanvas"></canvas>
            
            <!-- Snackbar for loading and connection status -->
            <v-snackbar v-model="snackbarVisible" :timeout="0" top>
                <div class="d-flex align-center">
                    <v-progress-circular v-if="isLoading" indeterminate color="white" size="24" class="mr-2" />
                    {{ snackbarText }}
                </div>
            </v-snackbar>
            
            <!-- Only render entities when scene is available -->
            <template v-if="sceneInitialized && scene && connectionStatus === 'connected'">
                <!-- BabylonAvatar component -->
                <BabylonAvatar
                    :scene="scene"
                    @ready="startRenderLoop"
                    @dispose="stopRenderLoop"
                    ref="avatarRef"
                />

                <!-- BabylonModel components -->
                <BabylonModel
                    v-for="def in appStore.modelDefinitions"
                    :key="def.fileName"
                    :def="def"
                    :scene="scene"
                    ref="modelRefs"
                />
                <TestAvatar :scene="scene" />
            </template>
        </main>
    </v-app>
</template>

<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/consistent-type-imports */
import { computed, watch, ref, onMounted, onUnmounted, inject } from "vue";
// @ts-ignore: used in template
import BabylonAvatar from "./components/BabylonAvatar.vue";
// @ts-ignore: used in template
import BabylonModel from "./components/BabylonModel.vue";
// @ts-ignore: used in template
import TestAvatar from "./components/TestAvatar.vue";
// mark as used at runtime for template
void BabylonAvatar;
// mark as used at runtime for template
void BabylonModel;
// mark as used at runtime for template
void TestAvatar;
import { useBabylonEnvironment } from "./composables/useBabylonEnvironment";
import { useAppStore } from "@/stores/appStore";
// BabylonJS
import {
    Scene,
    Vector3,
    HemisphericLight,
    WebGPUEngine,
    DirectionalLight,
    MeshBuilder,
    StandardMaterial,
    Color3,
    PhysicsAggregate,
    PhysicsShapeType,
    HavokPlugin,
} from "@babylonjs/core";
import { useVircadiaInstance } from "@vircadia/world-sdk/browser/vue";

// Get Vircadia context once in setup
const vircadiaWorld = inject(useVircadiaInstance());

if (!vircadiaWorld) {
    throw new Error("Vircadia instance not found");
}
const connectionStatus = computed(
    () => vircadiaWorld.connectionInfo.value.status,
);
const appStore = useAppStore();

// BabylonJS Setup - use variables instead of refs
const renderCanvas = ref<HTMLCanvasElement | null>(null);
// Using regular variables instead of refs for non-reactive engine and scene
let engine: WebGPUEngine | null = null;
let scene: Scene | null = null;
// Track if scene is initialized for template rendering
const sceneInitialized = ref(false);
// Track inspector state
const isInspectorVisible = ref(false);
// Track if avatar is ready
const avatarRef = ref<InstanceType<typeof BabylonAvatar> | null>(null);
const modelRefs = ref<(InstanceType<typeof BabylonModel> | null)[]>([]);

// Inline physics initialization and inspector helpers
let havokInstance: unknown = null;
let physicsPlugin: HavokPlugin | null = null;

const initializePhysics = async (
    scene: Scene,
    gravityVector: Vector3,
): Promise<boolean> => {
    try {
        if (!havokInstance) {
            const HavokPhysics = (await import("@babylonjs/havok")).default;
            havokInstance = await HavokPhysics();
        }
        physicsPlugin = new HavokPlugin(true, havokInstance);
        const enabled = scene.enablePhysics(gravityVector, physicsPlugin);
        console.log("Physics engine initialized:", enabled);
        return enabled;
    } catch (error) {
        console.error("Error initializing physics engine:", error);
        return false;
    }
};

const loadInspector = async (scene: Scene): Promise<void> => {
    if (import.meta.env.DEV) {
        await import("@babylonjs/inspector");
        scene.debugLayer.show({ embedMode: true });
        return;
    }
    console.warn("Inspector is only available in development mode");
};

const hideInspector = (scene: Scene): void => {
    scene.debugLayer.hide();
};

// Add function to toggle the inspector
const toggleInspector = async (): Promise<void> => {
    if (!scene) return;
    if (!isInspectorVisible.value) {
        await loadInspector(scene);
        isInspectorVisible.value = true;
    } else {
        hideInspector(scene);
        isInspectorVisible.value = false;
    }
};

// Start the render loop after avatar is ready
const startRenderLoop = () => {
    if (!engine || !scene) return;

    console.log("Starting render loop after avatar is ready");
    engine.runRenderLoop(() => scene?.render());
};

// Stop the render loop when the avatar unmounts
const stopRenderLoop = () => {
    if (!engine || !scene) return;
    console.log("Stopping render loop before avatar unmount");
    engine.stopRenderLoop();
};

// Keyboard event handler for inspector toggle
const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "t" && scene) {
        toggleInspector();
    }
};

// Set up environment loader using HDR list from store
const envLoader = useBabylonEnvironment(appStore.hdrList);
const loadEnvironments = envLoader.loadAll;
const environmentLoading = envLoader.isLoading;

// Child component loading states
const avatarLoading = computed(
    () =>
        (avatarRef.value?.isCreating || avatarRef.value?.isRetrieving) ?? false,
);
const modelsLoading = computed(() =>
    modelRefs.value.some(
        (m) =>
            (m?.isEntityCreating ||
                m?.isEntityRetrieving ||
                m?.isAssetLoading) ??
            false,
    ),
);

// Global loading state: environment, avatar, or models
const isLoading = computed(
    () =>
        environmentLoading.value || avatarLoading.value || modelsLoading.value,
);

// snackbarVisible is driven by connection status and loading, add noop setter to satisfy v-model
const snackbarVisible = computed<boolean>({
    get: () => connectionStatus.value !== "connected" || isLoading.value,
    set: (_val: boolean) => {
        // no-op setter: visibility is derived from connection status and loading
    },
});
const snackbarText = computed(() => {
    if (isLoading.value) {
        return "Loading assets or creating entities...";
    }
    if (connectionStatus.value === "connecting") {
        return "Connecting to Vircadia server...";
    }
    if (connectionStatus.value === "disconnected") {
        return "Disconnected from Vircadia server. Will attempt to reconnect...";
    }
    return "";
});

// Initialize BabylonJS
const initializeBabylon = async () => {
    if (!(await navigator.gpu?.requestAdapter())) {
        console.error("WebGPU not supported.");
        return false;
    }

    if (!renderCanvas.value) {
        console.error("Canvas not found.");
        return false;
    }

    console.log("Initializing BabylonJS with WebGPU...");
    try {
        engine = new WebGPUEngine(renderCanvas.value, {
            antialias: true,
            adaptToDeviceRatio: true,
        });

        await engine.initAsync();

        scene = new Scene(engine);

        // Create light
        new HemisphericLight("light", new Vector3(1, 1, 0), scene);

        // Create a directional light for shadows
        const directionalLight = new DirectionalLight(
            "directionalLight",
            new Vector3(-1, -2, -1),
            scene,
        );
        directionalLight.position = new Vector3(10, 10, 10);
        directionalLight.intensity = 1.0;

        // Initialize physics first
        const gravityVector = new Vector3(0, -9.81, 0);
        const physicsEnabled = await initializePhysics(scene, gravityVector);

        if (physicsEnabled) {
            // Create a large ground plane after physics is initialized
            const ground = MeshBuilder.CreateGround(
                "ground",
                { width: 1000, height: 1000 },
                scene,
            );
            ground.position = new Vector3(0, -1, 0);

            // Add material to the ground
            const groundMaterial = new StandardMaterial(
                "groundMaterial",
                scene,
            );
            groundMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2);
            groundMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
            ground.material = groundMaterial;

            // Create a physics aggregate for the ground instead of using impostor
            new PhysicsAggregate(
                ground,
                PhysicsShapeType.BOX,
                { mass: 0, friction: 0.5, restitution: 0.3 },
                scene,
            );

            console.log("Ground plane created with physics");
        }

        // Note: We no longer start the render loop here
        // The render loop will be started when PhysicsAvatar is ready
        window.addEventListener("resize", handleResize);

        // Set scene initialized flag to true
        sceneInitialized.value = true;

        console.log("BabylonJS initialized successfully.");
        return true;
    } catch (error) {
        console.error("Error initializing BabylonJS:", error);
        return false;
    }
};

const handleResize = () => engine?.resize();

onMounted(async () => {
    await initializeBabylon();

    // Add keyboard event listener for inspector toggle
    window.addEventListener("keydown", handleKeyDown);
});

onUnmounted(() => {
    window.removeEventListener("resize", handleResize);
    // Remove keyboard event listener
    window.removeEventListener("keydown", handleKeyDown);
    console.log("Disposing BabylonJS scene and engine...");
    scene?.dispose();
    engine?.dispose();
    scene = null;
    engine = null;
    sceneInitialized.value = false;
});

// Combined watcher for connection status and scene initialization
watch(
    [() => connectionStatus.value, () => sceneInitialized.value],
    ([status, initialized], [prevStatus, prevInitialized]) => {
        // Log connection status changes
        if (status !== prevStatus) {
            if (status === "connected") {
                console.log("Connected to Vircadia server");
            } else if (status === "disconnected") {
                console.log("Disconnected from Vircadia server");
            } else if (status === "connecting") {
                console.log("Connecting to Vircadia server...");
            }
        }
        // Load environments when scene is initialized and connected
        if (initialized && status === "connected" && scene) {
            const s = scene; // narrow scene
            loadEnvironments(s);
            // BabylonModel components auto-load themselves when scene is set
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
</style>
