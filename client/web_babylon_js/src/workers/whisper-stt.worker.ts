/*
  Streaming Whisper STT worker (WebGPU, Transformers.js)
  - Loads ONNX Whisper once (tokenizer, processor, model)
  - Accepts small PCM16k Float32Array chunks per peerId
  - Buffers per peer and decodes sliding windows
  - Emits token updates (partial) and final outputs per window
*/

import {
    AutoProcessor,
    AutoTokenizer,
    full,
    TextStreamer,
    WhisperForConditionalGeneration,
} from "@huggingface/transformers";

type PeerSession = {
    buffer: Float32Array[];
    processing: boolean;
    language: string | undefined;
    maxBufferSec: number;
    windowSec: number;
};

type LoadMessage = { type: "load" };
type StartMessage = {
    type: "start";
    peerId: string;
    language?: string;
    windowSec?: number;
    maxBufferSec?: number;
};
type AudioMessage = { type: "audio"; peerId: string; pcm: ArrayBuffer };
type StopMessage = { type: "stop"; peerId: string };
type WorkerMessage = LoadMessage | StartMessage | AudioMessage | StopMessage;

type WorkerEvent =
    | {
          type: "status";
          status: "loading" | "ready" | "start" | "update" | "complete";
          peerId?: string;
          data?: unknown;
      }
    | { type: "error"; peerId?: string; error: string };

// Model singleton
class WhisperRuntime {
    static modelId = "onnx-community/whisper-base";
    static tokenizer: any | null = null;
    static processor: any | null = null;
    static model: any | null = null;

    static async ensureLoaded(progress?: (x: unknown) => void) {
        if (!WhisperRuntime.tokenizer) {
            WhisperRuntime.tokenizer = await AutoTokenizer.from_pretrained(
                WhisperRuntime.modelId,
                {
                    progress_callback: progress,
                },
            );
        }
        if (!WhisperRuntime.processor) {
            WhisperRuntime.processor = await AutoProcessor.from_pretrained(
                WhisperRuntime.modelId,
                {
                    progress_callback: progress,
                },
            );
        }
        if (!WhisperRuntime.model) {
            WhisperRuntime.model =
                await WhisperForConditionalGeneration.from_pretrained(
                    WhisperRuntime.modelId,
                    {
                        dtype: {
                            encoder_model: "fp32",
                            decoder_model_merged: "q4",
                        },
                        device: "webgpu",
                        progress_callback: progress,
                    },
                );
        }
        return [
            WhisperRuntime.tokenizer,
            WhisperRuntime.processor,
            WhisperRuntime.model,
        ] as const;
    }
}

const sessions = new Map<string, PeerSession>();

function mergeChunks(chunks: Float32Array[]): Float32Array {
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Float32Array(total);
    let o = 0;
    for (const c of chunks) {
        out.set(c, o);
        o += c.length;
    }
    return out;
}

function secondsToSamples(sec: number): number {
    return Math.floor(sec * 16000);
}

async function maybeDecode(peerId: string) {
    const session = sessions.get(peerId);
    if (!session) return;
    if (session.processing) return;

    const numSamples = session.buffer.reduce((a, b) => a + b.length, 0);
    if (numSamples < secondsToSamples(session.windowSec)) return;

    session.processing = true;

    try {
        // Keep last windowSec seconds for decoding; keep a small left overlap implicitly by retaining buffer
        let keepSamples = secondsToSamples(session.windowSec);
        const chunks: Float32Array[] = [];
        for (
            let i = session.buffer.length - 1;
            i >= 0 && keepSamples > 0;
            i--
        ) {
            const c = session.buffer[i];
            chunks.push(c);
            keepSamples -= c.length;
        }
        chunks.reverse();
        const audio = mergeChunks(chunks);

        const [tokenizer, processor, model] =
            await WhisperRuntime.ensureLoaded();

        // Token streaming callbacks
        let numTokens = 0;
        const streamer = new TextStreamer(tokenizer, {
            skip_prompt: true,
            skip_special_tokens: true,
            callback_function: (text: string) => {
                const evt: WorkerEvent = {
                    type: "status",
                    status: "update",
                    peerId,
                    data: { text },
                };
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (self as any).postMessage(evt);
            },
            token_callback_function: () => {
                numTokens++;
            },
        });

        // Preprocess to input features
        const inputs = await processor(audio);

        const outputs = await model.generate({
            ...inputs,
            max_new_tokens: 96,
            language: session.language,
            streamer,
        });

        const decoded: string[] = tokenizer.batch_decode(outputs, {
            skip_special_tokens: true,
        });

        const finalText = Array.isArray(decoded)
            ? decoded.join(" ")
            : String(decoded);

        // Emit completion for this window
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (self as any).postMessage({
            type: "status",
            status: "complete",
            peerId,
            data: { text: finalText },
        } satisfies WorkerEvent);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (self as any).postMessage({
            type: "error",
            peerId,
            error: msg,
        } as WorkerEvent);
    } finally {
        const session2 = sessions.get(peerId);
        if (session2) session2.processing = false;
    }
}

async function handleMessage(e: MessageEvent<WorkerMessage>) {
    const msg = e.data;
    try {
        if (msg.type === "load") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (self as any).postMessage({
                type: "status",
                status: "loading",
            } as WorkerEvent);
            const [, , model] = await WhisperRuntime.ensureLoaded((x) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (self as any).postMessage({
                    type: "status",
                    status: "loading",
                    data: x,
                } as WorkerEvent);
            });
            // Warm up shader compilation
            await model.generate({
                input_features: full([1, 80, 3000], 0.0),
                max_new_tokens: 1,
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (self as any).postMessage({
                type: "status",
                status: "ready",
            } as WorkerEvent);
            return;
        }
        if (msg.type === "start") {
            const {
                peerId,
                language,
                windowSec = 2.0,
                maxBufferSec = 8.0,
            } = msg;
            sessions.set(peerId, {
                buffer: [],
                processing: false,
                language,
                windowSec,
                maxBufferSec,
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (self as any).postMessage({
                type: "status",
                status: "start",
                peerId,
            } as WorkerEvent);
            return;
        }
        if (msg.type === "audio") {
            const { peerId, pcm } = msg;
            const session = sessions.get(peerId);
            if (!session) return;
            const f32 = new Float32Array(pcm);
            if (f32.length === 0) return;
            session.buffer.push(f32);
            // Trim buffer to maxBufferSec
            let total = session.buffer.reduce((a, b) => a + b.length, 0);
            const limit = secondsToSamples(session.maxBufferSec);
            if (total > limit) {
                for (
                    let i = 0;
                    i < session.buffer.length && total > limit;
                    i++
                ) {
                    total -= session.buffer[i].length;
                    session.buffer[i] = new Float32Array(0);
                }
                // Drop emptied leading chunks
                const compacted: Float32Array[] = [];
                for (const c of session.buffer)
                    if (c.length > 0) compacted.push(c);
                session.buffer = compacted;
            }
            void maybeDecode(peerId);
            return;
        }
        if (msg.type === "stop") {
            sessions.delete(msg.peerId);
            return;
        }
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (self as any).postMessage({ type: "error", error } as WorkerEvent);
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).addEventListener("message", handleMessage);
