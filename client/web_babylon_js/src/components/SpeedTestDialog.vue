<template>
    <v-dialog v-model="dialog" max-width="500px">
        <v-card>
            <v-card-title class="headline">Network Speed Test</v-card-title>
            <v-card-text>
                <div class="d-flex flex-column align-center justify-center my-4">
                    <v-progress-circular :rotate="360" :size="100" :width="15" :model-value="progress" color="primary">
                        {{ Math.round(progress) }}%
                    </v-progress-circular>
                    <div class="mt-4 text-h6">{{ statusText }}</div>
                </div>

                <v-list density="compact">
                    <v-list-item>
                        <template v-slot:prepend>
                            <v-icon icon="mdi-network-outline"></v-icon>
                        </template>
                        <v-list-item-title>Latency (Ping)</v-list-item-title>
                        <template v-slot:append>
                            <span v-if="latency !== null">{{ latency }} ms</span>
                            <span v-else>-</span>
                        </template>
                    </v-list-item>

                    <v-list-item>
                        <template v-slot:prepend>
                            <v-icon icon="mdi-download"></v-icon>
                        </template>
                        <v-list-item-title>Download Speed</v-list-item-title>
                        <template v-slot:append>
                            <span v-if="downloadSpeed !== null">{{ downloadSpeed }} Mbps</span>
                            <span v-else>-</span>
                        </template>
                    </v-list-item>

                    <v-list-item>
                        <template v-slot:prepend>
                            <v-icon icon="mdi-upload"></v-icon>
                        </template>
                        <v-list-item-title>Upload Speed</v-list-item-title>
                        <template v-slot:append>
                            <span v-if="uploadSpeed !== null">{{ uploadSpeed }} Mbps</span>
                            <span v-else>-</span>
                        </template>
                    </v-list-item>
                </v-list>

                <v-alert v-if="error" type="error" density="compact" class="mt-2">
                    {{ error }}
                </v-alert>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="primary" variant="text" @click="startTest" :disabled="isRunning">Start Test</v-btn>
                <v-btn color="grey" variant="text" @click="dialog = false">Close</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";

const props = defineProps<{
    modelValue: boolean;
}>();

const emit = defineEmits(["update:modelValue"]);

const dialog = computed({
    get: () => props.modelValue,
    set: (val) => emit("update:modelValue", val),
});

const isRunning = ref(false);
const progress = ref(0);
const statusText = ref("Ready");
const latency = ref<number | null>(null);
const downloadSpeed = ref<string | null>(null);
const uploadSpeed = ref<string | null>(null);
const error = ref<string | null>(null);

const DOWNLOAD_SIZE = 5 * 1024 * 1024; // 5MB
const UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB

// Helper to get asset service host
const getAssetHost = () => {
    // Check if we can get the active connection host from global state or just use window.location if served from same origin (Caddy)
    // Since we are likely behind Caddy in production:
    return window.location.origin;
};

async function startTest() {
    isRunning.value = true;
    progress.value = 0;
    latency.value = null;
    downloadSpeed.value = null;
    uploadSpeed.value = null;
    error.value = null;
    statusText.value = "Measuring Latency...";

    try {
        const baseUrl = getAssetHost();

        // 1. Latency (Ping)
        const startPing = performance.now();
        // Use a small info endpoint (stats)
        await fetch(`${baseUrl}/world/rest/asset/stats`, { method: "GET" });
        const endPing = performance.now();
        latency.value = Math.round(endPing - startPing);
        progress.value = 33;

        // 2. Download
        statusText.value = "Testing Download...";
        const startDl = performance.now();
        const dlRes = await fetch(`${baseUrl}/world/rest/asset/speedtest/download?size=${DOWNLOAD_SIZE}`);
        await dlRes.arrayBuffer(); // Consume
        const endDl = performance.now();
        const dlDurationSec = (endDl - startDl) / 1000;
        const dlBits = DOWNLOAD_SIZE * 8;
        const dlMbps = (dlBits / dlDurationSec) / (1024 * 1024);
        downloadSpeed.value = dlMbps.toFixed(2);
        progress.value = 66;

        // 3. Upload
        statusText.value = "Testing Upload...";
        const randomData = new Uint8Array(UPLOAD_SIZE); // Zeros are fine for speed, maybe random to avoid compression
        // Fill with random to avoid compression shortcuts
        for (let i = 0; i < UPLOAD_SIZE; i += 1024) {
            randomData[i] = Math.floor(Math.random() * 255);
        }

        const startUl = performance.now();
        await fetch(`${baseUrl}/world/rest/asset/speedtest/upload`, {
            method: "POST",
            body: randomData,
            headers: {
                "Content-Type": "application/octet-stream"
            }
        });
        const endUl = performance.now();
        const ulDurationSec = (endUl - startUl) / 1000;
        const ulBits = UPLOAD_SIZE * 8;
        const ulMbps = (ulBits / ulDurationSec) / (1024 * 1024);
        uploadSpeed.value = ulMbps.toFixed(2);

        progress.value = 100;
        statusText.value = "Test Complete";

    } catch (e: any) {
        console.error(e);
        error.value = "Test Failed: " + (e.message || "Unknown error");
        statusText.value = "Error";
    } finally {
        isRunning.value = false;
    }
}
</script>
