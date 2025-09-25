<template>
    <VircadiaWorldProvider 
        :autoConnect="clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_AUTO_CONNECT"
        @auth-denied="onAuthDenied($event)"
        v-slot="{ vircadiaWorld, connectionStatus, isConnecting, isAuthenticated, isAuthenticating, accountDisplayName, sessionId, fullSessionId, agentId, lastCloseCode, lastCloseReason, connect, logout }">

        <!-- Auth Screen when not authenticated -->
        <VircadiaWorldAuthProvider 
            v-if="!isAuthenticated" 
            :vircadia-world="vircadiaWorld" 
            @authenticated="connect" 
        />

        <!-- Main world when authenticated -->
        <template v-else>
        <!-- Component Loader -->
        <template v-for="comp in availableComponents" :key="comp">
            <component 
                :is="comp" 
                :scene="scene"
                :engine="engine"
                :canvas="renderCanvas"
                :vircadia-world="vircadiaWorld as any"
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
            density="comfortable"
            color="primary"
            flat
        >
            <v-app-bar-title>Debug</v-app-bar-title>

            <!-- Connection State -->
            <v-tooltip location="bottom">
                <template #activator="{ props }">
                    <v-chip
                        v-bind="props"
                        :color="getConnectionStatusColor(connectionStatus)"
                        size="small"
                        variant="flat"
                        class="ml-4"
                    >
                        <v-icon start size="small">{{ getConnectionStatusIcon(connectionStatus) }}</v-icon>
                        {{ connectionStatus }}
                    </v-chip>
                </template>
                <div class="text-caption">
                    <div><strong>Last close code:</strong> {{ lastCloseCode ?? '-' }}</div>
                    <div><strong>Last close reason:</strong> {{ lastCloseReason || '-' }}</div>
                </div>
            </v-tooltip>

            <!-- Auth State -->
            <v-chip
                :color="getAuthStatusColor(isAuthenticated, isAuthenticating)"
                size="small"
                variant="flat"
                class="ml-2"
            >
                <v-icon start size="small">{{ getAuthStatusIcon(isAuthenticated, isAuthenticating) }}</v-icon>
                {{ getAuthStatusText(isAuthenticated, isAuthenticating) }}
            </v-chip>

            <!-- Connected URL -->
            <v-chip
                color="info"
                size="small"
                variant="outlined"
                class="ml-2"
                v-if="connectionStatus !== 'disconnected'"
            >
                <v-icon start size="small">mdi-web</v-icon>
                {{ getConnectedUrl() }}
            </v-chip>

            <!-- Physics State -->
            <v-tooltip location="bottom">
                <template #activator="{ props }">
                    <v-chip
                        v-bind="props"
                        :color="envPhysicsEnabledRef ? 'success' : 'error'"
                        size="small"
                        variant="flat"
                        class="ml-2"
                    >
                        <v-icon start size="small">{{ envPhysicsEnabledRef ? 'mdi-atom-variant' : 'mdi-atom' }}</v-icon>
                        Physics: {{ envPhysicsPluginNameRef || (envPhysicsEnabledRef ? 'on' : 'off') }}
                    </v-chip>
                </template>
                <div class="text-caption">
                    <div><strong>Enabled:</strong> {{ String(envPhysicsEnabledRef) }}</div>
                    <div><strong>Plugin:</strong> {{ envPhysicsPluginNameRef || '-' }}</div>
                    <div><strong>Error:</strong> {{ envPhysicsErrorRef || '-' }}</div>
                </div>
            </v-tooltip>

            <v-spacer />
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
                :color="modelsDebugOpen ? 'error' : 'default'"
                prepend-icon="mdi-cube-outline"
                @click="modelsDebugOpen = !modelsDebugOpen"
                class="ml-2"
            >
                Models
            </v-btn>
            <v-btn
                variant="tonal"
                :color="otherAvatarsDebugOpen ? 'error' : 'default'"
                prepend-icon="mdi-account-group-outline"
                @click="otherAvatarsDebugOpen = !otherAvatarsDebugOpen"
                class="ml-2"
            >
                Others
            </v-btn>
            <v-btn
                variant="tonal"
                :color="performanceMode === 'low' ? 'warning' : 'default'"
                prepend-icon="mdi-speedometer"
                @click="togglePerformanceMode"
                class="ml-2"
            >
                Perf ({{ performanceMode }})
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
                v-if="sceneInitialized && connectionStatus === 'connected' && !isConnecting"
                :scene="sceneNonNull"
                :vircadia-world="vircadiaWorld"
                environment-entity-name="babylon.environment.default"
                ref="envRef"
                v-slot="{ isLoading, physicsEnabled: envPhysicsEnabled, physicsPluginName: envPhysicsPluginName, physicsError: envPhysicsError, gravity }"
            >
                <!-- Sync environment physics slot values to top-level refs for use outside this slot (e.g., Debug Bar) -->
                <div style="display: none">
                    {{ envPhysicsEnabledRef = envPhysicsEnabled }}
                    {{ envPhysicsPluginNameRef = envPhysicsPluginName }}
                    {{ envPhysicsErrorRef = envPhysicsError }}
                </div>
                <!-- Only render entities when scene is available, connection is stable, and full session ID is available -->
                <template v-if="!isLoading && envPhysicsEnabled && sceneInitialized && connectionStatus === 'connected' && !isConnecting && fullSessionId">
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
                        :slow-run-toggle-codes="[]"
                        v-slot="controls"
                    >
                        <BabylonMyAvatarTalking v-slot="{ isTalking, level: talkLevel, devices: audioDevices, threshold: talkThreshold }">
                            <BabylonMyAvatar
                                :scene="sceneNonNull"
                                :vircadia-world="vircadiaWorld as any"
                                :key-state="controls.keyState"
                                :is-talking="isTalking"
                                :talk-level="talkLevel"
                                :physics-enabled="envPhysicsEnabled"
                                :physics-plugin-name="envPhysicsPluginName"
                                :gravity="gravity"
                                ref="avatarRef"
                            >
                                <template #default="{ avatarSkeleton, animations, vircadiaWorld, onAnimationState, avatarNode, modelFileName, meshPivotPoint, capsuleHeight, onSetAvatarModel, airborne, verticalVelocity, supportState, physicsEnabled, hasTouchedGround, spawnSettling, groundProbeHit, groundProbeDistance, groundProbeMeshName, onAvatarDefinitionLoaded, onEntityDataLoaded }">
                                    <!-- Renderless entity sync component runs outside of model v-if so it can load DB definition -->
                                    <BabylonMyAvatarEntity
                                        v-if="vircadiaWorld.connectionInfo.value.status === 'connected'"
                                        :scene="sceneNonNull"
                                        :vircadia-world="vircadiaWorld as any"
                                        :avatar-node="(avatarNode as any) || null"
                                        :target-skeleton="(avatarSkeleton as any) || null"
                                        :camera="null"
                                        :model-file-name="modelFileName || ''"
                                        :avatar-definition="avatarDefinition"
                                        :persist-pose-snapshot-interval="5000"
                                        :position-throttle-interval="50"
                                        :rotation-throttle-interval="50"
                                        :camera-orientation-throttle-interval="100"
                                        :joint-throttle-interval="50"
                                        :joint-position-decimals="3"
                                        :joint-rotation-decimals="4"
                                        :joint-scale-decimals="5"
                                        :joint-position-update-decimals="2"
                                        :joint-rotation-update-decimals="3"
                                        :joint-scale-update-decimals="4"
                                        :reflect-sync-group="'public.NORMAL'"
                                        :reflect-channel="'avatar_joints'"
                                        :position-decimals="4"
                                        :rotation-decimals="4"
                                        :scale-decimals="4"
                                        :position-update-decimals="4"
                                        :rotation-update-decimals="4"
                                        :scale-update-decimals="3"
                                        @avatar-definition-loaded="onAvatarDefinitionLoaded"
                                        @entity-data-loaded="onEntityDataLoaded"
                                        @sync-stats="onAvatarSyncStats"
                                    />
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
                                        :min-z="0.1"
                                        :lower-radius-limit="1.2"
                                        :upper-radius-limit="25"
                                        :lower-beta-limit="0.15"
                                        :upper-beta-limit="Math.PI * 0.9"
                                        :inertia="0.6"
                                        :panning-sensibility="0"
                                        :wheel-precision="40"
                                        :fov-delta="
                                            ((controls.keyState.forward ||
                                                controls.keyState.backward ||
                                                controls.keyState.strafeLeft ||
                                                controls.keyState.strafeRight)
                                                ? (controls.keyState.sprint ? 0.08 : 0.04)
                                                : 0)
                                        "
                                        :fov-lerp-speed="8"
                                    />
                                    <!-- Non-visual animation loaders now slotted under model component -->
                                    <BabylonMyAvatarAnimation
                                        v-for="anim in animations"
                                        v-if="targetSkeleton"
                                        :key="anim.fileName"
                                        :scene="sceneNonNull"
                                        :vircadia-world="vircadiaWorld"
                                        :animation="anim"
                                        :target-skeleton="(targetSkeleton as any) || null"
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
                                        :is-talking="isTalking"
                                        :talk-level="talkLevel"
                                        :talk-threshold="talkThreshold"
                                        :audio-input-devices="audioDevices"
                                        :airborne="airborne"
                                        :vertical-velocity="verticalVelocity"
                                        :support-state="supportState as any"
                                        :physics-enabled="physicsEnabled"
                                        :physics-plugin-name="envPhysicsPluginNameRef || undefined"
                                        :physics-error="envPhysicsErrorRef || undefined"
                                        :has-touched-ground="hasTouchedGround"
                                        :spawn-settling="spawnSettling"
                                        :ground-probe-hit="groundProbeHit"
                                        :ground-probe-distance="groundProbeDistance ?? undefined"
                                        :ground-probe-mesh-name="groundProbeMeshName ?? undefined"
                                        :sync-metrics="avatarSyncMetrics || undefined"
                                        :animation-debug="(avatarRef as any)?.animationDebug || undefined"
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
                        </BabylonMyAvatarTalking>
                    </BabylonMyAvatarMKBController>

                    <!-- Other avatars wrapper -->
                    <BabylonOtherAvatars
                        :scene="sceneNonNull"
                        :vircadia-world="vircadiaWorld as any"
                        :current-full-session-id="fullSessionId ?? undefined"
                        :discovery-polling-interval="500"
                        :reflect-sync-group="'public.NORMAL'"
                        :reflect-channel="'avatar_joints'"
                        v-slot="{ otherAvatarSessionIds, avatarDataMap, positionDataMap, rotationDataMap, jointDataMap }"
                    >
                        <BabylonOtherAvatar
                            v-for="otherFullSessionId in otherAvatarSessionIds || []"
                            :key="otherFullSessionId"
                            :scene="sceneNonNull"
                            :vircadia-world="vircadiaWorld as any"
                            :session-id="otherFullSessionId"
                            :avatar-data="avatarDataMap?.[otherFullSessionId]"
                            :position-data="positionDataMap?.[otherFullSessionId]"
                            :rotation-data="rotationDataMap?.[otherFullSessionId]"
                            :joint-data="jointDataMap?.[otherFullSessionId]"
                            :on-ready="() => markLoaded(otherFullSessionId)"
                            :on-dispose="() => markDisposed(otherFullSessionId)"
                        />

                        <!-- WebRTC component (now under OtherAvatars slot) -->
                        <BabylonWebRTCRefactored
                            v-model="showWebRTCControls"
                            :vircadia-world="vircadiaWorld"
                            :avatar-data-map="(avatarDataMap as Record<string, AvatarBaseData>) || {}"
                            :position-data-map="(positionDataMap as Record<string, AvatarPositionData>) || {}"
                            :rotation-data-map="(rotationDataMap as Record<string, AvatarRotationData>) || {}"
                            :my-position-data="null"
                            :my-camera-orientation="null"
                            :on-set-peer-audio-state="setPeerAudioState"
                            :on-remove-peer-audio-state="removePeerAudioState"
                            :webrtc-sync-group="'public.NORMAL'"
                        />
                    </BabylonOtherAvatars>

                    <!-- BabylonModel components provided by DB-scanned list -->
                    <BabylonModels :vircadia-world="vircadiaWorld as any" v-slot="{ models }">
                        <BabylonModel
                            v-for="def in models"
                            :key="def.fileName"
                            :def="def"
                            :scene="sceneNonNull"
                            :vircadia-world="vircadiaWorld as any"
                            ref="modelRefs"
                            v-slot="{ meshes, def: slotDef }"
                        >
                            <BabylonModelPhysics
                                :scene="sceneNonNull"
                                :meshes="meshes"
                                :def="slotDef"
                                ref="modelPhysicsRefs"
                            />
                        </BabylonModel>

                        <BabylonModelsDebugOverlay
                            v-model="modelsDebugOpen"
                            :models="models"
                            :model-runtime="modelRuntime"
                            :physics-summaries="physicsSummaries"
                        />
                        <div style="display: none">
                            {{ setModelRuntimeFromRefs(models, (modelRefs as any).map((r: any) => r?.meshes)) }}
                            {{ refreshPhysicsSummaries(models) }}
                        </div>
                    </BabylonModels>


                    <!-- BabylonDoor component for interactive door -->
                    <BabylonDoor
                        :scene="sceneNonNull"
                        :vircadia-world="vircadiaWorld as any"
                        entity-name="babylon.door.main"
                        model-file-name="babylon.model.wooden_door.glb"
                        :initial-position="{ x: 0, y: 0, z: 0 }"
                        :initial-rotation="{ x: 0, y: 0, z: 0, w: 1 }"
                        :initial-open="false"
                        :rotation-open-radians="1.57"
                        :rotation-axis="'y'"
                        :sync-interval-ms="750"
                        :update-throttle-ms="300"
                        @state="onDoorState"
                        @open="onDoorOpen"
                    />
                </template>
            </BabylonEnvironment>
        </main>
        
        <!-- WebRTC moved inside BabylonOtherAvatars -->
        
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
                    :onLogout="logout"
                />
            </div>
            
            <!-- Debug Controls removed: joint overlay toggle -->
            
            <!-- Audio Controls -->
            <v-tooltip bottom>
                <template v-slot:activator="{ props }">
                    <v-btn
                        fab
                        small
                        color="primary"
                        @click="showWebRTCControls = true"
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
        
        <!-- Audio controls dialog now lives inside BabylonWebRTC -->

        </template>
    </VircadiaWorldProvider>
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
import BabylonMyAvatar, {
    type AvatarDefinition,
} from "../components/BabylonMyAvatar.vue";
import BabylonMyAvatarTalking from "../components/BabylonMyAvatarTalking.vue";
import BabylonMyAvatarMKBController from "../components/BabylonMyAvatarMKBController.vue";
import BabylonMyAvatarModel from "../components/BabylonMyAvatarModel.vue";
import BabylonMyAvatarAnimation from "../components/BabylonMyAvatarAnimation.vue";
import BabylonMyAvatarEntity, {
    type AvatarSyncMetrics,
} from "../components/BabylonMyAvatarEntity.vue";
import BabylonMyAvatarDesktopThirdPersonCamera from "../components/BabylonMyAvatarDesktopThirdPersonCamera.vue";
import BabylonOtherAvatars from "../components/BabylonOtherAvatars.vue";
import BabylonOtherAvatar from "../components/BabylonOtherAvatar.vue";
import BabylonModel from "../components/BabylonModel.vue";
import BabylonModelPhysics, {
    type PhysicsSummary,
} from "../components/BabylonModelPhysics.vue";
import BabylonModels from "../components/BabylonModels.vue";
import BabylonMyAvatarDebugOverlay from "../components/BabylonMyAvatarDebugOverlay.vue";
import BabylonWebRTCRefactored from "../components/BabylonWebRTCRefactored.vue";
import BabylonCameraDebugOverlay from "../components/BabylonCameraDebugOverlay.vue";
import BabylonInspector from "../components/BabylonInspector.vue";
import BabylonModelsDebugOverlay from "../components/BabylonModelsDebugOverlay.vue";
import BabylonOtherAvatarsDebugOverlay from "../components/BabylonOtherAvatarsDebugOverlay.vue";
import VircadiaWorldAuthProvider from "./VircadiaWorldAuthProvider.vue";
import BabylonCanvas from "../components/BabylonCanvas.vue";
import BabylonSnackbar from "../components/BabylonSnackbar.vue";
import LogoutButton from "../components/LogoutButton.vue";
import VircadiaWorldProvider from "./VircadiaWorldProvider.vue";
// mark as used at runtime for template
void BabylonMyAvatar;
void BabylonMyAvatarTalking;
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
void BabylonOtherAvatar;
// mark as used at runtime for template
void BabylonModel;
// mark as used at runtime for template
void BabylonModelPhysics;
// mark as used at runtime for template
void BabylonModels;
// mark as used at runtime for template
// mark as used at runtime for template
// mark as used at runtime for template
void BabylonMyAvatarDebugOverlay;
void BabylonCameraDebugOverlay;
// mark as used at runtime for template
void BabylonInspector;
// mark as used at runtime for template
// mark as used at runtime for template
void BabylonModelsDebugOverlay;
// mark as used at runtime for template
void BabylonOtherAvatarsDebugOverlay;
// mark as used at runtime for template
void BabylonMyAvatarEntity;
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
// mark as used at runtime for template
void BabylonWebRTCRefactored;
// mark as used at runtime for template
import BabylonEnvironment from "../components/BabylonEnvironment.vue";
import BabylonDoor from "../components/BabylonDoor.vue";
import { clientBrowserConfiguration } from "@vircadia/world-sdk/browser/vue";
import { useStorage } from "@vueuse/core";
import type {
    AvatarJointMetadata,
    AvatarBaseData,
    AvatarPositionData,
    AvatarRotationData,
} from "@/schemas";

// BabylonJS types
import type { Scene, WebGPUEngine } from "@babylonjs/core";

// Auth change handling moved to provider

// Connection count is now managed by BabylonWebRTCRefactored component
// WebRTC controls dialog visibility
const showWebRTCControls = ref(false);

// Session/agent and world instance are provided reactively via slot props; no local refs needed

// Scene readiness derived from BabylonCanvas exposed API
// Track if avatar is ready
const avatarRef = ref<InstanceType<typeof BabylonMyAvatar> | null>(null);
void avatarRef;
// targetSkeleton now provided via slot; no local ref needed
// Other avatar types for v-slot destructuring
type OtherAvatarSlotProps = {
    otherAvatarSessionIds?: string[];
    avatarDataMap?: Record<string, AvatarBaseData>;
    positionDataMap?: Record<string, AvatarPositionData>;
    rotationDataMap?: Record<string, AvatarRotationData>;
    jointDataMap?: Record<string, Map<string, AvatarJointMetadata>>;
};
// Combined otherAvatarsMetadata removed; use separate maps from BabylonOtherAvatars
const modelRefs = ref<(InstanceType<typeof BabylonModel> | null)[]>([]);
const modelPhysicsRefs = ref<
    (InstanceType<typeof BabylonModelPhysics> | null)[]
>([]);
void modelRefs;
void modelPhysicsRefs;

// Other avatar discovery handled by BabylonOtherAvatars wrapper

// Physics handled by BabylonCanvas

// State for debug overlays with persistence across reloads
const cameraDebugOpen = useStorage<boolean>("vrca.debug.camera", false);
const avatarDebugOpen = useStorage<boolean>("vrca.debug.avatar", false);
void cameraDebugOpen;
void avatarDebugOpen;
// Models debug overlay
const modelsDebugOpen = useStorage<boolean>("vrca.debug.models", false);
void modelsDebugOpen;

// Other avatars overlay
const otherAvatarsDebugOpen = useStorage<boolean>(
    "vrca.debug.otherAvatars",
    false,
);
void otherAvatarsDebugOpen;

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
const performanceMode = useStorage<"normal" | "low">("vrca.perf.mode", "low");
const fps = ref<number>(0);
void performanceMode;
void fps;

// Physics state now comes directly from BabylonEnvironment slot props
// See v-slot destructuring in template: envPhysicsEnabled, envPhysicsPluginName, etc.

// FPS sampling removed; now handled by BabylonCanvas via v-model:fps

// Ready callback no longer needed; scene readiness comes from the canvas API

onMounted(async () => {
    console.debug("[MainScene] Initialized");
    console.debug(
        "[MainScene] Debug",
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG,
    );

    // Add keyboard listener for performance mode toggle
    const handleKeyPress = (event: KeyboardEvent) => {
        if (event.key === "p" || event.key === "P") {
            togglePerformanceMode();
        }
    };

    document.addEventListener("keydown", handleKeyPress);
});

// No onUnmounted reset needed; canvas manages its own ready state

// Performance mode toggle function
function togglePerformanceMode() {
    if (canvasComponentRef.value) {
        canvasComponentRef.value.togglePerformanceMode();
        // Vue's v-model will automatically sync the performanceMode ref
    }
}

// Connection watchers migrated to provider

// Active audio connections - now handled internally by BabylonWebRTCRefactored
const activeAudioCount = computed(() => 0);
// removed legacy showDebugOverlay marker
void performanceMode;
void togglePerformanceMode;
void fps;
// removed inline avatarDefinition; using DB-backed avatar definition by name

// Keyboard toggle handled inside BabylonCanvas

const envRef = ref<InstanceType<typeof BabylonEnvironment> | null>(null);

// Mark environment physics slot props as used in template
// These are now received directly from BabylonEnvironment slot props
// avoiding the convoluted ref-based access
void envRef; // envPhysicsEnabled, envPhysicsPluginName, envPhysicsError, gravity are used directly from v-slot

// Top-level refs to mirror BabylonEnvironment physics slot values for use outside the slot
const envPhysicsEnabledRef = ref<boolean>(false);
const envPhysicsPluginNameRef = ref<string | null>(null);
const envPhysicsErrorRef = ref<string | null>(null);
void envPhysicsEnabledRef;
void envPhysicsPluginNameRef;
void envPhysicsErrorRef;

// Avatar definition is now provided locally instead of DB
const avatarDefinition: AvatarDefinition = {
    initialAvatarPosition: { x: 25, y: 3, z: -5 },
    initialAvatarRotation: { x: 0, y: 0, z: 0, w: 1 },
    modelFileName: "babylon.avatar.glb",
    meshPivotPoint: "bottom",
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
    disableRootMotion: true,
    startFlying: true,
    animations: [
        {
            fileName: "babylon.avatar.animation.f.idle.1.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.idle.2.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.idle.3.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.idle.4.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.idle.5.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.idle.6.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.idle.7.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.idle.8.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.idle.9.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.idle.10.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.walk.1.glb",
            slMotion: "walk",
            direction: "forward",
        },
        {
            fileName: "babylon.avatar.animation.f.walk.2.glb",
            slMotion: "walk",
            direction: "forward",
        },
        {
            fileName: "babylon.avatar.animation.f.crouch_strafe_left.glb",
            slMotion: "crouchwalk",
            direction: "left",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.crouch_strafe_right.glb",
            slMotion: "crouchwalk",
            direction: "right",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.crouch_walk_back.glb",
            slMotion: "crouchwalk",
            direction: "back",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.crouch_walk.glb",
            slMotion: "crouchwalk",
            direction: "forward",
        },
        {
            fileName: "babylon.avatar.animation.f.falling_idle.1.glb",
            slMotion: "falling",
        },
        {
            fileName: "babylon.avatar.animation.f.falling_idle.2.glb",
            slMotion: "falling",
        },
        {
            fileName: "babylon.avatar.animation.f.jog_back.glb",
            slMotion: "run",
            direction: "back",
            variant: "jog",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.jog.glb",
            slMotion: "run",
            direction: "forward",
            variant: "jog",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.jump_small.glb",
            slMotion: "jump",
        },
        { fileName: "babylon.avatar.animation.f.jump.glb", slMotion: "jump" },
        {
            fileName: "babylon.avatar.animation.f.run_back.glb",
            slMotion: "run",
            direction: "back",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.run_strafe_left.glb",
            slMotion: "run",
            direction: "left",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.run_strafe_right.glb",
            slMotion: "run",
            direction: "right",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.run.glb",
            slMotion: "run",
            direction: "forward",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.strafe_left.glb",
            slMotion: "walk",
            direction: "left",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.strafe_right.glb",
            slMotion: "walk",
            direction: "right",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.talking.1.glb",
            slMotion: "talk",
        },
        {
            fileName: "babylon.avatar.animation.f.talking.2.glb",
            slMotion: "talk",
        },
        {
            fileName: "babylon.avatar.animation.f.talking.3.glb",
            slMotion: "talk",
        },
        {
            fileName: "babylon.avatar.animation.f.talking.4.glb",
            slMotion: "talk",
        },
        {
            fileName: "babylon.avatar.animation.f.talking.5.glb",
            slMotion: "talk",
        },
        {
            fileName: "babylon.avatar.animation.f.talking.6.glb",
            slMotion: "talk",
        },
        {
            fileName: "babylon.avatar.animation.f.walk_back.glb",
            slMotion: "walk",
            direction: "back",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.walk_jump.1.glb",
            slMotion: "jump",
        },
        {
            fileName: "babylon.avatar.animation.f.walk_jump.2.glb",
            slMotion: "jump",
        },
        {
            fileName: "babylon.avatar.animation.f.walk_strafe_left.glb",
            slMotion: "walk",
            direction: "left",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.walk_strafe_right.glb",
            slMotion: "walk",
            direction: "right",
            ignoreHipTranslation: true,
        },
    ],
};
void avatarDefinition;

// Debug function to check physics status
function debugPhysicsStatus() {
    console.log("[MainScene] Debugging physics status...");
    // Physics state is now received via slot props from BabylonEnvironment
    // Check envRef for direct exposed method
    if (envRef.value && typeof envRef.value.checkPhysicsStatus === "function") {
        const status = envRef.value.checkPhysicsStatus();
        console.log("[MainScene] Environment physics status:", status);
    } else {
        console.log(
            "[MainScene] Environment ref not available or checkPhysicsStatus not exposed",
        );
    }

    if (scene.value) {
        const engine = scene.value.getPhysicsEngine?.();
        console.log("[MainScene] Scene physics engine:", {
            hasMethod: typeof scene.value.getPhysicsEngine === "function",
            engineExists: !!engine,
            engineType: engine ? engine.constructor.name : "none",
        });
    }
}

// Expose for debugging in console
(
    window as unknown as { debugPhysicsStatus?: typeof debugPhysicsStatus }
).debugPhysicsStatus = debugPhysicsStatus;
const environmentLoading = computed(() => {
    const exposed = envRef.value as unknown as {
        isLoading?: { value: boolean };
    } | null;
    return exposed?.isLoading?.value ?? false;
});
void envRef;
void environmentLoading;
// Physics error now comes from BabylonEnvironment slot props (envPhysicsError)

// Child component loading states
const avatarLoading = computed(
    () =>
        // Fallback to model loading only now that entity sync is internal
        avatarModelLoading.value,
);
void avatarLoading;
// Other avatars loading state is handled internally by BabylonOtherAvatars component
const otherAvatarsLoading = computed(() => false); // Placeholder - loading state managed by component
void otherAvatarsLoading;
const modelsLoading = computed(() =>
    modelRefs.value.some((m) => {
        const mm = m as unknown as { isEntityCreating?: boolean; isEntityRetrieving?: boolean; isAssetLoading?: boolean } | null;
        return Boolean(mm?.isEntityCreating || mm?.isEntityRetrieving || mm?.isAssetLoading);
    }),
);
void modelsLoading;

// Runtime info for models to augment overlay (e.g., mesh counts)
type ModelRuntimeInfo = { meshCount: number };
const modelRuntime = ref<Record<string, ModelRuntimeInfo>>({});
void modelRuntime;
function setModelRuntimeFromRefs(
    models: { entityName: string; fileName: string }[],
    meshesByIndex: unknown[],
) {
    for (let i = 0; i < models.length; i++) {
        const id = models[i].entityName || models[i].fileName;
        if (!id) continue;
        const meshArray = Array.isArray(meshesByIndex[i])
            ? (meshesByIndex[i] as unknown[])
            : [];
        if (!modelRuntime.value[id]) modelRuntime.value[id] = { meshCount: 0 };
        modelRuntime.value[id].meshCount = meshArray.length;
    }
}
void setModelRuntimeFromRefs;
function getPhysicsShape(type: unknown): string {
    switch (type) {
        case "convexHull":
            return "Convex Hull";
        case "box":
            return "Box";
        case "mesh":
            return "Mesh";
        default:
            return type ? String(type) : "Mesh";
    }
}
void modelRuntime;
void getPhysicsShape;

// Physics summaries reported by BabylonModelPhysics instances
const physicsSummaries = ref<Record<string, PhysicsSummary>>({});
function refreshPhysicsSummaries(
    models: { entityName: string; fileName: string }[],
) {
    for (let i = 0; i < models.length; i++) {
        const id = models[i].entityName || models[i].fileName;
        const comp = modelPhysicsRefs.value[i] as unknown as {
            lastEmittedSummary?: { value?: PhysicsSummary };
        } | null;
        const summary = comp?.lastEmittedSummary?.value;
        if (id && summary) physicsSummaries.value[id] = summary;
    }
}
void physicsSummaries;
void refreshPhysicsSummaries;

// Avatar model loader debug state
const avatarModelStep = ref<string>("");
const avatarModelError = ref<string | null>(null);
const avatarModelLoading = ref<boolean>(false);
const modelFileNameRef = ref<string | null>(null);
// Avatar sync metrics
const avatarSyncMetrics = ref<AvatarSyncMetrics | null>(null);
function onAvatarSyncStats(m: AvatarSyncMetrics) {
    avatarSyncMetrics.value = m;
}
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
void onAvatarSyncStats;

// Snackbar logic moved into BabylonSnackbar component

// Audio dialog is owned by BabylonWebRTC now
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

// Mark audio helpers used in template
void setPeerAudioState;
void removePeerAudioState;
void setPeerVolume;
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
void BabylonDoor;
void clientBrowserConfiguration;

// Handle auth denial from provider by showing user feedback
type AuthDeniedPayload = {
    reason: "expired" | "invalid" | "unauthorized" | "authentication_failed";
    message: string;
};
function onAuthDenied(payload: AuthDeniedPayload) {
    console.warn("[MainScene] Auth denied, showing user feedback", payload);
    // Show a toast/snackbar using your global notification system
    // The VircadiaWorldProvider already handles clearing auth state and disconnecting
    // This function now only handles UI feedback for the user

    // For now, just log the message - you can integrate with your notification system here
    console.log(`Authentication failed: ${payload.message}`);

    // TODO: Replace with actual notification system call
    // Example: notificationService.error(`Authentication failed: ${payload.message}`);
}
void onAuthDenied;

// Other avatar event handlers
function markLoaded(sessionId: string) {
    console.debug("[MainScene] Other avatar loaded", sessionId);
}

function markDisposed(sessionId: string) {
    console.debug("[MainScene] Other avatar disposed", sessionId);
}

// Door event handlers
function onDoorState(payload: {
    state: "loading" | "ready" | "error";
    step: string;
    message?: string;
    details?: Record<string, unknown>;
}) {
    console.debug("[MainScene] Door state changed", payload);
    if (payload.state === "error") {
        console.error(
            "[MainScene] Door error",
            payload.message,
            payload.details,
        );
    }
}

function onDoorOpen(payload: { open: boolean }) {
    console.debug("[MainScene] Door opened/closed", payload);
}

void onDoorState;
void onDoorOpen;
void markLoaded;
void markDisposed;

// Debug bar helper functions
function getConnectionStatusColor(status: string): string {
    switch (status) {
        case "connected":
            return "success";
        case "connecting":
            return "warning";
        case "disconnected":
            return "error";
        case "error":
            return "error";
        default:
            return "grey";
    }
}

function getConnectionStatusIcon(status: string): string {
    switch (status) {
        case "connected":
            return "mdi-wifi-check";
        case "connecting":
            return "mdi-wifi-sync";
        case "disconnected":
            return "mdi-wifi-off";
        case "error":
            return "mdi-wifi-alert";
        default:
            return "mdi-wifi-strength-off";
    }
}

function getAuthStatusColor(
    isAuthenticated: boolean,
    isAuthenticating: boolean,
): string {
    if (isAuthenticating) return "warning";
    if (isAuthenticated) return "success";
    return "error";
}

function getAuthStatusIcon(
    isAuthenticated: boolean,
    isAuthenticating: boolean,
): string {
    if (isAuthenticating) return "mdi-account-clock";
    if (isAuthenticated) return "mdi-account-check";
    return "mdi-account-off";
}

function getAuthStatusText(
    isAuthenticated: boolean,
    isAuthenticating: boolean,
): string {
    if (isAuthenticating) return "Authenticating";
    if (isAuthenticated) return "Authenticated";
    return "Not Authenticated";
}

function getConnectedUrl(): string {
    const baseUri =
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI;
    const useSSL =
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI_USING_SSL;
    return `${useSSL ? "wss" : "ws"}://${baseUri}`;
}

// Mark debug helper functions as used (they're called from template)
void getConnectionStatusColor;
void getConnectionStatusIcon;
void getAuthStatusColor;
void getAuthStatusIcon;
void getAuthStatusText;
void getConnectedUrl;
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
