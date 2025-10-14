<!-- TODO: Need to put progress callbacks on the loading for each so we can track real progress loading on each model. -->

<template>
    <!-- Renderless component for the autonomous agent -->
    <slot></slot>

    <!-- Teleport agent control button to MainScene app bar -->
    <Teleport v-if="teleportTarget && featureEnabled" :to="teleportTarget">
        <v-tooltip location="bottom">
            <template #activator="{ props }">
                <v-btn v-bind="props" icon variant="text" class="ml-2" :color="overlayOpen ? 'success' : undefined"
                    @click="toggleOverlay">
                    <v-icon>mdi-robot</v-icon>
                </v-btn>
            </template>
            <span>Autonomous Agent Controls</span>
        </v-tooltip>
    </Teleport>

    <!-- Autonomous Agent Overlay -->
    <v-overlay v-model="overlayOpen" location="center" scroll-strategy="block" class="align-center justify-center">
        <v-card class="d-flex flex-column overflow-hidden min-w-[360px] max-w-[90vw] md:min-w-[720px] lg:min-w-[880px]"
            style="height: 80vh; max-height: 80vh;">
            <v-card-title class="d-flex align-center">
                <v-icon class="mr-2">mdi-robot</v-icon>
                Autonomous Agent Status
                <v-spacer />
                <v-btn icon variant="text" @click="overlayOpen = false">
                    <v-icon>mdi-close</v-icon>
                </v-btn>
            </v-card-title>

            <v-card-text class="py-2" style="flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain;">
                <!-- Feature Status Overview -->
                <v-row class="mb-4">
                    <v-col cols="12">
                        <v-card variant="outlined" class="pa-3">
                            <v-card-subtitle>Feature Status</v-card-subtitle>
                            <div class="d-flex flex-column">
                                <div class="d-flex align-center mb-2">
                                    <v-icon :color="props.agentEnableTts ? 'success' : 'grey'" class="mr-2">
                                        {{ props.agentEnableTts ? 'mdi-check-circle' : 'mdi-circle-outline' }}
                                    </v-icon>
                                    <span>TTS ({{ ttsModelName }}): {{ props.agentEnableTts ? 'Enabled' : 'Disabled'
                                    }}</span>
                                </div>
                                <div class="d-flex align-center mb-2">
                                    <v-icon :color="props.agentEnableLlm ? 'success' : 'grey'" class="mr-2">
                                        {{ props.agentEnableLlm ? 'mdi-check-circle' : 'mdi-circle-outline' }}
                                    </v-icon>
                                    <span>LLM ({{ llmModelName }}): {{ props.agentEnableLlm ? 'Enabled' : 'Disabled'
                                    }}</span>
                                </div>
                                <div class="d-flex align-center">
                                    <v-icon :color="props.agentEnableStt ? 'success' : 'grey'" class="mr-2">
                                        {{ props.agentEnableStt ? 'mdi-check-circle' : 'mdi-circle-outline' }}
                                    </v-icon>
                                    <span>STT ({{ sttModelName }}): {{ props.agentEnableStt ? 'Enabled' : 'Disabled'
                                    }}</span>
                                </div>
                            </div>
                        </v-card>
                    </v-col>
                </v-row>

                <!-- Consolidated Loading Progress (replaces global snackbar) -->
                <v-row v-if="featureEnabled && (kokoroLoading || llmLoading || sttLoading)" class="mb-2">
                    <v-col cols="12">
                        <v-alert type="info" variant="tonal" class="mb-2">
                            <div class="d-flex align-center">
                                <v-progress-circular indeterminate color="primary" size="20" class="mr-2" />
                                <div class="d-flex flex-column">
                                    <span>• LLM ({{ llmModelName }}): {{ llmLoading ? (llmStep || 'Loading') : 'Ready'
                                    }}</span>
                                    <span>• TTS ({{ ttsModelName }}): {{ kokoroLoading ? (kokoroStep || 'Loading') :
                                        'Ready'
                                    }}</span>
                                    <span>• STT ({{ sttModelName }}): {{ sttLoading ? (sttStep || 'Loading') : 'Ready'
                                    }}</span>
                                </div>
                            </div>
                        </v-alert>
                    </v-col>
                </v-row>

                <!-- Live Transcripts -->
                <v-row v-if="props.agentEnableStt">
                    <v-col cols="12">
                        <v-card variant="outlined" class="pa-3">
                            <div class="d-flex align-center mb-2">
                                <v-card-subtitle class="pr-2">Live Transcripts</v-card-subtitle>
                                <v-spacer />
                                <v-chip :color="sttActive ? 'success' : 'warning'" size="small">
                                    {{ sttActive ? 'Listening' : 'Paused' }}
                                </v-chip>
                                <v-btn class="ml-2" size="small" variant="text" @click="sttActive = !sttActive">
                                    <v-icon>{{ sttActive ? 'mdi-pause' : 'mdi-play' }}</v-icon>
                                </v-btn>
                                <v-btn class="ml-1" size="small" variant="text" @click="clearTranscripts">
                                    <v-icon>mdi-delete</v-icon>
                                </v-btn>
                            </div>
                            <div v-if="transcripts.length === 0" class="text-caption text-medium-emphasis ml-1">
                                Waiting for audio...
                            </div>
                            <div v-else class="overflow-y-auto pr-1" style="max-height: 220px;">
                                <v-list density="compact">
                                    <template v-for="item in transcriptsLimitedReversed"
                                        :key="item.at + ':' + item.peerId">
                                        <v-list-item density="compact">
                                            <v-list-item-title>
                                                <code>{{ new Date(item.at).toLocaleTimeString() }}</code>
                                                <span class="ml-2 text-medium-emphasis">[{{ item.peerId }}]</span>
                                            </v-list-item-title>
                                            <v-list-item-subtitle class="wrap-anywhere">{{ item.text
                                            }}</v-list-item-subtitle>
                                        </v-list-item>
                                        <v-divider class="my-1" />
                                    </template>
                                </v-list>
                            </div>
                        </v-card>
                    </v-col>
                </v-row>

                <!-- TODO: Remove this because now all transcripts are processed. -->
                <!-- Raw STT (Full rolling) -->
                <v-row v-if="props.agentEnableStt">
                    <v-col cols="12">
                        <v-card variant="outlined" class="pa-3">
                            <div class="d-flex align-center mb-2">
                                <v-card-subtitle class="pr-2">Raw STT (Full rolling)</v-card-subtitle>
                                <v-spacer />
                                <v-btn class="ml-1" size="small" variant="text" @click="clearTranscripts">
                                    <v-icon>mdi-delete</v-icon>
                                </v-btn>
                            </div>
                            <div v-if="sttRollingFullLimited.length === 0"
                                class="text-caption text-medium-emphasis ml-1">
                                Waiting for STT...
                            </div>
                            <div v-else class="overflow-y-auto pr-1" style="max-height: 220px;">
                                <v-list density="compact">
                                    <template v-for="item in sttRollingFullLimitedReversed"
                                        :key="item.at + ':' + item.peerId">
                                        <v-list-item density="compact">
                                            <v-list-item-title>
                                                <code>{{ new Date(item.at).toLocaleTimeString() }}</code>
                                                <span class="ml-2 text-medium-emphasis">[{{ item.peerId }}]</span>
                                            </v-list-item-title>
                                            <v-list-item-subtitle class="wrap-anywhere">{{ item.text
                                            }}</v-list-item-subtitle>
                                        </v-list-item>
                                        <v-divider class="my-1" />
                                    </template>
                                </v-list>
                            </div>
                        </v-card>
                    </v-col>
                </v-row>

                <!-- Model Loading States -->
                <v-row>
                    <v-col cols="12">
                        <v-card variant="outlined" class="pa-3">
                            <v-card-subtitle>Model Status</v-card-subtitle>

                            <!-- TTS Status -->
                            <div v-if="props.agentEnableTts" class="mb-3">
                                <div class="d-flex align-center mb-1">
                                    <v-icon class="mr-2">mdi-volume-high</v-icon>
                                    <span class="font-weight-medium">TTS ({{ ttsModelName }})</span>
                                    <v-spacer />
                                    <v-chip
                                        :color="kokoroLoading ? 'warning' : (ttsGenerating ? 'warning' : kokoroTTS ? 'success' : 'error')"
                                        size="small">
                                        {{ kokoroLoading ? 'Loading' : ttsGenerating ? 'Generating' : kokoroTTS ?
                                            'Ready' :
                                            'Error' }}
                                    </v-chip>
                                </div>
                                <div v-if="kokoroLoading" class="ml-6">
                                    <v-progress-linear :model-value="ttsProgressPct" color="primary" height="8"
                                        class="mb-1" />
                                    <span class="text-caption text-medium-emphasis">{{ (kokoroStep || 'Initializing...')
                                        +
                                        (ttsProgressPct ? ` (${Math.round(ttsProgressPct)}%)` : '') }}</span>
                                </div>
                                <div v-else-if="kokoroTTS" class="ml-6">
                                    <span class="text-caption text-success">Model loaded successfully</span>
                                </div>
                                <div v-else class="ml-6">
                                    <span class="text-caption text-error">Failed to load model</span>
                                </div>
                            </div>

                            <!-- LLM Status -->
                            <div v-if="props.agentEnableLlm" class="mb-3">
                                <div class="d-flex align-center mb-1">
                                    <v-icon class="mr-2">mdi-brain</v-icon>
                                    <span class="font-weight-medium">LLM ({{ llmModelName }})</span>
                                    <v-spacer />
                                    <v-chip
                                        :color="llmLoading ? 'warning' : (llmGenerating ? 'warning' : llmPipeline ? 'success' : 'error')"
                                        size="small">
                                        {{ llmLoading ? 'Loading' : llmGenerating ? 'Generating' : llmPipeline ? 'Ready'
                                            :
                                            'Error' }}
                                    </v-chip>
                                </div>
                                <div v-if="llmLoading" class="ml-6">
                                    <v-progress-linear :model-value="llmProgressPct" color="primary" height="8"
                                        class="mb-1" />
                                    <span class="text-caption text-medium-emphasis">{{ (llmStep || 'Initializing...') +
                                        (llmProgressPct ? ` (${Math.round(llmProgressPct)}%)` : '') }}</span>
                                </div>
                                <div v-else-if="llmPipeline" class="ml-6">
                                    <span class="text-caption text-success">Model loaded successfully</span>
                                </div>
                                <div v-else class="ml-6">
                                    <span class="text-caption text-error">Failed to load model</span>
                                </div>
                            </div>

                            <!-- STT Status -->
                            <div v-if="props.agentEnableStt" class="mb-3">
                                <div class="d-flex align-center mb-1">
                                    <v-icon class="mr-2">mdi-microphone</v-icon>
                                    <span class="font-weight-medium">STT ({{ sttModelName }})</span>
                                    <v-spacer />
                                    <v-chip
                                        :color="sttLoading ? 'warning' : (sttProcessing ? 'warning' : (sttPipeline ? 'success' : 'error'))"
                                        size="small">
                                        {{ sttLoading ? 'Loading' : (sttProcessing ? 'Processing' : (sttPipeline ?
                                            'Ready' :
                                            'Error')) }}
                                    </v-chip>
                                </div>
                                <div v-if="sttLoading" class="ml-6">
                                    <v-progress-linear indeterminate color="primary" height="4" class="mb-1" />
                                    <span class="text-caption text-medium-emphasis">{{ sttStep || 'Initializing...'
                                    }}</span>
                                </div>
                                <div v-else-if="sttPipeline" class="ml-6">
                                    <span class="text-caption text-success">Model loaded successfully</span>
                                </div>
                                <div v-else class="ml-6">
                                    <span class="text-caption text-error">Failed to load model</span>
                                </div>

                                <!-- VAD Live Status -->
                                <div class="mt-2 ml-6 d-flex align-center">
                                    <span class="text-caption text-medium-emphasis mr-2">VAD:</span>
                                    <v-chip :color="vadRecording ? 'success' : 'grey'" size="x-small">
                                        {{ vadRecording ? 'Listening' : 'Idle' }}
                                    </v-chip>
                                    <v-divider vertical class="mx-2" />
                                    <span class="text-caption text-medium-emphasis mr-2">Segments:</span>
                                    <v-chip size="x-small">{{ vadSegmentsCount }}</v-chip>
                                    <v-spacer />
                                    <span v-if="vadLastSegmentAt" class="text-caption text-medium-emphasis">
                                        Last: {{ new Date(vadLastSegmentAt).toLocaleTimeString() }}
                                    </span>
                                </div>

                                <!-- Audio level (RMS) -->
                                <div class="mt-2 ml-6">
                                    <div class="d-flex align-center mb-1">
                                        <span class="text-caption text-medium-emphasis mr-2">RMS</span>
                                        <v-progress-linear :model-value="rmsPct" color="secondary" height="6" rounded
                                            class="flex-grow-1" />
                                        <span class="text-caption text-medium-emphasis ml-2">{{ rmsLevel.toFixed(2)
                                            }}</span>
                                    </div>
                                </div>
                                <!-- STT Inputs status -->
                                <div class="mt-2 ml-6">
                                    <div class="d-flex align-center mb-1">
                                        <span class="text-caption text-medium-emphasis mr-2">Input Mode:</span>
                                        <v-chip size="x-small">{{ props.agentSttInputMode }}</v-chip>
                                        <v-spacer />
                                        <span class="text-caption text-medium-emphasis mr-2">Attached Inputs:</span>
                                        <template v-if="sttAttachedIds.length === 0">
                                            <v-chip size="x-small" color="warning">none</v-chip>
                                        </template>
                                        <template v-else>
                                            <v-chip v-for="id in sttAttachedIds" :key="id" size="x-small"
                                                class="ml-1">{{ id }}</v-chip>
                                        </template>
                                    </div>
                                </div>
                            </div>

                            <!-- WebRTC Status -->
                            <div class="mb-3">
                                <div class="d-flex align-center mb-1">
                                    <v-icon class="mr-2">mdi-phone</v-icon>
                                    <span class="font-weight-medium">WebRTC Audio</span>
                                    <v-spacer />
                                    <v-chip :color="busRef ? 'success' : 'warning'" size="small">
                                        {{ busRef ? 'Connected' : 'Disconnected' }}
                                    </v-chip>
                                </div>
                                <div class="ml-6">
                                    <span class="text-caption text-medium-emphasis">
                                        {{ busRef ? 'Audio bus available for TTS/STT' : 'Waiting for WebRTC connection'
                                        }}
                                    </span>
                                </div>
                            </div>
                            <!-- TTS Output Destination Indicator -->
                            <div class="ml-6 d-flex align-center mt-1">
                                <span class="text-caption text-medium-emphasis mr-2">TTS Output:</span>
                                <v-chip :color="ttsOutputColor" size="x-small">{{ ttsOutputLabel }}</v-chip>
                            </div>
                        </v-card>
                    </v-col>
                </v-row>

                <!-- Conversation (Prompts vs Replies) -->
                <v-row v-if="props.agentEnableLlm">
                    <v-col cols="12">
                        <v-card variant="outlined" class="pa-3">
                            <div class="d-flex align-center mb-2">
                                <v-card-subtitle class="pr-2">Conversation</v-card-subtitle>
                                <v-spacer />
                                <v-chip :color="llmGenerating ? 'warning' : 'success'" size="small">
                                    {{ llmGenerating ? 'Generating' : 'Idle' }}
                                </v-chip>
                            </div>
                            <div v-if="conversationItems.length === 0" class="text-caption text-medium-emphasis ml-1">
                                No conversation yet. Speak into the mic to start.
                            </div>
                            <div v-else class="overflow-y-auto pr-1" style="max-height: 260px;">
                                <v-list density="compact">
                                    <template v-for="msg in conversationItemsReversed" :key="msg.key">
                                        <v-list-item :class="msg.role === 'user' ? 'bg-transparent' : 'bg-transparent'">
                                            <template #prepend>
                                                <v-avatar color="grey-darken-3" size="24" v-if="msg.role === 'user'">
                                                    <v-icon size="18">mdi-account</v-icon>
                                                </v-avatar>
                                                <v-avatar color="deep-purple-darken-3" size="24" v-else>
                                                    <v-icon size="18">mdi-robot</v-icon>
                                                </v-avatar>
                                            </template>
                                            <v-list-item-title class="d-flex align-center">
                                                <span class="text-caption text-medium-emphasis mr-2">
                                                    <code>{{ new Date(msg.at).toLocaleTimeString() }}</code>
                                                </span>
                                                <span class="font-weight-medium">{{ msg.role === 'user' ? 'You' :
                                                    'Assistant'
                                                }}</span>
                                            </v-list-item-title>
                                            <v-list-item-subtitle class="mt-1 wrap-anywhere"
                                                :class="msg.role === 'user' ? 'text-high-emphasis' : ''">
                                                {{ msg.text }}
                                            </v-list-item-subtitle>
                                        </v-list-item>
                                        <v-divider class="my-1" />
                                    </template>
                                </v-list>
                            </div>
                        </v-card>
                    </v-col>
                </v-row>

                <!-- Action Buttons -->
                <v-row>
                    <v-col cols="12">
                        <div class="d-flex gap-2">
                            <v-btn v-if="props.agentEnableTts && kokoroTTS" color="primary" variant="outlined"
                                @click="testTTS" :loading="isSpeaking">
                                <v-icon class="mr-1">mdi-volume-high</v-icon>
                                Test TTS
                            </v-btn>
                            <v-btn color="secondary" variant="outlined" @click="overlayOpen = false">
                                Close
                            </v-btn>
                        </div>
                    </v-col>
                </v-row>
            </v-card-text>
        </v-card>
    </v-overlay>


</template>
<!-- TODO: We should cut off STT and LLM for now, only have TTS and run a test of it continually generating audio and pushing it through WebRTC until we can hear it, then move onto getting WebRTC -> STT working, then finally LLM. -->

<script setup lang="ts">
import type { Scene, WebGPUEngine } from "@babylonjs/core";
import { computed, inject, onUnmounted, type Ref, ref, watch } from "vue";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";

const props = defineProps({
    scene: { type: Object as () => Scene, default: null },
    engine: { type: Object as () => WebGPUEngine, default: null },
    canvas: { type: Object as () => HTMLCanvasElement, default: null },
    vircadiaWorld: {
        type: Object as () => VircadiaWorldInstance,
        default: null,
    },
    // WebRTC bus, provided via MainScene template
    webrtcBus: { type: Object as () => unknown, default: null },
    // Reactive WebRTC models from MainScene
    webrtcLocalStream: {
        type: Object as () => MediaStream | null,
        default: null,
    },
    webrtcPeers: {
        type: Object as () => Map<string, RTCPeerConnection>,
        default: () => new Map(),
    },
    webrtcRemoteStreams: {
        type: Object as () => Map<string, MediaStream>,
        default: () => new Map(),
    },
    // Feature flags provided by MainScene
    agentEnableTts: { type: Boolean, required: true },
    agentEnableLlm: { type: Boolean, required: true },
    agentEnableStt: { type: Boolean, required: true },
    agentTtsLocalEcho: { type: Boolean, required: true },
    // Wake/End word control provided by MainScene (required via template props)
    agentWakeWord: { type: String, required: true },
    agentEndWord: { type: String, required: true },
    // No external gating timeout; gating handled by LLM
    // Reprompt timeout for partials/no-reply decisions
    agentNoReplyTimeoutSec: { type: Number, required: true },
    // STT segmentation window (seconds) and max buffer
    agentSttWindowSec: { type: Number, required: true },
    agentSttMaxBufferSec: { type: Number, required: true },
    // Preferred conversational language (ISO-639-1), provided via MainScene
    agentLanguage: { type: String, required: true },
    // Model identifiers provided via MainScene
    agentTtsModelId: { type: String, required: true },
    agentLlmModelId: { type: String, required: true },
    agentSttModelId: { type: String, required: true },
    // Pre-gain before STT processing
    agentSttPreGain: { type: Number, required: true },
    // Which inputs feed STT: 'webrtc' | 'mic' | 'both' (provided by MainScene)
    agentSttInputMode: { type: String as () => 'webrtc' | 'mic' | 'both', required: true },
});

const featureEnabled = sessionStorage.getItem("is_autonomous_agent") === "true";

// Inject the teleport target from MainScene
const teleportTarget = inject<Ref<HTMLElement | null>>(
    "mainAppBarTeleportTarget",
    ref(null),
);

// Overlay state
const overlayOpen = ref<boolean>(false);

// Toggle overlay function
const toggleOverlay = () => {
    overlayOpen.value = !overlayOpen.value;
};

const kokoroTTS = ref<unknown | null>(null);
const kokoroLoading = ref<boolean>(false);
const kokoroStep = ref<string>("");
const ttsWorkerRef = ref<Worker | null>(null);
const ttsProgressPct = ref<number>(0);
const ttsGenerating = ref<boolean>(false);

function parseModelDisplayName(modelId: string | null | undefined): string {
    const id = String(modelId || '').trim();
    if (!id) return 'Unknown';
    const last = id.split('/').pop() || id;
    return last.replace(/[-_]+/g, ' ');
}
const ttsModelName = computed(() => parseModelDisplayName(props.agentTtsModelId));
const llmModelName = computed(() => parseModelDisplayName(props.agentLlmModelId));
const sttModelName = computed(() => parseModelDisplayName(props.agentSttModelId));

// Use a broad unknown type here to avoid coupling to transformers' complex union type
let llmPipeline: unknown = null;
const llmLoading = ref<boolean>(false);
const llmStep = ref<string>("");
const llmWorkerRef = ref<Worker | null>(null);
const llmProgressPct = ref<number>(0);
const llmGenerating = ref<boolean>(false);

// Whisper STT
let sttPipeline: unknown = null;
const sttLoading = ref<boolean>(false);
const sttStep = ref<string>("");

// Realtime STT via WebGPU worker (required)
const useWorkerStreaming = true;
const sttWorkerRef = ref<Worker | null>(null);
const vadWorkerRef = ref<Worker | null>(null);
const sttProcessing = ref<boolean>(false);
// VAD UI state
const vadRecording = ref<boolean>(false);
const vadSegmentsCount = ref<number>(0);
const vadLastSegmentAt = ref<number | null>(null);
type PeerAudioProcessor = {
    ctx: AudioContext;
    source: MediaStreamAudioSourceNode;
    node: AudioWorkletNode;
    sink: GainNode;
};
const peerProcessors = new Map<string, PeerAudioProcessor>();
const sttAttachedIds = ref<string[]>([]);
function markAttached(peerId: string, attached: boolean): void {
    const list = sttAttachedIds.value;
    const idx = list.indexOf(peerId);
    if (attached) {
        if (idx < 0) list.push(peerId);
    } else if (idx >= 0) {
        list.splice(idx, 1);
    }
}

function initSttWorkerOnce(): void {
    if (!useWorkerStreaming) return;
    if (sttWorkerRef.value) return;
    try {
        const workerPreURL = `./VircadiaAutonomousAgentSTTWorker.ts?v=${Date.now()}`
        const workerUrl = new URL(workerPreURL, import.meta.url)
        const worker = new Worker(workerUrl, { type: "module" });
        worker.addEventListener("message", (e: MessageEvent) => {
            const msg = e.data as { type: string; status?: string; peerId?: string; data?: unknown; error?: string };
            if (msg.type === "status") {
                if (msg.status === "processing") {
                    try {
                        const active = !!(msg.data && typeof (msg.data as Record<string, unknown>).active === 'boolean' ? (msg.data as Record<string, unknown>).active : false);
                        sttProcessing.value = active;
                    } catch { sttProcessing.value = false; }
                }
                if (msg.status === "downloading") {
                    sttLoading.value = true;
                    sttStep.value = "Downloading Whisper (worker)";
                }
                if (msg.status === "loading") {
                    sttLoading.value = true;
                    try {
                        const d = msg.data;
                        if (d && typeof d === "object") {
                            const p = (d as Record<string, unknown>)?.progress || (d as Record<string, unknown>)?.status || (d as Record<string, unknown>)?.file || (d as Record<string, unknown>)?.message || JSON.stringify(d);
                            sttStep.value = typeof p === "string" ? p : "Loading Whisper (worker)";
                        } else {
                            sttStep.value = "Loading Whisper (worker)";
                        }
                    } catch { sttStep.value = "Loading Whisper (worker)"; }
                }
                if (msg.status === "mounting") {
                    sttLoading.value = true;
                    sttStep.value = "Mounting Whisper (GPU compile)";
                }
                if (msg.status === "ready") {
                    sttLoading.value = false;
                    sttStep.value = "";
                    sttPipeline = {};
                }
                if (msg.status === "update") {
                    const dataObj = (msg.data && typeof msg.data === "object")
                        ? (msg.data as Record<string, unknown>)
                        : null;
                    const t = typeof dataObj?.text === "string"
                        ? (dataObj.text as string).trim()
                        : "";
                    if (t) void onSttResult(msg.peerId || "peer", t);
                } else if (msg.status === "complete") {
                    const dataObj = (msg.data && typeof msg.data === "object")
                        ? (msg.data as Record<string, unknown>)
                        : null;
                    const t = typeof dataObj?.text === "string"
                        ? (dataObj.text as string).trim()
                        : "";
                    if (t) void onSttResult(msg.peerId || "peer", t);
                    // Also finalize buffered text at STT complete to avoid missing VAD recording_end
                    const pid = msg.peerId || "peer";
                    const wake = String(props.agentWakeWord || "").trim().toLowerCase();
                    const end = String(props.agentEndWord || "").trim().toLowerCase();
                    const s = sttSessions.get(pid);
                    if (s) {
                        if (!wake && !end) {
                            const u = s.buffered.trim();
                            s.buffered = "";
                            if (u) void submitToLlmWithNoReply(pid, u);
                        } else if (wake && !end && !s.awaitingWake) {
                            const u = s.buffered.trim();
                            s.awaitingWake = true;
                            s.buffered = "";
                            if (u) void submitToLlmWithNoReply(pid, u);
                        }
                    }
                }
            } else if (msg.type === "error") {
                console.warn("[Agent STT] worker error", msg.error);
            }
        });
        sttLoading.value = true;
        sttStep.value = "Initializing Whisper (worker)";
        worker.postMessage({ type: "load", modelId: String(props.agentSttModelId || '') });
        sttWorkerRef.value = worker;
    } catch (e) {
        console.error("[Agent STT] Failed to init worker:", e);
        sttWorkerRef.value = null;
    }
}

function initVadWorkerOnce(): void {
    if (!useWorkerStreaming) return;
    if (vadWorkerRef.value) return;
    try {
        const worker = new Worker(new URL("./VircadiaAutonomousAgentVADWorker.ts", import.meta.url), { type: "module" });
        worker.addEventListener("message", (e: MessageEvent) => {
            const msg = e.data as { type: string; status?: string; peerId?: string; pcm?: ArrayBuffer };
            if (msg.type === "segment" && msg.pcm && msg.peerId) {
                // Forward finalized speech segment to STT worker
                try {
                    sttWorkerRef.value?.postMessage({ type: "audio", peerId: msg.peerId, pcm: msg.pcm, language: String(props.agentLanguage || 'en') }, [msg.pcm]);
                } catch (err) {
                    console.warn("[Agent VAD] Failed to forward segment to STT worker:", err);
                }
                // Update UI counters
                vadSegmentsCount.value = vadSegmentsCount.value + 1;
                vadLastSegmentAt.value = Date.now();
            }
            if (msg.type === "status" && msg.status) {
                // On recording_end, finalize any buffered text for ungated or wake-only modes
                if (msg.status === "recording_end" && typeof msg.peerId === 'string') {
                    const pid = msg.peerId;
                    const wake = String(props.agentWakeWord || "").trim().toLowerCase();
                    const end = String(props.agentEndWord || "").trim().toLowerCase();
                    const s = sttSessions.get(pid);
                    if (s) {
                        if (!wake && !end) {
                            const finalUtt = s.buffered.trim();
                            s.buffered = "";
                            if (finalUtt) void submitToLlmWithNoReply(pid, finalUtt);
                        } else if (wake && !end && !s.awaitingWake) {
                            const finalUtt = s.buffered.trim();
                            s.awaitingWake = true;
                            s.buffered = "";
                            if (finalUtt) void submitToLlmWithNoReply(pid, finalUtt);
                        }
                    }
                }
                if (msg.status === "recording_start") vadRecording.value = true;
                if (msg.status === "recording_end") vadRecording.value = false;
            }
            // Optionally handle recording_start/recording_end UI here if desired
        });
        // Load with defaults; could be tuned from MainScene props later
        worker.postMessage({ type: "load", config: { sampleRate: 16000 } });
        vadWorkerRef.value = worker;
    } catch (e) {
        console.error("[Agent VAD] Failed to init worker:", e);
        vadWorkerRef.value = null;
    }
}

const sttWorkletLoaded = new WeakSet<AudioContext>();
async function ensureSttWorklet(ctx: AudioContext): Promise<void> {
    if (sttWorkletLoaded.has(ctx)) return;
    try {
        await ctx.audioWorklet.addModule(new URL("./VircadiaAutonomousAgentSTTWorklet.ts", import.meta.url));
        sttWorkletLoaded.add(ctx);
    } catch (e) {
        console.error("[Agent STT] Failed to load AudioWorklet:", e);
        throw e;
    }
}

async function attachStreamToSTT(peerId: string, stream: MediaStream): Promise<void> {
    if (!useWorkerStreaming) return;
    if (peerProcessors.has(peerId)) return;
    initSttWorkerOnce();
    initVadWorkerOnce();
    if (!sttWorkerRef.value) return;

    try {
        const ctx = new AudioContext({ sampleRate: 48000 });
        await ensureSttWorklet(ctx);
        const source = ctx.createMediaStreamSource(stream);
        // Optional pre-gain before worklet to compensate remote levels
        const preGain = ctx.createGain();
        preGain.gain.value = Math.max(0.01, Number(props.agentSttPreGain || 1.0));
        const node = new AudioWorkletNode(ctx, "stt-processor", {
            processorOptions: { targetSampleRate: 16000, chunkMs: 200 },
        });

        // Ensure audio processing starts (autoplay policies may suspend context)
        try { await ctx.resume(); } catch { /* ignore */ }

        node.port.onmessage = (ev: MessageEvent) => {
            const data = ev.data as { type: string; pcm?: ArrayBuffer; rms?: number };
            if (data && data.type === "pcm" && data.pcm) {
                if (!sttActive.value) return;
                try {
                    // Route through VAD worker first; it will emit finalized segments
                    vadWorkerRef.value?.postMessage({ type: "audio", peerId, pcm: data.pcm, rms: data.rms }, [data.pcm]);
                } catch (err) {
                    console.warn("[Agent VAD] Failed to post PCM to VAD worker:", err);
                }
                // Update local RMS meter if provided
                if (typeof data.rms === 'number' && Number.isFinite(data.rms)) {
                    rmsLevel.value = Math.max(0, Math.min(1, data.rms));
                }
            }
        };

        // Ensure graph is pulled without audible output
        const sink = ctx.createGain();
        sink.gain.value = 0.0;

        source.connect(preGain);
        preGain.connect(node);
        node.connect(sink);
        sink.connect(ctx.destination);

        peerProcessors.set(peerId, { ctx, source, node, sink });
        markAttached(peerId, true);
        sttWorkerRef.value.postMessage({
            type: "start",
            peerId,
            language: String(props.agentLanguage || 'en'),
            windowSec: props.agentSttWindowSec,
            maxBufferSec: props.agentSttMaxBufferSec,
        });
        vadWorkerRef.value?.postMessage({ type: "start", peerId, language: String(props.agentLanguage || 'en') });
        console.log(`[Agent STT] Streaming (AudioWorklet) attached for ${peerId}`);
    } catch (e) {
        console.error("[Agent STT] Failed to attach stream:", e);
    }
}

function detachStreamFromSTT(peerId: string): void {
    const w = sttWorkerRef.value;
    if (w) {
        try { w.postMessage({ type: "stop", peerId }); } catch { }
    }
    const vw = vadWorkerRef.value;
    if (vw) {
        try { vw.postMessage({ type: "stop", peerId }); } catch { }
    }
    const proc = peerProcessors.get(peerId);
    if (!proc) return;
    try {
        proc.node.disconnect();
        proc.sink.disconnect();
        proc.source.disconnect();
        proc.ctx.close().catch(() => { });
    } catch { }
    peerProcessors.delete(peerId);
    markAttached(peerId, false);
}

// WebRTC bus runtime
type WebRTCAudioBus = {
    getLocalStream: () => MediaStream | null;
    getPeers: () => Map<string, RTCPeerConnection>;
    getRemoteStreams: () => Map<string, MediaStream>;
    onRemoteAudio: (
        cb: (peerId: string, stream: MediaStream) => void,
    ) => () => void;
    getUplinkAudioContext: () => AudioContext | null;
    getUplinkDestination: () => MediaStreamAudioDestinationNode | null;
    ensureUplinkDestination: () => Promise<MediaStreamTrack | null>;
    replaceUplinkWithDestination: () => Promise<boolean>;
    restoreUplinkMic: () => Promise<boolean>;
    connectMicToUplink: (enabled: boolean) => void;
    connectNodeToUplink: (node: AudioNode) => void;
};
const busRef = computed(() => props.webrtcBus as WebRTCAudioBus | null);

// Reactive mirrors passed from MainScene
const localStreamRef = computed<MediaStream | null>(
    () => props.webrtcLocalStream as MediaStream | null,
);
const peersMapRef = computed<Map<string, RTCPeerConnection>>(
    () => props.webrtcPeers as Map<string, RTCPeerConnection>,
);
const remoteStreamsRef = computed<Map<string, MediaStream>>(
    () => props.webrtcRemoteStreams as Map<string, MediaStream>,
);

// STT session state
const remoteRecorders = new Map<string, MediaRecorder>();
const remoteUnsubscribeFns: (() => void)[] = [];
const sttActive = ref<boolean>(true);
// RMS UI state (raw amplitude estimate)
const rmsLevel = ref<number>(0);
const rmsPct = computed<number>(() => Math.round(Math.min(1, rmsLevel.value) * 100));
const ttsQueue: string[] = [];
const isSpeaking = ref<boolean>(false);

// Transcript capture state
type TranscriptEntry = { peerId: string; text: string; at: number };
const transcripts = ref<TranscriptEntry[]>([]);
const MAX_TRANSCRIPTS = 10;
const transcriptsLimited = computed<TranscriptEntry[]>(() =>
    transcripts.value.slice(-MAX_TRANSCRIPTS),
);
const transcriptsLimitedReversed = computed<TranscriptEntry[]>(() =>
    [...transcriptsLimited.value].reverse(),
);
function addTranscript(peerId: string, text: string) {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    transcripts.value.push({ peerId, text: trimmed, at: Date.now() });
    // Keep the list bounded
    if (transcripts.value.length > MAX_TRANSCRIPTS)
        transcripts.value.splice(0, transcripts.value.length - MAX_TRANSCRIPTS);
}

// Rolling-context STT aggregator used only to compute deltas from Whisper updates
const sttRollingState = new Map<string, { lastCommitted: string }>();
// Full rolling transcript log (debug): captures entire rolling text, regardless of gate
type RollingFullEntry = { peerId: string; text: string; at: number };
const sttRollingFull = ref<RollingFullEntry[]>([]);
const MAX_STT_ROLLING_FULL = 20;
const sttRollingFullLimited = computed<RollingFullEntry[]>(() => sttRollingFull.value.slice(-MAX_STT_ROLLING_FULL));
const sttRollingFullLimitedReversed = computed<RollingFullEntry[]>(() => [...sttRollingFullLimited.value].reverse());
function onSttResult(peerId: string, text: string): void {
    let s = sttRollingState.get(peerId);
    if (!s) {
        s = { lastCommitted: "" };
        sttRollingState.set(peerId, s);
    }
    const a = s.lastCommitted;
    const b = text.trim();
    let i = 0;
    const max = Math.min(a.length, b.length);
    while (i < max && a[i] === b[i]) i++;
    const delta = b.slice(i).trim();
    // Always log the full rolling text for debug visibility
    if (b) sttRollingFull.value.push({ peerId, text: b, at: Date.now() });
    // Keep bounded
    if (sttRollingFull.value.length > MAX_STT_ROLLING_FULL)
        sttRollingFull.value.splice(0, sttRollingFull.value.length - MAX_STT_ROLLING_FULL);
    if (delta.length === 0) return;
    s.lastCommitted = b;
    // Always surface raw incremental STT output to the live transcripts for debugging
    addTranscript(peerId, delta);
    // Always route incremental ASR to the LLM; VAD handles segment boundaries, LLM returns <no-reply/> when partial
    void handleTranscript(peerId, delta, { incomplete: true });
}

function clearTranscripts() {
    transcripts.value = [];
    sttRollingFull.value = [];
}

// TTS output destination indicator
function busHasPeers(): boolean {
    const bus = busRef.value as unknown as { getPeers?: () => Map<string, RTCPeerConnection> } | null;
    try {
        return !!bus && typeof bus.getPeers === 'function' && bus.getPeers().size > 0;
    } catch {
        return false;
    }
}
const ttsOutputLabel = computed<string>(() => {
    if (!props.agentEnableTts) return 'Disabled';
    const hasBusPeers = busHasPeers();
    const local = !!props.agentTtsLocalEcho;
    if (local && hasBusPeers) return 'Both';
    if (hasBusPeers) return 'WebRTC';
    if (local) return 'Local';
    return 'None';
});
const ttsOutputColor = computed<string>(() => {
    const label = ttsOutputLabel.value;
    if (label === 'Both') return 'primary';
    if (label === 'WebRTC') return 'success';
    if (label === 'Local') return 'info';
    if (label === 'Disabled') return 'grey';
    return 'warning';
});

// Mic input handling for STT
let micStandaloneStream: MediaStream | null = null;
async function attachMicToSTT(): Promise<void> {
    if (!props.agentEnableStt) return;
    const local = localStreamRef.value;
    let stream: MediaStream | null = local || null;
    if (!stream) {
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                video: false,
            });
            micStandaloneStream = stream;
        } catch (e) {
            console.warn('[Agent STT] Failed to obtain mic stream:', e);
            return;
        }
    }
    await attachStreamToSTT('mic', stream);
}
function detachMicFromSTT(): void {
    detachStreamFromSTT('mic');
    if (micStandaloneStream) {
        try { for (const t of micStandaloneStream.getTracks()) t.stop(); } catch { }
        micStandaloneStream = null;
    }
}

// LLM output capture
type LlmEntry = { text: string; at: number };
const llmOutputs = ref<LlmEntry[]>([]);
// TODO: Remove this, it should be a prop for total history, not just LLM replies.
const MAX_LLM_OUTPUTS = 10;
const llmOutputsReversed = computed<LlmEntry[]>(() =>
    [...llmOutputs.value].reverse(),
);
function addLlmOutput(text: string) {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    llmOutputs.value.push({ text: trimmed, at: Date.now() });
    if (llmOutputs.value.length > MAX_LLM_OUTPUTS)
        llmOutputs.value.splice(0, llmOutputs.value.length - MAX_LLM_OUTPUTS);
}

// Merge transcripts (user prompts) and llmOutputs (assistant replies) into a single conversation list
type ConversationItem = { role: 'user' | 'assistant'; text: string; at: number; key: string };
const conversationItems = computed<ConversationItem[]>(() => {
    const items: ConversationItem[] = [];
    for (const t of transcriptsLimited.value) {
        items.push({ role: 'user', text: t.text, at: t.at, key: `u:${t.at}:${t.peerId}` });
    }
    for (const l of llmOutputs.value) {
        items.push({ role: 'assistant', text: l.text, at: l.at, key: `a:${l.at}` });
    }
    items.sort((a, b) => a.at - b.at);
    // Keep the conversation bounded
    return items.slice(-20);
});

// Newest-first ordering for UI rendering
const conversationItemsReversed = computed<ConversationItem[]>(() =>
    [...conversationItems.value].reverse(),
);

// Deprecated snackbar flags removed; progress now shown inside overlay

const stopKokoro = () => {
    kokoroTTS.value = null;
};

// Main-thread TTS initialization removed; worker-only

// LLM worker initialization and request routing
function extractProgressPercent(x: unknown): number {
    try {
        const anyX = x as Record<string, unknown> | null;
        const progressField = anyX && (anyX as Record<string, unknown>).progress;
        const p = typeof progressField === "number" ? progressField : undefined;
        if (typeof p === "number") return p <= 1 ? p * 100 : p;
        const loaded = Number((anyX as Record<string, unknown>)?.loaded || 0);
        const total = Number((anyX as Record<string, unknown>)?.total || 0);
        if (loaded > 0 && total > 0) return Math.max(1, Math.min(100, Math.round((loaded / total) * 100)));
    } catch { /* ignore */ }
    return 0;
}

let llmPending: { resolve: (text: string) => void; reject: (e: Error) => void } | null = null;
function initLlmWorkerOnce(): void {
    if (llmWorkerRef.value) return;
    try {
        const worker = new Worker(new URL("./VircadiaAutonomousAgentLLMWorker.ts", import.meta.url), { type: "module" });
        worker.addEventListener("message", (e: MessageEvent) => {
            const msg = e.data as { type: string; status?: string; data?: unknown; text?: string; error?: string };
            if (msg.type === "status") {
                if (msg.status === "downloading" || msg.status === "loading") {
                    llmLoading.value = true;
                    llmProgressPct.value = extractProgressPercent(msg.data);
                    const statusText = (msg.data && typeof (msg.data as Record<string, unknown>)?.status === "string")
                        ? String((msg.data as Record<string, unknown>).status)
                        : "Loading LLM runtime";
                    llmStep.value = msg.status === 'downloading' ? 'Downloading LLM model' : statusText;
                }
                if (msg.status === "mounting") {
                    llmLoading.value = true;
                    llmStep.value = "Mounting LLM (GPU compile)";
                }
                if (msg.status === "ready") {
                    llmLoading.value = false;
                    llmStep.value = "";
                    llmProgressPct.value = 100;
                    llmPipeline = {};
                }
                if (msg.status === "generating") {
                    llmGenerating.value = true;
                }
            } else if (msg.type === "token") {
                // Optionally stream tokens; keep UI minimal (final output recorded on complete)
            } else if (msg.type === "complete") {
                llmGenerating.value = false;
                const t = String(msg.text || "");
                const cleanedFromWorker = extractAssistantText(t);
                if (cleanedFromWorker?.trim()) {
                    addLlmOutput(cleanedFromWorker.trim());
                }
                if (llmPending) {
                    llmPending.resolve(t);
                    llmPending = null;
                }
            } else if (msg.type === "error") {
                llmGenerating.value = false;
                const err = new Error(String(msg.error || "LLM error"));
                if (llmPending) {
                    llmPending.reject(err);
                    llmPending = null;
                }
            }
        });
        llmLoading.value = true;
        llmStep.value = "Initializing LLM (worker)";
        worker.postMessage({ type: "load", modelId: props.agentLlmModelId });
        llmWorkerRef.value = worker;
    } catch (e) {
        console.error("[Agent LLM] Failed to init worker:", e);
        llmWorkerRef.value = null;
    }
}

async function generateWithLLM(prompt: string, options?: Record<string, unknown>): Promise<string> {
    if (llmWorkerRef.value) {
        if (llmPending) return "";
        return await new Promise<string>((resolve, reject) => {
            llmPending = { resolve, reject };
            try {
                llmWorkerRef.value?.postMessage({ type: "generate", prompt, options: options || {} });
            } catch (e) {
                llmPending = null;
                reject(e as Error);
            }
        });
    }
    // Worker is required; if unavailable, return empty
    return "";
}

// Main-thread STT removed; worker-only

// MediaRecorder-based STT removed; worker-only

function maybeRejectAudio(text: string): boolean {
    const s = (text || "").trim();
    return s === "[BLANK_AUDIO]";
}

// Build a trimmed, reverse-ordered chat history snippet for prompts
function buildPromptHistory(
    maxItems: number,
    maxCharsPerItem: number,
    totalCharLimit: number,
): string {
    try {
        const src = conversationItems.value.slice(-maxItems); // chronological (oldest first)
        let out = "";
        let total = 0;
        for (const item of src) {
            const role = item.role === 'user' ? 'User' : 'Assistant';
            let text = String(item.text || '').trim().replace(/\s+/g, ' ');
            if (maxCharsPerItem > 0 && text.length > maxCharsPerItem) {
                text = text.slice(0, maxCharsPerItem);
            }
            const line = `${role}: ${text}`;
            const toAdd = out ? `\n${line}` : line;
            if (totalCharLimit > 0 && total + toAdd.length > totalCharLimit) break;
            out += toAdd;
            total += toAdd.length;
        }
        return out;
    } catch {
        return "";
    }
}

// Extract only the assistant portion from LLM output, if present
function extractAssistantText(raw: string): string {
    const t = String(raw || '');
    const cleaned = t.replace(/^[\s\S]*?Assistant:\s*/i, '').trim();
    return cleaned || t.trim();
}

async function handleTranscript(peerId: string, text: string, _opts?: { incomplete?: boolean }) {
    // Optionally generate a reply if LLM is enabled
    if (!props.agentEnableLlm) return;
    try {
        if (maybeRejectAudio(text)) return;
        const history = buildPromptHistory(12, 200, 1800);
        const gatingInstruction = (() => {
            const wake = String(props.agentWakeWord || '').trim();
            const end = String(props.agentEndWord || '').trim();
            if (wake && end) return `Guidance: Wake word may be present ('${wake}'); if the request seems partial or lacks a clear end, output exactly <no-reply/>.`;
            if (wake && !end) return `Guidance: A wake word may start the request ('${wake}'); rely on natural boundaries. If the request seems partial, output exactly <no-reply/>.`;
            return `Guidance: If input seems partial, output exactly <no-reply/>.`;
        })();
        const systemPrefix = 'System: You are an in-world assistant. Be concise and conversational. If the user input is partial or insufficient, respond with exactly <no-reply/> and nothing else. If sufficient follow up has been provided after you replied <no-reply/> then reply with a response.';
        const prompt = `${systemPrefix}\n${gatingInstruction}\n${history ? `Chat history:\n${history}\n` : ''}\nUser: ${text}\n\nAssistant:`;
        const reply: string = await generateWithLLM(prompt, { max_new_tokens: 80, temperature: 0.7, return_full_text: false });
        const cleaned = extractAssistantText(reply).trim();
        if (cleaned?.includes('<no-reply/>')) {
            // Start a timer to reprompt if nothing else arrives
            scheduleNoReplyTimer(peerId);
            return;
        }
        if (cleaned.length > 0) {
            console.log("[Agent LLM]", cleaned);
            ttsQueue.push(cleaned);
            void flushTTSQueue();
        }
    } catch (e) {
        console.error("[Agent LLM] Generation failed:", e);
    }
}

async function submitToLlmWithNoReply(peerId: string, text: string, opts?: { incomplete?: boolean }): Promise<void> {
    const s = getOrCreateSttSession(peerId);
    s.lastSubmitAt = Date.now();
    clearNoReplyTimer(peerId);
    await handleTranscript(peerId, text, opts);
}

// Wake/End word gated ASR routing with session timeout and no-reply timers
type STTSession = { awaitingWake: boolean; buffered: string; noReplyTimerId: number | null; lastSubmitAt: number };
const sttSessions = new Map<string, STTSession>();

function getOrCreateSttSession(peerId: string): STTSession {
    let s = sttSessions.get(peerId);
    if (!s) {
        s = { awaitingWake: true, buffered: "", noReplyTimerId: null, lastSubmitAt: 0 };
        sttSessions.set(peerId, s);
    }
    return s;
}

function clearNoReplyTimer(peerId: string): void {
    const s = getOrCreateSttSession(peerId);
    if (s.noReplyTimerId !== null) {
        try { clearTimeout(s.noReplyTimerId); } catch { /* ignore */ }
        s.noReplyTimerId = null;
    }
}

// Removed scheduleGateTimeout: gating handled by LLM no-reply behavior

function scheduleNoReplyTimer(peerId: string): void {
    const s = getOrCreateSttSession(peerId);
    clearNoReplyTimer(peerId);
    const ms = Math.max(500, Number(props.agentNoReplyTimeoutSec) * 1000);
    s.noReplyTimerId = setTimeout(async () => {
        s.noReplyTimerId = null;
        const text = (s.buffered || "").trim();
        if (text) await submitToLlmWithNoReply(peerId, text, { incomplete: true });
    }, ms) as unknown as number;
}

async function flushTTSQueue() {
    if (isSpeaking.value) return;
    if (ttsQueue.length === 0) return;
    const next = ttsQueue.shift();
    if (!next) return;
    isSpeaking.value = true;
    try {
        await speakWithKokoro(next);
    } finally {
        isSpeaking.value = false;
        if (ttsQueue.length > 0) void flushTTSQueue();
    }
}

async function speakWithKokoro(text: string): Promise<void> {
    try {
        const bus = busRef.value;
        const allowLocalEcho = props.agentTtsLocalEcho;
        const hasPeers = !!bus && typeof bus.getPeers === 'function' && bus.getPeers().size > 0;
        const useBus = !!bus && hasPeers;

        // If local echo is disabled and there are no WebRTC peers, skip speaking
        if (!allowLocalEcho && !useBus) {
            console.warn("[Agent TTS] No WebRTC peers and local echo disabled; skipping TTS playback.");
            return;
        }

        // Ensure bus audio context exists if we intend to use it
        if (useBus) {
            try {
                await bus.ensureUplinkDestination();
            } catch {
                /* no-op */
            }
        }

        const busCtx = useBus ? (bus.getUplinkAudioContext() || null) : null;
        const ctx = busCtx || new AudioContext();

        // Resume context before scheduling audio (autoplay policies)
        try {
            await ctx.resume();
        } catch {
            /* ignore */
        }

        // Generate PCM off-thread via worker (required)
        let pcmData: Float32Array | null = null;
        let sampleRate: number = 24000;
        if (ttsWorkerRef.value) {
            let payload: { sampleRate: number; pcm: ArrayBuffer } | null = null;
            ttsGenerating.value = true;
            try {
                payload = await new Promise<{ sampleRate: number; pcm: ArrayBuffer }>((resolve, reject) => {
                    let settled = false;
                    const onMsg = (e: MessageEvent) => {
                        const m = e.data as { type: string; sampleRate?: number; pcm?: ArrayBuffer; status?: string; error?: string };
                        if (m.type === 'audio' && m.pcm && typeof m.sampleRate === 'number') {
                            settled = true;
                            ttsWorkerRef.value?.removeEventListener('message', onMsg);
                            resolve({ sampleRate: m.sampleRate, pcm: m.pcm });
                        } else if (m.type === 'error') {
                            settled = true;
                            ttsWorkerRef.value?.removeEventListener('message', onMsg);
                            reject(new Error(String(m.error || 'TTS error')));
                        }
                    };
                    ttsWorkerRef.value?.addEventListener('message', onMsg);
                    try { ttsWorkerRef.value?.postMessage({ type: 'speak', text }); } catch (e) { if (!settled) { ttsWorkerRef.value?.removeEventListener('message', onMsg); reject(e as Error); } }
                });
            } finally {
                ttsGenerating.value = false;
            }
            if (payload) {
                sampleRate = payload.sampleRate;
                pcmData = new Float32Array(payload.pcm);
            }
        }

        let source: AudioBufferSourceNode | null = null;
        let gain: GainNode | null = null;
        if (pcmData) {
            const buffer = ctx.createBuffer(1, pcmData.length, sampleRate);
            buffer.getChannelData(0).set(pcmData);
            source = ctx.createBufferSource();
            source.buffer = buffer;
        }
        if (!source) return;

        if (!source) return;

        // Add a gain node to ensure audible output and allow easy scaling
        gain = ctx.createGain();
        gain.gain.value = 1.25; // slight amplification

        // Always connect source to our gain
        source.connect(gain);
        // Route to WebRTC uplink if available
        if (useBus && bus) {
            bus.connectNodeToUplink(gain);
            await bus.replaceUplinkWithDestination();
        }
        // Optionally also play locally
        if (allowLocalEcho) {
            try { gain.connect(ctx.destination); } catch { /* ignore */ }
        }

        await new Promise<void>((resolve) => {
            source.addEventListener("ended", () => resolve());
            // Small fade-in to avoid clicks
            try {
                const t = ctx.currentTime;
                gain?.gain.setValueAtTime(0.0001, t);
                gain?.gain.exponentialRampToValueAtTime(1.25, t + 0.02);
            } catch {
                /* ignore */
            }
            source.start();
        });
    } catch (e) {
        console.error("[Agent TTS] Failed to speak via Kokoro:", e);
    }
}

// Test TTS function for the overlay
const testTTS = async () => {
    if (!kokoroTTS.value) {
        console.warn("[Agent] TTS not available for testing");
        return;
    }

    try {
        await speakWithKokoro(
            "Hello! This is a test of the autonomous agent TTS system.",
        );
        console.log("[Agent] TTS test completed successfully");
    } catch (e) {
        console.error("[Agent] TTS test failed:", e);
    }
};

if (featureEnabled) {
    watch(
        () => props.vircadiaWorld?.connectionInfo.value.status,
        async (status) => {
            if (status === "connected") {
                if (props.agentEnableTts) {
                    // Initialize TTS worker
                    initTtsWorkerOnce();
                }
                if (props.agentEnableLlm) {
                    // Initialize LLM worker
                    initLlmWorkerOnce();
                }
                // After models are ready, attach STT to existing remote streams via worker
                if (props.agentEnableStt) {
                    initSttWorkerOnce();
                    const mode = props.agentSttInputMode;
                    if (mode === 'webrtc' || mode === 'both') {
                        for (const [pid, stream] of remoteStreamsRef.value) {
                            attachStreamToSTT(pid, stream);
                        }
                    }
                    if (mode === 'mic' || mode === 'both') {
                        await attachMicToSTT();
                    }
                }
            } else {
                stopKokoro();
                for (const [pid] of peerProcessors) detachStreamFromSTT(pid);
                detachMicFromSTT();
            }
        },
        { immediate: true },
    );
    // Also react if the WebRTC bus becomes available after connection
    // React whenever remoteStreams map changes: attach recorders to new streams
    watch(
        () => remoteStreamsRef.value,
        (streams, oldStreams) => {
            if (!props.agentEnableStt) return;
            initSttWorkerOnce();
            const mode = props.agentSttInputMode;
            if (mode === 'webrtc' || mode === 'both') {
                for (const [pid, stream] of streams) {
                    attachStreamToSTT(pid, stream);
                }
            }
            // Detach for peers removed from map
            if (oldStreams instanceof Map) {
                for (const [oldPid] of oldStreams) {
                    if (!streams.has(oldPid)) detachStreamFromSTT(oldPid);
                }
            }
        },
        { deep: true },
    );
    // Watch for input mode changes
    watch(
        () => props.agentSttInputMode,
        async (mode) => {
            if (!props.agentEnableStt) return;
            initSttWorkerOnce();
            if (mode === 'webrtc') {
                // ensure mic detached, attach all remote
                detachMicFromSTT();
                for (const [pid, stream] of remoteStreamsRef.value) attachStreamToSTT(pid, stream);
            } else if (mode === 'mic') {
                // detach all remote, attach mic
                for (const [pid] of peerProcessors) detachStreamFromSTT(pid);
                await attachMicToSTT();
            } else if (mode === 'both') {
                for (const [pid, stream] of remoteStreamsRef.value) attachStreamToSTT(pid, stream);
                await attachMicToSTT();
            }
        },
        { immediate: false },
    );
} else {
    console.debug(
        "[VircadiaAutonomousAgent] Disabled via ?is_autonomous_agent=false (default to false)",
    );
}

onUnmounted(() => {
    stopKokoro();
    for (const [pid] of peerProcessors) detachStreamFromSTT(pid);
    detachMicFromSTT();
    for (const unsub of remoteUnsubscribeFns) {
        try {
            unsub();
        } catch { }
    }
    remoteUnsubscribeFns.length = 0;
});

// TTS worker init
function initTtsWorkerOnce(): void {
    if (ttsWorkerRef.value) return;
    try {
        const worker = new Worker(new URL("./VircadiaAutonomousAgentTTSWorker.ts", import.meta.url), { type: "module" });
        worker.addEventListener("message", (e: MessageEvent) => {
            const msg = e.data as { type: string; status?: string; data?: unknown };
            if (msg.type === "status") {
                if (msg.status === "downloading") {
                    kokoroLoading.value = true;
                    kokoroStep.value = "Downloading TTS model";
                }
                if (msg.status === "loading") {
                    kokoroLoading.value = true;
                    kokoroStep.value = "Initializing TTS";
                }
                if (msg.status === "mounting") {
                    kokoroLoading.value = true;
                    kokoroStep.value = "Mounting TTS (GPU compile)";
                }
                if (msg.status === "ready") {
                    kokoroLoading.value = false;
                    kokoroStep.value = "";
                    kokoroTTS.value = {};
                }
                if (msg.status === "generating") {
                    ttsGenerating.value = true;
                }
            }
        });
        kokoroLoading.value = true;
        kokoroStep.value = "Initializing TTS (worker)";
        worker.postMessage({ type: "load", modelId: props.agentTtsModelId });
        ttsWorkerRef.value = worker;
    } catch (e) {
        console.error("[Agent TTS] Failed to init worker:", e);
        ttsWorkerRef.value = null;
    }
}
</script>

<style>
.teleport-container {
    display: flex;
    align-items: center;
}

.wrap-anywhere {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
}
</style>
