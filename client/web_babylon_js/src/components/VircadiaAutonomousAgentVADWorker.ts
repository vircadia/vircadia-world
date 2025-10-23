/*
  Lightweight energy-based VAD worker (CPU/WASM only)
  - Input: 16 kHz mono Float32 PCM via ArrayBuffer
  - Detects speech segments using RMS thresholds + hysteresis and min durations
  - Emits padded speech segments back to caller as transferable ArrayBuffers

  Messages in:
    { type: 'load', config?: Partial<VADConfig> }
    { type: 'start', peerId: string, language?: string }
    { type: 'audio', peerId: string, pcm: ArrayBuffer, rms?: number }
    { type: 'stop', peerId: string }

  Messages out:
    { type: 'status', status: 'recording_start'|'recording_end', peerId: string }
    { type: 'segment', peerId: string, pcm: ArrayBuffer }
    { type: 'error', error: string, peerId?: string }
*/

type LoadMessage = { type: "load"; config?: Partial<VADConfig> };
type StartMessage = { type: "start"; peerId: string; language?: string };
type AudioMessage = {
    type: "audio";
    peerId: string;
    pcm: ArrayBuffer;
    rms?: number;
};
type StopMessage = { type: "stop"; peerId: string };
type WorkerMessage = LoadMessage | StartMessage | AudioMessage | StopMessage;

type WorkerEvent =
    | {
          type: "status";
          status: "recording_start" | "recording_end";
          peerId: string;
      }
    | { type: "segment"; peerId: string; pcm: ArrayBuffer }
    | { type: "error"; error: string; peerId?: string };

type VADConfig = {
    sampleRate: number; // expected input sample rate (Hz)
    minSpeechMs: number; // minimum duration required to consider as speech
    minSilenceMs: number; // required trailing silence to close segment
    prePadMs: number; // audio to prepend before detected speech
    postPadMs: number; // audio to append after speech
    speechThreshold: number; // RMS threshold to start speech
    exitThreshold: number; // RMS threshold to continue while recording
    maxPrevMs: number; // how much pre-buffer to retain for padding (ms)
};

type PeerState = {
    isRecording: boolean;
    language?: string;
    // Previous non-speech buffers used for pre-padding
    prevBuffers: Float32Array[];
    prevSamples: number;
    // In-progress speech buffers
    speechBuffers: Float32Array[];
    postSpeechSamples: number;
};

const DEFAULT_CONFIG: VADConfig = {
    sampleRate: 16000,
    minSpeechMs: 250,
    minSilenceMs: 300,
    prePadMs: 150,
    postPadMs: 150,
    speechThreshold: 0.015, // tune based on environment
    exitThreshold: 0.008, // lower to allow brief dips
    maxPrevMs: 800,
};

let CONFIG: VADConfig = { ...DEFAULT_CONFIG };

const peers = new Map<string, PeerState>();

function getPeerState(peerId: string): PeerState {
    let s = peers.get(peerId);
    if (!s) {
        s = {
            isRecording: false,
            prevBuffers: [],
            prevSamples: 0,
            speechBuffers: [],
            postSpeechSamples: 0,
        };
        peers.set(peerId, s);
    }
    return s;
}

function rmsOf(buffer: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
        const v = buffer[i];
        sum += v * v;
    }
    return buffer.length > 0 ? Math.sqrt(sum / buffer.length) : 0;
}

function msToSamples(ms: number): number {
    return Math.max(
        0,
        Math.floor((CONFIG.sampleRate * Math.max(0, ms)) / 1000),
    );
}

function trimPrevToMax(s: PeerState): void {
    const maxPrev = msToSamples(CONFIG.maxPrevMs);
    if (s.prevSamples <= maxPrev) return;
    let need = s.prevSamples - maxPrev;
    // Drop from the front until within limit
    for (let i = 0; i < s.prevBuffers.length && need > 0; i++) {
        const buf = s.prevBuffers[i];
        if (buf.length <= need) {
            need -= buf.length;
            s.prevSamples -= buf.length;
            s.prevBuffers[i] = new Float32Array(0);
        } else {
            const sliced = buf.subarray(buf.length - (buf.length - need));
            s.prevSamples -= need;
            s.prevBuffers[i] = sliced;
            need = 0;
        }
    }
    // Remove emptied buffers at front
    let removeCount = 0;
    for (const b of s.prevBuffers) {
        if (b.length === 0) removeCount++;
        else break;
    }
    if (removeCount > 0) s.prevBuffers.splice(0, removeCount);
}

function concatFloat32(buffers: Float32Array[]): Float32Array {
    let total = 0;
    for (const b of buffers) total += b.length;
    const out = new Float32Array(total);
    let o = 0;
    for (const b of buffers) {
        out.set(b, o);
        o += b.length;
    }
    return out;
}

function onRecordingStart(peerId: string): void {
    (
        self as unknown as {
            postMessage: (m: WorkerEvent, t?: Transferable[]) => void;
        }
    ).postMessage({
        type: "status",
        status: "recording_start",
        peerId,
    });
}

function onRecordingEnd(peerId: string): void {
    (
        self as unknown as {
            postMessage: (m: WorkerEvent, t?: Transferable[]) => void;
        }
    ).postMessage({
        type: "status",
        status: "recording_end",
        peerId,
    });
}

function emitSegment(peerId: string, segment: Float32Array): void {
    const buf = segment.buffer as ArrayBuffer;
    (
        self as unknown as {
            postMessage: (m: WorkerEvent, t?: Transferable[]) => void;
        }
    ).postMessage({ type: "segment", peerId, pcm: buf }, [buf]);
}

function handleChunk(
    peerId: string,
    chunk: Float32Array,
    providedRms?: number,
): void {
    const s = getPeerState(peerId);
    const r =
        typeof providedRms === "number" && Number.isFinite(providedRms)
            ? providedRms
            : rmsOf(chunk);

    const isSpeech =
        r >= CONFIG.speechThreshold ||
        (s.isRecording && r >= CONFIG.exitThreshold);
    if (!s.isRecording && !isSpeech) {
        // Maintain prev buffer ring for padding
        s.prevBuffers.push(chunk);
        s.prevSamples += chunk.length;
        trimPrevToMax(s);
        return;
    }

    if (isSpeech) {
        if (!s.isRecording) {
            s.isRecording = true;
            s.postSpeechSamples = 0;
            // Seed with prePad from prevBuffers
            const needPre = msToSamples(CONFIG.prePadMs);
            if (needPre > 0 && s.prevSamples > 0) {
                const pre: Float32Array[] = [];
                let remaining = needPre;
                // Pull from tail of prev buffers
                for (
                    let i = s.prevBuffers.length - 1;
                    i >= 0 && remaining > 0;
                    i--
                ) {
                    const b = s.prevBuffers[i];
                    if (b.length <= remaining) {
                        pre.unshift(b);
                        remaining -= b.length;
                    } else {
                        pre.unshift(b.subarray(b.length - remaining));
                        remaining = 0;
                    }
                }
                for (const p of pre) s.speechBuffers.push(p);
            }
            onRecordingStart(peerId);
        }
        s.speechBuffers.push(chunk);
        s.postSpeechSamples = 0;
        return;
    }

    // Non-speech chunk while recording
    s.postSpeechSamples += chunk.length;
    const needSilence = msToSamples(CONFIG.minSilenceMs);
    if (s.postSpeechSamples < needSilence) {
        // keep accumulating a little silence inside the segment
        s.speechBuffers.push(chunk);
        return;
    }

    // Close the segment if it meets min speech duration
    const minSpeech = msToSamples(CONFIG.minSpeechMs);
    let speechSamples = 0;
    for (const b of s.speechBuffers) speechSamples += b.length;
    if (speechSamples >= minSpeech) {
        const postPad = msToSamples(CONFIG.postPadMs);
        if (postPad > 0) {
            // Add additional padding by appending part of current silence chunk
            const toAppend = Math.min(postPad, chunk.length);
            if (toAppend > 0) s.speechBuffers.push(chunk.subarray(0, toAppend));
        }
        const segment = concatFloat32(s.speechBuffers);
        emitSegment(peerId, segment);
    }

    // Reset state; treat this chunk as prev (non-speech) for future prePad
    s.isRecording = false;
    s.speechBuffers = [];
    s.postSpeechSamples = 0;
    s.prevBuffers.push(chunk);
    s.prevSamples += chunk.length;
    trimPrevToMax(s);
    onRecordingEnd(peerId);
}

function onMessage(e: MessageEvent<WorkerMessage>) {
    const msg = e.data;
    try {
        if (msg.type === "load") {
            if (msg.config && typeof msg.config === "object") {
                const c = msg.config as Partial<VADConfig>;
                CONFIG = { ...CONFIG, ...c };
            }
            return;
        }
        if (msg.type === "start") {
            const s = getPeerState(msg.peerId);
            s.language = msg.language;
            s.isRecording = false;
            s.speechBuffers = [];
            s.postSpeechSamples = 0;
            // Do not clear prevBuffers to allow prePad continuity across starts
            return;
        }
        if (msg.type === "audio") {
            const f32 = new Float32Array(msg.pcm);
            if (f32.length === 0) return;
            handleChunk(msg.peerId, f32, msg.rms);
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
