<template>
    <!-- Renderless component -->
    <slot :is-listening="sttActive" :is-processing="sttProcessing"></slot>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";
import { MicVAD, utils } from "@ricky0123/vad-web";

const props = defineProps({
    vircadiaWorld: {
        type: Object as () => VircadiaWorldInstance | null,
        required: true,
    },
    micStream: {
        type: Object as () => MediaStream | null,
        default: null,
    },
    enabled: {
        type: Boolean,
        default: true,
    },
});

const sttActive = ref(false);
const sttProcessing = ref(false);
const vadInstance = ref<any>(null);

// VAD Configuration
const vadConfig = {
    positiveSpeechThreshold: 0.8,
    negativeSpeechThreshold: 0.45,
    minSpeechFrames: 4,
    preSpeechPadFrames: 10,
    redemptionFrames: 8,
};

async function startVad() {
    if (!props.micStream || !props.enabled) return;
    if (vadInstance.value) return;

    try {
        vadInstance.value = await MicVAD.new({
            stream: props.micStream,
            baseAssetPath: "/vad/",
            onnxWASMBasePath: "/vad/",
            ...vadConfig,
            onSpeechStart: () => {
                sttActive.value = true;
                console.debug("[VoiceChatInput] Speech started");
            },
            onSpeechEnd: async (audio: Float32Array) => {
                sttActive.value = false;
                console.debug("[VoiceChatInput] Speech ended");
                await processAudioSegment(audio);
            },
            onVADMisfire: () => {
                sttActive.value = false;
                console.debug("[VoiceChatInput] VAD misfire");
            },
        } as any);

        vadInstance.value.start();
    } catch (e) {
        console.error("[VoiceChatInput] Failed to start VAD:", e);
    }
}

function stopVad() {
    if (vadInstance.value) {
        vadInstance.value.pause();
        vadInstance.value.destroy(); // or just pause? destroy seems safer to release resources
        vadInstance.value = null;
    }
    sttActive.value = false;
}

async function processAudioSegment(audio: Float32Array) {
    if (!props.vircadiaWorld?.client) return;

    sttProcessing.value = true;
    try {
        // Encode to WAV
        const wavBuffer = utils.encodeWAV(audio);
        const blob = new Blob([wavBuffer], { type: "audio/wav" });
        const file = new File([blob], "speech.wav", { type: "audio/wav" });

        const resp = await props.vircadiaWorld.client.restInference.stt({
            audio: file,
            language: "en",
            responseFormat: "json",
        });

        if (resp && resp.text) {
            await postChatMessage(resp.text);
        }
    } catch (e) {
        console.error("[VoiceChatInput] STT failed:", e);
    } finally {
        sttProcessing.value = false;
    }
}

async function postChatMessage(text: string) {
    emit('message', text);
}

const emit = defineEmits(['message']);

watch(() => props.enabled, (val) => {
    if (val) startVad();
    else stopVad();
});

watch(() => props.micStream, (val) => {
    stopVad();
    if (props.enabled && val) {
        startVad();
    }
});

onMounted(() => {
    if (props.enabled && props.micStream) {
        startVad();
    }
});

onUnmounted(() => {
    stopVad();
});

defineExpose({
    sttActive,
    sttProcessing,
    vadInstance,
});
</script>
