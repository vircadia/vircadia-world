<template>
    <VircadiaWorldProvider :autoConnect="clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_AUTO_CONNECT"
        @auth-denied="onAuthDenied($event)"
        v-slot="{ vircadiaWorld, connectionInfo, connectionStatus, isConnecting, isAuthenticated, isAuthenticating, accountDisplayName, sessionToken, connect, logout }">

        <!-- Auth Screen when not authenticated -->
        <VircadiaWorldAuthProvider v-if="!isAuthenticated" :vircadia-world="vircadiaWorld" />

        <!-- Main world when authenticated -->
        <template v-else>

            <!-- Sidebar / Drawer -->
            <SceneDrawer v-model:open="drawerOpen" v-model:tab="drawerTab" :environment-is-loading="!envInitializedRef"
                :physics-enabled="envPhysicsEnabledRef" :physics-plugin-name="envPhysicsPluginNameRef"
                :physics-error="envPhysicsErrorRef" :gravity="envGravityRef"
                :physics-engine-type="envPhysicsEngineTypeRef || ''" :physics-initialized="envPhysicsInitializedRef"
                :havok-instance-loaded="envHavokInstanceLoadedRef" :physics-plugin-created="envPhysicsPluginCreatedRef"
                :connection-status="connectionStatus" :is-connecting="isConnecting" :is-authenticated="isAuthenticated"
                :is-authenticating="isAuthenticating" :account-display-name="accountDisplayName"
                :session-id="connectionInfo.sessionId" :full-session-id="connectionInfo.fullSessionId"
                :agent-id="connectionInfo.agentId" :instance-id="connectionInfo.instanceId"
                :auth-provider="connectionInfo.authProvider ?? 'anon'"
                :last-close-code="(connectionInfo).lastClose?.code ?? null"
                :last-close-reason="(connectionInfo).lastClose?.reason ?? null"
                :connected-url="connectionStatus !== 'disconnected' ? getConnectedUrl() : null" />

            <!-- Component Loader -->
            <template v-for="comp in availableComponents" :key="comp">
                <component :is="comp" :scene="scene" :engine="engine" :canvas="renderCanvas"
                    :vircadia-world="vircadiaWorld" :connection-status="connectionStatus"
                    :session-id="connectionInfo.sessionId ?? undefined" :agent-id="connectionInfo.agentId ?? undefined"
                    :scene-initialized="sceneInitialized" :fps="fps" :performance-mode="performanceMode" />
            </template>

            <!-- Dev Debug App Bar -->
            <v-app-bar density="compact" color="primary" flat>
                <v-spacer />

                <!-- Connection State -->
                <v-tooltip location="bottom">
                    <template #activator="{ props }">
                        <v-chip v-bind="props" :color="getConnectionStatusColor(connectionStatus)" size="small"
                            variant="flat" class="ml-4">
                            <v-icon start size="small">{{ getConnectionStatusIcon(connectionStatus) }}</v-icon>
                            {{ connectionStatus }}
                        </v-chip>
                    </template>
                    <div class="text-caption">
                        <div><strong>Last close code:</strong> {{ (connectionInfo).lastClose?.code ?? '-' }}</div>
                        <div><strong>Last close reason:</strong> {{ (connectionInfo).lastClose?.reason || '-' }}</div>
                    </div>
                </v-tooltip>

                <!-- Auth State -->
                <v-tooltip location="bottom">
                    <template #activator="{ props }">
                        <v-chip v-bind="props" :color="getAuthStatusColor(isAuthenticated, isAuthenticating)"
                            size="small" variant="flat" class="ml-2">
                            <v-icon start size="small">{{ getAuthStatusIcon(isAuthenticated, isAuthenticating)
                            }}</v-icon>
                            {{ getAuthStatusText(isAuthenticated, isAuthenticating) }}
                        </v-chip>
                    </template>
                    <div class="text-caption">
                        <div><strong>Status:</strong> {{ getAuthStatusText(isAuthenticated, isAuthenticating) }}</div>
                        <div><strong>User:</strong> {{ accountDisplayName || '-' }}</div>
                    </div>
                </v-tooltip>

                <!-- Mic Permission State -->
                <v-tooltip location="bottom">
                    <template #activator="{ props }">
                        <v-chip v-bind="props" :color="micChipColor" size="small" variant="flat" class="ml-2">
                            <v-icon start size="small">{{ micChipIcon }}</v-icon>
                            Mic: {{ microphonePermission.toUpperCase() }}
                        </v-chip>
                    </template>
                    <div class="text-caption">
                        <div><strong>Permission:</strong> {{ microphonePermission }}</div>
                        <div><strong>Local stream:</strong> {{ String(localStreamActive) }}</div>
                    </div>
                </v-tooltip>

                <!-- Audio Context State -->
                <v-tooltip location="bottom">
                    <template #activator="{ props }">
                        <v-chip v-bind="props" :color="audioChipColor" size="small" variant="flat" class="ml-2">
                            <v-icon start size="small">{{ audioChipIcon }}</v-icon>
                            Audio: {{ audioContextState.toUpperCase() }}
                        </v-chip>
                    </template>
                    <div class="text-caption">
                        <div><strong>AudioContext:</strong> {{ audioContextState }}</div>
                        <div><strong>Local stream:</strong> {{ String(localStreamActive) }}</div>
                    </div>
                </v-tooltip>

                <!-- Connected URL -->
                <v-tooltip location="bottom" v-if="connectionStatus !== 'disconnected'">
                    <template #activator="{ props }">
                        <v-chip v-bind="props" color="info" size="small" variant="outlined" class="ml-2">
                            <v-icon start size="small">mdi-web</v-icon>
                            {{ getConnectedUrl() }}
                        </v-chip>
                    </template>
                    <div class="text-caption">
                        <div><strong>WebSocket URL:</strong> {{ getConnectedUrl() }}</div>
                    </div>
                </v-tooltip>

                <!-- Physics State -->
                <v-tooltip location="bottom">
                    <template #activator="{ props }">
                        <v-chip v-bind="props" :color="envPhysicsEnabledRef ? 'success' : 'error'" size="small"
                            variant="flat" class="ml-2">
                            <v-icon start size="small">{{ envPhysicsEnabledRef ? 'mdi-atom-variant' : 'mdi-atom'
                            }}</v-icon>
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
            </v-app-bar>

            <main>
                <BabylonCanvas ref="canvasComponentRef" v-model:performanceMode="performanceMode" v-model:fps="fps" />

                <BabylonSnackbar :scene-initialized="sceneInitialized" :connection-status="connectionStatus"
                    :is-connecting="isConnecting" :environment-loading="!envInitializedRef"
                    :avatar-loading="avatarLoading" :other-avatars-loading="otherAvatarsLoading"
                    :models-loading="modelsLoading" :is-authenticating="isAuthenticating"
                    :is-authenticated="isAuthenticated" :avatar-model-step="avatarModelStep"
                    :avatar-model-error="avatarModelError" :model-file-name="modelFileNameRef" />

                <BabylonPhysics v-if="sceneInitialized && connectionStatus === 'connected'" :scene="sceneNonNull"
                    :vircadia-world="vircadiaWorld" :gravity="[0, -9.81, 0]">
                    <template
                        #default="{ physicsEnabled: envPhysicsEnabled, physicsPluginName: envPhysicsPluginName, physicsError: envPhysicsError, physicsEngineType: envPhysicsEngineType, physicsInitialized: envPhysicsInitialized, havokInstanceLoaded: envHavokInstanceLoaded, physicsPluginCreated: envPhysicsPluginCreated, gravity: sceneGravity }">
                        <BabylonEnvironment :scene="sceneNonNull" :vircadia-world="vircadiaWorld"
                            :hdr-file="'babylon.level.hdr.1k.hdr'" ref="envRef"
                            v-slot="{ environmentInitialized: envInitialized }">
                            <!-- Sync physics slot values and environment state to top-level refs -->
                            <div style="display: none">
                                {{ envPhysicsEnabledRef = envPhysicsEnabled }}
                                {{ envPhysicsPluginNameRef = envPhysicsPluginName }}
                                {{ envPhysicsErrorRef = envPhysicsError }}
                                {{ envGravityRef = sceneGravity }}
                                {{ envPhysicsEngineTypeRef = envPhysicsEngineType || '' }}
                                {{ envPhysicsInitializedRef = !!envPhysicsInitialized }}
                                {{ envHavokInstanceLoadedRef = !!envHavokInstanceLoaded }}
                                {{ envPhysicsPluginCreatedRef = !!envPhysicsPluginCreated }}
                                {{ envInitializedRef = !!envInitialized }}
                            </div>

                            <template v-if="envInitialized && sceneInitialized && connectionStatus === 'connected'">
                                <!-- BabylonMyAvatar component wrapped with MKB controller -->
                                <BabylonMyAvatarMKBController :scene="sceneNonNull" :forward-codes="['KeyW', 'ArrowUp']"
                                    :backward-codes="['KeyS', 'ArrowDown']" :strafe-left-codes="['KeyA', 'ArrowLeft']"
                                    :strafe-right-codes="['KeyD', 'ArrowRight']" :jump-codes="['Space']"
                                    :sprint-codes="['ShiftLeft', 'ShiftRight']" :dash-codes="[]"
                                    :turn-left-codes="['KeyQ']" :turn-right-codes="['KeyE']"
                                    :fly-mode-toggle-codes="['KeyF']" :crouch-toggle-codes="['KeyC']"
                                    :prone-toggle-codes="['KeyZ']" :slow-run-toggle-codes="[]" v-slot="controls">
                                    <BabylonMyAvatarTalking
                                        v-slot="{ isTalking, level: talkLevel, devices: audioDevices, threshold: talkThreshold }">
                                        <BabylonMyAvatar :scene="sceneNonNull" :vircadia-world="vircadiaWorld"
                                            :key-state="controls.keyState" :is-talking="isTalking"
                                            :talk-level="talkLevel" :physics-enabled="envPhysicsEnabled"
                                            :physics-plugin-name="envPhysicsPluginName" :gravity="sceneGravity"
                                            ref="avatarRef">
                                            <template
                                                #default="{ avatarSkeleton, animations, vircadiaWorld, onAnimationState, avatarNode, modelFileName, meshPivotPoint, capsuleHeight, onSetAvatarModel, airborne, verticalVelocity, supportState, physicsEnabled, hasTouchedGround, spawnSettling, groundProbeHit, groundProbeDistance, groundProbeMeshName, onAvatarDefinitionLoaded, onEntityDataLoaded }">
                                                <!-- Renderless entity sync component runs outside of model v-if so it can load DB definition -->
                                                <BabylonMyAvatarEntity
                                                    v-if="vircadiaWorld.connectionInfo.value.status === 'connected'"
                                                    :scene="sceneNonNull" :vircadia-world="vircadiaWorld"
                                                    :avatar-node="(avatarNode) || null"
                                                    :target-skeleton="(avatarSkeleton) || null" :camera="null"
                                                    :model-file-name="modelFileName || ''"
                                                    :avatar-definition="avatarDefinition"
                                                    :persist-pose-snapshot-interval="5000"
                                                    :position-throttle-interval="50" :rotation-throttle-interval="50"
                                                    :camera-orientation-throttle-interval="100"
                                                    :joint-throttle-interval="50" :joint-position-decimals="3"
                                                    :joint-rotation-decimals="4" :joint-scale-decimals="5"
                                                    :joint-position-update-decimals="2"
                                                    :joint-rotation-update-decimals="3" :joint-scale-update-decimals="4"
                                                    :reflect-sync-group="'public.NORMAL'"
                                                    :reflect-channel="'avatar_joints'" :position-decimals="4"
                                                    :rotation-decimals="4" :scale-decimals="4"
                                                    :position-update-decimals="4" :rotation-update-decimals="4"
                                                    :scale-update-decimals="3"
                                                    @avatar-definition-loaded="onAvatarDefinitionLoaded"
                                                    @entity-data-loaded="onEntityDataLoaded"
                                                    @sync-stats="onAvatarSyncStats" />
                                                <BabylonMyAvatarModel v-if="modelFileName" :scene="sceneNonNull"
                                                    :vircadia-world="vircadiaWorld" :avatar-node="(avatarNode) || null"
                                                    :model-file-name="modelFileName" :mesh-pivot-point="meshPivotPoint"
                                                    :capsule-height="capsuleHeight"
                                                    :on-set-avatar-model="onSetAvatarModel" :animations="animations"
                                                    :on-animation-state="onAnimationState" @state="onAvatarModelState"
                                                    v-slot="{ targetSkeleton }">
                                                    <!-- Renderless desktop third-person camera -->
                                                    <BabylonMyAvatarDesktopThirdPersonCamera :scene="sceneNonNull"
                                                        :avatar-node="(avatarNode) || null"
                                                        :capsule-height="capsuleHeight" :min-z="0.1"
                                                        :lower-radius-limit="1.2" :upper-radius-limit="25"
                                                        :lower-beta-limit="0.15" :upper-beta-limit="Math.PI * 0.9"
                                                        :inertia="0.6" :panning-sensibility="0" :wheel-precision="40"
                                                        :fov-delta="((controls.keyState.forward ||
                                                            controls.keyState.backward ||
                                                            controls.keyState.strafeLeft ||
                                                            controls.keyState.strafeRight)
                                                            ? (controls.keyState.sprint ? 0.08 : 0.04)
                                                            : 0)
                                                            " :fov-lerp-speed="8" />
                                                    <!-- Non-visual animation loaders now slotted under model component -->
                                                    <BabylonMyAvatarAnimation v-for="anim in animations"
                                                        v-if="targetSkeleton" :key="anim.fileName" :scene="sceneNonNull"
                                                        :vircadia-world="vircadiaWorld" :animation="anim"
                                                        :target-skeleton="(targetSkeleton) || null"
                                                        @state="onAnimationState" />

                                                </BabylonMyAvatarModel>

                                                <!-- Debug overlays moved outside of model to render regardless of model availability -->
                                                <BabylonMyAvatarDebugOverlay :scene="sceneNonNull"
                                                    :vircadia-world="vircadiaWorld" :avatar-node="(avatarNode) || null"
                                                    :avatar-skeleton="(avatarSkeleton) || null"
                                                    :model-file-name="modelFileNameRef || modelFileName"
                                                    :model-step="avatarModelStep"
                                                    :model-error="avatarModelError || undefined" :is-talking="isTalking"
                                                    :talk-level="talkLevel" :talk-threshold="talkThreshold"
                                                    :audio-input-devices="audioDevices" :airborne="airborne"
                                                    :vertical-velocity="verticalVelocity" :support-state="supportState"
                                                    :physics-enabled="physicsEnabled"
                                                    :physics-plugin-name="envPhysicsPluginNameRef || undefined"
                                                    :physics-error="envPhysicsErrorRef || undefined"
                                                    :has-touched-ground="hasTouchedGround"
                                                    :spawn-settling="spawnSettling" :ground-probe-hit="groundProbeHit"
                                                    :ground-probe-distance="groundProbeDistance ?? undefined"
                                                    :ground-probe-mesh-name="groundProbeMeshName ?? undefined"
                                                    :sync-metrics="avatarSyncMetrics || undefined"
                                                    :animation-debug="(avatarRef)?.animationDebug || undefined"
                                                    v-model="avatarDebugOpen" hotkey="Shift+M" />
                                                <!-- Camera debug overlay -->
                                                <BabylonCameraDebugOverlay v-model="cameraDebugOpen"
                                                    :scene="sceneNonNull" :avatar-node="(avatarNode) || null"
                                                    hotkey="Shift+N" />
                                            </template>
                                        </BabylonMyAvatar>
                                    </BabylonMyAvatarTalking>
                                </BabylonMyAvatarMKBController>

                                <!-- Other avatars wrapper -->
                                <BabylonOtherAvatars :scene="sceneNonNull" :vircadia-world="vircadiaWorld"
                                    :current-full-session-id="connectionInfo.fullSessionId ?? undefined"
                                    :discovery-polling-interval="500" :reflect-sync-group="'public.NORMAL'"
                                    :reflect-channel="'avatar_joints'"
                                    v-slot="{ otherAvatarSessionIds, avatarDataMap, positionDataMap, rotationDataMap, jointDataMap }">
                                    <BabylonOtherAvatar v-for="otherFullSessionId in otherAvatarSessionIds || []"
                                        :key="otherFullSessionId" :scene="sceneNonNull" :vircadia-world="vircadiaWorld"
                                        :session-id="otherFullSessionId"
                                        :avatar-data="avatarDataMap?.[otherFullSessionId]"
                                        :position-data="positionDataMap?.[otherFullSessionId]"
                                        :rotation-data="rotationDataMap?.[otherFullSessionId]"
                                        :joint-data="jointDataMap?.[otherFullSessionId]"
                                        :on-ready="() => markLoaded(otherFullSessionId)"
                                        :on-dispose="() => markDisposed(otherFullSessionId)" />

                                    <!-- WebRTC component (now under OtherAvatars slot) -->
                                    <BabylonWebRTC v-model="showWebRTCControls" :vircadia-world="vircadiaWorld"
                                        :avatar-data-map="(avatarDataMap as Record<string, AvatarBaseData>) || {}"
                                        :position-data-map="(positionDataMap as Record<string, AvatarPositionData>) || {}"
                                        :rotation-data-map="(rotationDataMap as Record<string, AvatarRotationData>) || {}"
                                        :my-position-data="null" :my-camera-orientation="null"
                                        :on-set-peer-audio-state="setPeerAudioState"
                                        :on-remove-peer-audio-state="removePeerAudioState"
                                        :webrtc-sync-group="'public.NORMAL'"
                                        @permissions="onWebRTCPermissions($event)" />
                                </BabylonOtherAvatars>

                                <!-- BabylonModel components provided by DB-scanned list -->
                                <BabylonModels :vircadia-world="vircadiaWorld" v-slot="{ models }">
                                    <BabylonModel v-for="def in models" :key="def.fileName" :def="def"
                                        :scene="sceneNonNull" :vircadia-world="vircadiaWorld" ref="modelRefs"
                                        v-slot="{ meshes, def: slotDef }">
                                        <BabylonModelPhysics :scene="sceneNonNull" :meshes="meshes" :def="slotDef"
                                            ref="modelPhysicsRefs" />
                                    </BabylonModel>

                                    <BabylonModelsDebugOverlay v-model="modelsDebugOpen" :models="models"
                                        :model-runtime="modelRuntime" :physics-summaries="physicsSummaries" />
                                    <div style="display: none">
                                        {{setModelRuntimeFromRefs(models, (modelRefs).map((r: any) =>
                                            r?.meshes))}}
                                        {{ refreshPhysicsSummaries(models) }}
                                    </div>
                                </BabylonModels>


                                <!-- BabylonDoor component for interactive door -->
                                <BabylonDoor :scene="sceneNonNull" :vircadia-world="vircadiaWorld"
                                    entity-name="babylon.door.main" model-file-name="babylon.model.wooden_door.glb"
                                    :initial-position="{ x: 0, y: 0, z: 0 }"
                                    :initial-rotation="{ x: 0, y: 0, z: 0, w: 1 }" :initial-open="false"
                                    :rotation-open-radians="1.57" :rotation-axis="'y'" :sync-interval-ms="750"
                                    :update-throttle-ms="300" @state="onDoorState" @open="onDoorOpen" />
                            </template>
                        </BabylonEnvironment>
                    </template>
                </BabylonPhysics>
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
                    <LogoutButton :isAuthenticated="isAuthenticated" :onLogout="logout" />
                </div>

                <!-- Debug Controls removed: joint overlay toggle -->

                <!-- Audio Controls -->
                <v-tooltip bottom>
                    <template v-slot:activator="{ props }">
                        <v-btn fab small color="primary" @click="showWebRTCControls = true" v-bind="props"
                            class="toolbar-btn">
                            <v-badge v-if="activeAudioCount > 0" :content="activeAudioCount" color="success" overlap>
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
// BabylonJS types
import type { Scene, WebGPUEngine } from "@babylonjs/core";
import { clientBrowserConfiguration } from "@vircadia/world-sdk/browser/vue";
import { useStorage } from "@vueuse/core";
import {
    computed,
    type defineComponent,
    getCurrentInstance,
    onMounted,
    ref,
} from "vue";
import type {
    AvatarBaseData,
    AvatarJointMetadata,
    AvatarPositionData,
    AvatarRotationData,
} from "@/schemas";
import BabylonCameraDebugOverlay from "../components/BabylonCameraDebugOverlay.vue";
import BabylonCanvas from "../components/BabylonCanvas.vue";
import BabylonDoor from "../components/BabylonDoor.vue";
import BabylonEnvironment from "../components/BabylonEnvironment.vue";
import BabylonInspector from "../components/BabylonInspector.vue";
import BabylonModel from "../components/BabylonModel.vue";
import BabylonModelPhysics, {
    type PhysicsSummary,
} from "../components/BabylonModelPhysics.vue";
import BabylonModels from "../components/BabylonModels.vue";
import BabylonModelsDebugOverlay from "../components/BabylonModelsDebugOverlay.vue";
import BabylonMyAvatar, {
    type AvatarDefinition,
} from "../components/BabylonMyAvatar.vue";
import BabylonMyAvatarAnimation from "../components/BabylonMyAvatarAnimation.vue";
import BabylonMyAvatarDebugOverlay from "../components/BabylonMyAvatarDebugOverlay.vue";
import BabylonMyAvatarDesktopThirdPersonCamera from "../components/BabylonMyAvatarDesktopThirdPersonCamera.vue";
import BabylonMyAvatarEntity, {
    type AvatarSyncMetrics,
} from "../components/BabylonMyAvatarEntity.vue";
import BabylonMyAvatarMKBController from "../components/BabylonMyAvatarMKBController.vue";
import BabylonMyAvatarModel from "../components/BabylonMyAvatarModel.vue";
import BabylonMyAvatarTalking from "../components/BabylonMyAvatarTalking.vue";
import BabylonOtherAvatar from "../components/BabylonOtherAvatar.vue";
import BabylonOtherAvatars from "../components/BabylonOtherAvatars.vue";
import BabylonOtherAvatarsDebugOverlay from "../components/BabylonOtherAvatarsDebugOverlay.vue";
import BabylonPhysics from "../components/BabylonPhysics.vue";
import BabylonSnackbar from "../components/BabylonSnackbar.vue";
import LogoutButton from "../components/LogoutButton.vue";
import BabylonWebRTC from "./BabylonWebRTC.vue";
import SceneDrawer from "./SceneDrawer.vue";
import VircadiaWorldAuthProvider from "./VircadiaWorldAuthProvider.vue";
import VircadiaWorldProvider from "./VircadiaWorldProvider.vue";

// Auth change handling moved to provider

// Connection count is now managed by BabylonWebRTC component
// WebRTC controls dialog visibility
const showWebRTCControls = ref(false);
// removed collapsible debug app bar state

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

// Local debug drawer state
const drawerOpen = useStorage<boolean>("vrca.debug.sidebar.open", false);
const drawerTab = useStorage<string>("vrca.debug.sidebar.tab", "environment");
void drawerOpen;
void drawerTab;

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
const envGravityRef = ref<[number, number, number]>([0, -9.81, 0]);
const envPhysicsEngineTypeRef = ref<string>("");
const envPhysicsInitializedRef = ref<boolean>(false);
const envHavokInstanceLoadedRef = ref<boolean>(false);
const envPhysicsPluginCreatedRef = ref<boolean>(false);
const envInitializedRef = ref<boolean>(false);
void envPhysicsEnabledRef;
void envPhysicsPluginNameRef;
void envPhysicsErrorRef;
void envGravityRef;
void envPhysicsEngineTypeRef;
void envPhysicsInitializedRef;
void envHavokInstanceLoadedRef;
void envPhysicsPluginCreatedRef;
void envInitializedRef;

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
        const mm = m as unknown as {
            isEntityCreating?: boolean;
            isEntityRetrieving?: boolean;
            isAssetLoading?: boolean;
        } | null;
        return Boolean(
            mm?.isEntityCreating ||
            mm?.isEntityRetrieving ||
            mm?.isAssetLoading,
        );
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

// Mic/audio permission indicator state (from BabylonWebRTC)
const microphonePermission = ref<"granted" | "denied" | "prompt" | "unknown">(
    "unknown",
);
const audioContextState = ref<"resumed" | "suspended" | "unknown">("unknown");
const localStreamActive = ref<boolean>(false);

function onWebRTCPermissions(payload: {
    microphone: "granted" | "denied" | "prompt" | "unknown";
    audioContext: "resumed" | "suspended" | "unknown";
    localStreamActive: boolean;
}) {
    microphonePermission.value = payload.microphone;
    audioContextState.value = payload.audioContext;
    localStreamActive.value = payload.localStreamActive;
}

const micChipColor = computed(() => {
    switch (microphonePermission.value) {
        case "granted":
            return "success";
        case "prompt":
            return "warning";
        case "denied":
            return "error";
        default:
            return "grey";
    }
});
const micChipIcon = computed(() => {
    switch (microphonePermission.value) {
        case "granted":
            return "mdi-microphone";
        case "prompt":
            return "mdi-microphone-question";
        case "denied":
            return "mdi-microphone-off";
        default:
            return "mdi-microphone-settings";
    }
});

const audioChipColor = computed(() =>
    audioContextState.value === "resumed"
        ? "success"
        : audioContextState.value === "suspended"
            ? "warning"
            : "grey",
);
const audioChipIcon = computed(() =>
    audioContextState.value === "resumed"
        ? "mdi-volume-high"
        : audioContextState.value === "suspended"
            ? "mdi-volume-medium"
            : "mdi-volume-off",
);

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
html,
body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background-color: #202020;
}

main {
    padding: 0;
    margin: 0;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    display: flex;
    position: relative;
}

#renderCanvas {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
    outline: none;
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
