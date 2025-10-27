<template>
    <!-- Renderless provider of audio talk state and diagnostics -->
    <slot :is-talking="isTalking" :level="level" :threshold="threshold" />
</template>

<script setup lang="ts">
import { onUnmounted, ref, watch } from "vue";

const props = defineProps({
    threshold: { type: Number, default: 0.02 }, // 0..1 amplitude
    holdMs: { type: Number, default: 150 }, // keep talking for this after drop
    smoothing: { type: Number, default: 0.8 }, // analyser smoothingTimeConstant
    fftSize: { type: Number, default: 2048 },
    // External audio stream (required). Component will NOT request microphone.
    audioStream: { type: Object as () => MediaStream | null, required: true },
});

const isTalking = ref(false);
const level = ref(0);

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let rafId: number | null = null;
let lastAboveTs = 0;
let resumeHandlersAttached = false;
let resumeHandler: (() => void) | null = null;
let timeDomainBuffer: Float32Array<ArrayBuffer> | null = null;

function start(): void {
    if (audioCtx || analyser) return;
    type AudioContextConstructor = new () => AudioContext;
    const g = globalThis as unknown as {
        AudioContext?: AudioContextConstructor;
        webkitAudioContext?: AudioContextConstructor;
    };
    const Ctor = (g.AudioContext ?? g.webkitAudioContext) as
        | AudioContextConstructor
        | undefined;
    if (!Ctor) return;
    audioCtx = new Ctor();
    const ctx = audioCtx;
    if (!ctx) return;
    analyser = ctx.createAnalyser();
    analyser.smoothingTimeConstant = Math.min(
        0.99,
        Math.max(0, props.smoothing),
    );
    analyser.fftSize = props.fftSize;
}

async function ensureAudioContextRunning(): Promise<void> {
    if (!audioCtx) return;
    try {
        await audioCtx.resume();
    } catch { }
    if (audioCtx.state === "running") return;

    if (!resumeHandlersAttached) {
        const tryResume = async () => {
            try {
                await audioCtx?.resume();
            } catch { }
            if (audioCtx?.state === "running") {
                if (resumeHandler) {
                    document.removeEventListener("pointerdown", resumeHandler);
                    document.removeEventListener("keydown", resumeHandler);
                    resumeHandler = null;
                }
                resumeHandlersAttached = false;
            }
        };
        resumeHandlersAttached = true;
        resumeHandler = tryResume;
        document.addEventListener("pointerdown", tryResume);
        document.addEventListener("keydown", tryResume);
    }
}

// React to audioStream changes, including initial null and later assignment
watch(() => props.audioStream, async (current) => {
    if (!current) {
        // If stream becomes null or is initially null, fully stop until we get a real stream
        stop();
        return;
    }
    start();
    if (!audioCtx || !analyser) return;
    await ensureAudioContextRunning();
    try { source?.disconnect(); } catch { }
    try { analyser?.disconnect(); } catch { }
    source = audioCtx.createMediaStreamSource(current);
    source.connect(analyser);
    if (!rafId) loop();
}, { immediate: true });

function stop(): void {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    try {
        source?.disconnect();
    } catch { }
    source = null;
    try {
        analyser?.disconnect();
    } catch { }
    analyser = null;
    if (audioCtx) {
        try {
            audioCtx.close();
        } catch { }
    }
    audioCtx = null;
    if (resumeHandlersAttached) {
        if (resumeHandler) {
            document.removeEventListener("pointerdown", resumeHandler);
            document.removeEventListener("keydown", resumeHandler);
            resumeHandler = null;
        }
        resumeHandlersAttached = false;
    }
    isTalking.value = false;
}

function computeLevel(): number {
    if (!analyser) return 0;
    if (!timeDomainBuffer || timeDomainBuffer.length !== analyser.fftSize) {
        // Allocate with ArrayBuffer to satisfy stricter lib.dom types
        timeDomainBuffer = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
    }
    analyser.getFloatTimeDomainData(timeDomainBuffer);
    let sumSquares = 0;
    for (const sample of timeDomainBuffer) {
        sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / timeDomainBuffer.length);
    return rms;
}

function loop(): void {
    const now = performance.now();
    const lvl = computeLevel();
    level.value = lvl;
    if (lvl >= props.threshold) lastAboveTs = now;
    const talking = now - lastAboveTs <= props.holdMs;
    if (talking !== isTalking.value) isTalking.value = talking;
    rafId = requestAnimationFrame(loop);
}

onUnmounted(() => {
    stop();
});

// Expose for parent refs if needed
defineExpose({ isTalking, level });
</script>
