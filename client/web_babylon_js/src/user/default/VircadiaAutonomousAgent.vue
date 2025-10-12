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
    <v-overlay v-model="overlayOpen" persistent location="center" scroll-strategy="block"
        class="align-center justify-center">
        <v-card class="max-w-[500px] min-w-[400px] max-h-[80vh] overflow-y-auto">
            <v-card-title class="d-flex align-center">
                <v-icon class="mr-2">mdi-robot</v-icon>
                Autonomous Agent Status
                <v-spacer />
                <v-btn icon variant="text" @click="overlayOpen = false">
                    <v-icon>mdi-close</v-icon>
                </v-btn>
            </v-card-title>

            <v-card-text>
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
                                    <span>TTS (Kokoro): {{ props.agentEnableTTS ? 'Enabled' : 'Disabled' }}</span>
                                </div>
                                <div class="d-flex align-center mb-2">
                                    <v-icon :color="props.agentEnableLLM ? 'success' : 'grey'" class="mr-2">
                                        {{ props.agentEnableLLM ? 'mdi-check-circle' : 'mdi-circle-outline' }}
                                    </v-icon>
                                    <span>LLM (Granite): {{ props.agentEnableLLM ? 'Enabled' : 'Disabled' }}</span>
                                </div>
                                <div class="d-flex align-center">
                                    <v-icon :color="props.agentEnableSTT ? 'success' : 'grey'" class="mr-2">
                                        {{ props.agentEnableSTT ? 'mdi-check-circle' : 'mdi-circle-outline' }}
                                    </v-icon>
                                    <span>STT (Whisper): {{ props.agentEnableSTT ? 'Enabled' : 'Disabled' }}</span>
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
                                    <span>• LLM (Granite): {{ llmLoading ? (llmStep || 'Loading') : 'Ready' }}</span>
                                    <span>• TTS (Kokoro): {{ kokoroLoading ? (kokoroStep || 'Loading') : 'Ready'
                                    }}</span>
                                    <span>• STT (Whisper): {{ sttLoading ? (sttStep || 'Loading') : 'Ready' }}</span>
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
                                    <span class="font-weight-medium">TTS (Kokoro)</span>
                                    <v-spacer />
                                    <v-chip :color="kokoroLoading ? 'warning' : kokoroTTS ? 'success' : 'error'"
                                        size="small">
                                        {{ kokoroLoading ? 'Loading' : kokoroTTS ? 'Ready' : 'Error' }}
                                    </v-chip>
                                </div>
                                <div v-if="kokoroLoading" class="ml-6">
                                    <v-progress-linear indeterminate color="primary" height="4" class="mb-1" />
                                    <span class="text-caption text-medium-emphasis">{{ kokoroStep || 'Initializing...'
                                        }}</span>
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
                                    <span class="font-weight-medium">LLM (Granite)</span>
                                    <v-spacer />
                                    <v-chip :color="llmLoading ? 'warning' : llmPipeline ? 'success' : 'error'"
                                        size="small">
                                        {{ llmLoading ? 'Loading' : llmPipeline ? 'Ready' : 'Error' }}
                                    </v-chip>
                                </div>
                                <div v-if="llmLoading" class="ml-6">
                                    <v-progress-linear indeterminate color="primary" height="4" class="mb-1" />
                                    <span class="text-caption text-medium-emphasis">{{ llmStep || 'Initializing...'
                                        }}</span>
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
                                    <span class="font-weight-medium">STT (Whisper)</span>
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

// Use a broad unknown type here to avoid coupling to transformers' complex union type
let llmPipeline: unknown = null;
const llmLoading = ref<boolean>(false);
const llmStep = ref<string>("");

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
                if (msg.status === "loading") {
                    sttLoading.value = true;
                    try {
                        const d = msg.data;
                        if (d && typeof d === "object") {
                            const p = d?.progress || d?.status || d?.file || d?.message || JSON.stringify(d);
                            sttStep.value = typeof p === "string" ? p : "Loading Whisper (worker)";
                        } else {
                            sttStep.value = "Loading Whisper (worker)";
                        }
                    } catch { sttStep.value = "Loading Whisper (worker)"; }
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
        worker.postMessage({ type: "load" });
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
                    sttWorkerRef.value!.postMessage(
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
            "onnx-community/Kokoro-82M-v1.0-ONNX",
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

const initLLM = async (): Promise<void> => {
    if (!props.agentEnableLLM) return;
    if (llmPipeline) return;
    try {
        console.log(
            "[VircadiaAutonomousAgent] Initializing Transformers.js LLM (WebGPU)...",
        );
        llmLoading.value = true;
        llmStep.value = "Loading Transformers runtime";
        const { pipeline } = await import("@huggingface/transformers");
        llmStep.value = "Downloading Granite model";
        // Text-generation chat pipeline using Granite 4.0 Micro on WebGPU
        llmPipeline = await pipeline(
            "text-generation",
            "onnx-community/granite-4.0-micro-ONNX-web",
            {
                device: "webgpu",
                // Show granular load progress in overlay
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                progress_callback: (x: any) => {
                    try {
                        const p = x?.progress || x?.status || x?.file || x?.message || JSON.stringify(x);
                        llmStep.value = typeof p === "string" ? p : "Downloading Granite model";
                    } catch { /* ignore */ }
                },
            },
        );
        console.log("[VircadiaAutonomousAgent] LLM initialized.");
        llmStep.value = "";
    } catch (error) {
        console.error(
            "[VircadiaAutonomousAgent] Failed to initialize LLM:",
            error,
        );
        llmPipeline = null;
        llmStep.value = "Error";
    }
    llmLoading.value = false;
};

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
            "Xenova/whisper-base",
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
        const llmAny = llmPipeline as any;
        if (!llmAny) return; // Not ready yet
        const prompt = `You are an in-world assistant. Keep replies short and conversational. User said: "${text}"\nAssistant:`;
        const out = typeof llmAny === 'function'
            ? await llmAny(prompt, { max_new_tokens: 80, temperature: 0.7 })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            : (await (llmAny?.__call__
                ? llmAny.__call__(prompt, { max_new_tokens: 80, temperature: 0.7 })
                : llmAny?.generate?.({ inputs: prompt, max_new_tokens: 80, temperature: 0.7 } as any)));
        const reply: string =
            (Array.isArray(out)
                ? out[0]?.generated_text
                : out?.generated_text) || "";
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
    s.buffer = (s.buffer ? s.buffer + " " : "") + trimmed;
    await maybeSendStreamToLLM(peerId);
}

async function maybeSendStreamToLLM(peerId: string): Promise<void> {
    if (!props.agentEnableLLM) return;
    if (!llmPipeline) return; // Wait until ready
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
    const hash = String(windowText.length) + ":" + windowText.slice(-64);
    if (hash === s.lastSeenTextHash) return;

    s.lastSeenTextHash = hash;
    s.lastSentAtMs = now;

    try {
        const llmAny = llmPipeline as any;
        if (!llmAny) return;
        const wake = String(props.agentWakeWord || "").trim();
        const end = String(props.agentEndWord || "").trim();
        const policy = props.agentUseWakeEndGating
            ? `Only respond when you detect speech between the wake word "${wake}" and the end word "${end}". If not present, do not reply.`
            : `Decide if the latest stream contains a complete user request. If it's partial, ambiguous, or not addressable yet, respond with <no-reply/>.`;
        const prompt = `You are an in-world assistant receiving a rolling transcript stream (latest first may be truncated). ${policy}\nTranscript:\n"""\n${windowText}\n"""\nAssistant:`;
        const out = typeof llmAny === 'function'
            ? await llmAny(prompt, { max_new_tokens: 80, temperature: 0.7 })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            : (await (llmAny?.__call__
                ? llmAny.__call__(prompt, { max_new_tokens: 80, temperature: 0.7 })
                : llmAny?.generate?.({ inputs: prompt, max_new_tokens: 80, temperature: 0.7 } as any)));
        const reply: string =
            (Array.isArray(out)
                ? out[0]?.generated_text
                : out?.generated_text) || "";
        const cleaned = String(reply || "").trim();
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
    if (!kokoroTTS.value) return;
    try {
        const bus = busRef.value;
        const wantBus = !props.agentTtsLocalEcho && !!bus;

        // Ensure bus audio context exists if we intend to use it
        if (wantBus) {
            try {
                await bus!.ensureUplinkDestination();
            } catch {
                /* no-op */
            }
        }

        const busCtx = wantBus ? bus!.getUplinkAudioContext() || null : null;
        const useLocalEcho = !busCtx;
        const ctx = useLocalEcho ? new AudioContext() : busCtx!;

        // Resume context before scheduling audio (autoplay policies)
        try {
            await ctx.resume();
        } catch {
            /* ignore */
        }

        const ttsAny = kokoroTTS.value as any;
        const result =
            (await (ttsAny.tts ? ttsAny.tts(text) : ttsAny.generate?.(text))) ||
            null;

        let source: AudioBufferSourceNode | null = null;
        let gain: GainNode | null = null;

        function toFloat32Array(
            input: unknown,
        ): { data: Float32Array; sampleRate: number } | null {
            if (!input) return null;
            // Common shapes: { audio: Float32Array, sample_rate }, { audio: Int16Array, sample_rate },
            // { audio: number[], sample_rate }, AudioBuffer, or nested { audio: { data, sample_rate } }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const anyIn = input as any;
            if (anyIn instanceof AudioBuffer) {
                const sr = anyIn.sampleRate || 24000;
                const data = anyIn.getChannelData(0);
                return { data: new Float32Array(data), sampleRate: sr };
            }
            const container = anyIn.audio ? anyIn : anyIn.audio ? anyIn : null;
            const payload = container ? container.audio : anyIn.audio;
            const dataRaw = payload?.data ? payload.data : payload;
            const sr =
                anyIn.sample_rate ||
                anyIn.sampleRate ||
                anyIn.samplerate ||
                24000;
            if (!dataRaw) return null;
            if (dataRaw instanceof Float32Array)
                return { data: dataRaw, sampleRate: sr };
            if (dataRaw instanceof Int16Array) {
                const out = new Float32Array(dataRaw.length);
                for (let i = 0; i < dataRaw.length; i++)
                    out[i] = dataRaw[i] / 32768;
                return { data: out, sampleRate: sr };
            }
            if (Array.isArray(dataRaw)) {
                // Normalize if values look like PCM16
                let maxAbs = 0;
                for (let i = 0; i < dataRaw.length; i++) {
                    const v = Math.abs(Number(dataRaw[i]) || 0);
                    if (v > maxAbs) maxAbs = v;
                }
                const scale = maxAbs > 1.0 ? 32768 : 1.0;
                const out = new Float32Array(dataRaw.length);
                for (let i = 0; i < dataRaw.length; i++)
                    out[i] = Number(dataRaw[i]) / scale;
                return { data: out, sampleRate: sr };
            }
            return null;
        }

        const converted =
            toFloat32Array(result) ||
            toFloat32Array({
                audio: result?.audio,
                sample_rate: result?.sample_rate,
            });
        if (converted) {
            const buffer = ctx.createBuffer(
                1,
                converted.data.length,
                converted.sampleRate,
            );
            buffer.getChannelData(0).set(converted.data);
            source = ctx.createBufferSource();
            source.buffer = buffer;
        }
        // Fallback: if result was a direct AudioBuffer
        if (!source && result instanceof AudioBuffer) {
            source = ctx.createBufferSource();
            source.buffer = result as AudioBuffer;
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
            source!.addEventListener("ended", () => resolve());
            // Small fade-in to avoid clicks
            try {
                const t = ctx.currentTime;
                gain!.gain.setValueAtTime(0.0001, t);
                gain!.gain.exponentialRampToValueAtTime(1.25, t + 0.02);
            } catch {
                /* ignore */
            }
            source!.start();
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
                if (props.agentEnableTTS) inits.push(initKokoro());
                if (props.agentEnableLLM) inits.push(initLLM());
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
</script>

<style>
.teleport-container {
    display: flex;
    align-items: center;
}
</style>
