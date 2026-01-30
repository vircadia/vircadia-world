<template>
    <div style="position: relative; width: 100%; height: 100%; overflow: hidden">
        <BabylonCanvas ref="canvasComponentRef" v-model:performanceMode="performanceMode" :engine-type="engineType">
            <template
                #default="{ scene: providedScene, physicsEnabled: envPhysicsEnabled, physicsPluginName: envPhysicsPluginName, physicsError: envPhysicsError, physicsEngineType: envPhysicsEngineType, physicsInitialized: envPhysicsInitialized, havokInstanceLoaded: envHavokInstanceLoaded, physicsPluginCreated: envPhysicsPluginCreated, gravity: sceneGravity }">

                <!-- World Content Slot (Injected by Parent) -->
                <slot :scene="providedScene" />

                <BabylonMic :echo-cancellation="micEchoCancellation" :noise-suppression="micNoiseSuppression"
                    :auto-gain-control="micAutoGainControl">
                    <template #default="{ stream: micStream }">
                        <VircadiaCloudInferenceProvider ref="cloudAgentRef" :vircadia-world="vircadiaWorld"
                            :webrtc-ref="webrtcApi" :webrtc-local-stream="webrtcLocalStream"
                            :webrtc-remote-streams="webrtcRemoteStreamsMap" :agent-mic-input-stream="micStream"
                            :agent-echo-output-stream="agentEchoOutputStream"
                            :agent-tts-output-mode="agentTtsOutputMode" :agent-wake-word="agentWakeWord"
                            :agent-end-word="agentEndWord" :agent-language="agentLanguage"
                            :agent-enable-tts="agentEnableTTS && agentActive"
                            :agent-enable-llm="agentEnableLLM && agentActive"
                            :agent-enable-stt="agentEnableSTT && agentActive" :agent-stt-pre-gain="agentSttPreGain"
                            :agent-stt-input-mode="agentSttInputMode"
                            :agent-stt-target-sample-rate="agentSttTargetSampleRate"
                            :agent-stt-worklet-chunk-ms="agentSttWorkletChunkMs" :agent-vad-config="agentVadConfig"
                            :agent-llm-max-new-tokens="agentLlmMaxNewTokens"
                            :agent-llm-temperature="agentLlmTemperature"
                            :agent-llm-open-think-tag="agentLlmOpenThinkTag"
                            :agent-llm-close-think-tag="agentLlmCloseThinkTag"
                            :agent-ui-max-transcripts="agentUiMaxTranscripts"
                            :agent-ui-max-assistant-replies="agentUiMaxAssistantReplies"
                            :agent-ui-max-conversation-items="agentUiMaxConversationItems"
                            :agent-company-name="agentCompanyName" v-model:active="agentActive">

                            <template
                                #default="{ capabilitiesEnabled: agentCapabilities, agentSttWorking, agentTtsWorking, agentLlmWorking, ttsLevel, ttsTalking, ttsThreshold }">
                                <BabylonTalkLevel :audio-stream="micStream || null"
                                    v-slot="{ isTalking: micTalking, level: micLevel, threshold: micThreshold }">

                                    <v-snackbar :model-value="!(providedScene?.isReady())" location="bottom">
                                        <v-progress-circular indeterminate color="white" size="24" class="mr-2" />
                                        <span>Loading scene...</span>
                                    </v-snackbar>
                                    <template v-if="providedScene">
                                        <!-- Babylon Inspector (Dev only) -->
                                        <BabylonInspector ref="inspectorRef" :scene="providedScene"
                                            @visible-change="onInspectorVisibleChange" />

                                        <BabylonSnackbar :scene-ready="!!providedScene"
                                            :connection-status="vircadiaWorld.connectionInfo?.value?.status || 'disconnected'"
                                            :is-connecting="vircadiaWorld.connectionInfo?.value?.isConnecting || false"
                                            :avatar-loading="avatarLoading" :other-avatars-loading="otherAvatarsLoading"
                                            :is-authenticating="false" :is-authenticated="true"
                                            :avatar-model-step="avatarModelStep" :avatar-model-error="avatarModelError"
                                            :model-file-name="modelFileNameRef" />

                                        <!-- Camera Lock Alert -->
                                        <v-fade-transition>
                                            <v-alert density="compact" type="info" variant="flat"
                                                class="camera-lock-alert"
                                                style="position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%); z-index: 100; width: auto; pointer-events: none;">
                                                <div v-if="avatarRef?.keyState?.mouseLockCameraRotate || avatarRef?.keyState?.mouseLockCameraAvatarRotate"
                                                    class="d-flex align-center">
                                                    <span class="mr-2">Press</span>
                                                    <v-hotkey variant="elevated" platform="auto" keys="ESC" />
                                                    <span class="ml-2">to exit camera lock mode</span>
                                                </div>
                                                <div v-else class="d-flex align-center">
                                                    <span class="mr-2">Camera lock with</span>
                                                    <v-hotkey variant="elevated" platform="auto" keys="1" />
                                                    <span class="mx-2">or</span>
                                                    <v-hotkey variant="elevated" platform="auto" keys="2" />
                                                </div>
                                            </v-alert>
                                        </v-fade-transition>

                                        <!-- Flying Alert -->
                                        <v-fade-transition>
                                            <v-alert v-if="avatarRef?.isFlying" density="compact" type="info"
                                                variant="flat" class="flying-alert"
                                                style="position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 100; width: auto; pointer-events: none;">
                                                <div class="d-flex align-center">
                                                    <span class="mr-2">You can toggle flying by pressing</span>
                                                    <v-hotkey variant="elevated" platform="auto" keys="F" />
                                                </div>
                                            </v-alert>
                                        </v-fade-transition>

                                        <!-- MKB Controller Wrapper -->
                                        <BabylonMyAvatarMKBController :scene="providedScene" :forward-codes="['KeyW']"
                                            :backward-codes="['KeyS']" :strafe-left-codes="['KeyA']"
                                            :strafe-right-codes="['KeyD']" :jump-codes="['Space']"
                                            :sprint-codes="['ShiftLeft', 'ShiftRight']" :dash-codes="[]"
                                            :turn-left-codes="['KeyQ']" :turn-right-codes="['KeyE']"
                                            :fly-mode-toggle-codes="['KeyF']" :crouch-toggle-codes="['KeyC']"
                                            :prone-toggle-codes="['KeyZ']" :slow-run-toggle-codes="[]"
                                            :mouse-lock-camera-rotate-toggle-codes="['Digit1']"
                                            :mouse-lock-camera-avatar-rotate-toggle-codes="['Digit2']"
                                            :initial-mouse-lock-camera-avatar-rotate="true" v-slot="{ keyState }">

                                            <BabylonMyAvatar :scene="providedScene" :vircadia-world="vircadiaWorld"
                                                :is-talking="isAutonomousAgent ? ttsTalking : micTalking"
                                                :talk-level="isAutonomousAgent ? ttsLevel : micLevel"
                                                :talk-threshold="isAutonomousAgent ? ttsThreshold : micThreshold"
                                                :audio-devices="audioDevices" :physics-enabled="envPhysicsEnabled"
                                                :physics-plugin-name="envPhysicsPluginName" :gravity="sceneGravity"
                                                :avatar-definition="avatarDefinition" :key-state="keyState"
                                                ref="avatarRef">

                                                <!-- Entity sync slot -->
                                                <template
                                                    #entity="{ avatarNode, targetSkeleton, modelFileName, avatarDefinition, onEntityDataLoaded }">
                                                    <BabylonMyAvatarEntity :scene="providedScene"
                                                        :vircadia-world="vircadiaWorld"
                                                        :avatar-node="avatarNode as TransformNode | null"
                                                        :target-skeleton="targetSkeleton || null" :camera="null"
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
                                                    <ChatBubble :scene="providedScene"
                                                        :avatar-node="avatarNode as TransformNode | null"
                                                        :messages="localChatMessages" />
                                                </template>

                                                <!-- Model slot -->
                                                <template
                                                    #model="{ avatarNode, modelFileName, modelUrl, meshPivotPoint, capsuleHeight, onSetAvatarModel, animations, targetSkeleton, onAnimationState, boneMapping }">
                                                    <BabylonMyAvatarModel v-if="modelFileName" :scene="providedScene"
                                                        :vircadia-world="vircadiaWorld"
                                                        :avatar-node="(avatarNode as TransformNode | null) || null"
                                                        :model-file-name="modelFileName" :model-url="modelUrl"
                                                        :mesh-pivot-point="meshPivotPoint"
                                                        :capsule-height="capsuleHeight"
                                                        :on-set-avatar-model="onSetAvatarModel" :animations="animations"
                                                        :on-animation-state="onAnimationState"
                                                        @state="onAvatarModelState" v-slot="{ targetSkeleton }">
                                                        <!-- Renderless desktop third-person camera -->
                                                        <BabylonMyAvatarDesktopThirdPersonCamera :scene="providedScene"
                                                            :avatar-node="(avatarNode as TransformNode | null)"
                                                            :capsule-height="capsuleHeight" :min-z="0.1"
                                                            :lower-radius-limit="1.2" :upper-radius-limit="25"
                                                            :lower-beta-limit="0.15" :upper-beta-limit="Math.PI * 0.9"
                                                            :inertia="0.6" :panning-sensibility="0"
                                                            :wheel-precision="40" :fov-delta="((avatarRef?.keyState?.forward ||
                                                                avatarRef?.keyState?.backward ||
                                                                avatarRef?.keyState?.strafeLeft ||
                                                                avatarRef?.keyState?.strafeRight)
                                                                ? (avatarRef?.keyState?.sprint ? 0.08 : 0.04)
                                                                : 0)
                                                                " :fov-lerp-speed="8"
                                                            :mouse-lock-camera-rotate-toggle="!!(avatarRef?.keyState?.mouseLockCameraRotate)"
                                                            :mouse-lock-camera-avatar-rotate-toggle="!!(avatarRef?.keyState?.mouseLockCameraAvatarRotate)"
                                                            :override-mouse-lock-camera-avatar-rotate="!!(avatarRef?.keyState?.turnLeft || avatarRef?.keyState?.turnRight)"
                                                            :snap-strategy="'vertical-only'" :debug="cameraDebugOpen" />
                                                        <!-- Non-visual animation loaders now slotted under model component -->
                                                        <BabylonMyAvatarAnimation v-for="anim in animations"
                                                            v-if="targetSkeleton" :key="anim.fileName"
                                                            :scene="providedScene" :vircadia-world="vircadiaWorld"
                                                            :animation="anim" :target-skeleton="targetSkeleton"
                                                            :bone-mapping="boneMapping" @state="onAnimationState" />

                                                    </BabylonMyAvatarModel>
                                                </template>

                                                <!-- Agent slot -->
                                                <template
                                                    #agent="{ scene, vircadiaWorld, avatarNode, physicsEnabled, physicsPluginName, gravity, followOffset, maxSpeed, isTalking, talkLevel, talkThreshold }">
                                                    <VircadiaAgent :scene="scene" :vircadia-world="vircadiaWorld"
                                                        :avatar-node="(avatarNode as TransformNode | null)"
                                                        :physics-enabled="physicsEnabled"
                                                        :physics-plugin-name="physicsPluginName" :gravity="gravity"
                                                        :follow-offset="(followOffset as [number, number, number])"
                                                        :max-speed="maxSpeed" :is-talking="ttsTalking"
                                                        :talk-level="ttsLevel" :talk-threshold="ttsThreshold"
                                                        :agent-stt-enabled="agentCapabilities.stt"
                                                        :agent-tts-enabled="agentCapabilities.tts"
                                                        :agent-llm-enabled="agentCapabilities.llm"
                                                        :agent-stt-working="agentSttWorking"
                                                        :agent-tts-working="agentTtsWorking"
                                                        :agent-llm-working="agentLlmWorking"
                                                        v-model:active="agentActive" />
                                                </template>

                                                <!-- Other avatars slot -->
                                                <template #other-avatars="{ scene, vircadiaWorld }">
                                                    <BabylonOtherAvatars :scene="scene" :vircadia-world="vircadiaWorld"
                                                        :reflect-sync-group="'public.REALTIME'"
                                                        :entity-sync-group="'public.NORMAL'"
                                                        :reflect-channel="'avatar_data'" ref="otherAvatarsRef"
                                                        v-slot="{ otherAvatarSessionIds, avatarDataMap, positionDataMap }">

                                                        <!-- WebRTC component (now under OtherAvatars slot) -->
                                                        <BabylonWebRTC ref="webrtcRef" v-model="showWebRTCControls"
                                                            :client="vircadiaWorld"
                                                            :avatar-data="new Map(Object.entries((avatarDataMap as Record<string, AvatarBaseData>) || {}))"
                                                            :avatar-positions="new Map(Object.entries((positionDataMap as Record<string, AvatarPositionData>) || {}))"
                                                            :my-position="audioListenerPosition"
                                                            :my-camera-orientation="audioListenerOrientation"
                                                            :webrtc-sync-group="'public.NORMAL'"
                                                            @permissions="onWebRTCPermissions($event)"
                                                            v-model:local-audio-stream="webrtcLocalStream"
                                                            v-model:peers-map="webrtcPeersMap"
                                                            v-model:remote-streams-map="webrtcRemoteStreamsMap"
                                                            :headless-uplink="isAutonomousAgent"
                                                            :injected-local-stream="micStream"
                                                            v-model:echo-cancellation="micEchoCancellation"
                                                            v-model:noise-suppression="micNoiseSuppression"
                                                            v-model:auto-gain-control="micAutoGainControl"
                                                            :spatial-rolloff-factor="0.5" />

                                                    </BabylonOtherAvatars>
                                                </template>

                                            </BabylonMyAvatar>
                                        </BabylonMyAvatarMKBController>
                                    </template>
                                </BabylonTalkLevel>
                            </template>
                        </VircadiaCloudInferenceProvider>
                        <VoiceChatInput ref="voiceChatInputRef" :vircadia-world="vircadiaWorld" :mic-stream="micStream"
                            @message="onChatMessage($event, vircadiaWorld)" />
                    </template>
                </BabylonMic>

                <!-- UI Slot for standard UI Overlays -->
                <slot name="ui" />

            </template>
        </BabylonCanvas>
    </div>
</template>

<script setup lang="ts">
// BabylonJS types
import type { TransformNode } from "@babylonjs/core";
import VoiceChatInput from "@/components/VoiceChatInput.vue";
import ChatBubble from "@/components/ChatBubble.vue";

import { useStorage } from "@vueuse/core";
import type { ComponentPublicInstance } from "vue";
import {
    computed,
    defineComponent,
    getCurrentInstance,
    onMounted,
    provide,
    ref,
    watch,
    type Component,
    type DefineComponent,
} from "vue";
import BabylonCanvas from "@/components/BabylonCanvas.vue";
import BabylonInspector from "@/components/BabylonInspector.vue";
import BabylonMic from "@/components/BabylonMic.vue";
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

import BabylonOtherAvatars from "@/components/BabylonOtherAvatars.vue";
import BabylonSnackbar from "@/components/BabylonSnackbar.vue";
import BabylonTalkLevel from "@/components/BabylonTalkLevel.vue";
import BabylonWebRTC from "@/components/BabylonWebRTC.vue";
import VircadiaAgent from "@/components/VircadiaAgent.vue";
import VircadiaCloudInferenceProvider from "@/components/VircadiaCloudInferenceProvider.vue";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";
import type {
    AvatarBaseData,
    AvatarJointMetadata,
    AvatarPositionData,
    AvatarRotationData,
    ChatMessage,
} from "@/schemas";
import {
    clientBrowserConfiguration,
    clientBrowserState,
} from "@vircadia/world-sdk/browser/vue";

import { useAppStore } from "@/stores/appStore";

const props = defineProps<{
    vircadiaWorld: VircadiaWorldInstance;
    engineType?: "webgl" | "webgpu" | "nullengine";
    physicsEnabled?: boolean;
    physicsGravity?: [number, number, number];
}>();

const appStore = useAppStore();
const avatarDefinition = computed(() => appStore.avatarDefinition);

// isAutonomousAgent now comes from browser state via URL parameter detection
const isAutonomousAgent = computed(() =>
    clientBrowserState.isAutonomousAgent(),
);

// WebRTC controls dialog visibility (local tracking within Scene)
const showWebRTCControls = ref(false);

// Refs for exposed components
const canvasComponentRef = ref<InstanceType<typeof BabylonCanvas> | null>(null);
const avatarRef = ref<InstanceType<typeof BabylonMyAvatar> | null>(null);
const otherAvatarsRef = ref<InstanceType<typeof BabylonOtherAvatars> | null>(null);
const inspectorRef = ref<InstanceType<typeof BabylonInspector> | null>(null);

// State for debug overlays with persistence across reloads
const cameraDebugOpen = useStorage<boolean>("vrca.debug.camera", false);
const modelsDebugOpen = useStorage<boolean>("vrca.debug.models", false);

const inspectorVisible = ref<boolean>(false);
const isDev = import.meta.env.DEV;

function onInspectorVisibleChange(v: boolean) {
    inspectorVisible.value = v;
}

const performanceMode = useStorage<"normal" | "low">("vrca.perf.mode", "normal");

// WebRTC component ref for direct Agent API access (replaces bus)
const agentActive = useStorage<boolean>("vrca.agent.active", true);

type WebRTCRefApi = {
    getLocalStream: () => MediaStream | null;
    getPeersMap: () => Map<string, RTCPeerConnection>;
    getRemoteStreamsMap: () => Map<string, MediaStream>;
    getUplinkAudioContext: () => AudioContext | null;
    getUplinkDestination: () => MediaStreamAudioDestinationNode | null;
    ensureUplinkDestination: () => Promise<MediaStreamTrack | null>;
    replaceUplinkWithDestination: () => Promise<boolean>;
    restoreUplinkMic: () => Promise<boolean>;
    connectMicToUplink: (enabled: boolean) => void;
    connectNodeToUplink: (node: AudioNode) => void;
};

const webrtcRef = ref<(ComponentPublicInstance & Partial<WebRTCRefApi>) | null>(null);
const cloudAgentRef = ref<ComponentPublicInstance | null>(null);
const voiceChatInputRef = ref<InstanceType<typeof VoiceChatInput> | null>(null);

// Spatial Audio State
const audioListenerPosition = ref<AvatarPositionData | null>(null);
const audioListenerOrientation = ref<{
    alpha: number;
    beta: number;
    radius: number;
    rotation?: { y: number };
} | null>(null);

function updateSpatialAudioPosition() {
    // Update camera orientation
    if (canvasComponentRef.value?.scene?.activeCamera) {
        const cam = canvasComponentRef.value.scene.activeCamera as any; // Cast to access alpha/beta if arc rotate
        const orientation = { ...audioListenerOrientation.value } as any;

        if (cam.alpha !== undefined && cam.beta !== undefined) {
            orientation.alpha = cam.alpha;
            orientation.beta = cam.beta;
            orientation.radius = cam.radius || 10;
        }

        // Also capture rotation from avatar/camera if available for detailed spatial audio
        if (avatarRef.value?.avatarNode) {
            // Example: orientation.rotation = { y: avatarRef.value.avatarNode.rotation.y };
        }

        audioListenerOrientation.value = orientation;
    }

    // Update avatar position
    if (avatarRef.value?.avatarNode?.position) {
        const pos = avatarRef.value.avatarNode.position;
        audioListenerPosition.value = {
            x: pos.x,
            y: pos.y,
            z: pos.z
        };
    }
}

// Set up spatial audio polling loop (low frequency)
let spatialPoller = 0;
onMounted(() => {
    spatialPoller = window.setInterval(() => {
        updateSpatialAudioPosition();
    }, 200);
});

const webrtcApi = computed<WebRTCRefApi | null>(() =>
    webrtcRef.value
        ? {
            getLocalStream: () => webrtcRef.value?.getLocalStream?.() ?? null,
            getPeersMap: () =>
                webrtcRef.value?.getPeersMap?.() ??
                new Map<string, RTCPeerConnection>(),
            getRemoteStreamsMap: () =>
                webrtcRef.value?.getRemoteStreamsMap?.() ??
                new Map<string, MediaStream>(),
            getUplinkAudioContext: () =>
                webrtcRef.value?.getUplinkAudioContext?.() ?? null,
            getUplinkDestination: () =>
                webrtcRef.value?.getUplinkDestination?.() ?? null,
            ensureUplinkDestination: async () =>
                await (webrtcRef.value?.ensureUplinkDestination?.() ?? null),
            replaceUplinkWithDestination: async () =>
                await (webrtcRef.value?.replaceUplinkWithDestination?.() ??
                    false),
            restoreUplinkMic: async () =>
                await (webrtcRef.value?.restoreUplinkMic?.() ?? false),
            connectMicToUplink: (enabled: boolean) =>
                webrtcRef.value?.connectMicToUplink?.(enabled),
            connectNodeToUplink: (node: AudioNode) =>
                webrtcRef.value?.connectNodeToUplink?.(node),
        }
        : null,
);

// Agent mic input and echo output streams
const agentEchoAudioContext = ref<AudioContext | null>(null);
const agentEchoOutputStream = ref<MediaStreamAudioDestinationNode | null>(null);

// Initialize echo output stream synchronously
try {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    agentEchoAudioContext.value = ctx;
    agentEchoOutputStream.value = dest;
} catch (e) {
    console.warn(
        "[VircadiaScene] Failed to init agent echo output synchronously:",
        e,
    );
}

// Reactive mirrors of WebRTC internals
const webrtcLocalStream = ref<MediaStream | null>(null);
const webrtcPeersMap = ref(new Map<string, RTCPeerConnection>());
const webrtcRemoteStreamsMap = ref(new Map<string, MediaStream>());

// Agent configuration defaults
const agentWakeWord = ref<string>("");
const agentEndWord = ref<string>("");
const agentTtsOutputMode = ref<"local" | "webrtc" | "both">("local");
const agentEnableLLM = ref<boolean>(true);
const agentEnableSTT = ref<boolean>(true);
const agentEnableTTS = ref<boolean>(true);
const agentLanguage = ref<string>("en");
const agentSttPreGain = ref<number>(0.5);
const agentSttInputMode = ref<"webrtc" | "mic" | "both">("mic");
const agentSttTargetSampleRate = ref<number>(16000);
const agentSttWorkletChunkMs = ref<number>(120);
const agentVadConfig = ref({
    sampleRate: 16000,
    minSpeechMs: 250,
    minSilenceMs: 400,
    prePadMs: 80,
    postPadMs: 80,
    speechThreshold: 0.06,
    exitThreshold: 0.03,
    maxPrevMs: 800,
});
const agentLlmMaxNewTokens = ref<number>(500);
const agentLlmTemperature = ref<number>(0.7);
const agentLlmOpenThinkTag = ref<string>("<think>");
const agentLlmCloseThinkTag = ref<string>("</think>");
const agentCompanyName = ref<string>("Vircadia");
const agentUiMaxTranscripts = ref<number>(0);
const agentUiMaxAssistantReplies = ref<number>(0);
const agentUiMaxConversationItems = ref<number>(0);

const audioDevices = ref<{ deviceId: string; label: string }[]>([]);

// Chat state
const localChatMessages = ref<ChatMessage[]>([]);
const sttTranscripts = ref<string[]>([]);

// Audio Processing Constraints 
const micEchoCancellation = useStorage<boolean>("vrca.audio.v2.echoCancellation", false);
const micNoiseSuppression = useStorage<boolean>("vrca.audio.v2.noiseSuppression", false);
const micAutoGainControl = useStorage<boolean>("vrca.audio.v2.autoGainControl", false);

async function onChatMessage(text: string, vircadiaWorld: any) {
    if (!text.trim() || !vircadiaWorld) return;

    const message: ChatMessage = {
        id: crypto.randomUUID(),
        text: text.trim(),
        timestamp: Date.now(),
    };

    localChatMessages.value = [...localChatMessages.value, message].slice(-20);
    sttTranscripts.value = [text.trim(), ...sttTranscripts.value].slice(0, 50);

    const fullSessionId = vircadiaWorld.connectionInfo.value.fullSessionId;
    if (!fullSessionId) return;
    const entityName = `avatar:${fullSessionId}`;

    try {
        if (cloudAgentRef.value) {
            (cloudAgentRef.value as any).handleLocalUserMessage?.(text.trim());
        }

        await vircadiaWorld.client.connection.query({
            query: "INSERT INTO entity.entity_metadata (general__entity_name, metadata__key, metadata__jsonb) VALUES ($1, $2, $3) ON CONFLICT (general__entity_name, metadata__key) DO UPDATE SET metadata__jsonb = EXCLUDED.metadata__jsonb",
            parameters: [entityName, "chat_messages", { messages: localChatMessages.value }],
        });

        await vircadiaWorld.client.connection.publishReflect({
            syncGroup: "public.REALTIME",
            channel: "avatar_data",
            payload: {
                type: "avatar_frame",
                entityName: entityName,
                ts: Date.now(),
                chat_messages: localChatMessages.value,
            },
        });
    } catch (e) {
        console.warn("[VircadiaScene] Failed to send chat message:", e);
    }
}

// Avatar state tracking
const avatarLoading = ref(false); // TODO: wire up from avatar events
const otherAvatarsLoading = ref(false); // TODO: wire up from other avatars
const avatarModelStep = ref("");
const avatarModelError = ref("");
const modelFileNameRef = ref("");
const avatarSyncMetrics = ref<AvatarSyncMetrics | null>(null);

function onEntityDataLoaded(data: any) {
    // Handle entity data loaded...
    // console.log("Entity Data Loaded", data);
}

function onAvatarSyncStats(metrics: AvatarSyncMetrics) {
    avatarSyncMetrics.value = metrics;
}

function onAvatarModelState(state: { step: string; error?: string; fileName?: string }) {
    avatarModelStep.value = state.step;
    if (state.error) avatarModelError.value = state.error;
    if (state.fileName) modelFileNameRef.value = state.fileName;

    if (state.step === 'complete') avatarLoading.value = false;
    else if (state.step === 'loading') avatarLoading.value = true;
}

function onWebRTCPermissions(granted: boolean) {
    // Handle permissions logic if needed
}

function toggleInspector() {
    inspectorRef.value?.toggleInspector();
}

defineExpose({
    canvasComponentRef,
    avatarRef,
    otherAvatarsRef,
    toggleInspector,
});
</script>
