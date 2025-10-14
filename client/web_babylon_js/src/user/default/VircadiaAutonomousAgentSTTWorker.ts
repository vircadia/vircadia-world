/*
  Segment-based STT worker: Whisper ASR (WebGPU) via transformers.js pipeline
  - Expects finalized speech segments from VAD worker
  - Emits one completion per segment (status: complete)
  - Protocol: status: ready|processing|complete and messages: load/start/audio/stop
*/

import { pipeline } from "@huggingface/transformers";

type LoadMessage = { type: "load"; modelId?: string };
type StartMessage = {
    type: "start";
    peerId: string;
    language?: string;
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
    language?: string;
    isProcessing?: boolean;
};

// Config
const INPUT_SAMPLE_RATE = 16000;

const peers = new Map<string, PeerSttState>();
function getPeerState(peerId: string): PeerSttState {
    let s = peers.get(peerId);
    if (!s) {
        s = {};
        peers.set(peerId, s);
    }
    return s;
}

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

async function transcribeSegment(peerId: string, segment: Float32Array) {
    const s = getPeerState(peerId);
    try {
        await ensureLoaded();
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
            segment,
            {
                task: "transcribe",
                language: s.language || undefined,
            },
        );
        const text =
            out.text && out.text.length > 0 ? out.text : "[BLANK_AUDIO]";
        (
            self as unknown as { postMessage: (m: WorkerEvent) => void }
        ).postMessage({
            type: "status",
            status: "complete",
            peerId,
            data: { text },
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        (
            self as unknown as { postMessage: (m: WorkerEvent) => void }
        ).postMessage({ type: "error", peerId, error: msg });
    } finally {
        const st = getPeerState(peerId);
        st.isProcessing = false;
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
                data: { vadAvailable: true },
            });
            return;
        }
        if (msg.type === "start") {
            const s = getPeerState(msg.peerId);
            if (typeof msg.language === "string" && msg.language) {
                s.language = msg.language;
            }
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
            if (typeof msg.language === "string" && msg.language) {
                const s = getPeerState(msg.peerId);
                s.language = msg.language;
            }
            await transcribeSegment(msg.peerId, f32);
            return;
        }
        if (msg.type === "stop") {
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
