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
            @auth-denied="onAuthDenied($event, authProps)"
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
                :session-id="sessionId ?? undefined"
                :agent-id="agentId ?? undefined"
                :scene-initialized="sceneInitialized"
                :fps="fps"
                :performance-mode="performanceMode"
            />
        </template>

        <!-- Dev Debug App Bar -->
        <v-app-bar
            v-if="clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG"
            density="comfortable"
            color="primary"
            flat
        >
            <v-app-bar-title>Debug</v-app-bar-title>
            <v-spacer />
            <v-btn
                variant="tonal"
                :color="jointOverlayOpen ? 'error' : 'default'"
                prepend-icon="mdi-bug"
                @click="jointOverlayOpen = !jointOverlayOpen"
            >
                Joints
            </v-btn>
            <v-btn
                variant="tonal"
                :color="cameraDebugOpen ? 'error' : 'default'"
                prepend-icon="mdi-video"
                @click="cameraDebugOpen = !cameraDebugOpen"
                class="ml-2"
            >
                Camera
            </v-btn>
            <v-btn
                variant="tonal"
                :color="avatarDebugOpen ? 'error' : 'default'"
                prepend-icon="mdi-account-eye"
                @click="avatarDebugOpen = !avatarDebugOpen"
                class="ml-2"
            >
                Avatar
            </v-btn>
            <v-btn
                variant="tonal"
                :color="animDebugOpen ? 'error' : 'default'"
                prepend-icon="mdi-motion-outline"
                @click="animDebugOpen = !animDebugOpen"
                class="ml-2"
            >
                Anim
            </v-btn>
        </v-app-bar>

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
                :avatar-model-step="avatarModelStep"
                :avatar-model-error="avatarModelError"
                :model-file-name="modelFileNameRef"
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
                    <!-- BabylonMyAvatar component wrapped with MKB controller -->
                    <BabylonMyAvatarMKBController
                        :scene="sceneNonNull"
                        :forward-codes="['KeyW','ArrowUp']"
                        :backward-codes="['KeyS','ArrowDown']"
                        :strafe-left-codes="['KeyA','ArrowLeft']"
                        :strafe-right-codes="['KeyD','ArrowRight']"
                        :jump-codes="['Space']"
                        :sprint-codes="['ShiftLeft','ShiftRight']"
                        :dash-codes="[]"
                        :turn-left-codes="['KeyQ']"
                        :turn-right-codes="['KeyE']"
                        :fly-mode-toggle-codes="['KeyF']"
                        :crouch-toggle-codes="['KeyC']"
                        :prone-toggle-codes="['KeyZ']"
                        :slow-run-toggle-codes="['CapsLock']"
                        v-slot="controls"
                    >
                        <BabylonMyAvatar
                            :scene="sceneNonNull"
                            :vircadia-world="vircadiaWorld"
                            :instance-id="instanceId ?? undefined"
                            :key-state="controls.keyState"
                            avatar-definition-name="avatar.definition.default"
                            ref="avatarRef"
                        >
                            <template #default="{ avatarSkeleton, animations, vircadiaWorld, onAnimationState, avatarNode, modelFileName, meshPivotPoint, capsuleHeight, onSetAvatarModel }">
                                <BabylonMyAvatarModel
                                    v-if="modelFileName"
                                    :scene="sceneNonNull"
                                    :vircadia-world="vircadiaWorld"
                                    :avatar-node="(avatarNode as any) || null"
                                    :model-file-name="modelFileName"
                                    :mesh-pivot-point="meshPivotPoint"
                                    :capsule-height="capsuleHeight"
                                    :on-set-avatar-model="onSetAvatarModel as any"
                                    :animations="animations"
                                    :on-animation-state="onAnimationState as any"
                                    @state="onAvatarModelState"
                                    v-slot="{ targetSkeleton }"
                                >
                                    <!-- Renderless desktop third-person camera -->
                                    <BabylonMyAvatarDesktopThirdPersonCamera
                                        :scene="sceneNonNull"
                                        :avatar-node="(avatarNode as any) || null"
                                        :capsule-height="capsuleHeight"
                                    />
                                    <!-- Non-visual animation loaders now slotted under model component -->
                                    <BabylonMyAvatarAnimation
                                        v-for="anim in animations"
                                        v-if="targetSkeleton"
                                        :key="anim.fileName"
                                        :scene="sceneNonNull"
                                        :vircadia-world="vircadiaWorld"
                                        :animation="anim"
                                        :target-skeleton="targetSkeleton"
                                        @state="onAnimationState"
                                    />
                                    <!-- Debug overlay for avatar -->
                                    <BabylonMyAvatarDebugOverlay
                                        :scene="sceneNonNull"
                                        :vircadia-world="vircadiaWorld"
                                        :avatar-node="(avatarNode as any) || null"
                                        :avatar-skeleton="(avatarSkeleton as any) || null"
                                        :model-file-name="modelFileNameRef || modelFileName"
                                        :model-step="avatarModelStep"
                                        :model-error="avatarModelError || undefined"
                                        v-model="avatarDebugOpen"
                                        hotkey="Shift+M"
                                    />
                                    <!-- Camera debug overlay -->
                                    <BabylonCameraDebugOverlay
                                        v-model="cameraDebugOpen"
                                        :scene="sceneNonNull"
                                        :avatar-node="(avatarNode as any) || null"
                                        hotkey="Shift+N"
                                    />
                                </BabylonMyAvatarModel>
                            </template>
                        </BabylonMyAvatar>
                    </BabylonMyAvatarMKBController>

                    <!-- Other avatars wrapper -->
                    <BabylonOtherAvatars
                        :scene="sceneNonNull"
                        :vircadia-world="vircadiaWorld"
                        :current-full-session-id="sessionId && instanceId ? `${sessionId}-${instanceId}` : undefined"
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
        <!-- Animation Debug Overlay (Shift+B) -->
        <BabylonMyAvatarAnimationDebugOverlay v-model="animDebugOpen" hotkey="Shift+B" />
        <!-- WebRTC component (hidden, just for functionality) -->
        <BabylonWebRTC 
            v-if="sessionId && instanceId" 
            :instance-id="instanceId ?? undefined" 
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
                        @click="jointOverlayOpen = !jointOverlayOpen"
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
            v-if="jointOverlayOpen" 
            :visible="jointOverlayOpen"
            @close="jointOverlayOpen = false"
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
import BabylonMyAvatarMKBController from "../components/BabylonMyAvatarMKBController.vue";
import BabylonMyAvatarModel from "../components/BabylonMyAvatarModel.vue";
import BabylonMyAvatarAnimation from "../components/BabylonMyAvatarAnimation.vue";
import BabylonMyAvatarDesktopThirdPersonCamera from "../components/BabylonMyAvatarDesktopThirdPersonCamera.vue";
import BabylonOtherAvatars from "../components/BabylonOtherAvatars.vue";
import BabylonModel from "../components/BabylonModel.vue";
import BabylonModels from "../components/BabylonModels.vue";
import BabylonWebRTC from "../components/BabylonWebRTC.vue";
import BabylonDebugOverlay from "../components/BabylonDebugOverlay.vue";
import BabylonMyAvatarDebugOverlay from "../components/BabylonMyAvatarDebugOverlay.vue";
import BabylonMyAvatarAnimationDebugOverlay from "../components/BabylonMyAvatarAnimationDebugOverlay.vue";
import BabylonCameraDebugOverlay from "../components/BabylonCameraDebugOverlay.vue";
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
void BabylonMyAvatarMKBController;
// mark as used at runtime for template
void BabylonMyAvatarAnimation;
// mark as used at runtime for template
void BabylonMyAvatarModel;
// mark as used at runtime for template
void BabylonMyAvatarDesktopThirdPersonCamera;
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
void BabylonMyAvatarDebugOverlay;
// mark as used at runtime for template
void BabylonMyAvatarAnimationDebugOverlay;
void BabylonCameraDebugOverlay;
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
import { useLocalStorage } from "@vueuse/core";

// BabylonJS types
import type { Scene, WebGPUEngine } from "@babylonjs/core";

// Auth change handling moved to provider

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
// targetSkeleton now provided via slot; no local ref needed
type OtherAvatarsExposed = { isLoading: boolean };
const otherAvatarsRef = ref<OtherAvatarsExposed | null>(null);
const otherAvatarsMetadata = ref<
    Record<string, import("@/composables/schemas").AvatarMetadata>
>({});
void otherAvatarsMetadata;
const modelRefs = ref<(InstanceType<typeof BabylonModel> | null)[]>([]);

// Other avatar discovery handled by BabylonOtherAvatars wrapper

// Physics handled by BabylonCanvas

// State for debug overlays with persistence across reloads
const jointOverlayOpen = useLocalStorage<boolean>("vrca.debug.joints", false);
const cameraDebugOpen = useLocalStorage<boolean>("vrca.debug.camera", false);
const avatarDebugOpen = useLocalStorage<boolean>("vrca.debug.avatar", false);
const animDebugOpen = useLocalStorage<boolean>("vrca.debug.anim", false);
void jointOverlayOpen;
void cameraDebugOpen;
void avatarDebugOpen;
void animDebugOpen;

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
    console.debug("[MainScene] Initialized");
    console.debug(
        "[MainScene] Debug",
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG,
    );
});

// No onUnmounted reset needed; canvas manages its own ready state

// Connection watchers migrated to provider

// Variables referenced only in template - mark to satisfy linter
void activeAudioCount;
void otherAvatarsMetadata;
// removed legacy showDebugOverlay marker
void performanceMode;
void fps;
// removed inline avatarDefinition; using DB-backed avatar definition by name

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
        ((avatarRef.value?.isCreating || avatarRef.value?.isRetrieving) ??
            false) ||
        avatarModelLoading.value,
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

// Avatar model loader debug state
const avatarModelStep = ref<string>("");
const avatarModelError = ref<string | null>(null);
const avatarModelLoading = ref<boolean>(false);
const modelFileNameRef = ref<string | null>(null);
function onAvatarModelState(payload: {
    state: "loading" | "ready" | "error";
    step: string;
    message?: string;
    details?: Record<string, unknown>;
}): void {
    avatarModelStep.value = payload.step;
    avatarModelLoading.value = payload.state === "loading";
    avatarModelError.value =
        payload.state === "error" ? payload.message || null : null;
    const fileName = payload.details?.fileName;
    if (typeof fileName === "string") modelFileNameRef.value = fileName;
}
void avatarModelStep;
void avatarModelError;
void avatarModelLoading;
void modelFileNameRef;
void onAvatarModelState;

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

// No local forwarding needed; using slot's onAnimationState

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

// Handle auth denial from provider by clearing local auth state without server logout
type AuthDeniedPayload = {
    reason: "expired" | "invalid" | "unauthorized" | "authentication_failed";
    message: string;
};
type AuthSlotProps = {
    logoutLocal?: (reason?: string) => void;
    logout?: () => void;
};

function onAuthDenied(payload: AuthDeniedPayload, authProps: AuthSlotProps) {
    console.warn("[MainScene] Auth denied, logging out locally", payload);
    // Clear local auth state only; do not call server logout
    if (typeof authProps.logoutLocal === "function") {
        authProps.logoutLocal(
            `Logged out due to ${payload.reason}: ${payload.message}`,
        );
    } else if (typeof authProps.logout === "function") {
        // Fallback to full logout if logoutLocal is not available
        authProps.logout();
    }
    // TODO: show a toast/snackbar using your global notification system
}
void onAuthDenied;
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
