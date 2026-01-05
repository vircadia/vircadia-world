<template>
    <!-- Renderless: provide captured mic stream to parent via v-model and optional slot -->
    <slot :stream="stream" />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";

const props = defineProps({
    deviceId: { type: String, default: "" },
    echoCancellation: { type: Boolean, default: false },
    noiseSuppression: { type: Boolean, default: false },
    autoGainControl: { type: Boolean, default: false },
});

const emit = defineEmits<(e: "update:stream", v: MediaStream | null) => void>();

const stream = ref<MediaStream | null>(null);
let openMicCounter = 0;

async function openMic(): Promise<void> {
    const myId = ++openMicCounter;
    await closeMic();
    if (myId !== openMicCounter) return;

    try {
        const constraints: MediaStreamConstraints = {
            audio: {
                deviceId: props.deviceId ? { exact: props.deviceId } : undefined,
                echoCancellation: props.echoCancellation,
                noiseSuppression: props.noiseSuppression,
                autoGainControl: props.autoGainControl,
            },
            video: false,
        };
        const s = await navigator.mediaDevices.getUserMedia(constraints);
        if (myId !== openMicCounter) {
            // Another openMic called while we were waiting; close this stale stream immediately
            for (const track of s.getTracks()) track.stop();
            return;
        }
        stream.value = s;
        emit("update:stream", s);
    } catch (e) {
        if (myId !== openMicCounter) return;
        console.warn("[BabylonMic] Failed to obtain microphone:", e);
        stream.value = null;
        emit("update:stream", null);
    }
}

async function closeMic(): Promise<void> {
    try {
        for (const track of (stream.value?.getTracks?.() ?? [])) track.stop();
    } catch { }
    stream.value = null;
    emit("update:stream", null);
}

onMounted(async () => {
    await openMic();
});

onUnmounted(() => {
    void closeMic();
});

watch(() => [props.deviceId, props.echoCancellation, props.noiseSuppression, props.autoGainControl], async () => {
    await openMic();
});
</script>
