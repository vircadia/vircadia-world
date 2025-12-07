/*
  TTS Worker: runs Kokoro TTS off main thread and returns PCM Float32Array
*/

type LoadMessage = {
    type: "load";
    modelId?: string;
    device?: string;
    dtype?: string;
};
type SpeakMessage = { type: "speak"; text: string };
type WorkerMessage = LoadMessage | SpeakMessage;

type WorkerEvent =
    | ({
          type: "status";
          status: "downloading" | "mounting" | "ready" | "generating";
      } & {
          data?: unknown;
      })
    | { type: "audio"; sampleRate: number; pcm: ArrayBufferLike }
    | { type: "error"; error: string };

let kokoro: unknown | null = null;
let modelIdRef: string = "onnx-community/Kokoro-82M-v1.0-ONNX";
let deviceRef: string = "webgpu";
let dtypeRef: string = "fp32";

function post(event: WorkerEvent) {
    const transfer: Transferable[] | undefined =
        event.type === "audio"
            ? [
                  // Narrow cast: WorkerEvent when type==='audio' has pcm: ArrayBufferLike
                  (event as Extract<WorkerEvent, { type: "audio" }>)
                      .pcm as unknown as ArrayBuffer,
              ]
            : undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (
        self as unknown as {
            postMessage: (e: WorkerEvent, t?: Transferable[]) => void;
        }
    ).postMessage(event, transfer);
}

async function ensureLoaded() {
    if (kokoro) return;
    post({ type: "status", status: "downloading" });
    const { KokoroTTS } = await import("kokoro-js");
    kokoro = await KokoroTTS.from_pretrained(
        modelIdRef || "onnx-community/Kokoro-82M-v1.0-ONNX",
        {
            device: deviceRef || "webgpu",
            dtype: dtypeRef || "fp32",
        },
    );
    // Mount/compile kernels by running a tiny warmup
    post({ type: "status", status: "mounting" });
    try {
        const k = kokoro as {
            tts?: (t: string) => Promise<unknown>;
            generate?: (t: string) => Promise<unknown>;
        };
        if (typeof k?.tts === "function") {
            await k.tts(".");
        } else if (typeof k?.generate === "function") {
            await k.generate(".");
        }
    } catch {
        /* ignore */
    }
    post({ type: "status", status: "ready" });
}

function toFloat32Array(
    input: unknown,
): { data: Float32Array; sampleRate: number } | null {
    if (!input) return null;
    const anyIn = input as
        | {
              audio?: unknown;
              sample_rate?: number;
              sampleRate?: number;
              samplerate?: number;
              getChannelData?: (i: number) => Float32Array;
          }
        | { audio?: { data?: unknown } }
        | unknown;
    // Guard against referencing AudioBuffer in Worker context where it's undefined
    const AudioBufferCtor = (
        self as unknown as { AudioBuffer?: new (...args: unknown[]) => unknown }
    ).AudioBuffer;
    if (
        AudioBufferCtor &&
        anyIn instanceof
            (AudioBufferCtor as unknown as {
                new (...args: unknown[]): unknown;
            })
    ) {
        const sr = (anyIn as { sampleRate?: number }).sampleRate || 24000;
        const data = (
            anyIn as { getChannelData: (i: number) => Float32Array }
        ).getChannelData(0);
        return { data: new Float32Array(data), sampleRate: sr };
    }
    const container = anyIn.audio ? anyIn : anyIn.audio ? anyIn : null;
    const payload = container ? container.audio : anyIn.audio;
    const dataRaw = payload?.data ? payload.data : payload;
    const sr =
        anyIn.sample_rate || anyIn.sampleRate || anyIn.samplerate || 24000;
    if (!dataRaw) return null;
    if (dataRaw instanceof Float32Array)
        return { data: dataRaw, sampleRate: sr };
    if (dataRaw instanceof Int16Array) {
        const out = new Float32Array(dataRaw.length);
        for (let i = 0; i < dataRaw.length; i++) out[i] = dataRaw[i] / 32768;
        return { data: out, sampleRate: sr };
    }
    if (Array.isArray(dataRaw)) {
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

async function speak(text: string) {
    await ensureLoaded();
    post({ type: "status", status: "generating" });
    try {
        const k = kokoro as {
            tts?: (t: string) => Promise<unknown>;
            generate?: (t: string) => Promise<unknown>;
        };
        const result =
            (await (k.tts ? k.tts(text) : k.generate?.(text))) || null;
        const converted =
            toFloat32Array(result) ||
            toFloat32Array({
                audio: result?.audio,
                sample_rate: result?.sample_rate,
            });
        if (!converted) throw new Error("TTS produced no audio data");
        post({
            type: "audio",
            sampleRate: converted.sampleRate,
            pcm: converted.data.buffer,
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        post({ type: "error", error: msg });
    }
}

async function handleMessage(e: MessageEvent<WorkerMessage>) {
    const msg = e.data;
    if (msg.type === "load") {
        if (typeof msg.modelId === "string" && msg.modelId)
            modelIdRef = msg.modelId;
        if (typeof msg.device === "string" && msg.device)
            deviceRef = msg.device;
        if (typeof msg.dtype === "string" && msg.dtype) dtypeRef = msg.dtype;
        await ensureLoaded();
        return;
    }
    if (msg.type === "speak") {
        await speak(msg.text);
        return;
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
self.addEventListener("message", handleMessage);
