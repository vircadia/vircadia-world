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
                <!-- BabylonMyAvatar component -->
                <BabylonMyAvatar
                    :scene="scene"
                    @ready="startRenderLoop"
                    @dispose="stopRenderLoop"
                    ref="avatarRef"
                />

                <!-- BabylonOtherAvatar components for other users -->
                <BabylonOtherAvatar
                    v-for="otherSessionId in otherAvatarSessionIds"
                    :key="otherSessionId"
                    :scene="scene"
                    :session-id="otherSessionId"
                    ref="otherAvatarRefs"
                />

                <!-- BabylonModel components -->
                <BabylonModel
                    v-for="def in appStore.modelDefinitions"
                    :key="def.fileName"
                    :def="def"
                    :scene="scene"
                    ref="modelRefs"
                />
            </template>
        </main>
        <!-- WebRTC Status launcher -->
        <v-btn 
            style="position: fixed; top: 60px; right: 10px;" 
            fab 
            color="primary" 
            @click="webrtcDialog = true"
        >
            <v-badge
                v-if="connectionCount > 0"
                :content="connectionCount"
                color="success"
                overlap
            >
                <v-icon>mdi-phone</v-icon>
            </v-badge>
            <v-icon v-else>mdi-phone</v-icon>
        </v-btn>
        
        <v-dialog v-model="webrtcDialog" max-width="500">
            <WebRTCStatus ref="webrtcStatus" />
        </v-dialog>
        
        <!-- Debug Joint Overlay -->
        <v-btn 
            style="position: fixed; top: 10px; left: 10px;" 
            fab 
            color="error" 
            @click="showDebugOverlay = !showDebugOverlay"
        >
            Debug
        </v-btn>
        <BabylonDebugOverlay 
            v-if="showDebugOverlay" 
            :visible="showDebugOverlay"
            @close="showDebugOverlay = false"
        />
    </v-app>
</template>

<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/consistent-type-imports */
import { computed, watch, ref, onMounted, onUnmounted, inject } from "vue";
import BabylonMyAvatar from "./components/BabylonMyAvatar.vue";
import BabylonOtherAvatar from "./components/BabylonOtherAvatar.vue";
import BabylonModel from "./components/BabylonModel.vue";
import WebRTCStatus from "./components/WebRTCStatus.vue";
import BabylonDebugOverlay from "./components/BabylonDebugOverlay.vue";
// mark as used at runtime for template
void BabylonMyAvatar;
// mark as used at runtime for template
void BabylonOtherAvatar;
// mark as used at runtime for template
void BabylonModel;
// mark as used at runtime for template
void WebRTCStatus;
// mark as used at runtime for template
void BabylonDebugOverlay;
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
import { Inspector } from "@babylonjs/inspector";

import { useVircadiaInstance } from "@vircadia/world-sdk/browser/vue";

// Get Vircadia context once in setup
const vircadiaWorld = inject(useVircadiaInstance());

if (!vircadiaWorld) {
    throw new Error("Vircadia instance not found");
}

// Connection count is now managed by WebRTCStatus component
const webrtcStatus = ref<InstanceType<typeof WebRTCStatus> | null>(null);
const connectionCount = computed(
    () => webrtcStatus.value?.connectionCount || 0,
);

const connectionStatus = computed(
    () => vircadiaWorld.connectionInfo.value.status,
);
const sessionId = computed(() => vircadiaWorld.connectionInfo.value.sessionId);
const agentId = computed(() => vircadiaWorld.connectionInfo.value.agentId);

// Store access with error handling for timing issues
const appStore = useAppStore();

// sync session and agent IDs from Vircadia to the app store
watch(sessionId, (newSessionId) => {
    appStore.setSessionId(newSessionId ?? null);
});
watch(agentId, (newAgentId) => {
    appStore.setAgentId(newAgentId ?? null);
});

// Track if scene is initialized for template rendering
const sceneInitialized = ref(false);
// Track inspector state
const isInspectorVisible = ref(false);
// Track if avatar is ready
const avatarRef = ref<InstanceType<typeof BabylonMyAvatar> | null>(null);
const otherAvatarRefs = ref<(InstanceType<typeof BabylonOtherAvatar> | null)[]>(
    [],
);
const modelRefs = ref<(InstanceType<typeof BabylonModel> | null)[]>([]);

// Track other avatars
const otherAvatarSessionIds = ref<string[]>([]);

// Polling interval for discovering other avatars
let avatarDiscoveryInterval: number | null = null;

// Poll for other avatars every 500ms
async function pollForOtherAvatars() {
    if (
        !vircadiaWorld ||
        vircadiaWorld.connectionInfo.value.status !== "connected"
    ) {
        return;
    }

    try {
        const query = `SELECT general__entity_name FROM entity.entities WHERE general__entity_name LIKE 'avatar:%'`;

        const result = await vircadiaWorld.client.Utilities.Connection.query<
            Array<{ general__entity_name: string }>
        >({
            query,
            timeoutMs: 10000,
        });

        if (result.result) {
            const currentSessionId = sessionId.value;
            const foundSessionIds: string[] = [];

            for (const entity of result.result) {
                // Extract session ID from entity name (format: "avatar:sessionId")
                const match =
                    entity.general__entity_name.match(/^avatar:(.+)$/);
                if (match && match[1] !== currentSessionId) {
                    foundSessionIds.push(match[1]);
                }
            }

            // Update the list of other avatar session IDs
            otherAvatarSessionIds.value = foundSessionIds;
        }
    } catch (error) {
        console.warn("Error polling for other avatars:", error);
    }
}

// Start avatar discovery polling
function startAvatarDiscovery() {
    if (avatarDiscoveryInterval) {
        return;
    }

    // Poll every 500ms for other avatars
    avatarDiscoveryInterval = setInterval(pollForOtherAvatars, 500);
}

// Stop avatar discovery polling
function stopAvatarDiscovery() {
    if (avatarDiscoveryInterval) {
        clearInterval(avatarDiscoveryInterval);
        avatarDiscoveryInterval = null;
    }
}

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

// Add function to toggle the inspector
const toggleInspector = async (): Promise<void> => {
    if (!scene) return;

    if (!isInspectorVisible.value) {
        if (import.meta.env.DEV) {
            Inspector.Show(scene, { embedMode: true });
            isInspectorVisible.value = true;
        } else {
            console.warn("Inspector is only available in development mode");
        }
    } else {
        Inspector.Hide();
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
const otherAvatarsLoading = computed(
    () =>
        otherAvatarRefs.value.some(
            (avatar) => avatar && !avatar.isModelLoaded,
        ) ?? false,
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

// Global loading state: environment, avatar, other avatars, or models
const isLoading = computed(
    () =>
        environmentLoading.value ||
        avatarLoading.value ||
        otherAvatarsLoading.value ||
        modelsLoading.value,
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

// State for WebRTC dialog
const webrtcDialog = ref(false);

// State for debug overlay
const showDebugOverlay = ref(false);

// BabylonJS Setup - use variables instead of refs
const renderCanvas = ref<HTMLCanvasElement | null>(null);
// Using regular variables instead of refs for non-reactive engine and scene
let engine: WebGPUEngine | null = null;
let scene: Scene | null = null;

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

    // Stop avatar discovery polling
    stopAvatarDiscovery();

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
                // Start avatar discovery when connected
                startAvatarDiscovery();
            } else if (status === "disconnected") {
                console.log("Disconnected from Vircadia server");
                // Stop avatar discovery when disconnected
                stopAvatarDiscovery();
                // Clear other avatars list
                otherAvatarSessionIds.value = [];
                // Clear other avatars metadata from store
                appStore.clearOtherAvatarsMetadata();
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
