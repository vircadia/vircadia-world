<template>
    <!-- Right Debug Drawer -->
    <RightDrawer v-model:open="rightDrawerOpen" v-model:tab="rightDrawerTab"
        :environment-is-loading="!envRef?.environmentInitialized" :physics-enabled="physicsRef?.physicsEnabled"
        :physics-plugin-name="physicsRef?.physicsPluginName || undefined"
        :physics-error="physicsRef?.physicsError || undefined" :gravity="physicsRef?.gravity"
        :physics-engine-type="physicsRef?.physicsEngineType || ''" :physics-initialized="physicsRef?.physicsInitialized"
        :havok-instance-loaded="physicsRef?.havokInstanceLoaded"
        :physics-plugin-created="physicsRef?.physicsPluginCreated" :scene="sceneNonNull"
        :avatar-node="avatarRef?.avatarNode || null" :avatar-skeleton="avatarRef?.avatarSkeleton || null"
        :model-file-name="(avatarRef?.modelFileName) || (modelFileNameRef) || null" :model-step="avatarModelStep"
        :model-error="avatarModelError || undefined" :is-talking="!!(avatarRef?.isTalking)"
        :talk-level="Number(avatarRef?.talkLevel || 0)" :talk-threshold="Number(avatarRef?.talkThreshold || 0)"
        :audio-input-devices="(avatarRef?.audioInputDevices) || []" :airborne="!!(avatarRef?.lastAirborne)"
        :vertical-velocity="Number(avatarRef?.lastVerticalVelocity || 0)"
        :support-state="avatarRef?.lastSupportState ?? null" :has-touched-ground="!!(avatarRef?.hasTouchedGround)"
        :spawn-settling="!!(avatarRef?.spawnSettleActive)" :ground-probe-hit="!!(avatarRef?.groundProbeHit)"
        :ground-probe-distance="avatarRef?.groundProbeDistance ?? undefined"
        :ground-probe-mesh-name="avatarRef?.groundProbeMeshName ?? undefined"
        :animation-debug="avatarRef?.animationDebug || null" :sync-metrics="avatarSyncMetrics || undefined"
        :avatar-reflect-sync-group="'public.REALTIME'" :avatar-entity-sync-group="'public.NORMAL'"
        :avatar-reflect-channel="'avatar_data'" :other-avatar-session-ids="otherAvatarsRef?.otherAvatarSessionIds"
        :avatar-data-map="otherAvatarsRef?.avatarDataMap" :position-data-map="otherAvatarsRef?.positionDataMap || {}"
        :rotation-data-map="otherAvatarsRef?.rotationDataMap || {}"
        :joint-data-map="otherAvatarsRef?.jointDataMap || {}"
        :last-poll-timestamps="otherAvatarsRef?.lastPollTimestamps || {}"
        :last-base-poll-timestamps="otherAvatarsRef?.lastBasePollTimestamps || {}"
        :last-camera-poll-timestamps="otherAvatarsRef?.lastCameraPollTimestamps || {}"
        :other-avatars-is-loading="otherAvatarsRef?.areOtherAvatarsLoading"
        :other-avatars-poll-stats="otherAvatarsRef?.discoveryStats"
        :other-avatar-reflect-stats="otherAvatarsRef?.reflectStats" />
    <VircadiaWorldProvider v-slot="{ vircadiaWorld, connectionInfo, connectionStatus, isConnecting }">

        <!-- TODO: Split this into two components, auth UI and the internal component, so we can show the v-if else here instead of inside the component. -->
        <VircadiaWorldAuthProvider :vircadia-world="vircadiaWorld" :auto-connect="true"
            @auth-denied="onAuthDenied($event)">
            <template #default="{ isAuthenticated, isAuthenticating, accountDisplayName, logout, connect, disconnect }">
                <template v-if="connectionStatus === 'connected'">
                    <!-- Left Navigation Drawer extracted to component -->
                    <LeftDrawer v-model:open="leftDrawerOpen" :width="320" :isAuthenticated="isAuthenticated"
                        :displayName="accountDisplayName || undefined" :provider="connectionInfo.authProvider || 'anon'"
                        :onLogout="logout" :vircadia-world="vircadiaWorld" :connection-info="connectionInfo" />


                    <!-- Component Loader -->
                    <template v-for="comp in availableComponents" :key="comp">
                        <component :is="comp" :scene="scene" :engine="engine" :canvas="renderCanvas"
                            :vircadia-world="vircadiaWorld" />
                    </template>

                    <!-- App Bar with Actions -->
                    <v-app-bar density="compact" color="primary" flat>
                        <v-app-bar-nav-icon @click="leftDrawerOpen = !leftDrawerOpen" />
                        <v-spacer />

                        <!-- Audio Controls -->
                        <v-tooltip location="bottom">
                            <template #activator="{ props }">
                                <v-btn v-bind="props" icon variant="text"
                                    :color="activeAudioCount > 0 ? 'success' : undefined" class="ml-2"
                                    @click="showWebRTCControls = true">
                                    <v-icon>mdi-headphones</v-icon>
                                </v-btn>
                            </template>
                            <span>Audio Controls ({{ activeAudioCount }} active)</span>
                        </v-tooltip>

                        <!-- Performance Speed Dial -->
                        <v-speed-dial v-model="perfDialOpen" location="bottom end" transition="fade-transition">
                            <template #activator="{ props }">
                                <v-btn v-bind="props" icon class="ml-2"
                                    :color="performanceMode === 'normal' ? 'success' : 'warning'">
                                    <v-icon>{{ performanceMode === 'normal' ? 'mdi-speedometer' : 'mdi-speedometer-slow'
                                    }}</v-icon>
                                </v-btn>
                            </template>
                            <div key="normalPerf">
                                <v-tooltip location="bottom">
                                    <template #activator="{ props: aprops }">
                                        <v-btn v-bind="aprops" icon
                                            :color="performanceMode === 'normal' ? 'success' : undefined"
                                            @click="canvasComponentRef?.setPerformanceMode('normal'); perfDialOpen = false">
                                            <v-icon>mdi-speedometer</v-icon>
                                        </v-btn>
                                    </template>
                                    <span>Normal performance</span>
                                </v-tooltip>
                            </div>
                            <div key="lowPerf">
                                <v-tooltip location="bottom">
                                    <template #activator="{ props: aprops }">
                                        <v-btn v-bind="aprops" icon
                                            :color="performanceMode === 'low' ? 'warning' : undefined"
                                            @click="canvasComponentRef?.setPerformanceMode('low'); perfDialOpen = false">
                                            <v-icon>mdi-speedometer-slow</v-icon>
                                        </v-btn>
                                    </template>
                                    <span>Low performance</span>
                                </v-tooltip>
                            </div>
                        </v-speed-dial>

                        <!-- Movement Speed Dial -->
                        <v-speed-dial v-model="moveDialOpen" location="bottom end" transition="fade-transition">
                            <template #activator="{ props }">
                                <v-btn v-bind="props" icon class="ml-2"
                                    :color="(avatarRef?.isFlying) ? 'success' : undefined">
                                    <v-icon>{{ (avatarRef?.isFlying) ? 'mdi-airplane' : 'mdi-walk' }}</v-icon>
                                </v-btn>
                            </template>
                            <div key="fly">
                                <v-tooltip location="bottom">
                                    <template #activator="{ props: aprops }">
                                        <v-btn v-bind="aprops" icon color="success" :disabled="!!(avatarRef?.isFlying)"
                                            @click="!(avatarRef?.isFlying) && avatarRef?.toggleFlying && avatarRef.toggleFlying(); moveDialOpen = false">
                                            <v-icon>mdi-airplane-takeoff</v-icon>
                                        </v-btn>
                                    </template>
                                    <span>Fly on</span>
                                </v-tooltip>
                            </div>
                            <div key="walk">
                                <v-tooltip location="bottom">
                                    <template #activator="{ props: aprops }">
                                        <v-btn v-bind="aprops" icon :color="!(avatarRef?.isFlying) ? 'grey' : 'error'"
                                            :disabled="!(avatarRef?.isFlying)"
                                            @click="(avatarRef?.isFlying) && avatarRef?.toggleFlying && avatarRef.toggleFlying(); moveDialOpen = false">
                                            <v-icon>mdi-walk</v-icon>
                                        </v-btn>
                                    </template>
                                    <span>Fly off</span>
                                </v-tooltip>
                            </div>
                        </v-speed-dial>

                        <!-- Babylon Inspector (Dev only) -->
                        <template v-if="isDev">
                            <v-tooltip key="inspector" location="bottom">
                                <template #activator="{ props }">
                                    <v-btn v-bind="props" icon variant="text" class="ml-2" :disabled="!sceneInitialized"
                                        @click="inspectorRef?.toggleInspector()">
                                        <v-icon>{{ inspectorVisible ? 'mdi-file-tree' : 'mdi-file-tree-outline'
                                        }}</v-icon>
                                    </v-btn>
                                </template>
                                <span>Babylon Inspector (T)</span>
                            </v-tooltip>
                        </template>

                        <!-- Toggle Right Debug Drawer -->
                        <v-tooltip location="bottom">
                            <template #activator="{ props }">
                                <v-btn v-bind="props" icon variant="text" class="ml-2"
                                    @click="rightDrawerOpen = !rightDrawerOpen">
                                    <v-icon>mdi-dock-right</v-icon>
                                </v-btn>
                            </template>
                            <span>Debug Drawer</span>
                        </v-tooltip>
                    </v-app-bar>

                    <main>
                        <BabylonCanvas ref="canvasComponentRef" v-model:performanceMode="performanceMode"
                            v-model:fps="fps" />

                        <BabylonSnackbar :scene-initialized="sceneInitialized" :connection-status="connectionStatus"
                            :is-connecting="isConnecting" :environment-loading="!envRef?.environmentInitialized"
                            :avatar-loading="avatarLoading" :other-avatars-loading="otherAvatarsLoading"
                            :models-loading="modelsLoading" :is-authenticating="isAuthenticating"
                            :is-authenticated="isAuthenticated" :avatar-model-step="avatarModelStep"
                            :avatar-model-error="avatarModelError" :model-file-name="modelFileNameRef" />

                        <BabylonPhysics v-if="sceneInitialized && connectionStatus === 'connected'"
                            :scene="sceneNonNull" :vircadia-world="vircadiaWorld" :gravity="[0, -9.81, 0]"
                            ref="physicsRef">
                            <template
                                #default="{ physicsEnabled: envPhysicsEnabled, physicsPluginName: envPhysicsPluginName, physicsError: envPhysicsError, physicsEngineType: envPhysicsEngineType, physicsInitialized: envPhysicsInitialized, havokInstanceLoaded: envHavokInstanceLoaded, physicsPluginCreated: envPhysicsPluginCreated, gravity: sceneGravity }">
                                <BabylonEnvironment :scene="sceneNonNull" :vircadia-world="vircadiaWorld"
                                    :hdr-file="'babylon.level.hdr.1k.hdr'" :enable-defaults="true"
                                    :gravity="[0, -9.81, 0]"
                                    :hemispheric-light="{ enabled: true, direction: [1, 1, 0], intensity: 1.0 }"
                                    :directional-light="{ enabled: true, direction: [-1, -2, -1], position: [10, 10, 10], intensity: 1.0 }"
                                    :ground="{ enabled: true, width: 1000, height: 1000, position: [0, -1, 0], diffuseColor: [0.2, 0.2, 0.2], specularColor: [0.1, 0.1, 0.1], mass: 0, friction: 0.85, restitution: 0.1 }"
                                    ref="envRef" v-slot="{ environmentInitialized }">
                                    <!-- (removed) previously mirrored via SyncEnvState; now derived from physicsRef -->

                                    <template
                                        v-if="environmentInitialized && sceneInitialized && connectionStatus === 'connected'">
                                        <!-- BabylonMyAvatar component wrapped with MKB controller -->
                                        <BabylonMyAvatarMKBController :scene="sceneNonNull"
                                            :forward-codes="['KeyW', 'ArrowUp']" :backward-codes="['KeyS', 'ArrowDown']"
                                            :strafe-left-codes="['KeyA', 'ArrowLeft']"
                                            :strafe-right-codes="['KeyD', 'ArrowRight']" :jump-codes="['Space']"
                                            :sprint-codes="['ShiftLeft', 'ShiftRight']" :dash-codes="[]"
                                            :turn-left-codes="['KeyQ']" :turn-right-codes="['KeyE']"
                                            :fly-mode-toggle-codes="['KeyF']" :crouch-toggle-codes="['KeyC']"
                                            :prone-toggle-codes="['KeyZ']" :slow-run-toggle-codes="[]"
                                            v-slot="controls">
                                            <BabylonMyAvatarTalking
                                                v-slot="{ isTalking, level: talkLevel, devices: audioDevices, threshold: talkThreshold }">
                                                <BabylonMyAvatar :scene="sceneNonNull" :vircadia-world="vircadiaWorld"
                                                    :key-state="controls.keyState" :is-talking="isTalking"
                                                    :talk-level="talkLevel" :talk-threshold="talkThreshold"
                                                    :audio-devices="audioDevices" :physics-enabled="envPhysicsEnabled"
                                                    :physics-plugin-name="envPhysicsPluginName" :gravity="sceneGravity"
                                                    :avatar-definition="avatarDefinition" ref="avatarRef">
                                                    <template
                                                        #default="{ avatarSkeleton, animations, vircadiaWorld, onAnimationState, avatarNode, modelFileName, meshPivotPoint, capsuleHeight, onSetAvatarModel, airborne, verticalVelocity, supportState, physicsEnabled, hasTouchedGround, spawnSettling, groundProbeHit, groundProbeDistance, groundProbeMeshName, onEntityDataLoaded }">
                                                        <!-- Renderless entity sync component runs outside of model v-if so it can load DB definition -->
                                                        <BabylonMyAvatarEntity
                                                            v-if="vircadiaWorld.connectionInfo.value.status === 'connected'"
                                                            :scene="sceneNonNull" :vircadia-world="vircadiaWorld"
                                                            :avatar-node="avatarNode as TransformNode | null"
                                                            :target-skeleton="(avatarSkeleton) || null" :camera="null"
                                                            :model-file-name="modelFileName || ''"
                                                            :avatar-definition="avatarDefinition"
                                                            :persist-pose-snapshot-interval="5000"
                                                            :position-throttle-interval="50"
                                                            :rotation-throttle-interval="50"
                                                            :camera-orientation-throttle-interval="100"
                                                            :joint-throttle-interval="100" :joint-position-decimals="3"
                                                            :joint-rotation-decimals="4" :joint-scale-decimals="5"
                                                            :joint-position-update-decimals="2"
                                                            :joint-rotation-update-decimals="3"
                                                            :joint-scale-update-decimals="4"
                                                            :reflect-sync-group="'public.REALTIME'"
                                                            :entity-sync-group="'public.NORMAL'"
                                                            :reflect-channel="'avatar_data'" :position-decimals="4"
                                                            :rotation-decimals="4" :scale-decimals="4"
                                                            :position-update-decimals="4" :rotation-update-decimals="4"
                                                            :scale-update-decimals="3"
                                                            @entity-data-loaded="onEntityDataLoaded"
                                                            @sync-stats="onAvatarSyncStats" />
                                                        <BabylonMyAvatarModel v-if="modelFileName" :scene="sceneNonNull"
                                                            :vircadia-world="vircadiaWorld"
                                                            :avatar-node="(avatarNode as TransformNode | null) || null"
                                                            :model-file-name="modelFileName"
                                                            :mesh-pivot-point="meshPivotPoint"
                                                            :capsule-height="capsuleHeight"
                                                            :on-set-avatar-model="onSetAvatarModel"
                                                            :animations="animations"
                                                            :on-animation-state="onAnimationState"
                                                            @state="onAvatarModelState" v-slot="{ targetSkeleton }">
                                                            <!-- Renderless desktop third-person camera -->
                                                            <BabylonMyAvatarDesktopThirdPersonCamera
                                                                :scene="sceneNonNull"
                                                                :avatar-node="(avatarNode as TransformNode | null)"
                                                                :capsule-height="capsuleHeight" :min-z="0.1"
                                                                :lower-radius-limit="1.2" :upper-radius-limit="25"
                                                                :lower-beta-limit="0.15"
                                                                :upper-beta-limit="Math.PI * 0.9" :inertia="0.6"
                                                                :panning-sensibility="0" :wheel-precision="40"
                                                                :fov-delta="((controls.keyState.forward ||
                                                                    controls.keyState.backward ||
                                                                    controls.keyState.strafeLeft ||
                                                                    controls.keyState.strafeRight)
                                                                    ? (controls.keyState.sprint ? 0.08 : 0.04)
                                                                    : 0)
                                                                    " :fov-lerp-speed="8" />
                                                            <!-- Non-visual animation loaders now slotted under model component -->
                                                            <BabylonMyAvatarAnimation v-for="anim in animations"
                                                                v-if="targetSkeleton" :key="anim.fileName"
                                                                :scene="sceneNonNull" :vircadia-world="vircadiaWorld"
                                                                :animation="anim" :target-skeleton="targetSkeleton"
                                                                @state="onAnimationState" />

                                                        </BabylonMyAvatarModel>

                                                        <!-- (removed) syncing via hidden div; RightDrawer now reads via avatarRef -->
                                                        <!-- Camera debug overlay -->
                                                        <BabylonCameraDebugOverlay v-model="cameraDebugOpen"
                                                            :scene="sceneNonNull"
                                                            :avatar-node="(avatarNode as TransformNode | null)"
                                                            hotkey="Shift+N" />
                                                    </template>
                                                </BabylonMyAvatar>
                                            </BabylonMyAvatarTalking>
                                        </BabylonMyAvatarMKBController>

                                        <!-- Other avatars wrapper -->
                                        <BabylonOtherAvatars :scene="sceneNonNull" :vircadia-world="vircadiaWorld"
                                            :current-full-session-id="connectionInfo.fullSessionId ?? undefined"
                                            :discovery-polling-interval="500" :reflect-sync-group="'public.REALTIME'"
                                            :entity-sync-group="'public.NORMAL'" :reflect-channel="'avatar_data'"
                                            ref="otherAvatarsRef"
                                            v-slot="{ otherAvatarSessionIds, avatarDataMap, positionDataMap, rotationDataMap, jointDataMap }">
                                            <BabylonOtherAvatar
                                                v-for="otherFullSessionId in otherAvatarSessionIds || []"
                                                :key="otherFullSessionId" :scene="sceneNonNull"
                                                :vircadia-world="vircadiaWorld" :session-id="otherFullSessionId"
                                                :avatar-data="avatarDataMap?.[otherFullSessionId]"
                                                :position-data="positionDataMap?.[otherFullSessionId]"
                                                :rotation-data="rotationDataMap?.[otherFullSessionId]"
                                                :joint-data="jointDataMap?.[otherFullSessionId]"
                                                @ready="otherAvatarsRef?.markLoaded && otherAvatarsRef.markLoaded(otherFullSessionId)"
                                                @dispose="otherAvatarsRef?.markDisposed && otherAvatarsRef.markDisposed(otherFullSessionId)" />

                                            <!-- WebRTC component (now under OtherAvatars slot) -->
                                            <BabylonWebRTC v-model="showWebRTCControls" :client="vircadiaWorld"
                                                :full-session-id="connectionInfo.fullSessionId ?? null"
                                                :avatar-data="new Map(Object.entries((avatarDataMap as Record<string, AvatarBaseData>) || {}))"
                                                :avatar-positions="new Map(Object.entries((positionDataMap as Record<string, AvatarPositionData>) || {}))"
                                                :my-position="null" :my-camera-orientation="null"
                                                :webrtc-sync-group="'public.NORMAL'"
                                                @permissions="onWebRTCPermissions($event)" />
                                        </BabylonOtherAvatars>

                                        <!-- BabylonModel components provided by DB-scanned list -->
                                        <BabylonModels :vircadia-world="vircadiaWorld" v-slot="{ models }">
                                            <BabylonModel v-for="def in models" :key="def.fileName" :def="def"
                                                :scene="sceneNonNull" :vircadia-world="vircadiaWorld" ref="modelRefs"
                                                v-slot="{ meshes, def: slotDef }">
                                                <BabylonModelPhysics :scene="sceneNonNull" :meshes="meshes"
                                                    :def="slotDef" ref="modelPhysicsRefs" />
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
                                            entity-name="babylon.door.main"
                                            model-file-name="babylon.model.wooden_door.glb"
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

                    <!-- Headless Babylon Inspector instance for programmatic control (Dev only) -->
                    <template v-if="isDev">
                        <BabylonInspector ref="inspectorRef" :scene="sceneNonNull" :headless="true"
                            @visible-change="onInspectorVisibleChange" />
                    </template>

                    <!-- Audio controls dialog now lives inside BabylonWebRTC -->
                </template>
            </template>
        </VircadiaWorldAuthProvider>
    </VircadiaWorldProvider>
</template>

<script setup lang="ts">
// BabylonJS types
import type {
    Scene,
    TransformNode,
} from "@babylonjs/core";

import { clientBrowserConfiguration } from "@vircadia/world-sdk/browser/vue";
import { useStorage } from "@vueuse/core";
import {
    computed,
    defineComponent,
    getCurrentInstance,
    onMounted,
    ref,
    watch,
} from "vue";
import BabylonCameraDebugOverlay from "@/components/BabylonCameraDebugOverlay.vue";
import BabylonCanvas from "@/components/BabylonCanvas.vue";
import BabylonDoor from "@/components/BabylonDoor.vue";
import BabylonEnvironment from "@/components/BabylonEnvironment.vue";
import BabylonInspector from "@/components/BabylonInspector.vue";
import BabylonModel from "@/components/BabylonModel.vue";
import BabylonModelPhysics, {
    type PhysicsSummary,
} from "@/components/BabylonModelPhysics.vue";
import BabylonModels from "@/components/BabylonModels.vue";
import BabylonModelsDebugOverlay from "@/components/BabylonModelsDebugOverlay.vue";
import BabylonMyAvatar, {
    type AvatarDefinition,
} from "@/components/BabylonMyAvatar.vue";
import BabylonMyAvatarAnimation from "@/components/BabylonMyAvatarAnimation.vue";
import BabylonMyAvatarDesktopThirdPersonCamera from "@/components/BabylonMyAvatarDesktopThirdPersonCamera.vue";
import BabylonMyAvatarEntity, {
    type AvatarSyncMetrics,
} from "@/components/BabylonMyAvatarEntity.vue";
import BabylonMyAvatarMKBController from "@/components/BabylonMyAvatarMKBController.vue";
import BabylonMyAvatarModel from "@/components/BabylonMyAvatarModel.vue";
import BabylonMyAvatarTalking from "@/components/BabylonMyAvatarTalking.vue";
import BabylonOtherAvatar from "@/components/BabylonOtherAvatar.vue";
import BabylonOtherAvatars from "@/components/BabylonOtherAvatars.vue";
import BabylonPhysics from "@/components/BabylonPhysics.vue";
import BabylonSnackbar from "@/components/BabylonSnackbar.vue";
import BabylonWebRTC from "@/components/BabylonWebRTC.vue";
import LeftDrawer from "@/components/LeftDrawer.vue";
import RightDrawer from "@/components/RightDrawer.vue";
import VircadiaWorldAuthProvider from "@/components/VircadiaWorldAuthProvider.vue";
import VircadiaWorldProvider from "@/components/VircadiaWorldProvider.vue";
import type {
    AvatarBaseData,
    AvatarJointMetadata,
    AvatarPositionData,
    AvatarRotationData,
} from "@/schemas";

// Auth change handling moved to provider

// Connection count is now managed by BabylonWebRTC component
// WebRTC controls dialog visibility
const showWebRTCControls = ref(false);
// removed collapsible debug app bar state

// Session/agent and world instance are provided reactively via slot props; no local refs needed

// Scene readiness derived from BabylonCanvas exposed API
// Track if avatar is ready
const avatarRef = ref<InstanceType<typeof BabylonMyAvatar> | null>(null);

const otherAvatarsRef = ref<InstanceType<typeof BabylonOtherAvatars> | null>(
    null,
);
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

// Other avatar discovery handled by BabylonOtherAvatars wrapper

// Physics handled by BabylonCanvas

// State for debug overlays with persistence across reloads
const cameraDebugOpen = useStorage<boolean>("vrca.debug.camera", false);
// Models debug overlay
const modelsDebugOpen = useStorage<boolean>("vrca.debug.models", false);

// Other avatars overlay
const otherAvatarsDebugOpen = useStorage<boolean>(
    "vrca.debug.otherAvatars",
    false,
);

const canvasComponentRef = ref<InstanceType<typeof BabylonCanvas> | null>(null);
const inspectorRef = ref<InstanceType<typeof BabylonInspector> | null>(null);
const inspectorVisible = ref<boolean>(false);
const isDev = import.meta.env.DEV;

function onInspectorVisibleChange(v: boolean) {
    inspectorVisible.value = v;
}

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

const performanceMode = useStorage<"normal" | "low">("vrca.perf.mode", "low");
const fps = ref<number>(0);

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

// TODO: This global flag should be well defined somewhere as a const or setting.
// Set global flag when scene is ready for autonomous agent
if (clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_AUTONOMOUS_AGENT_ENABLED) {
    watch(sceneInitialized, (isReady) => {
        if (isReady) {
            (window as typeof window & { __VIRCADIA_SCENE_READY__?: boolean }).__VIRCADIA_SCENE_READY__ = true;
            console.debug("[MainScene] Scene ready flag set for autonomous agent");
        }
    });
}


// No onUnmounted reset needed; canvas manages its own ready state

// Performance mode toggle function
function togglePerformanceMode() {
    if (canvasComponentRef.value) {
        canvasComponentRef.value.togglePerformanceMode();
        // Vue's v-model will automatically sync the performanceMode ref
    }
}

// Speed-dial UI state
const perfDialOpen = ref(false);
const moveDialOpen = ref(false);

// (inlined in template) performance/flying helpers removed

// Local debug drawer state
const rightDrawerOpen = useStorage<boolean>("vrca.right.drawer.open", false);
const rightDrawerTab = useStorage<string>(
    "vrca.right.drawer.tab",
    "environment",
);
const leftDrawerOpen = useStorage<boolean>("vrca.nav.left.open", false);

const activeAudioCount = computed(() => 0);

const envRef = ref<InstanceType<typeof BabylonEnvironment> | null>(null);

const physicsRef = ref<InstanceType<typeof BabylonPhysics> | null>(null);

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
    walkSpeed: 1.7,
    turnSpeed: Math.PI,
    blendDuration: 0.15,
    disableRootMotion: true,
    startFlying: true,
    runSpeedMultiplier: 2.2,
    backWalkMultiplier: 0.6,
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

// Physics error now comes from BabylonEnvironment slot props (envPhysicsError)

// Child component loading states
const avatarLoading = computed(
    () =>
        // Fallback to model loading only now that entity sync is internal
        avatarModelLoading.value,
);
// Other avatars loading state is handled internally by BabylonOtherAvatars component
const otherAvatarsLoading = computed(() => false); // Placeholder - loading state managed by component
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

// Runtime info for models to augment overlay (e.g., mesh counts)
type ModelRuntimeInfo = { meshCount: number };
const modelRuntime = ref<Record<string, ModelRuntimeInfo>>({});
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

// Avatar debug state surfaced to RightDrawer
// (removed) mirror refs and sync helpers; RightDrawer now uses avatarRef's exposed state

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

// Removed local other avatar handlers; events are forwarded to BabylonOtherAvatars via ref

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

/* AvatarSDKExample loads the sample GLB; removed from MainScene */

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
</style>
