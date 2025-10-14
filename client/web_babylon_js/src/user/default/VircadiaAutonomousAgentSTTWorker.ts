/*
  Rolling STT worker (no VAD): Whisper ASR (WebGPU) via transformers.js pipeline
  - Emits rolling transcript updates (status: update) for keyword gating upstream
  - Preserves protocol (status: ready|start|update|complete; start/audio/stop)
*/

import { pipeline } from "@huggingface/transformers";

type LoadMessage = { type: "load"; modelId?: string };
type StartMessage = {
    type: "start";
    peerId: string;
    language?: string;
    // Rolling window parameters (seconds)
    windowSec?: number;
    maxBufferSec?: number;
};
type AudioMessage = {
    type: "audio";
    peerId: string;
    pcm: ArrayBuffer;
    language?: string;
};
type StopMessage = { type: "stop"; peerId: string };
type WorkerMessage = LoadMessage | StartMessage | AudioMessage | StopMessage;

type WorkerEvent =
    | {
          type: "status";
          status:
              | "ready"
              | "start"
              | "update"
              | "complete"
              | "downloading"
              | "loading"
              | "mounting"
              | "processing";
          peerId?: string;
          data?: unknown;
      }
    | { type: "error"; peerId?: string; error: string };

type PeerSttState = {
    buffered: Float32Array[];
    bufferedSamples: number;
    windowSamples: number;
    maxBufferSamples: number;
    lastText: string;
    language?: string;
    isProcessing?: boolean;
};

// Config
const INPUT_SAMPLE_RATE = 16000;

const peers = new Map<string, PeerSttState>();
function getPeerState(peerId: string): PeerSttState {
    let s = peers.get(peerId);
    if (!s) {
        s = {
            buffered: [],
            bufferedSamples: 0,
            windowSamples: Math.floor(1.0 * INPUT_SAMPLE_RATE),
            maxBufferSamples: Math.floor(8.0 * INPUT_SAMPLE_RATE),
            lastText: "",
        };
        peers.set(peerId, s);
    }
    return s;
}
// Reserve for future explicit resets via control messages
// Removed VAD-based segmentation; explicit reset no longer used

// concatBuffers removed; rolling window reads from trailing buffers

let transcriber:
    | null
    | ((
          input: Float32Array,
          options?: Record<string, unknown>,
      ) => Promise<{ text: string }>) = null;
let modelId = "onnx-community/whisper-base";

async function ensureLoaded(): Promise<void> {
    if (!transcriber) {
        // Emit coarse-grained loading statuses to mirror example UI behavior
        (
            self as unknown as { postMessage: (m: WorkerEvent) => void }
        ).postMessage({
            type: "status",
            status: "loading",
            data: { status: "Initializing Whisper pipeline" },
        });
        const pipe = await pipeline("automatic-speech-recognition", modelId, {
            device: "webgpu",
            dtype: { encoder_model: "fp32", decoder_model_merged: "fp32" },
        });
        // Trigger shader compilation/mount step
        (
            self as unknown as { postMessage: (m: WorkerEvent) => void }
        ).postMessage({
            type: "status",
            status: "mounting",
            data: { status: "Compiling GPU shaders" },
        });
        await pipe(new Float32Array(INPUT_SAMPLE_RATE));
        transcriber = async (
            input: Float32Array,
            options?: Record<string, unknown>,
        ) => {
            const result = await pipe(input, {
                // Keep caller-supplied options (language/task) last to allow override
                ...(options ?? {}),
            });
            const single = Array.isArray(result) ? result[0] : result;
            const text =
                (single && typeof single === "object"
                    ? (single as Record<string, unknown>).text
                    : undefined) ?? "";
            return { text: String(text).trim() };
        };
        (
            self as unknown as { postMessage: (m: WorkerEvent) => void }
        ).postMessage({
            type: "status",
            status: "ready",
        });
    }
}

function trimBufferToMax(s: PeerSttState): void {
    // Keep only the most recent samples within maxBufferSamples
    if (s.bufferedSamples <= s.maxBufferSamples) return;
    let need = s.bufferedSamples - s.maxBufferSamples;
    while (need > 0 && s.buffered.length > 0) {
        const first = s.buffered[0];
        if (first.length <= need) {
            s.buffered.shift();
            s.bufferedSamples -= first.length;
            need -= first.length;
        } else {
            // Slice the first buffer
            s.buffered[0] = first.subarray(need);
            s.bufferedSamples -= need;
            need = 0;
        }
    }
}

function getLastWindow(s: PeerSttState): Float32Array | null {
    if (s.bufferedSamples === 0) return null;
    const need = Math.min(s.windowSamples, s.bufferedSamples);
    const out = new Float32Array(need);
    let remaining = need;
    let o = need;
    for (let i = s.buffered.length - 1; i >= 0 && remaining > 0; i--) {
        const buf = s.buffered[i];
        const copyLen = Math.min(buf.length, remaining);
        o -= copyLen;
        out.set(buf.subarray(buf.length - copyLen), o);
        remaining -= copyLen;
    }
    return out;
}

async function handleChunk(peerId: string, chunk: Float32Array) {
    const s = getPeerState(peerId);
    // Append chunk and trim to max buffer
    s.buffered.push(chunk);
    s.bufferedSamples += chunk.length;
    trimBufferToMax(s);

    // If not enough for a window yet, skip
    if (s.bufferedSamples < s.windowSamples) return;

    try {
        await ensureLoaded();
        const windowBuf = getLastWindow(s);
        if (!windowBuf || windowBuf.length === 0) return;
        if (!s.isProcessing) {
            s.isProcessing = true;
            (
                self as unknown as { postMessage: (m: WorkerEvent) => void }
            ).postMessage({
                type: "status",
                status: "processing",
                peerId,
                data: { active: true },
            });
        }
        const out = await (transcriber as NonNullable<typeof transcriber>)(
            windowBuf,
            {
                // Encourage Whisper to transcribe in the specified language if provided
                task: "transcribe",
                language: s.language || undefined,
            },
        );
        let text = out.text;
        // Normalize empty result to a visible placeholder for GUI previews
        if (!text) text = "[BLANK_AUDIO]";
        // Emit updates even for blank audio, but avoid spamming identical repeats
        if (text === s.lastText) {
            s.isProcessing = false;
            (
                self as unknown as { postMessage: (m: WorkerEvent) => void }
            ).postMessage({
                type: "status",
                status: "processing",
                peerId,
                data: { active: false },
            });
            return;
        }
        s.lastText = text;
        (
            self as unknown as { postMessage: (m: WorkerEvent) => void }
        ).postMessage({
            type: "status",
            status: "update",
            peerId,
            data: { text },
        });
        s.isProcessing = false;
        (
            self as unknown as { postMessage: (m: WorkerEvent) => void }
        ).postMessage({
            type: "status",
            status: "processing",
            peerId,
            data: { active: false },
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        (
            self as unknown as { postMessage: (m: WorkerEvent) => void }
        ).postMessage({ type: "error", peerId, error: msg });
        // Clear processing on error
        s.isProcessing = false;
        (
            self as unknown as { postMessage: (m: WorkerEvent) => void }
        ).postMessage({
            type: "status",
            status: "processing",
            peerId,
            data: { active: false },
        });
    }
}

async function onMessage(e: MessageEvent<WorkerMessage>) {
    const msg = e.data;
    try {
        if (msg.type === "load") {
            if (typeof msg.modelId === "string" && msg.modelId)
                modelId = msg.modelId;
            await ensureLoaded();
            (
                self as unknown as { postMessage: (m: WorkerEvent) => void }
            ).postMessage({
                type: "status",
                status: "ready",
                data: { vadAvailable: false },
            });
            return;
        }
        if (msg.type === "start") {
            const s = getPeerState(msg.peerId);
            // Reset rolling state for this peer to avoid stale matches
            s.buffered = [];
            s.bufferedSamples = 0;
            s.lastText = "";
            if (typeof msg.language === "string" && msg.language) {
                s.language = msg.language;
            }
            const winSec = Math.max(
                0.5,
                Math.min(5.0, Number(msg.windowSec ?? 1.0)),
            );
            const maxSec = Math.max(
                winSec,
                Math.min(30.0, Number(msg.maxBufferSec ?? 8.0)),
            );
            s.windowSamples = Math.floor(winSec * INPUT_SAMPLE_RATE);
            s.maxBufferSamples = Math.floor(maxSec * INPUT_SAMPLE_RATE);
            (
                self as unknown as { postMessage: (m: WorkerEvent) => void }
            ).postMessage({
                type: "status",
                status: "start",
                peerId: msg.peerId,
            });
            return;
        }
        if (msg.type === "audio") {
            const f32 = new Float32Array(msg.pcm);
            if (f32.length === 0) return;
            // Update language if provided on audio messages
            if (typeof msg.language === "string" && msg.language) {
                const s = getPeerState(msg.peerId);
                s.language = msg.language;
            }
            await handleChunk(msg.peerId, f32);
            return;
        }
        if (msg.type === "stop") {
            // Fully clear peer state on stop
            peers.delete(msg.peerId);
            return;
        }
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        (
            self as unknown as { postMessage: (m: WorkerEvent) => void }
        ).postMessage({ type: "error", error });
    }
}

(
    self as unknown as { addEventListener: typeof addEventListener }
).addEventListener("message", onMessage as never);
