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
            v-slot="{ vircadiaWorld, connectionStatus, isConnecting, isAuthenticated, isAuthenticating, accountDisplayName, sessionId, agentId, instanceId }">
        <!-- Sync slot values to refs for script usage -->
        <div style="display: none">
            {{ vircadiaWorldRef = vircadiaWorld }}
            
            {{ sessionIdRef = sessionId }}
            {{ agentIdRef = agentId }}
            {{ instanceIdRef = instanceId }}
        </div>
        <!-- Component Loader -->
        <template v-for="comp in availableComponents" :key="comp">
            <component 
                :is="comp" 
                :scene="scene"
                :engine="engine"
                :canvas="renderCanvas"
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
                environment-entity-name="babylon.environment.default"
                ref="envRef"
                v-slot="{ isLoading }"
            >
                <!-- Only render entities when scene is available and connection is stable -->
                <template v-if="sceneInitialized && scene && connectionStatus === 'connected' && !isConnecting">
                    <!-- BabylonMyAvatar component -->
                    <BabylonMyAvatar
                        :scene="sceneNonNull"
                        :vircadia-world="vircadiaWorld"
                        :instance-id="instanceId || undefined"
                        :avatar-definition="avatarDefinition"
                        ref="avatarRef"
                    >
                    </BabylonMyAvatar>

                    <!-- Other avatars wrapper -->
                    <BabylonOtherAvatars
                        :scene="sceneNonNull"
                        :vircadia-world="vircadiaWorld"
                        :current-full-session-id="sessionId && instanceId ? `${sessionId}-${instanceId}` : null"
                        v-model:otherAvatarsMetadata="otherAvatarsMetadata"
                        ref="otherAvatarsRef"
                    />

                    <!-- BabylonModel components provided by DB-scanned list -->
                    <BabylonModels :vircadia-world="vircadiaWorld" v-slot="{ models }">
                        <BabylonModel
                            v-for="def in models"
                            :key="def.fileName"
                            :def="def"
                            :scene="sceneNonNull"
                            :vircadia-world="vircadiaWorld"
                            ref="modelRefs"
                        />
                    </BabylonModels>
                </template>
            </BabylonEnvironment>
        </main>
        <!-- WebRTC component (hidden, just for functionality) -->
        <BabylonWebRTC 
            v-if="sessionId && instanceId" 
            :instance-id="instanceId" 
            :vircadia-world="vircadiaWorld"
            :other-avatars-metadata="otherAvatarsMetadata"
            :on-set-peer-audio-state="setPeerAudioState"
            :on-remove-peer-audio-state="removePeerAudioState"
            :on-set-peer-volume="setPeerVolume"
            :on-clear-peer-audio-states="clearPeerAudioStates"
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
                <LogoutButton 
                    :isAuthenticated="isAuthenticated"
                    :onLogout="authProps.logout"
                />
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
            <AudioControlsDialog 
                :webrtc-ref="webrtcStatus || undefined"
                :spatial-audio-enabled="spatialAudioEnabled"
                :on-toggle-spatial-audio="toggleSpatialAudio"
                :active-peer-audio-states="activePeerAudioStates"
                :get-peer-audio-state="getPeerAudioState"
                :on-set-peer-volume="setPeerVolume"
                :on-set-peer-muted="setPeerMuted"
            />
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
import BabylonModels from "../components/BabylonModels.vue";
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
void BabylonModels;
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
import { clientBrowserConfiguration } from "@/vircadia.browser.config";

// BabylonJS types
import type { Scene, WebGPUEngine } from "@babylonjs/core";

// Auth change handling moved to provider

// Local avatar definition to ensure animations are present
const avatarDefinition = {
    initialAvatarPosition: { x: 0, y: 0, z: -5 },
    initialAvatarRotation: { x: 0, y: 0, z: 0, w: 1 },
    initialAvatarCameraOrientation: {
        alpha: -Math.PI / 2,
        beta: Math.PI / 3,
        radius: 5,
    },
    modelFileName: "babylon.avatar.glb",
    meshPivotPoint: "bottom" as const,
    throttleInterval: 500,
    capsuleHeight: 1.8,
    capsuleRadius: 0.3,
    slopeLimit: 45,
    jumpSpeed: 5,
    debugBoundingBox: false,
    debugSkeleton: true,
    debugAxes: false,
    walkSpeed: 1.47,
    turnSpeed: Math.PI,
    blendDuration: 0.15,
    gravity: -9.8,
    animations: [
        { fileName: "babylon.avatar.animation.f.idle.1.glb" },
        { fileName: "babylon.avatar.animation.f.idle.2.glb" },
        { fileName: "babylon.avatar.animation.f.idle.3.glb" },
        { fileName: "babylon.avatar.animation.f.idle.4.glb" },
        { fileName: "babylon.avatar.animation.f.idle.5.glb" },
        { fileName: "babylon.avatar.animation.f.idle.6.glb" },
        { fileName: "babylon.avatar.animation.f.idle.7.glb" },
        { fileName: "babylon.avatar.animation.f.idle.8.glb" },
        { fileName: "babylon.avatar.animation.f.idle.9.glb" },
        { fileName: "babylon.avatar.animation.f.idle.10.glb" },
        { fileName: "babylon.avatar.animation.f.walk.1.glb" },
        { fileName: "babylon.avatar.animation.f.walk.2.glb" },
        { fileName: "babylon.avatar.animation.f.crouch_strafe_left.glb" },
        { fileName: "babylon.avatar.animation.f.crouch_strafe_right.glb" },
        { fileName: "babylon.avatar.animation.f.crouch_walk_back.glb" },
        { fileName: "babylon.avatar.animation.f.crouch_walk.glb" },
        { fileName: "babylon.avatar.animation.f.falling_idle.1.glb" },
        { fileName: "babylon.avatar.animation.f.falling_idle.2.glb" },
        { fileName: "babylon.avatar.animation.f.jog_back.glb" },
        { fileName: "babylon.avatar.animation.f.jog.glb" },
        { fileName: "babylon.avatar.animation.f.jump_small.glb" },
        { fileName: "babylon.avatar.animation.f.jump.glb" },
        { fileName: "babylon.avatar.animation.f.run_back.glb" },
        { fileName: "babylon.avatar.animation.f.run_strafe_left.glb" },
        { fileName: "babylon.avatar.animation.f.run_strafe_right.glb" },
        { fileName: "babylon.avatar.animation.f.run.glb" },
        { fileName: "babylon.avatar.animation.f.strafe_left.glb" },
        { fileName: "babylon.avatar.animation.f.strafe_right.glb" },
        { fileName: "babylon.avatar.animation.f.talking.1.glb" },
        { fileName: "babylon.avatar.animation.f.talking.2.glb" },
        { fileName: "babylon.avatar.animation.f.talking.3.glb" },
        { fileName: "babylon.avatar.animation.f.talking.4.glb" },
        { fileName: "babylon.avatar.animation.f.talking.5.glb" },
        { fileName: "babylon.avatar.animation.f.talking.6.glb" },
        { fileName: "babylon.avatar.animation.f.walk_back.glb" },
        { fileName: "babylon.avatar.animation.f.walk_jump.1.glb" },
        { fileName: "babylon.avatar.animation.f.walk_jump.2.glb" },
        { fileName: "babylon.avatar.animation.f.walk_strafe_left.glb" },
        { fileName: "babylon.avatar.animation.f.walk_strafe_right.glb" },
    ],
};

// Connection count is now managed by BabylonWebRTC component
const webrtcStatus = ref<InstanceType<typeof BabylonWebRTC> | null>(null);
void webrtcStatus;
// const connectionCount = computed(() => webrtcStatus.value?.peers.size || 0);

// Active audio connections derived from WebRTC peers
const activeAudioCount = computed(() => webrtcStatus.value?.peers?.size ?? 0);
void activeAudioCount;

// Track slot values in refs for script usage
const vircadiaWorldRef = ref<unknown>(null);
const sessionIdRef = ref<string | null>(null);
const agentIdRef = ref<string | null>(null);
const instanceIdRef = ref<string | null>(null);
// These are synced from template but not directly used in script
void vircadiaWorldRef;
void sessionIdRef;
void agentIdRef;
void instanceIdRef;

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
void avatarDefinition;

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

// Local audio state (replaces store for dialog)
type PeerAudioState = {
    sessionId: string;
    volume: number;
    isMuted: boolean;
    isReceiving: boolean;
    isSending: boolean;
};
const spatialAudioEnabled = ref(false);
const peerAudioStates = ref<Record<string, PeerAudioState>>({});
const activePeerAudioStates = computed(() =>
    Object.values(peerAudioStates.value).filter(
        (p) => p.isReceiving || p.isSending,
    ),
);
const getPeerAudioState = (sessionId: string): PeerAudioState | null =>
    peerAudioStates.value[sessionId] || null;
function setPeerAudioState(sessionId: string, state: Partial<PeerAudioState>) {
    if (!peerAudioStates.value[sessionId]) {
        peerAudioStates.value[sessionId] = {
            sessionId,
            volume: 100,
            isMuted: false,
            isReceiving: false,
            isSending: false,
        };
    }
    Object.assign(peerAudioStates.value[sessionId], state);
}
function removePeerAudioState(sessionId: string) {
    delete peerAudioStates.value[sessionId];
}
function setPeerVolume(sessionId: string, volume: number) {
    if (peerAudioStates.value[sessionId]) {
        peerAudioStates.value[sessionId].volume = volume;
    }
}
function setPeerMuted(sessionId: string, muted: boolean) {
    if (peerAudioStates.value[sessionId]) {
        peerAudioStates.value[sessionId].isMuted = muted;
    }
}
function clearPeerAudioStates() {
    peerAudioStates.value = {};
}
function toggleSpatialAudio(enabled: boolean) {
    spatialAudioEnabled.value = enabled;
}

// Mark dialog helpers used in template
void activePeerAudioStates;
void getPeerAudioState;
void setPeerAudioState;
void removePeerAudioState;
void setPeerVolume;
void setPeerMuted;
void clearPeerAudioStates;
void toggleSpatialAudio;

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
