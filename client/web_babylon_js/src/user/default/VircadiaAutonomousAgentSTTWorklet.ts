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
    const outLen = Math.max(0, Math.floor(from.length / ratio));
    const out = new Float32Array(outLen);
    if (outLen === 0) return out;

    // For downsampling (ratio >= 1), average source samples that fall into each output frame
    // This reduces aliasing compared to nearest-neighbor selection.
    if (ratio >= 1) {
        let srcIndex = 0;
        let acc = 0;
        let accCount = 0;
        let nextBoundary = ratio; // exclusive upper bound for current output frame
        for (let i = 0; i < outLen; i++) {
            // Accumulate samples until we reach the next output boundary
            while (srcIndex < from.length && srcIndex < nextBoundary) {
                acc += from[srcIndex];
                accCount++;
                srcIndex++;
            }
            out[i] = accCount > 0 ? acc / accCount : 0;
            acc = 0;
            accCount = 0;
            nextBoundary += ratio;
        }
        return out;
    }

    // For upsampling (ratio < 1), use linear interpolation
    for (let i = 0; i < outLen; i++) {
        const pos = i * ratio;
        const base = Math.floor(pos);
        const frac = pos - base;
        const a = from[base] || 0;
        const b = from[base + 1] || a;
        out[i] = a + (b - a) * frac;
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

    private lastRms: number = 0;

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
            { type: "pcm", pcm: merged.buffer, rms: this.lastRms },
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
        // Compute instantaneous RMS on downsampled chunk (approximate input level)
        let sum = 0;
        for (let i = 0; i < ds.length; i++) {
            const v = ds[i];
            sum += v * v;
        }
        const rms = ds.length > 0 ? Math.sqrt(sum / ds.length) : 0;
        this.lastRms = rms;
        if (ds.length > 0) {
            this.buffer.push(ds);
            this.bufferedSamples += ds.length;
            this.flushIfReady();
        }
        return true;
    }
}

registerProcessor("stt-processor", STTProcessor);
