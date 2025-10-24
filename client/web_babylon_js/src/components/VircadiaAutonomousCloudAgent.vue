<template>
    <!-- Renderless by default -->
    <slot></slot>

    <!-- Teleport control button to MainScene app bar -->
    <Teleport v-if="teleportTarget && featureEnabled" :to="teleportTarget">
        <v-tooltip location="bottom">
            <template #activator="{ props }">
                <v-btn v-bind="props" icon variant="text" class="ml-2" :color="overlayOpen ? 'primary' : undefined"
                    @click="toggleOverlay">
                    <v-icon>mdi-cloud</v-icon>
                </v-btn>
            </template>
            <span>Cloud Agent</span>
        </v-tooltip>
    </Teleport>

    <!-- Cloud Agent Overlay (simplified) -->
    <v-overlay v-model="overlayOpen" location="center" scroll-strategy="block" class="align-center justify-center">
        <v-card class="d-flex flex-column overflow-hidden min-w-[360px] max-w-[90vw] md:min-w-[720px] lg:min-w-[880px]"
            style="height: 70vh; max-height: 70vh;">
            <v-card-title class="d-flex align-center">
                <v-icon class="mr-2">mdi-cloud</v-icon>
                Autonomous Cloud Agent
                <v-spacer />
                <v-btn icon variant="text" @click="overlayOpen = false">
                    <v-icon>mdi-close</v-icon>
                </v-btn>
            </v-card-title>

            <v-card-text class="py-2" style="flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain;">
                <v-row class="mb-3">
                    <v-col cols="12">
                        <v-card variant="outlined" class="pa-3">
                            <div class="d-flex flex-wrap gap-3 align-center">
                                <div class="d-flex align-center">
                                    <v-icon class="mr-1">mdi-microphone</v-icon>
                                    <v-chip
                                        :color="sttUploading || sttProcessing ? 'warning' : (sttReady ? 'success' : 'error')"
                                        size="small">
                                        {{ sttUploading || sttProcessing ? 'Transcribing' : sttReady ? 'Ready' : 'Idle'
                                        }}
                                    </v-chip>
                                </div>
                                <div class="d-flex align-center">
                                    <v-icon class="mr-1">mdi-brain</v-icon>
                                    <v-chip :color="llmGenerating ? 'warning' : 'success'" size="small">
                                        {{ llmGenerating ? 'Thinking' : 'Ready' }}
                                    </v-chip>
                                </div>
                                <div class="d-flex align-center">
                                    <v-icon class="mr-1">mdi-volume-high</v-icon>
                                    <v-chip :color="ttsGenerating ? 'warning' : 'success'" size="small">
                                        {{ ttsGenerating ? 'Speaking' : 'Ready' }}
                                    </v-chip>
                                </div>
                                <div class="d-flex align-center">
                                    <v-icon class="mr-1">mdi-phone</v-icon>
                                    <v-chip :color="webrtcConnected ? 'success' : 'warning'" size="small">
                                        {{ webrtcConnected ? 'WebRTC' : 'No WebRTC' }}
                                    </v-chip>
                                </div>
                                <div class="d-flex align-center">
                                    <span class="text-caption text-medium-emphasis mr-2">RMS</span>
                                    <v-progress-linear :model-value="rmsPct" color="secondary" height="6" rounded
                                        class="flex-grow-1 min-w-[160px]" />
                                    <span class="text-caption text-medium-emphasis ml-2">{{ rmsLevel.toFixed(2)
                                    }}</span>
                                </div>
                            </div>
                        </v-card>
                    </v-col>
                </v-row>

                <!-- Conversation -->
                <v-row>
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
                                        <v-list-item>
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
                                        <v-expansion-panels v-if="msg.role === 'assistant' && msg.thinking"
                                            variant="accordion" density="compact" class="mt-1">
                                            <v-expansion-panel>
                                                <v-expansion-panel-title>
                                                    <v-icon size="small" class="mr-2">mdi-lightbulb-on</v-icon>
                                                    <span class="text-caption">Thinking</span>
                                                </v-expansion-panel-title>
                                                <v-expansion-panel-text>
                                                    <div class="text-caption text-medium-emphasis wrap-anywhere">
                                                        {{ msg.thinking }}
                                                    </div>
                                                </v-expansion-panel-text>
                                            </v-expansion-panel>
                                        </v-expansion-panels>
                                        <v-divider class="my-1" />
                                    </template>
                                </v-list>
                            </div>
                        </v-card>
                    </v-col>
                </v-row>

                <!-- Actions -->
                <v-row class="mt-2">
                    <v-col cols="12">
                        <div class="d-flex gap-2">
                            <v-btn color="primary" variant="outlined" @click="testServerTTS" :loading="ttsGenerating">
                                <v-icon class="mr-1">mdi-volume-high</v-icon>
                                Test Server TTS
                            </v-btn>
                            <v-btn color="primary" variant="outlined" @click="testServerLLM" :loading="llmGenerating">
                                <v-icon class="mr-1">mdi-brain</v-icon>
                                Test Server LLM
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

<script setup lang="ts">
import { clientBrowserState } from "@vircadia/world-sdk/browser/vue";
import { computed, inject, onUnmounted, type PropType, type Ref, ref, watch } from "vue";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";

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

const props = defineProps({
    vircadiaWorld: { type: Object as () => VircadiaWorldInstance | null, required: true },
    webrtcRef: { type: Object as PropType<WebRTCRefApi | null>, default: null },
    webrtcLocalStream: { type: Object as () => MediaStream | null, default: null },
    webrtcPeers: { type: Object as () => Map<string, RTCPeerConnection>, default: () => new Map() },
    webrtcRemoteStreams: { type: Object as () => Map<string, MediaStream>, default: () => new Map() },
    agentEnableTts: { type: Boolean, required: true },
    agentEnableLlm: { type: Boolean, required: true },
    agentEnableStt: { type: Boolean, required: true },
    agentTtsLocalEcho: { type: Boolean, required: true },
    agentWakeWord: { type: String, required: true },
    agentEndWord: { type: String, required: true },
    agentNoReplyTimeoutSec: { type: Number, required: true },
    agentSttWindowSec: { type: Number, required: true },
    agentSttMaxBufferSec: { type: Number, required: true },
    agentLanguage: { type: String, required: true },
    agentSttPreGain: { type: Number, required: true },
    agentSttInputMode: { type: String as () => "webrtc" | "mic" | "both", required: true },
    agentSttTargetSampleRate: { type: Number, required: true },
    agentSttWorkletChunkMs: { type: Number, required: true },
    agentVadConfig: {
        type: Object as () => {
            sampleRate: number;
            minSpeechMs: number;
            minSilenceMs: number;
            prePadMs: number;
            postPadMs: number;
            speechThreshold: number;
            exitThreshold: number;
            maxPrevMs: number;
        },
        required: true,
    },
    agentLlmMaxNewTokens: { type: Number, required: true },
    agentLlmTemperature: { type: Number, required: true },
    agentLlmOpenThinkTag: { type: String, required: true },
    agentLlmCloseThinkTag: { type: String, required: true },
    agentUiMaxTranscripts: { type: Number, required: true },
    agentUiMaxAssistantReplies: { type: Number, required: true },
    agentUiMaxConversationItems: { type: Number, required: true },
});

const featureEnabled = computed(() => clientBrowserState.isAutonomousAgent());

// Teleport
const teleportTarget = inject<Ref<HTMLElement | null>>("mainAppBarTeleportTarget", ref(null));
const overlayOpen = ref<boolean>(false);
const toggleOverlay = () => { overlayOpen.value = !overlayOpen.value; };

// WebRTC
const webrtc = computed(() => props.webrtcRef as WebRTCRefApi | null);
const localStreamRef = computed<MediaStream | null>(() => props.webrtcLocalStream as MediaStream | null);
const remoteStreamsRef = computed<Map<string, MediaStream>>(() => props.webrtcRemoteStreams as Map<string, MediaStream>);
const webrtcConnected = computed(() => {
    const api = webrtc.value;
    try {
        return !!api && typeof api.getPeersMap === "function" && api.getPeersMap().size > 0;
    } catch { return false; }
});

// STT/VAD
const vadWorkerRef = ref<Worker | null>(null);
const sttProcessing = ref<boolean>(false);
const sttUploading = ref<boolean>(false);
const sttReady = ref<boolean>(false);
const vadSampleRate = ref<number>(16000);
const sttActive = ref<boolean>(true);

// Audio graph per peer
type PeerAudioProcessor = {
    ctx: AudioContext;
    source: MediaStreamAudioSourceNode;
    node: AudioWorkletNode;
    sink: GainNode;
};
const peerProcessors = new Map<string, PeerAudioProcessor>();

// RMS meter
const rmsLevel = ref<number>(0);
const rmsPct = computed<number>(() => Math.round(Math.min(1, rmsLevel.value) * 100));

// Conversation state
type TranscriptEntry = { peerId: string; text: string; at: number };
const transcripts = ref<TranscriptEntry[]>([]);
const transcriptsLimited = computed<TranscriptEntry[]>(() => {
    const limit = Number((props as unknown as { agentUiMaxTranscripts?: number }).agentUiMaxTranscripts || 0);
    const src = transcripts.value;
    return limit > 0 ? src.slice(-limit) : src;
});
function addTranscript(peerId: string, text: string): void {
    const t = (text || "").trim();
    if (!t) return;
    transcripts.value.push({ peerId, text: t, at: Date.now() });
    const limit = Number((props as unknown as { agentUiMaxTranscripts?: number }).agentUiMaxTranscripts || 0);
    if (limit > 0 && transcripts.value.length > limit) transcripts.value.splice(0, transcripts.value.length - limit);
}

type LlmEntry = { text: string; thinking?: string; at: number };
const llmOutputs = ref<LlmEntry[]>([]);
function addLlmOutput(text: string, thinking?: string): void {
    const t = (text || "").trim();
    if (!t) return;
    llmOutputs.value.push({ text: t, thinking: thinking?.trim() || undefined, at: Date.now() });
    const limit = Number((props as unknown as { agentUiMaxAssistantReplies?: number }).agentUiMaxAssistantReplies || 0);
    if (limit > 0 && llmOutputs.value.length > limit) llmOutputs.value.splice(0, llmOutputs.value.length - limit);
}

type ConversationItem = { role: "user" | "assistant"; text: string; thinking?: string; at: number; key: string };
const conversationItems = computed<ConversationItem[]>(() => {
    const items: ConversationItem[] = [];
    for (const t of transcriptsLimited.value) items.push({ role: "user", text: t.text, at: t.at, key: `u:${t.at}:${t.peerId}` });
    for (const l of llmOutputs.value) items.push({ role: "assistant", text: l.text, thinking: l.thinking, at: l.at, key: `a:${l.at}` });
    items.sort((a, b) => a.at - b.at);
    const limit = Number((props as unknown as { agentUiMaxConversationItems?: number }).agentUiMaxConversationItems || 0);
    return limit > 0 ? items.slice(-limit) : items;
});
const conversationItemsReversed = computed<ConversationItem[]>(() => [...conversationItems.value].reverse());

// LLM/TTS state
const llmGenerating = ref<boolean>(false);
const ttsGenerating = ref<boolean>(false);

// TTS output stream for avatar talking detection
const ttsOutputStream = ref<MediaStream | null>(null);
const ttsDestinationNode = ref<MediaStreamAudioDestinationNode | null>(null);
const ttsAudioContext = ref<AudioContext | null>(null);

// Worklet loader
const sttWorkletLoaded = new WeakSet<AudioContext>();
async function ensureSttWorklet(ctx: AudioContext): Promise<void> {
    if (sttWorkletLoaded.has(ctx)) return;
    await ctx.audioWorklet.addModule(new URL("./VircadiaAutonomousAgentSTTWorklet.ts", import.meta.url));
    sttWorkletLoaded.add(ctx);
}

// Attach stream → VAD → upload
async function attachStream(peerId: string, stream: MediaStream): Promise<void> {
    if (peerProcessors.has(peerId)) return;
    try {
        const ctx = new AudioContext({ sampleRate: 48000 });
        await ensureSttWorklet(ctx);
        const source = ctx.createMediaStreamSource(stream);
        const preGain = ctx.createGain();
        preGain.gain.value = Math.max(0.01, Number(props.agentSttPreGain || 1.0));
        const node = new AudioWorkletNode(ctx, "stt-processor", {
            processorOptions: {
                targetSampleRate: Math.max(8000, Math.min(48000, Number(props.agentSttTargetSampleRate || 16000))),
                chunkMs: Math.max(50, Math.min(2000, Number(props.agentSttWorkletChunkMs || 200))),
            },
        });

        try { await ctx.resume(); } catch { }

        node.port.onmessage = (ev: MessageEvent) => {
            const data = ev.data as { type: string; pcm?: ArrayBuffer; rms?: number };
            if (!data) return;
            if (data.type === "pcm" && data.pcm) {
                if (!sttActive.value) return;
                // Forward to VAD worker
                try { vadWorkerRef.value?.postMessage({ type: "audio", peerId, pcm: data.pcm, rms: data.rms }, [data.pcm]); } catch { }
                if (typeof data.rms === "number" && Number.isFinite(data.rms)) rmsLevel.value = Math.max(0, Math.min(1, data.rms));
            }
        };

        const sink = ctx.createGain();
        sink.gain.value = 0.0;
        source.connect(preGain);
        preGain.connect(node);
        node.connect(sink);
        sink.connect(ctx.destination);

        peerProcessors.set(peerId, { ctx, source, node, sink });
        // Start VAD for this peer
        vadWorkerRef.value?.postMessage({ type: "start", peerId, language: String(props.agentLanguage || "en") });
    } catch (e) {
        console.warn("[CloudAgent] Failed to attach stream:", e);
    }
}

function detachStream(peerId: string): void {
    const proc = peerProcessors.get(peerId);
    if (!proc) return;
    try {
        proc.node.disconnect();
        proc.sink.disconnect();
        proc.source.disconnect();
        void proc.ctx.close();
    } catch { }
    peerProcessors.delete(peerId);
    try { vadWorkerRef.value?.postMessage({ type: "stop", peerId }); } catch { }
}

// VAD worker
function initVadWorkerOnce(): void {
    if (vadWorkerRef.value) return;
    try {
        const worker = new Worker(new URL("./VircadiaAutonomousAgentVADWorker.ts", import.meta.url), { type: "module" });
        worker.addEventListener("message", (e: MessageEvent) => {
            const msg = e.data as { type: string; status?: string; peerId?: string; pcm?: ArrayBuffer };
            if (msg.type === "segment" && msg.pcm && msg.peerId) {
                // Upload to server STT
                void uploadVadSegment(msg.peerId, msg.pcm).catch(() => { });
            }
            if (msg.type === "status" && msg.status) {
                if (msg.status === "recording_start") sttReady.value = true;
            }
        });
        const vadCfg = props.agentVadConfig || { sampleRate: 16000 };
        const mergedCfg = {
            ...vadCfg,
            sampleRate: Math.max(8000, Math.min(48000, Number(props.agentSttTargetSampleRate || vadCfg.sampleRate || 16000))),
        };
        worker.postMessage({ type: "load", config: mergedCfg });
        vadSampleRate.value = mergedCfg.sampleRate;
        vadWorkerRef.value = worker;
        sttReady.value = true;
    } catch (e) {
        console.error("[CloudAgent] Failed to init VAD worker:", e);
        vadWorkerRef.value = null;
        sttReady.value = false;
    }
}

// WAV encoding and upload
function clampToInt16(sample: number): number { const s = Math.max(-1, Math.min(1, sample)); return s < 0 ? s * 0x8000 : s * 0x7fff; }
function writeString(view: DataView, offset: number, str: string): void { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); }
function encodeWavFromFloat32(pcm: Float32Array, sampleRate: number): ArrayBuffer {
    const numChannels = 1; const bitsPerSample = 16; const blockAlign = (numChannels * bitsPerSample) >> 3; const byteRate = sampleRate * blockAlign; const dataSize = pcm.length * 2; const buffer = new ArrayBuffer(44 + dataSize); const view = new DataView(buffer);
    writeString(view, 0, "RIFF"); view.setUint32(4, 36 + dataSize, true); writeString(view, 8, "WAVE"); writeString(view, 12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true); view.setUint32(28, byteRate, true); view.setUint16(32, blockAlign, true); view.setUint16(34, bitsPerSample, true); writeString(view, 36, "data"); view.setUint32(40, dataSize, true);
    let offset = 44; for (const x of pcm) { view.setInt16(offset, clampToInt16(x), true); offset += 2; } return buffer;
}
function encodeWavFromInt16(pcm: Int16Array, sampleRate: number): ArrayBuffer {
    const numChannels = 1; const bitsPerSample = 16; const blockAlign = (numChannels * bitsPerSample) >> 3; const byteRate = sampleRate * blockAlign; const dataSize = pcm.length * 2; const buffer = new ArrayBuffer(44 + dataSize); const view = new DataView(buffer);
    writeString(view, 0, "RIFF"); view.setUint32(4, 36 + dataSize, true); writeString(view, 8, "WAVE"); writeString(view, 12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, byteRate, true); view.setUint16(32, blockAlign, true); view.setUint16(34, bitsPerSample, true); writeString(view, 36, "data"); view.setUint32(40, dataSize, true);
    let offset = 44; for (const x of pcm) { view.setInt16(offset, x, true); offset += 2; } return buffer;
}
function detectAndEncodeWav(pcmBuffer: ArrayBuffer, sampleRate: number): ArrayBuffer {
    if (pcmBuffer.byteLength % 4 === 0) {
        const f32 = new Float32Array(pcmBuffer); let ok = true; const n = Math.min(8, f32.length);
        for (let i = 0; i < n; i++) { const v = f32[i]; if (!Number.isFinite(v) || Math.abs(v) > 1.0001) { ok = false; break; } }
        if (ok) return encodeWavFromFloat32(f32, sampleRate);
    }
    return encodeWavFromInt16(new Int16Array(pcmBuffer), sampleRate);
}

async function uploadVadSegment(peerId: string, pcm: ArrayBuffer): Promise<void> {
    try {
        sttUploading.value = true; sttProcessing.value = true;
        const sr = Math.max(8000, Math.min(48000, Number(vadSampleRate.value || 16000)));
        const wavAb = detectAndEncodeWav(pcm, sr);
        const blob = new Blob([wavAb], { type: "audio/wav" });
        const file = new File([blob], `segment_${Date.now()}.wav`, { type: "audio/wav" });
        const client = props.vircadiaWorld?.client;
        if (!client) return;
        const resp = await client.restInference.stt({ audio: file, language: String(props.agentLanguage || "en"), responseFormat: "json" });
        if (resp?.success && resp.text) {
            addTranscript(peerId, resp.text);
            await submitToLlm(peerId, resp.text);
        }
    } catch (e) {
        console.warn("[CloudAgent] STT upload failed:", e);
    } finally { sttUploading.value = false; sttProcessing.value = false; }
}

// LLM
function buildPromptHistory(maxItems: number, maxCharsPerItem: number, totalCharLimit: number): string {
    try {
        const src = conversationItems.value.slice(-maxItems);
        let out = ""; let total = 0;
        for (const item of src) {
            const role = item.role === "user" ? "User" : "Assistant";
            let text = String(item.text || "").trim().replace(/\s+/g, " ");
            if (maxCharsPerItem > 0 && text.length > maxCharsPerItem) text = text.slice(0, maxCharsPerItem);
            const line = `${role}: ${text}`;
            const toAdd = out ? `\n${line}` : line;
            if (totalCharLimit > 0 && total + toAdd.length > totalCharLimit) break;
            out += toAdd; total += toAdd.length;
        }
        return out;
    } catch { return ""; }
}
function extractAssistantText(raw: string): string { const t = String(raw || ""); const cleaned = t.replace(/^[\s\S]*?Assistant:\s*/i, "").trim(); return cleaned || t.trim(); }
function parseThinkingTags(text: string): { cleanText: string; thinking: string } {
    const openTag = String(props.agentLlmOpenThinkTag || "");
    const closeTag = String(props.agentLlmCloseThinkTag || "");
    if (!openTag || !closeTag) return { cleanText: text, thinking: "" };
    const regex = new RegExp(`${escapeRegex(openTag)}([\\s\\S]*?)${escapeRegex(closeTag)}`, "g");
    let cleanText = text;
    let thinking = "";
    const matches = [...text.matchAll(regex)];
    for (const match of matches) {
        cleanText = cleanText.replace(match[0], "");
        thinking += (thinking ? "\n\n" : "") + match[1];
    }
    return { cleanText: cleanText.trim(), thinking: thinking.trim() };
}
function escapeRegex(str: string): string { return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
const llmNoReplyTimers = new Map<string, number | null>();
function clearNoReplyTimer(peerId: string): void { const id = llmNoReplyTimers.get(peerId); if (id) { try { clearTimeout(id as unknown as number); } catch { } } llmNoReplyTimers.set(peerId, null); }
function scheduleNoReplyTimer(peerId: string, buffered: string): void { clearNoReplyTimer(peerId); const ms = Math.max(500, Number(props.agentNoReplyTimeoutSec) * 1000); const id = setTimeout(async () => { llmNoReplyTimers.set(peerId, null); if (buffered.trim()) await submitToLlm(peerId, buffered, { incomplete: true }); }, ms) as unknown as number; llmNoReplyTimers.set(peerId, id); }

async function submitToLlm(peerId: string, text: string, _opts?: { incomplete?: boolean }): Promise<void> {
    if (!props.agentEnableLlm) return;
    const t = (text || "").trim(); if (!t) return;
    try {
        const client = props.vircadiaWorld?.client; if (!client) return;
        const history = buildPromptHistory(12, 200, 1800);
        const gating = (() => {
            const wake = String(props.agentWakeWord || "").trim(); const end = String(props.agentEndWord || "").trim();
            if (wake && end) return `Guidance: Wake word may be present ('${wake}'); if the request seems partial or lacks a clear end, output exactly <no-reply/>.`;
            if (wake && !end) return `Guidance: A wake word may start the request ('${wake}'); rely on natural boundaries. If the request seems partial, output exactly <no-reply/>.`;
            return `Guidance: If input seems partial, output exactly <no-reply/>. If sufficient follow up has been provided after you replied <no-reply/> then reply with a response.`;
        })();
        const systemPrefix = "System: You are an in-world assistant. Be concise and conversational.";
        // Build a single conversation block that already includes the latest user message via transcripts/history.
        // Do not append an extra User line here to avoid duplication.
        const prompt = `${systemPrefix}\n${gating}\n${history ? `Conversation:\n${history}\n` : ""}\nAssistant:`;
        llmGenerating.value = true;
        const resp = await client.restInference.llm({
            prompt,
            temperature: Number(props.agentLlmTemperature),
            maxTokens: Number(props.agentLlmMaxNewTokens),
        });
        llmGenerating.value = false;
        if (resp?.success && resp.text) {
            const cleaned = extractAssistantText(resp.text).trim();
            const { cleanText, thinking } = parseThinkingTags(cleaned);
            if (cleanText.includes("<no-reply/>")) { scheduleNoReplyTimer(peerId, t); return; }
            if (cleanText) { addLlmOutput(cleanText, thinking); ttsQueue.push(cleanText); void flushTtsQueue(); }
        }
    } catch (e) {
        llmGenerating.value = false;
        console.warn("[CloudAgent] LLM error:", e);
    }
}

// TTS
const ttsQueue: string[] = [];
const isSpeaking = ref<boolean>(false);
async function flushTtsQueue(): Promise<void> { if (isSpeaking.value || ttsQueue.length === 0) return; const next = ttsQueue.shift(); if (!next) return; isSpeaking.value = true; try { await speakServerTts(next); } finally { isSpeaking.value = false; if (ttsQueue.length > 0) void flushTtsQueue(); } }

// Initialize TTS output stream for avatar talking detection
async function initTtsOutputStream(): Promise<void> {
    if (ttsDestinationNode.value) return;
    try {
        const ctx = new AudioContext();
        await ctx.resume();
        const dest = ctx.createMediaStreamDestination();
        ttsAudioContext.value = ctx;
        ttsDestinationNode.value = dest;
        ttsOutputStream.value = dest.stream;
    } catch (e) {
        console.warn("[CloudAgent] Failed to init TTS output stream:", e);
    }
}

async function speakServerTts(text: string, forceLocalEcho = false): Promise<void> {
    try {
        const api = webrtc.value;
        const allowLocalEcho = forceLocalEcho || props.agentTtsLocalEcho;
        const hasPeers = !!api && typeof api.getPeersMap === "function" && api.getPeersMap().size > 0;
        const useBus = !!api && hasPeers;
        if (!allowLocalEcho && !useBus) return;

        // Ensure TTS output stream is initialized
        await initTtsOutputStream();

        if (useBus && api) { try { await api.ensureUplinkDestination(); } catch { } }
        const busCtx = useBus && api ? api.getUplinkAudioContext() || null : null;
        const ctx = busCtx || ttsAudioContext.value || new AudioContext();
        try { await ctx.resume(); } catch { }

        // Request TTS audio from server
        const client = props.vircadiaWorld?.client; if (!client) return;
        ttsGenerating.value = true;
        const audioBlob = await client.restInference.tts({ text, responseFormat: "wav" });
        ttsGenerating.value = false;
        const arrayBuf = await audioBlob.arrayBuffer();

        // Decode audio buffers for both contexts in parallel
        const ttsCtx = ttsAudioContext.value;
        const [ttsBuffer, audioBuffer] = await Promise.all([
            ttsCtx && ttsDestinationNode.value ? ttsCtx.decodeAudioData(arrayBuf.slice(0)).catch(() => null) : Promise.resolve(null),
            ctx.decodeAudioData(arrayBuf.slice(0)),
        ]);

        // Start both audio paths simultaneously
        const promises: Promise<void>[] = [];

        // Avatar detection audio path
        if (ttsBuffer && ttsCtx && ttsDestinationNode.value) {
            try {
                const ttsSource = ttsCtx.createBufferSource();
                ttsSource.buffer = ttsBuffer;
                const ttsGain = ttsCtx.createGain();
                ttsGain.gain.value = 1.25;
                ttsSource.connect(ttsGain);
                ttsGain.connect(ttsDestinationNode.value);
                promises.push(new Promise<void>((resolve) => { ttsSource.addEventListener("ended", () => resolve()); ttsSource.start(); }));
            } catch (e) {
                console.warn("[CloudAgent] Failed to play TTS for avatar detection:", e);
            }
        }

        // WebRTC/playback audio path
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        const gain = ctx.createGain();
        gain.gain.value = 1.25;
        source.connect(gain);

        if (useBus && api) { api.connectNodeToUplink(gain); await api.replaceUplinkWithDestination(); }
        if (allowLocalEcho) { try { gain.connect(ctx.destination); } catch { } }
        promises.push(new Promise<void>((resolve) => { source.addEventListener("ended", () => resolve()); try { const t = ctx.currentTime; gain.gain.setValueAtTime(0.0001, t); gain.gain.exponentialRampToValueAtTime(1.25, t + 0.02); } catch { } source.start(); }));

        // Wait for both audio paths to complete
        await Promise.all(promises);
    } catch (e) {
        ttsGenerating.value = false;
        console.warn("[CloudAgent] TTS error:", e);
    }
}

async function testServerTTS(): Promise<void> { await speakServerTts("Hello! This is a test of the cloud agent TTS system.", true); }

async function testServerLLM(): Promise<void> {
    try {
        const client = props.vircadiaWorld?.client;
        if (!client) return;
        llmGenerating.value = true;
        const resp = await client.restInference.llm({
            prompt: "System: You are a helpful assistant.\n\nUser: Say hello and introduce yourself.\n\nAssistant:",
            temperature: Number(props.agentLlmTemperature),
            maxTokens: Number(props.agentLlmMaxNewTokens),
        });
        llmGenerating.value = false;
        if (resp?.success && resp.text) {
            console.log("[CloudAgent] Test LLM response:", resp.text);
            const cleaned = extractAssistantText(resp.text).trim();
            const { cleanText } = parseThinkingTags(cleaned);
            if (cleanText) {
                await speakServerTts(cleanText, true);
            }
        }
    } catch (e) {
        llmGenerating.value = false;
        console.warn("[CloudAgent] Test LLM error:", e);
    }
}

// Attachments
async function attachMic(): Promise<void> {
    if (!props.agentEnableStt) return;
    const local = localStreamRef.value; let stream: MediaStream | null = local || null;
    if (!stream) {
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }); } catch (e) { console.warn("[CloudAgent] getUserMedia failed:", e); return; }
    }
    await attachStream("mic", stream);
}

// Watchers
watch(() => props.vircadiaWorld?.connectionInfo.value.status, async (status) => {
    if (!featureEnabled.value) return;
    if (status === "connected") {
        if (props.agentEnableTts) {
            await initTtsOutputStream();
        }
        if (props.agentEnableStt) {
            initVadWorkerOnce();
            const mode = props.agentSttInputMode;
            if (mode === "webrtc" || mode === "both") {
                for (const [pid, stream] of remoteStreamsRef.value) attachStream(pid, stream);
            }
            if (mode === "mic" || mode === "both") await attachMic();
        }
    } else {
        for (const [pid] of peerProcessors) detachStream(pid);
    }
}, { immediate: true });

watch(() => remoteStreamsRef.value, (streams, oldStreams) => {
    if (!featureEnabled.value) return;
    if (!props.agentEnableStt) return;
    initVadWorkerOnce();
    const mode = props.agentSttInputMode;
    if (mode === "webrtc" || mode === "both") {
        for (const [pid, stream] of streams) attachStream(pid, stream);
    }
    if (oldStreams instanceof Map) {
        for (const [oldPid] of oldStreams) { if (!streams.has(oldPid)) detachStream(oldPid); }
    }
}, { deep: true });

watch(() => props.agentSttInputMode, async (mode) => {
    if (!featureEnabled.value) return;
    if (!props.agentEnableStt) return;
    initVadWorkerOnce();
    if (mode === "webrtc") { for (const [pid] of peerProcessors) { if (pid !== "mic") detachStream(pid); } for (const [pid, stream] of remoteStreamsRef.value) attachStream(pid, stream); }
    else if (mode === "mic") { for (const [pid] of peerProcessors) detachStream(pid); await attachMic(); }
    else if (mode === "both") { for (const [pid, stream] of remoteStreamsRef.value) attachStream(pid, stream); await attachMic(); }
}, { immediate: false });

onUnmounted(() => {
    for (const [pid] of peerProcessors) detachStream(pid);
    try { const w = vadWorkerRef.value; if (w) w.terminate(); } catch { }
    try { const ctx = ttsAudioContext.value; if (ctx) ctx.close(); } catch { }
});

// Expose TTS output stream for parent refs
defineExpose({ ttsOutputStream });
</script>

<style>
.wrap-anywhere {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
}
</style>
