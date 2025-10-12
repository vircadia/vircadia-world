/*
  AudioWorkletProcessor for STT streaming
  - Input: mono 48 kHz
  - Downsamples to 16 kHz
  - Buffers into chunkMs windows and posts Float32Array buffers via port
*/

// The worklet runs in an isolated context; TypeScript types may not be available at runtime.

type STTProcessorOptions = {
    targetSampleRate?: number;
    chunkMs?: number;
};

function downsample(
    from: Float32Array,
    fromRate: number,
    toRate: number,
): Float32Array {
    if (toRate === fromRate) return from;
    const ratio = fromRate / toRate;
    const outLen = Math.floor(from.length / ratio);
    const out = new Float32Array(outLen);
    let pos = 0;
    for (let i = 0; i < outLen; i++) {
        out[i] = from[Math.floor(pos)] || 0;
        pos += ratio;
    }
    return out;
}

declare const sampleRate: number;
declare function registerProcessor(name: string, processorCtor: unknown): void;
declare abstract class AudioWorkletProcessor {
    readonly port: MessagePort;
    constructor(options?: unknown);
    abstract process(
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>,
    ): boolean;
}

class STTProcessor extends AudioWorkletProcessor {
    private readonly targetRate: number;
    private readonly chunkSamples: number;
    private buffer: Float32Array[] = [];
    private bufferedSamples = 0;

    constructor(options: AudioWorkletNodeOptions) {
        super();
        const opts = (options?.processorOptions || {}) as STTProcessorOptions;
        this.targetRate = Math.max(
            8000,
            Math.min(48000, opts.targetSampleRate || 16000),
        );
        const chunkMs = Math.max(50, Math.min(2000, opts.chunkMs || 200));
        this.chunkSamples = Math.floor((this.targetRate * chunkMs) / 1000);
    }

    private flushIfReady(): void {
        if (this.bufferedSamples < this.chunkSamples) return;
        let total = 0;
        for (const c of this.buffer) total += c.length;
        const merged = new Float32Array(total);
        let o = 0;
        for (const c of this.buffer) {
            merged.set(c, o);
            o += c.length;
        }
        this.buffer = [];
        this.bufferedSamples = 0;
        // Transfer underlying buffer to avoid copy
        (this as unknown as { port: MessagePort }).port.postMessage(
            { type: "pcm", pcm: merged.buffer },
            [merged.buffer],
        );
    }

    process(inputs: Float32Array[][]): boolean {
        if (!inputs || inputs.length === 0) return true;
        const first = inputs[0];
        if (!first || first.length === 0) return true;
        const ch0 = first[0];
        if (!ch0 || ch0.length === 0) return true;

        // audioWorklet sampleRate is available on global
        const sr: number = typeof sampleRate === "number" ? sampleRate : 48000;
        const ds = downsample(ch0, sr, this.targetRate);
        if (ds.length > 0) {
            this.buffer.push(ds);
            this.bufferedSamples += ds.length;
            this.flushIfReady();
        }
        return true;
    }
}

registerProcessor("stt-processor", STTProcessor);
