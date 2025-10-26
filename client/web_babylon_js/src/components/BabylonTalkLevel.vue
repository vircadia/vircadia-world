<template>
    <!-- Renderless provider of audio talk state and diagnostics -->
    <slot :is-talking="isTalking" :level="level" :devices="audioInputDevices" :threshold="threshold" />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watchEffect } from "vue";

const props = defineProps({
    threshold: { type: Number, default: 0.02 }, // 0..1 amplitude
    holdMs: { type: Number, default: 150 }, // keep talking for this after drop
    smoothing: { type: Number, default: 0.8 }, // analyser smoothingTimeConstant
    fftSize: { type: Number, default: 2048 },
    audioStream: { type: Object as () => MediaStream | null, default: null }, // Optional audio stream (e.g., TTS output)
});

const isTalking = ref(false);
const level = ref(0);
type AudioInputDevice = { deviceId: string; label: string };
const audioInputDevices = ref<AudioInputDevice[]>([]);

// Manual media stream (audio-only)
const stream = ref<MediaStream | null>(null);

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let rafId: number | null = null;
let lastAboveTs = 0;
let resumeHandlersAttached = false;
let timeDomainBuffer: Float32Array | null = null;

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
                document.removeEventListener("pointerdown", tryResume);
                document.removeEventListener("keydown", tryResume);
                resumeHandlersAttached = false;
            }
        };
        resumeHandlersAttached = true;
        document.addEventListener("pointerdown", tryResume);
        document.addEventListener("keydown", tryResume);
    }
}

// Enumerate audio input devices manually
async function refreshAudioDevices(): Promise<void> {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter((d) => d.kind === "audioinput");
        audioInputDevices.value = inputs.map((d) => ({
            deviceId: d.deviceId,
            label: d.label || "(audio input)",
        }));
    } catch {
        audioInputDevices.value = [];
    }
}

// Connect analyser to the current stream (use provided audioStream if available, otherwise mic stream)
watchEffect(async () => {
    const current = props.audioStream || stream.value;
    if (!current) return;
    start();
    if (!audioCtx || !analyser) return;
    await ensureAudioContextRunning();
    try {
        source?.disconnect();
    } catch { }
    try {
        analyser?.disconnect();
    } catch { }
    source = audioCtx.createMediaStreamSource(current);
    source.connect(analyser);
    if (!rafId) loop();
});

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
    try {
        for (const track of stream.value?.getTracks() ?? []) {
            track.stop();
        }
    } catch { }
    stream.value = null;
    if (resumeHandlersAttached) {
        const noop = () => { };
        document.removeEventListener("pointerdown", noop);
        document.removeEventListener("keydown", noop);
        resumeHandlersAttached = false;
    }
    isTalking.value = false;
}

function computeLevel(): number {
    if (!analyser) return 0;
    if (!timeDomainBuffer || timeDomainBuffer.length !== analyser.fftSize) {
        timeDomainBuffer = new Float32Array(analyser.fftSize);
    }
    analyser.getFloatTimeDomainData(timeDomainBuffer);
    let sumSquares = 0;
    for (const sample of timeDomainBuffer as unknown as number[]) {
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

onMounted(async () => {
    // Only request mic stream if audioStream prop is not provided
    if (!props.audioStream) {
        try {
            // Request audio-only stream
            stream.value = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
                video: false,
            });
        } catch { }
    }
    await refreshAudioDevices();
    navigator.mediaDevices.addEventListener?.(
        "devicechange",
        refreshAudioDevices,
    );
});

onUnmounted(() => {
    stop();
    try {
        navigator.mediaDevices.removeEventListener?.(
            "devicechange",
            refreshAudioDevices,
        );
    } catch { }
});

// Expose for parent refs if needed
defineExpose({ isTalking, level, audioInputDevices });
</script>
