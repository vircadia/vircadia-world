<template>
    <v-dialog v-model="dialog" max-width="800px">
        <v-card>
            <v-card-title class="headline">Network Speed Test</v-card-title>
            <v-card-text>
                <div class="d-flex flex-column align-center justify-center my-4">
                    <v-progress-circular :rotate="360" :size="80" :width="10" :model-value="progress" color="primary">
                        {{ Math.round(progress) }}%
                    </v-progress-circular>
                    <div class="mt-4 text-h6">{{ statusText }}</div>
                </div>

                <v-table density="compact">
                    <thead>
                        <tr>
                            <th class="text-left">Service</th>
                            <th class="text-left">Status</th>
                            <th class="text-left">Latency</th>
                            <th class="text-left">Download</th>
                            <th class="text-left">Upload</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="service in services" :key="service.name">
                            <td>{{ service.name }}</td>
                            <td>
                                <v-icon v-if="service.status === 'done'" color="success" icon="mdi-check"></v-icon>
                                <v-icon v-else-if="service.status === 'running'" color="primary"
                                    icon="mdi-loading mdi-spin"></v-icon>
                                <v-icon v-else-if="service.status === 'error'" color="error" icon="mdi-alert"></v-icon>
                                <v-icon v-else icon="mdi-minus" color="grey"></v-icon>
                            </td>
                            <td>
                                <span v-if="service.latency !== null">{{ service.latency }} ms</span>
                                <span v-else>-</span>
                            </td>
                            <td>
                                <span v-if="service.downloadSpeed !== null">{{ service.downloadSpeed }} Mbps</span>
                                <span v-else>-</span>
                            </td>
                            <td>
                                <span v-if="service.uploadSpeed !== null">{{ service.uploadSpeed }} Mbps</span>
                                <span v-else>-</span>
                            </td>
                        </tr>
                    </tbody>
                </v-table>

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

interface ServiceResult {
    name: string;
    path: string;
    latency: number | null;
    downloadSpeed: string | null;
    uploadSpeed: string | null;
    status: 'pending' | 'running' | 'done' | 'error';
}

const isRunning = ref(false);
const progress = ref(0);
const statusText = ref("Ready");
const error = ref<string | null>(null);

const services = ref<ServiceResult[]>([
    { name: 'Asset', path: '/world/rest/asset', latency: null, downloadSpeed: null, uploadSpeed: null, status: 'pending' },
    { name: 'Auth', path: '/world/rest/auth', latency: null, downloadSpeed: null, uploadSpeed: null, status: 'pending' },
    { name: 'Inference', path: '/world/rest/inference', latency: null, downloadSpeed: null, uploadSpeed: null, status: 'pending' },
    { name: 'WS', path: '/world/rest/ws', latency: null, downloadSpeed: null, uploadSpeed: null, status: 'pending' },
]);

const DOWNLOAD_SIZE = 5 * 1024 * 1024; // 5MB
const UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB

// Helper to get asset service host
const getBaseUrl = () => {
    // Check if we can get the active connection host from global state or just use window.location if served from same origin (Caddy)
    // Since we are likely behind Caddy in production:
    return window.location.origin;
};

async function startTest() {
    isRunning.value = true;
    progress.value = 0;
    error.value = null;
    statusText.value = "Starting tests...";

    // Reset results
    for (const s of services.value) {
        s.latency = null;
        s.downloadSpeed = null;
        s.uploadSpeed = null;
        s.status = 'pending';
    }

    const baseUrl = getBaseUrl();
    const totalSteps = services.value.length * 3;
    let completedSteps = 0;

    const updateProgress = () => {
        progress.value = (completedSteps / totalSteps) * 100;
    };

    try {
        for (const service of services.value) {
            service.status = 'running';
            statusText.value = `Testing ${service.name}...`;

            try {
                // 1. Latency (Ping)
                const startPing = performance.now();
                // Use a generic endpoint or the stats endpoint if available. 
                // For simplified logic, if the service is WS, we still use HTTP endpoint we added.
                // We use /stats for ping if possible, or just the download endpoint with size 0? 
                // Actually, for Auth/Inference/Asset check if they have /stats.
                // Asset: /world/rest/asset/stats (checked in previous implementation)
                // Auth: /world/rest/auth/stats (Auth has stats)
                // Inference: /world/rest/inference/stats (Inference has stats)
                // WS: /world/rest/ws/stats? No, WS doesn't seem to have a stats endpoint exposed via HTTP in the code I read?
                // Wait, WS manager has `fetch` handler but I didn't see stats endpoint logic in my grep or read. 
                // Use existing `addCorsHeaders` handler for OPTIONS as a ping? Or download?
                // Let's use download with small size as ping for all to be safe and consistent.

                // Correction: implementation plan assumed stats for ping.
                // Let's try to use `tests/download?size=0` or small size for latency check?
                // Or just a fetch to the base path?

                // Let's check if services support HEAD or OPTIONS.
                // All managers I touched support OPTIONS.
                // So I can use OPTIONS for latency.

                await fetch(`${baseUrl}${service.path}/speedtest/download?size=1`, { method: "HEAD" }).catch(() => {
                    // fallback to GET if HEAD fails
                    return fetch(`${baseUrl}${service.path}/speedtest/download?size=1`);
                });

                const endPing = performance.now();
                service.latency = Math.round(endPing - startPing);
                completedSteps++;
                updateProgress();

                // 2. Download
                const startDl = performance.now();
                const dlRes = await fetch(`${baseUrl}${service.path}/speedtest/download?size=${DOWNLOAD_SIZE}`);
                if (!dlRes.ok) throw new Error(`HTTP ${dlRes.status}`);
                await dlRes.arrayBuffer(); // Consume
                const endDl = performance.now();
                const dlDurationSec = (endDl - startDl) / 1000;
                const dlBits = DOWNLOAD_SIZE * 8;
                const dlMbps = (dlBits / dlDurationSec) / (1024 * 1024);
                service.downloadSpeed = dlMbps.toFixed(2);
                completedSteps++;
                updateProgress();

                // 3. Upload
                const randomData = new Uint8Array(UPLOAD_SIZE);
                for (let i = 0; i < UPLOAD_SIZE; i += 1024) {
                    randomData[i] = Math.floor(Math.random() * 255);
                }

                const startUl = performance.now();
                const ulRes = await fetch(`${baseUrl}${service.path}/speedtest/upload`, {
                    method: "POST",
                    body: randomData,
                    headers: {
                        "Content-Type": "application/octet-stream"
                    }
                });
                if (!ulRes.ok) throw new Error(`HTTP ${ulRes.status}`);
                const endUl = performance.now();
                const ulDurationSec = (endUl - startUl) / 1000;
                const ulBits = UPLOAD_SIZE * 8;
                const ulMbps = (ulBits / ulDurationSec) / (1024 * 1024);
                service.uploadSpeed = ulMbps.toFixed(2);
                completedSteps++;
                updateProgress();

                service.status = 'done';

            } catch (e: any) {
                console.error(`Error testing ${service.name}:`, e);
                service.status = 'error';
                // Complete the steps for progress bar purposes
                completedSteps += (3 - (completedSteps % 3)); // skip remaining steps for this service
                updateProgress();
            }
        }

        progress.value = 100;
        statusText.value = "All Tests Complete";

    } catch (e: any) {
        console.error(e);
        error.value = "Test Suite Failed: " + (e.message || "Unknown error");
        statusText.value = "Error";
    } finally {
        isRunning.value = false;
    }
}
</script>
