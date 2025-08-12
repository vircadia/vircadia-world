<template>
    <!-- Intro Screen when not authenticated -->
    <IntroScreen v-if="!isAuthenticated" />

    <template v-else>
        <!-- Component Loader -->
        <template v-for="comp in availableComponents" :key="comp">
            <component 
                :is="comp" 
                :scene="scene"
                :engine="engine"
                :canvas="renderCanvas"
                :app-store="appStore"
                :vircadia-world="vircadiaWorld"
                :connection-status="connectionStatus"
                :session-id="sessionId"
                :agent-id="agentId"
                :scene-initialized="sceneInitialized"
                :fps="fps"
                :performance-mode="performanceMode"
            />
        </template>

        <main>
            <BabylonCanvas
                ref="canvasComponentRef"
                v-model:performanceMode="performanceMode"
                v-model:fps="fps"
            />
            
            <!-- Snackbar for loading and connection status -->
            <v-snackbar v-model="snackbarVisible" :timeout="0" top>
                <div class="d-flex align-center">
                    <v-progress-circular v-if="isLoading" indeterminate color="white" size="24" class="mr-2" />
                    {{ snackbarText }}
                </div>
            </v-snackbar>
            
            <!-- Only render entities when scene is available and connection is stable -->
            <template v-if="sceneInitialized && scene && connectionStatus === 'connected' && !isConnecting">
                <!-- BabylonMyAvatar component -->
                <BabylonMyAvatar
                    :scene="sceneNonNull"
                    ref="avatarRef"
                />

                <!-- Other avatars wrapper -->
                <BabylonOtherAvatars
                    :scene="sceneNonNull"
                    ref="otherAvatarsRef"
                />

                <!-- BabylonModel components -->
                <BabylonModel
                    v-for="def in appStore.modelDefinitions"
                    :key="def.fileName"
                    :def="def"
                    :scene="sceneNonNull"
                    ref="modelRefs"
                />
            </template>
        </main>
        <!-- WebRTC component (hidden, just for functionality) -->
        <BabylonWebRTC 
            v-if="sessionId && appStore.instanceId" 
            :instance-id="appStore.instanceId" 
            ref="webrtcStatus" 
            style="display: none;"
        />
        
        <!-- Floating Control Toolbar -->
        <div class="floating-toolbar">
            <!-- User Info and Logout -->
            <div v-if="isAuthenticated" class="d-flex align-center flex-column ga-2">
                <v-chip>
                    <v-icon start>mdi-account-circle</v-icon>
                    {{ username }}
                </v-chip>
                <v-btn
                    color="error"
                    variant="outlined"
                    @click="handleLogout"
                    size="small"
                >
                    Sign Out
                </v-btn>
            </div>
            
            <!-- Debug Controls -->
            <v-tooltip bottom>
                <template v-slot:activator="{ props }">
                    <v-btn 
                        fab 
                        small
                        color="error" 
                        @click="showDebugOverlay = !showDebugOverlay"
                        v-bind="props"
                        class="toolbar-btn"
                    >
                        <v-icon>mdi-bug</v-icon>
                    </v-btn>
                </template>
                <span>Toggle Debug Overlay</span>
            </v-tooltip>
            
            
            
            <!-- Audio Controls -->
            <v-tooltip bottom>
                <template v-slot:activator="{ props }">
                    <v-btn 
                        fab 
                        small
                        color="primary" 
                        @click="audioDialog = true"
                        v-bind="props"
                        class="toolbar-btn"
                    >
                        <v-badge
                            v-if="activeAudioCount > 0"
                            :content="activeAudioCount"
                            color="success"
                            overlap
                        >
                            <v-icon>mdi-headphones</v-icon>
                        </v-badge>
                        <v-icon v-else>mdi-headphones</v-icon>
                    </v-btn>
                </template>
                <span>Audio Controls ({{ activeAudioCount }} active)</span>
            </v-tooltip>

            <!-- Babylon Inspector Toggle (dev only) -->
            <BabylonInspector :scene="sceneNonNull" />
        </div>
        
        <!-- Audio controls dialog -->
        <v-dialog v-model="audioDialog" max-width="600" eager>
            <AudioControlsDialog :webrtc-ref="webrtcStatus || undefined" />
        </v-dialog>
        
        <!-- Debug Joint Overlay -->
        <BabylonDebugOverlay 
            v-if="showDebugOverlay" 
            :visible="showDebugOverlay"
            @close="showDebugOverlay = false"
        />

    </template>
</template>

<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/consistent-type-imports */
import {
    computed,
    watch,
    ref,
    onMounted,
    onUnmounted,
    inject,
    getCurrentInstance,
    nextTick,
    type defineComponent,
} from "vue";
import BabylonMyAvatar from "../components/BabylonMyAvatar.vue";
import BabylonOtherAvatar from "../components/BabylonOtherAvatar.vue";
import BabylonOtherAvatars from "../components/BabylonOtherAvatars.vue";
import BabylonModel from "../components/BabylonModel.vue";
import BabylonWebRTC from "../components/BabylonWebRTC.vue";
import BabylonDebugOverlay from "../components/BabylonDebugOverlay.vue";
import BabylonInspector from "../components/BabylonInspector.vue";
import AudioControlsDialog from "../components/AudioControlsDialog.vue";
import IntroScreen from "../components/IntroScreen.vue";
import BabylonCanvas from "../components/BabylonCanvas.vue";
// mark as used at runtime for template
void BabylonMyAvatar;
// mark as used at runtime for template
void BabylonOtherAvatar;
// mark as used at runtime for template
void BabylonOtherAvatars;
// mark as used at runtime for template
void BabylonModel;
// mark as used at runtime for template
void BabylonWebRTC;
// mark as used at runtime for template
void BabylonDebugOverlay;
// mark as used at runtime for template
void BabylonInspector;
// mark as used at runtime for template
void AudioControlsDialog;
// mark as used at runtime for template
void IntroScreen;
import { useBabylonEnvironment } from "../composables/useBabylonEnvironment";
import { useAppStore } from "@/stores/appStore";

// BabylonJS types
import type { Scene, WebGPUEngine } from "@babylonjs/core";

import { useVircadiaInstance } from "@vircadia/world-sdk/browser/vue";

// Get Vircadia context once in setup
const vircadiaWorld = inject(useVircadiaInstance());

if (!vircadiaWorld) {
    throw new Error("Vircadia instance not found");
}

// Connection Management State (moved from connectionManager.ts)
// Track if we're currently trying to connect to avoid connection loops
const isConnecting = ref(false);

// Track the last token we connected with to detect changes
const lastConnectedToken = ref<string | null>(null);
const lastConnectedAgentId = ref<string | null>(null);

// Connection Management Functions (moved from connectionManager.ts)
/**
 * Attempts to connect with the current authentication state
 */
async function attemptConnection() {
    if (isConnecting.value) {
        console.log("[ConnectionManager] Already connecting, skipping");
        return;
    }

    // Get current auth token from app store only
    const currentToken = appStore.sessionToken;
    const currentAgentId = appStore.agentId;

    // Check if we have a valid token
    if (!currentToken) {
        console.log(
            "[ConnectionManager] No token available, staying disconnected",
        );
        ensureDisconnected();
        return;
    }

    if (!vircadiaWorld) {
        console.error("[ConnectionManager] No Vircadia instance found");
        return;
    }

    // Check if we're already connected with the same token and agent
    const connectionInfo = vircadiaWorld.connectionInfo.value;
    if (
        connectionInfo.isConnected &&
        lastConnectedToken.value === currentToken &&
        lastConnectedAgentId.value === currentAgentId
    ) {
        console.log(
            "[ConnectionManager] Already connected with current credentials",
        );
        return;
    }

    console.log("[ConnectionManager] Attempting connection...", {
        hasToken: !!currentToken,
        agentId: currentAgentId,
        currentStatus: connectionInfo.status,
        isConnected: connectionInfo.isConnected,
    });

    isConnecting.value = true;

    try {
        // Always disconnect first to ensure clean state
        if (connectionInfo.isConnected || connectionInfo.isConnecting) {
            console.log(
                "[ConnectionManager] Disconnecting existing connection",
            );
            vircadiaWorld.client.Utilities.Connection.disconnect();
            // Wait a bit for disconnect to complete
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Update the client config with current token
        // Use the provider from the auth store instead of deriving from account environment
        const authProvider = appStore.getCurrentAuthProvider;

        // Update client configuration
        vircadiaWorld.client.setAuthToken(currentToken);
        vircadiaWorld.client.setAuthProvider(authProvider);

        // Attempt connection
        await vircadiaWorld.client.Utilities.Connection.connect({
            timeoutMs: 15000, // 15 second timeout
        });

        // Store the token we successfully connected with
        lastConnectedToken.value = currentToken;
        lastConnectedAgentId.value = currentAgentId;

        console.log("[ConnectionManager] Connection successful");
    } catch (error) {
        console.error("[ConnectionManager] Connection failed:", error);

        // Clear last connected token on failure
        lastConnectedToken.value = null;
        lastConnectedAgentId.value = null;

        // Set app store error if it's an auth-related error
        if (error instanceof Error) {
            if (
                error.message.includes("Authentication") ||
                error.message.includes("401") ||
                error.message.includes("Invalid token")
            ) {
                appStore.setError(
                    "Authentication failed. Please try logging in again.",
                );
                // Clear authentication state to redirect back to IntroScreen
                appStore.logout();
            }
        }
    } finally {
        isConnecting.value = false;
    }
}

/**
 * Ensures the connection is disconnected and clears state
 */
function ensureDisconnected() {
    if (!vircadiaWorld) {
        console.error("[ConnectionManager] No Vircadia instance found");
        return;
    }

    const connectionInfo = vircadiaWorld.connectionInfo.value;

    if (connectionInfo.isConnected || connectionInfo.isConnecting) {
        console.log("[ConnectionManager] Disconnecting...");
        vircadiaWorld.client.Utilities.Connection.disconnect();
    }

    lastConnectedToken.value = null;
    lastConnectedAgentId.value = null;
}

/**
 * Handles authentication state changes
 */
function handleAuthChange() {
    console.log("[ConnectionManager] Auth state changed:", {
        isAuthenticated: appStore.isAuthenticated,
        hasSessionToken: !!appStore.sessionToken,
        agentId: appStore.agentId,
    });

    if (appStore.isAuthenticated) {
        // We have authentication, attempt connection
        attemptConnection();
    } else {
        // No authentication, ensure disconnected
        console.log("[ConnectionManager] No valid auth, disconnecting");
        ensureDisconnected();
    }
}

// Connection count is now managed by BabylonWebRTC component
const webrtcStatus = ref<InstanceType<typeof BabylonWebRTC> | null>(null);
const connectionCount = computed(() => webrtcStatus.value?.peers.size || 0);

// Active audio connections from app store
const activeAudioCount = computed(() => appStore.activeAudioConnectionsCount);

const connectionStatus = computed(
    () => vircadiaWorld.connectionInfo.value.status,
);
const sessionId = computed(() => vircadiaWorld.connectionInfo.value.sessionId);
const agentId = computed(() => vircadiaWorld.connectionInfo.value.agentId);

// Store access with error handling for timing issues
const appStore = useAppStore();
const isAuthenticated = computed(() => appStore.isAuthenticated);
const isAuthenticating = computed(() => appStore.isAuthenticating);

const username = computed(() => {
    if (!appStore.account) return "Not signed in";
    return (
        appStore.account.username ||
        appStore.account.name ||
        appStore.account.idTokenClaims?.preferred_username ||
        appStore.account.idTokenClaims?.name ||
        appStore.account.localAccountId
    );
});

const handleLogout = () => {
    appStore.logout();
};

// sync session and agent IDs from Vircadia to the app store
watch(sessionId, (newSessionId) => {
    appStore.setSessionId(newSessionId ?? null);
});
watch(agentId, (newAgentId) => {
    appStore.setAgentId(newAgentId ?? null);
});

// Scene readiness derived from BabylonCanvas exposed API
// Track if avatar is ready
const avatarRef = ref<InstanceType<typeof BabylonMyAvatar> | null>(null);
type OtherAvatarsExposed = { isLoading: boolean };
const otherAvatarsRef = ref<OtherAvatarsExposed | null>(null);
const modelRefs = ref<(InstanceType<typeof BabylonModel> | null)[]>([]);

// Other avatar discovery handled by BabylonOtherAvatars wrapper

// Physics handled by BabylonCanvas

// State for debug overlay
const showDebugOverlay = ref(false);

// Babylon managed by BabylonCanvas
// Use the exposed API from BabylonCanvas via a component ref instead of local refs
type BabylonCanvasExposed = {
    getScene: () => Scene | null;
    getEngine: () => WebGPUEngine | null;
    getCanvas: () => HTMLCanvasElement | null;
    getFps: () => number;
    getPerformanceMode: () => "normal" | "low";
    getIsReady: () => boolean;
    startRenderLoop: () => void;
    stopRenderLoop: () => void;
    togglePerformanceMode: () => void;
    setPerformanceMode: (mode: "normal" | "low") => void;
};

const canvasComponentRef = ref<BabylonCanvasExposed | null>(null);

const renderCanvas = computed(
    () => canvasComponentRef.value?.getCanvas() ?? null,
);
// Depend on readiness so these recompute once the canvas initializes
const engine = computed(
    () =>
        (canvasComponentRef.value?.getIsReady()
            ? canvasComponentRef.value?.getEngine()
            : null) ?? null,
);
const scene = computed(
    () =>
        (canvasComponentRef.value?.getIsReady()
            ? canvasComponentRef.value?.getScene()
            : null) ?? null,
);
const sceneNonNull = computed(() => scene.value as unknown as Scene);
const sceneInitialized = computed(
    () => canvasComponentRef.value?.getIsReady() ?? false,
);
void renderCanvas;
void engine;
void sceneNonNull;
const performanceMode = ref<"normal" | "low">("low");
const fps = ref<number>(0);

// FPS sampling removed; now handled by BabylonCanvas via v-model:fps

// Ready callback no longer needed; scene readiness comes from the canvas API

onMounted(async () => {
    const instanceId = appStore.generateInstanceId();
    console.log(`[App] Generated instance ID: ${instanceId}`);
    console.log("[ConnectionManager] Connection manager initialized");
});

// No onUnmounted reset needed; canvas manages its own ready state

// Watch for authentication state changes (moved from connectionManager.ts)
watch(
    () => ({
        isAuthenticated: appStore.isAuthenticated,
        sessionToken: appStore.sessionToken,
        agentId: appStore.agentId,
        account: appStore.account,
    }),
    handleAuthChange,
    { immediate: true, deep: true },
);

// Watch for connection state changes to detect disconnections (moved from connectionManager.ts)
watch(
    () => vircadiaWorld!.connectionInfo.value.status,
    (newStatus, oldStatus) => {
        console.log(
            "[ConnectionManager] Connection status changed:",
            oldStatus,
            "->",
            newStatus,
        );

        // If we unexpectedly disconnected and should be connected, try to reconnect
        if (
            newStatus === "disconnected" &&
            oldStatus === "connected" &&
            appStore.isAuthenticated &&
            !isConnecting.value
        ) {
            console.log(
                "[ConnectionManager] Unexpected disconnection, attempting reconnect",
            );
            setTimeout(() => {
                attemptConnection();
            }, 2000); // Wait 2 seconds before retry
        }
    },
);

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
        if (initialized && status === "connected" && scene.value) {
            loadEnvironments(scene.value as unknown as Scene);
            // BabylonModel components auto-load themselves when scene is set
        }
    },
);

// Start the render loop after avatar is ready
const startRenderLoop = () => {
    console.log("Starting render loop after avatar is ready");
    canvasComponentRef.value?.startRenderLoop();
};

// Stop the render loop when the avatar unmounts
const stopRenderLoop = () => {
    console.log("Stopping render loop before avatar unmount");
    canvasComponentRef.value?.stopRenderLoop();
};

// Keyboard toggle handled inside BabylonCanvas

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
    () => otherAvatarsRef.value?.isLoading ?? false,
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

// snackbarVisible is driven by scene initialization, connection status and loading, add noop setter to satisfy v-model
const snackbarVisible = computed<boolean>({
    get: () =>
        !sceneInitialized.value ||
        connectionStatus.value !== "connected" ||
        isLoading.value ||
        isConnecting.value ||
        !isAuthenticated.value,
    set: (_val: boolean) => {
        // no-op setter: visibility is derived from scene initialization, connection status and loading
    },
});
const snackbarText = computed(() => {
    const states = [];

    // Scene initialization
    if (!sceneInitialized.value) {
        states.push("• Scene: Initializing");
    } else {
        states.push("• Scene: Ready");
    }

    // Connection status
    if (isConnecting.value) {
        states.push("• Connection: Connecting");
    } else {
        states.push(`• Connection: ${connectionStatus.value}`);
    }

    // Individual loading states
    if (environmentLoading.value) {
        states.push("• Environment: Loading");
    } else {
        states.push("• Environment: Ready");
    }

    if (avatarLoading.value) {
        states.push("• Avatar: Loading");
    } else {
        states.push("• Avatar: Ready");
    }

    if (otherAvatarsLoading.value) {
        states.push("• Other Avatars: Loading");
    } else {
        states.push("• Other Avatars: Ready");
    }

    if (modelsLoading.value) {
        states.push("• Models: Loading");
    } else {
        states.push("• Models: Ready");
    }

    if (isAuthenticating.value) {
        states.push("• Authentication: Authenticating");
    } else {
        states.push("• Authentication: Authenticated");
    }

    return states.join("\n");
});

// State for WebRTC dialog
const webrtcDialog = ref(false);

// State for Audio dialog
const audioDialog = ref(false);

// Component Loader
const app = getCurrentInstance();
const availableComponents = ref<
    (string | ReturnType<typeof defineComponent>)[]
>([]);

onMounted(() => {
    if (app) {
        availableComponents.value = Object.keys(app.appContext.components);
    }
});
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

/* Floating Toolbar Styles */
.floating-toolbar {
    position: fixed;
    top: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 1000;
    padding: 8px;
    background: rgba(0, 0, 0, 0.1);
    border-radius: 28px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.toolbar-btn {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
    transition: all 0.2s ease !important;
}

.toolbar-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
}

.component-loader {
    position: fixed;
    bottom: 16px;
    left: 16px;
    width: 300px;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.2);
    padding: 10px;
    border-radius: 8px;
}

.component-container {
    margin-top: 10px;
    padding: 10px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
}

/* Responsive design for smaller screens */
@media (max-width: 768px) {
    .floating-toolbar {
        top: 12px;
        right: 12px;
        gap: 6px;
        padding: 6px;
    }
}

@media (max-width: 480px) {
    .floating-toolbar {
        flex-direction: row;
        top: 8px;
        right: 8px;
        left: 8px;
        justify-content: center;
        border-radius: 24px;
    }
}
</style>
