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
        <v-card
            class="d-flex flex-column max-h-[80vh] overflow-hidden min-w-[360px] max-w-[90vw] md:min-w-[720px] lg:min-w-[880px]">
            <v-card-title class="d-flex align-center">
                <v-icon class="mr-2">mdi-robot</v-icon>
                Autonomous Agent Status
                <v-spacer />
                <v-btn icon variant="text" @click="overlayOpen = false">
                    <v-icon>mdi-close</v-icon>
                </v-btn>
            </v-card-title>

            <v-card-text class="py-2" style="flex: 1 1 auto; overflow-y: auto;">
                <!-- Feature Status Overview -->
                <v-row class="mb-4">
                    <v-col cols="12">
                        <v-card variant="outlined" class="pa-3">
                            <v-card-subtitle>Feature Status</v-card-subtitle>
                            <div class="d-flex flex-column">
                                <div class="d-flex align-center mb-2">
                                    <v-icon :color="props.agentEnableTTS ? 'success' : 'grey'" class="mr-2">
                                        {{ props.agentEnableTTS ? 'mdi-check-circle' : 'mdi-circle-outline' }}
                                    </v-icon>
                                    <span>TTS ({{ ttsModelName }}): {{ props.agentEnableTTS ? 'Enabled' : 'Disabled'
                                    }}</span>
                                </div>
                                <div class="d-flex align-center mb-2">
                                    <v-icon :color="props.agentEnableLLM ? 'success' : 'grey'" class="mr-2">
                                        {{ props.agentEnableLLM ? 'mdi-check-circle' : 'mdi-circle-outline' }}
                                    </v-icon>
                                    <span>LLM ({{ llmModelName }}): {{ props.agentEnableLLM ? 'Enabled' : 'Disabled'
                                    }}</span>
                                </div>
                                <div class="d-flex align-center">
                                    <v-icon :color="props.agentEnableSTT ? 'success' : 'grey'" class="mr-2">
                                        {{ props.agentEnableSTT ? 'mdi-check-circle' : 'mdi-circle-outline' }}
                                    </v-icon>
                                    <span>STT ({{ sttModelName }}): {{ props.agentEnableSTT ? 'Enabled' : 'Disabled'
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
                <v-row v-if="props.agentEnableSTT">
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
                                Waiting for remote audio...
                            </div>
                            <v-virtual-scroll v-else :items="transcriptsLimitedReversed" :height="220"
                                class="overflow-y-auto" item-height="44">
                                <template #default="{ item }">
                                    <v-list-item :key="item.at + ':' + item.peerId" density="compact">
                                        <v-list-item-title>
                                            <code>{{ new Date(item.at).toLocaleTimeString() }}</code>
                                            <span class="ml-2 text-medium-emphasis">[{{ item.peerId }}]</span>
                                        </v-list-item-title>
                                        <v-list-item-subtitle>{{ item.text }}</v-list-item-subtitle>
                                    </v-list-item>
                                </template>
                            </v-virtual-scroll>
                        </v-card>
                    </v-col>
                </v-row>

                <!-- Model Loading States -->
                <v-row>
                    <v-col cols="12">
                        <v-card variant="outlined" class="pa-3">
                            <v-card-subtitle>Model Status</v-card-subtitle>

                            <!-- TTS Status -->
                            <div v-if="props.agentEnableTTS" class="mb-3">
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
                            <div v-if="props.agentEnableLLM" class="mb-3">
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
                            <div v-if="props.agentEnableSTT" class="mb-3">
                                <div class="d-flex align-center mb-1">
                                    <v-icon class="mr-2">mdi-microphone</v-icon>
                                    <span class="font-weight-medium">STT ({{ sttModelName }})</span>
                                    <v-spacer />
                                    <v-chip :color="sttLoading ? 'warning' : sttPipeline ? 'success' : 'error'"
                                        size="small">
                                        {{ sttLoading ? 'Loading' : sttPipeline ? 'Ready' : 'Error' }}
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
                        </v-card>
                    </v-col>
                </v-row>

                <!-- LLM Output (Thoughts) -->
                <v-row v-if="props.agentEnableLLM">
                    <v-col cols="12">
                        <v-card variant="outlined" class="pa-3">
                            <div class="d-flex align-center mb-2">
                                <v-card-subtitle class="pr-2">LLM Output</v-card-subtitle>
                                <v-spacer />
                                <v-chip :color="llmGenerating ? 'warning' : 'success'" size="small">
                                    {{ llmGenerating ? 'Generating' : 'Idle' }}
                                </v-chip>
                            </div>
                            <div v-if="llmOutputs.length === 0" class="text-caption text-medium-emphasis ml-1">
                                Waiting for LLM output...
                            </div>
                            <v-virtual-scroll v-else :items="llmOutputsReversed" :height="160" class="overflow-y-auto"
                                item-height="44">
                                <template #default="{ item }">
                                    <v-list-item :key="item.at" density="compact">
                                        <v-list-item-title>
                                            <code>{{ new Date(item.at).toLocaleTimeString() }}</code>
                                        </v-list-item-title>
                                        <v-list-item-subtitle>{{ item.text }}</v-list-item-subtitle>
                                    </v-list-item>
                                </template>
                            </v-virtual-scroll>
                        </v-card>
                    </v-col>
                </v-row>

                <!-- Action Buttons -->
                <v-row>
                    <v-col cols="12">
                        <div class="d-flex gap-2">
                            <v-btn v-if="props.agentEnableTTS && kokoroTTS" color="primary" variant="outlined"
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
import { read_audio } from "@huggingface/transformers";
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
    agentEnableTTS: { type: Boolean, default: true },
    agentEnableLLM: { type: Boolean, default: true },
    agentEnableSTT: { type: Boolean, default: true },
    agentTtsLocalEcho: { type: Boolean, default: false },
    // Wake/End word control provided by MainScene (required via template props)
    agentWakeWord: { type: String, default: "computer" },
    agentEndWord: { type: String, default: "over" },
    // Control whether to gate by wake/end or stream small segments to LLM
    agentUseWakeEndGating: { type: Boolean, default: false },
    // STT segmentation window (seconds) and max buffer
    agentSttWindowSec: { type: Number, default: 2.5 },
    agentSttMaxBufferSec: { type: Number, default: 10.0 },
    // Preferred conversational language (ISO-639-1), provided via MainScene
    agentLanguage: { type: String, required: true },
    // Model identifiers provided via MainScene
    agentTtsModelId: { type: String, required: true },
    agentLlmModelId: { type: String, required: true },
    agentSttModelId: { type: String, required: true },
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

// Realtime STT via WebGPU worker
const useWorkerStreaming = true;
const sttWorkerRef = ref<Worker | null>(null);
type PeerAudioProcessor = {
    ctx: AudioContext;
    source: MediaStreamAudioSourceNode;
    node: AudioWorkletNode;
    sink: GainNode;
};
const peerProcessors = new Map<string, PeerAudioProcessor>();

function initSttWorkerOnce(): void {
    if (!useWorkerStreaming) return;
    if (sttWorkerRef.value) return;
    try {
        const worker = new Worker(new URL("./VircadiaAutonomousAgentSTTWorker.ts", import.meta.url), { type: "module" });
        worker.addEventListener("message", (e: MessageEvent) => {
            const msg = e.data as { type: string; status?: string; peerId?: string; data?: any; error?: string };
            if (msg.type === "status") {
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
                }
                if (msg.status === "update") {
                    // Optional: surface interim text; keep UI minimal for now
                    // console.debug("[Agent STT] partial", msg.peerId, msg.data?.text);
                } else if (msg.status === "complete") {
                    const t = (msg.data?.text || "").trim();
                    if (t) void processAsrText(msg.peerId || "peer", t);
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

function downsample48kTo16k(input: Float32Array): Float32Array {
    const ratio = 48000 / 16000;
    const outLen = Math.floor(input.length / ratio);
    const out = new Float32Array(outLen);
    let pos = 0;
    for (let i = 0; i < outLen; i++) {
        out[i] = input[Math.floor(pos)];
        pos += ratio;
    }
    return out;
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
    if (!sttWorkerRef.value) return;

    try {
        const ctx = new AudioContext({ sampleRate: 48000 });
        await ensureSttWorklet(ctx);
        const source = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, "stt-processor", {
            processorOptions: { targetSampleRate: 16000, chunkMs: 200 },
        });

        node.port.onmessage = (ev: MessageEvent) => {
            const data = ev.data as { type: string; pcm?: ArrayBuffer };
            if (data && data.type === "pcm" && data.pcm) {
                if (!sttActive.value) return;
                try {
                    sttWorkerRef.value?.postMessage(
                        { type: "audio", peerId, pcm: data.pcm },
                        [data.pcm],
                    );
                } catch (err) {
                    console.warn("[Agent STT] Failed to post PCM to worker:", err);
                }
            }
        };

        // Ensure graph is pulled without audible output
        const sink = ctx.createGain();
        sink.gain.value = 0.0;

        source.connect(node);
        node.connect(sink);
        sink.connect(ctx.destination);

        peerProcessors.set(peerId, { ctx, source, node, sink });
        sttWorkerRef.value.postMessage({ type: "start", peerId, language: String(props.agentLanguage || 'en'), windowSec: Number(props.agentSttWindowSec || 2.5), maxBufferSec: Number(props.agentSttMaxBufferSec || 10.0) });
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
    const proc = peerProcessors.get(peerId);
    if (!proc) return;
    try {
        proc.node.disconnect();
        proc.sink.disconnect();
        proc.source.disconnect();
        proc.ctx.close().catch(() => { });
    } catch { }
    peerProcessors.delete(peerId);
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
function clearTranscripts() {
    transcripts.value = [];
}

// LLM output capture
type LlmEntry = { text: string; at: number };
const llmOutputs = ref<LlmEntry[]>([]);
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

// Deprecated snackbar flags removed; progress now shown inside overlay

const stopKokoro = () => {
    kokoroTTS.value = null;
};

const initKokoro = async (): Promise<void> => {
    if (kokoroTTS.value) return;
    try {
        console.log(
            "[VircadiaAutonomousAgent] Initializing Kokoro TTS (WebGPU)...",
        );
        kokoroLoading.value = true;
        kokoroStep.value = "Downloading TTS model";
        // Use WebGPU for acceleration; fallback handling is internal to kokoro-js
        const { KokoroTTS } = await import("kokoro-js");
        kokoroStep.value = "Compiling/initializing TTS";
        kokoroTTS.value = await KokoroTTS.from_pretrained(
            props.agentTtsModelId,
            {
                device: "webgpu",
                dtype: "fp32",
            },
        );
        console.log("[VircadiaAutonomousAgent] Kokoro TTS initialized.");
        kokoroStep.value = "";
    } catch (error) {
        console.error(
            "[VircadiaAutonomousAgent] Failed to initialize Kokoro TTS:",
            error,
        );
        kokoroTTS.value = null;
        kokoroStep.value = "Error";
    }
    kokoroLoading.value = false;
};

// LLM worker initialization and request routing
function extractProgressPercent(x: unknown): number {
    try {
        const anyX = x as Record<string, unknown> | null;
        const p = (anyX && (anyX as any).progress) as unknown;
        if (typeof p === "number") return p <= 1 ? p * 100 : p;
        const loaded = Number((anyX as any)?.loaded || 0);
        const total = Number((anyX as any)?.total || 0);
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
                    llmStep.value = msg.status === 'downloading' ? 'Downloading LLM model' : (typeof (msg.data as any)?.status === "string" ? String((msg.data as any).status) : "Loading LLM runtime");
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
                addLlmOutput(t);
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
    // Fallback path uses main-thread pipeline
    const llmAny = llmPipeline as any;
    if (!llmAny) return "";
    const out = typeof llmAny === 'function'
        ? await llmAny(prompt, options || {})
        : (await (llmAny?.__call__
            ? llmAny.__call__(prompt, options || {})
            : llmAny?.generate?.({ inputs: prompt, ...(options || {}) } as any)));
    return (Array.isArray(out) ? out[0]?.generated_text : out?.generated_text) || "";
}

const initSTT = async (): Promise<void> => {
    if (!props.agentEnableSTT) return;
    if (sttPipeline) return;
    try {
        sttLoading.value = true;
        sttStep.value = "Loading Transformers runtime";
        const { pipeline } = await import("@huggingface/transformers");
        sttStep.value = "Downloading Whisper model";
        // Browser ONNX Whisper via Xenova repo (Transformers.js)
        // See model card: Xenova/whisper-base
        sttPipeline = await pipeline(
            "automatic-speech-recognition",
            props.agentSttModelId,
            {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                progress_callback: (x: any) => {
                    try {
                        const p = x?.progress || x?.status || x?.file || x?.message || JSON.stringify(x);
                        sttStep.value = typeof p === "string" ? p : "Downloading Whisper model";
                    } catch { /* ignore */ }
                },
            },
        );
        sttStep.value = "";
        console.log("[VircadiaAutonomousAgent] STT initialized (Whisper base)");
    } catch (error) {
        console.error(
            "[VircadiaAutonomousAgent] Failed to initialize STT:",
            error,
        );
        sttPipeline = null;
        sttStep.value = "Error";
    }
    sttLoading.value = false;
};

function ensureRemoteRecording(peerId: string, stream: MediaStream) {
    if (remoteRecorders.has(peerId)) return;
    try {
        const track = stream.getAudioTracks()[0];
        if (!track) return;
        // Create a composed MediaStream for recorder stability
        const recStream = new MediaStream([track]);
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : MediaRecorder.isTypeSupported("audio/webm")
                ? "audio/webm"
                : "audio/ogg";
        const recorder = new MediaRecorder(recStream, { mimeType: mime });
        recorder.addEventListener("dataavailable", async (ev) => {
            if (!sttActive.value) return;
            if (!sttPipeline) return;
            const blob = ev.data;
            if (!blob || blob.size === 0) return;
            try {
                const sttAny = sttPipeline as any;
                // Convert Blob -> Float32Array PCM for Whisper
                let objectUrl: string | null = null;
                let result: unknown;
                try {
                    objectUrl = URL.createObjectURL(blob);
                    // Read and resample to 16 kHz mono as required by Whisper
                    const audio: Float32Array = await read_audio(
                        objectUrl,
                        16000,
                    );
                    result = await sttAny(audio, { language: String(props.agentLanguage || 'en') });
                } finally {
                    if (objectUrl) URL.revokeObjectURL(objectUrl);
                }
                const text: string = (result as any)?.text || "";
                if (text.trim().length > 0) {
                    console.log(`[Agent STT] (${peerId})`, text);
                    void processAsrText(peerId, text);
                }
            } catch (e) {
                console.error("[Agent STT] Whisper transcription failed:", e);
            }
        });
        const segMs = Math.max(1000, Math.min(5000, Math.round((props.agentSttWindowSec || 2.5) * 1000)));
        recorder.start(segMs);
        remoteRecorders.set(peerId, recorder);
        console.log(`[Agent STT] Recorder started for ${peerId}`);
    } catch (e) {
        console.error("[Agent STT] Failed to start recorder:", e);
    }
}

async function handleTranscript(peerId: string, text: string) {
    // Always record to overlay
    addTranscript(peerId, text);
    // Optionally generate a reply if LLM is enabled
    if (!props.agentEnableLLM) return;
    try {
        const prompt = `You are an in-world assistant. Keep replies short and conversational. User said: "${text}"\nAssistant:`;
        const reply: string = await generateWithLLM(prompt, { max_new_tokens: 80, temperature: 0.7 });
        if (reply.trim().length > 0) {
            console.log("[Agent LLM]", reply);
            ttsQueue.push(reply);
            void flushTTSQueue();
        }
    } catch (e) {
        console.error("[Agent LLM] Generation failed:", e);
    }
}

// Wake/End word gated ASR routing
type STTSession = { awaitingWake: boolean; buffered: string };
const sttSessions = new Map<string, STTSession>();

function getOrCreateSttSession(peerId: string): STTSession {
    let s = sttSessions.get(peerId);
    if (!s) {
        s = { awaitingWake: true, buffered: "" };
        sttSessions.set(peerId, s);
    }
    return s;
}

async function processAsrText(peerId: string, rawText: string): Promise<void> {
    // If streaming mode, forward small segments to LLM aggregator
    if (!props.agentUseWakeEndGating) {
        await handleStreamingSegment(peerId, rawText);
        return;
    }

    // Gated mode using wake/end words
    const wake = String(props.agentWakeWord || "").trim().toLowerCase();
    const end = String(props.agentEndWord || "").trim().toLowerCase();
    if (!wake || !end) {
        await handleTranscript(peerId, rawText);
        return;
    }
    const session = getOrCreateSttSession(peerId);
    let text = rawText;
    let lower = text.toLowerCase();
    if (session.awaitingWake) {
        const wakeIdx = lower.indexOf(wake);
        if (wakeIdx < 0) return;
        const start = wakeIdx + wake.length;
        text = text.slice(start);
        lower = lower.slice(start);
        session.awaitingWake = false;
        session.buffered = "";
    }
    const endIdx = lower.indexOf(end);
    if (endIdx >= 0) {
        const toAdd = text.slice(0, endIdx).trim();
        if (toAdd) session.buffered += (session.buffered ? " " : "") + toAdd;
        const finalUtterance = session.buffered.trim();
        session.awaitingWake = true;
        session.buffered = "";
        if (finalUtterance) await handleTranscript(peerId, finalUtterance);
        return;
    }
    const toAdd = text.trim();
    if (toAdd) session.buffered += (session.buffered ? " " : "") + toAdd;
}

// Streaming segmentation state and routing to LLM
type StreamSession = { buffer: string; lastSentAtMs: number; lastSeenTextHash: string };
const streamSessions = new Map<string, StreamSession>();

function getOrCreateStreamSession(peerId: string): StreamSession {
    let s = streamSessions.get(peerId);
    if (!s) {
        s = { buffer: "", lastSentAtMs: 0, lastSeenTextHash: "" };
        streamSessions.set(peerId, s);
    }
    return s;
}

async function handleStreamingSegment(peerId: string, segment: string): Promise<void> {
    const trimmed = (segment || "").trim();
    if (!trimmed) return;
    // Record minimal pieces to overlay
    addTranscript(peerId, trimmed);
    const s = getOrCreateStreamSession(peerId);
    s.buffer = (s.buffer ? `${s.buffer} ` : "") + trimmed;
    await maybeSendStreamToLLM(peerId);
}

async function maybeSendStreamToLLM(peerId: string): Promise<void> {
    if (!props.agentEnableLLM) return;
    if (!llmWorkerRef.value && !llmPipeline) return;
    const s = getOrCreateStreamSession(peerId);
    const now = Date.now();
    const minIntervalMs = 1500;
    if (now - s.lastSentAtMs < minIntervalMs) return;

    const full = s.buffer.trim();
    if (!full) return;

    // Use a sliding window to keep prompt bounded
    const maxChars = 600;
    const windowText = full.length > maxChars ? full.slice(-maxChars) : full;

    // Avoid redundant calls if text unchanged
    const hash = `${String(windowText.length)}:${windowText.slice(-64)}`;
    if (hash === s.lastSeenTextHash) return;

    s.lastSeenTextHash = hash;
    s.lastSentAtMs = now;

    try {
        const wake = props.agentWakeWord.trim();
        const end = props.agentEndWord.trim();
        const policy = props.agentUseWakeEndGating
            ? `Only respond when you detect speech between the wake word "${wake}" and the end word "${end}". If not present, do not reply.`
            : `Decide if the latest stream contains a complete user request. If it's partial, ambiguous, or not addressable yet, respond with <no-reply/>.`;
        const prompt = `You are an in-world assistant receiving a rolling transcript stream (latest first may be truncated). ${policy}\nTranscript:\n"""\n${windowText}\n"""\nAssistant:`;
        const reply: string = await generateWithLLM(prompt, { max_new_tokens: 80, temperature: 0.7 });
        const cleaned = reply.trim();
        if (!cleaned || cleaned.includes("<no-reply/>")) return;
        ttsQueue.push(cleaned);
        void flushTTSQueue();
    } catch (e) {
        console.error("[Agent LLM] Streaming generation failed:", e);
    }
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
        const allowLocalEcho = Boolean(props.agentTtsLocalEcho);
        const wantBus = !allowLocalEcho && !!bus;

        // If local echo is disabled and there are no WebRTC peers, skip speaking
        const hasPeers = !!bus && typeof bus.getPeers === 'function' && bus.getPeers().size > 0;
        if (!allowLocalEcho && !hasPeers) {
            console.warn("[Agent TTS] No WebRTC peers and local echo disabled; skipping TTS playback.");
            return;
        }

        // Ensure bus audio context exists if we intend to use it
        if (wantBus) {
            try {
                await bus.ensureUplinkDestination();
            } catch {
                /* no-op */
            }
        }

        const busCtx = wantBus ? bus.getUplinkAudioContext() || null : null;
        // Only fall back to local echo if explicitly allowed
        const useLocalEcho = allowLocalEcho || !busCtx;
        const ctx = useLocalEcho ? new AudioContext() : busCtx;

        // Resume context before scheduling audio (autoplay policies)
        try {
            await ctx.resume();
        } catch {
            /* ignore */
        }

        // If worker is available, generate PCM off-thread
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
        if (!source && !kokoroTTS.value) return;
        if (!source && kokoroTTS.value) {
            // Fallback to main-thread TTS if worker unavailable
            const ttsAny = kokoroTTS.value as any;
            const result = (await (ttsAny.tts ? ttsAny.tts(text) : ttsAny.generate?.(text))) || null;
            if (result instanceof AudioBuffer) {
                source = ctx.createBufferSource();
                source.buffer = result as AudioBuffer;
            }
        }

        if (!source) return;

        // Add a gain node to ensure audible output and allow easy scaling
        gain = ctx.createGain();
        gain.gain.value = 1.25; // slight amplification

        if (useLocalEcho) {
            source.connect(gain);
            gain.connect(ctx.destination);
        } else if (bus) {
            // Build nodes in the bus' AudioContext so connection succeeds
            source.connect(gain);
            // Connect into the uplink chain for WebRTC transmission
            bus.connectNodeToUplink(gain);
            await bus.replaceUplinkWithDestination();
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
                const inits: Promise<void>[] = [];
                if (props.agentEnableTTS) {
                    // Initialize TTS worker (and keep main-thread fallback available)
                    initTtsWorkerOnce();
                }
                if (props.agentEnableLLM) {
                    // Initialize LLM worker
                    initLlmWorkerOnce();
                }
                if (props.agentEnableSTT) inits.push(initSTT());
                await Promise.all(inits);
                // After models are ready, reactively attach STT to existing remote streams
                if (props.agentEnableSTT) {
                    if (useWorkerStreaming) initSttWorkerOnce();
                    for (const [pid, stream] of remoteStreamsRef.value) {
                        if (useWorkerStreaming) attachStreamToSTT(pid, stream);
                        else ensureRemoteRecording(pid, stream);
                    }
                }
            } else {
                stopKokoro();
                for (const [, rec] of remoteRecorders) {
                    try {
                        if (rec.state !== "inactive") rec.stop();
                    } catch { }
                }
                remoteRecorders.clear();
                for (const [pid] of peerProcessors) detachStreamFromSTT(pid);
            }
        },
        { immediate: true },
    );
    // Also react if the WebRTC bus becomes available after connection
    // React whenever remoteStreams map changes: attach recorders to new streams
    watch(
        () => remoteStreamsRef.value,
        (streams, oldStreams) => {
            if (!props.agentEnableSTT) return;
            void initSTT();
            if (useWorkerStreaming) initSttWorkerOnce();
            for (const [pid, stream] of streams) {
                if (useWorkerStreaming) attachStreamToSTT(pid, stream);
                else ensureRemoteRecording(pid, stream);
            }
            // Detach for peers removed from map
            if (useWorkerStreaming && oldStreams instanceof Map) {
                for (const [oldPid] of oldStreams) {
                    if (!streams.has(oldPid)) detachStreamFromSTT(oldPid);
                }
            }
        },
        { deep: true },
    );
} else {
    console.debug(
        "[VircadiaAutonomousAgent] Disabled via ?is_autonomous_agent=false (default to false)",
    );
}

onUnmounted(() => {
    stopKokoro();
    for (const [, rec] of remoteRecorders) {
        try {
            if (rec.state !== "inactive") rec.stop();
        } catch { }
    }
    remoteRecorders.clear();
    for (const [pid] of peerProcessors) {
        detachStreamFromSTT(pid);
    }
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
</style>
