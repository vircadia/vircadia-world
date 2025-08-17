<template>
    <VircadiaWorldAuthProvider v-slot="authProps">
        <VircadiaWorldProvider 
            :sessionToken="authProps.sessionToken"
            :agentId="authProps.agentId"
            :authProvider="authProps.authProvider"
            :isAuthenticated="authProps.isAuthenticated"
            :account="authProps.account"
            :isAuthenticating="authProps.isAuthenticating"
            :authError="authProps.authError"
            :autoConnect="clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_AUTO_CONNECT"
            v-slot="{ vircadiaWorld, connectionStatus, isConnecting, isAuthenticated, isAuthenticating, accountDisplayName, sessionId, agentId }">
        <!-- Sync slot values to refs for script usage -->
        <div style="display: none">
            {{ vircadiaWorldRef = vircadiaWorld }}
            
            {{ sessionIdRef = sessionId }}
            {{ agentIdRef = agentId }}
        </div>
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

            <BabylonSnackbar
                :scene-initialized="sceneInitialized"
                :connection-status="connectionStatus"
                :is-connecting="isConnecting"
                :environment-loading="environmentLoading"
                :avatar-loading="avatarLoading"
                :other-avatars-loading="otherAvatarsLoading"
                :models-loading="modelsLoading"
                :is-authenticating="isAuthenticating"
                :is-authenticated="isAuthenticated"
            />
            
            <BabylonEnvironment
                v-if="sceneInitialized && scene && connectionStatus === 'connected' && !isConnecting"
                :scene="sceneNonNull"
                :vircadia-world="vircadiaWorld"
                :hdr-files="appStore.hdrList"
                ref="envRef"
                v-slot="{ isLoading }"
            >
                <!-- Only render entities when scene is available and connection is stable -->
                <template v-if="sceneInitialized && scene && connectionStatus === 'connected' && !isConnecting">
                    <!-- BabylonMyAvatar component -->
                    <BabylonMyAvatar
                        :scene="sceneNonNull"
                        :vircadia-world="vircadiaWorld"
                        ref="avatarRef"
                    />

                    <!-- Other avatars wrapper -->
                    <BabylonOtherAvatars
                        :scene="sceneNonNull"
                        :vircadia-world="vircadiaWorld"
                        v-model:otherAvatarsMetadata="otherAvatarsMetadata"
                        ref="otherAvatarsRef"
                    />

                    <!-- BabylonModel components provided by DB-scanned list -->
                <BabylonModels :vircadia-world="vircadiaWorld" v-slot="{ models }">
                    <BabylonModel
                        v-for="def in models"
                        :key="def.entityName || def.fileName"
                        :def="def"
                        :scene="scene"
                        ref="modelRefs"
                    />
                </BabylonModels>
                </template>
            </BabylonEnvironment>
        </main>
        <!-- WebRTC component (hidden, just for functionality) -->
        <BabylonWebRTC 
            v-if="sessionId && appStore.instanceId" 
            :instance-id="appStore.instanceId" 
            :vircadia-world="vircadiaWorld"
            :other-avatars-metadata="otherAvatarsMetadata"
            ref="webrtcStatus" 
            style="display: none;"
        />
        
        <!-- Floating Control Toolbar -->
        <div class="floating-toolbar">
            <!-- User Info and Logout -->
            <div v-if="isAuthenticated" class="d-flex align-center flex-column ga-2">
                <v-chip>
                    <v-icon start>mdi-account-circle</v-icon>
                    {{ accountDisplayName }}
                </v-chip>
                <LogoutButton />
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
        </VircadiaWorldProvider>
    </VircadiaWorldAuthProvider>
</template>

<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/consistent-type-imports */
import {
    computed,
    ref,
    onMounted,
    getCurrentInstance,
    type defineComponent,
} from "vue";
import BabylonMyAvatar from "../components/BabylonMyAvatar.vue";
import BabylonOtherAvatars from "../components/BabylonOtherAvatars.vue";
import BabylonModel from "../components/BabylonModel.vue";
import BabylonWebRTC from "../components/BabylonWebRTC.vue";
import BabylonDebugOverlay from "../components/BabylonDebugOverlay.vue";
import BabylonInspector from "../components/BabylonInspector.vue";
import AudioControlsDialog from "../components/AudioControlsDialog.vue";
import VircadiaWorldAuthProvider from "../components/VircadiaWorldAuthProvider.vue";
import BabylonCanvas from "../components/BabylonCanvas.vue";
import BabylonSnackbar from "../components/BabylonSnackbar.vue";
import LogoutButton from "../components/LogoutButton.vue";
import VircadiaWorldProvider from "../components/VircadiaWorldProvider.vue";
// mark as used at runtime for template
void BabylonMyAvatar;
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
void VircadiaWorldAuthProvider;
// mark as used at runtime for template
void BabylonSnackbar;
// mark as used at runtime for template
void LogoutButton;
// mark as used at runtime for template
void BabylonCanvas;
// mark as used at runtime for template
void VircadiaWorldProvider;
import BabylonEnvironment from "../components/BabylonEnvironment.vue";
import { useAppStore } from "@/stores/appStore";
import { clientBrowserConfiguration } from "@/vircadia.browser.config";

// BabylonJS types
import type { Scene, WebGPUEngine } from "@babylonjs/core";

// Auth change handling moved to provider

// Store access with error handling for timing issues
const appStore = useAppStore();

// Connection count is now managed by BabylonWebRTC component
const webrtcStatus = ref<InstanceType<typeof BabylonWebRTC> | null>(null);
void webrtcStatus;
// const connectionCount = computed(() => webrtcStatus.value?.peers.size || 0);

// Active audio connections from app store
const activeAudioCount = computed(() => appStore.activeAudioConnectionsCount);
void activeAudioCount;

// Track slot values in refs for script usage
const vircadiaWorldRef = ref<unknown>(null);
const sessionIdRef = ref<string | null>(null);
const agentIdRef = ref<string | null>(null);
// These are synced from template but not directly used in script
void vircadiaWorldRef;
void sessionIdRef;
void agentIdRef;

// Auth state now handled via slot props from VircadiaWorldProvider in the template

// Session/agent syncing handled by provider

// Scene readiness derived from BabylonCanvas exposed API
// Track if avatar is ready
const avatarRef = ref<InstanceType<typeof BabylonMyAvatar> | null>(null);
type OtherAvatarsExposed = { isLoading: boolean };
const otherAvatarsRef = ref<OtherAvatarsExposed | null>(null);
const otherAvatarsMetadata = ref<
    Record<string, import("@/composables/schemas").AvatarMetadata>
>({});
void otherAvatarsMetadata;
const modelRefs = ref<(InstanceType<typeof BabylonModel> | null)[]>([]);

// Other avatar discovery handled by BabylonOtherAvatars wrapper

// Physics handled by BabylonCanvas

// State for debug overlay
const showDebugOverlay = ref(false);
void showDebugOverlay;

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
void sceneInitialized;
const performanceMode = ref<"normal" | "low">("low");
const fps = ref<number>(0);
void performanceMode;
void fps;

// FPS sampling removed; now handled by BabylonCanvas via v-model:fps

// Ready callback no longer needed; scene readiness comes from the canvas API

onMounted(async () => {
    const instanceId = appStore.generateInstanceId();
    console.log(`[App] Generated instance ID: ${instanceId}`);
    console.log("[MainScene] Initialized");
});

// No onUnmounted reset needed; canvas manages its own ready state

// Connection watchers migrated to provider

// Variables referenced only in template - mark to satisfy linter
void activeAudioCount;
void otherAvatarsMetadata;
void showDebugOverlay;
void performanceMode;
void fps;

// Keyboard toggle handled inside BabylonCanvas

const envRef = ref<InstanceType<typeof BabylonEnvironment> | null>(null);
const environmentLoading = computed(() => {
    const exposed = envRef.value as unknown as {
        isLoading?: { value: boolean };
    } | null;
    return exposed?.isLoading?.value ?? false;
});
void envRef;
void environmentLoading;

// Child component loading states
const avatarLoading = computed(
    () =>
        (avatarRef.value?.isCreating || avatarRef.value?.isRetrieving) ?? false,
);
void avatarLoading;
const otherAvatarsLoading = computed(
    () => otherAvatarsRef.value?.isLoading ?? false,
);
void otherAvatarsLoading;
const modelsLoading = computed(() =>
    modelRefs.value.some(
        (m) =>
            (m?.isEntityCreating ||
                m?.isEntityRetrieving ||
                m?.isAssetLoading) ??
            false,
    ),
);
void modelsLoading;

// Snackbar logic moved into BabylonSnackbar component

// State for Audio dialog
const audioDialog = ref(false);
void audioDialog;

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
// mark components/config used in template
void BabylonEnvironment;
void clientBrowserConfiguration;
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
