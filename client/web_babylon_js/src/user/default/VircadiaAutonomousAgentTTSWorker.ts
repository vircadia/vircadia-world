/*
  TTS Worker: runs Kokoro TTS off main thread and returns PCM Float32Array
*/

type LoadMessage = { type: "load" };
type SpeakMessage = { type: "speak"; text: string };
type WorkerMessage = LoadMessage | SpeakMessage;

type WorkerEvent =
    | ({ type: "status"; status: "loading" | "ready" | "generating" } & {
          data?: unknown;
      })
    | { type: "audio"; sampleRate: number; pcm: ArrayBufferLike }
    | { type: "error"; error: string };

let kokoro: unknown | null = null;

function post(event: WorkerEvent) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (self as any).postMessage(
        event,
        event.type === "audio" ? [(event as any).pcm] : undefined,
    );
}

async function ensureLoaded() {
    if (kokoro) return;
    post({ type: "status", status: "loading" });
    const { KokoroTTS } = await import("kokoro-js");
    kokoro = await KokoroTTS.from_pretrained(
        "onnx-community/Kokoro-82M-v1.0-ONNX",
        {
            device: "webgpu",
            dtype: "fp32",
            // progress callback not exposed by kokoro-js; keeping placeholder
        },
    );
    post({ type: "status", status: "ready" });
}

function toFloat32Array(
    input: unknown,
): { data: Float32Array; sampleRate: number } | null {
    if (!input) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyIn: any = input;
    // Guard against referencing AudioBuffer in Worker context where it's undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AudioBufferCtor: any = (self as any).AudioBuffer;
    if (AudioBufferCtor && anyIn instanceof AudioBufferCtor) {
        const sr = anyIn.sampleRate || 24000;
        const data = anyIn.getChannelData(0);
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const k: any = kokoro;
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
        await ensureLoaded();
        return;
    }
    if (msg.type === "speak") {
        await speak(msg.text);
        return;
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).addEventListener("message", handleMessage);
