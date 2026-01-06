<template>
    <v-dialog v-model="dialog" max-width="900px" scrollable>
        <v-card>
            <v-card-title class="headline">World Stats</v-card-title>
            <v-tabs v-model="activeTab" bg-color="primary" grow>
                <v-tab value="speedtest">
                    <v-icon start>mdi-speedometer</v-icon>
                    Speed Test
                </v-tab>
                <v-tab value="asset">
                    <v-icon start>mdi-file-multiple</v-icon>
                    Asset
                </v-tab>
                <v-tab value="auth">
                    <v-icon start>mdi-shield-account</v-icon>
                    Auth
                </v-tab>
                <v-tab value="inference">
                    <v-icon start>mdi-brain</v-icon>
                    Inference
                </v-tab>
                <v-tab value="ws">
                    <v-icon start>mdi-web</v-icon>
                    WS
                </v-tab>
            </v-tabs>

            <v-card-text style="max-height: 60vh; overflow-y: auto;">
                <v-tabs-window v-model="activeTab">
                    <!-- Speed Test Tab -->
                    <v-tabs-window-item value="speedtest">
                        <div class="d-flex flex-column align-center justify-center my-4">
                            <v-progress-circular :rotate="360" :size="80" :width="10" :model-value="progress"
                                color="primary">
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
                                        <v-icon v-if="service.status === 'done'" color="success"
                                            icon="mdi-check"></v-icon>
                                        <v-icon v-else-if="service.status === 'running'" color="primary"
                                            icon="mdi-loading mdi-spin"></v-icon>
                                        <v-icon v-else-if="service.status === 'error'" color="error"
                                            icon="mdi-alert"></v-icon>
                                        <v-icon v-else icon="mdi-minus" color="grey"></v-icon>
                                    </td>
                                    <td>
                                        <span v-if="service.latency !== null">{{ service.latency }} ms</span>
                                        <span v-else>-</span>
                                    </td>
                                    <td>
                                        <span v-if="service.downloadSpeed !== null">{{ service.downloadSpeed }}
                                            Mbps</span>
                                        <span v-else>-</span>
                                    </td>
                                    <td>
                                        <span v-if="service.uploadSpeed !== null">{{ service.uploadSpeed }} Mbps</span>
                                        <span v-else>-</span>
                                    </td>
                                </tr>
                            </tbody>
                        </v-table>

                        <v-alert v-if="speedTestError" type="error" density="compact" class="mt-2">
                            {{ speedTestError }}
                        </v-alert>
                        <div class="d-flex justify-end mt-4">
                            <v-btn color="primary" variant="tonal" @click="startSpeedTest" :disabled="isRunning"
                                :loading="isRunning">
                                <v-icon start>mdi-play</v-icon>
                                Start Test
                            </v-btn>
                        </div>
                    </v-tabs-window-item>

                    <!-- Asset Stats Tab -->
                    <v-tabs-window-item value="asset">
                        <ServiceStatsPanel :stats="assetStats" :loading="assetLoading" :error="assetError ?? undefined"
                            service-name="Asset Service" @refresh="fetchAssetStats">
                            <template #extra v-if="assetStats?.assets?.cache">
                                <v-divider class="my-3"></v-divider>
                                <div class="text-subtitle-2 mb-2">Asset Cache</div>
                                <v-table density="compact">
                                    <tbody>
                                        <tr>
                                            <td class="text-medium-emphasis">Directory</td>
                                            <td class="font-weight-medium">{{ assetStats.assets.cache.dir }}</td>
                                        </tr>
                                        <tr>
                                            <td class="text-medium-emphasis">Max Size</td>
                                            <td class="font-weight-medium">{{
                                                assetStats.assets.cache.maxMegabytes?.toFixed(2) }} MB</td>
                                        </tr>
                                        <tr>
                                            <td class="text-medium-emphasis">Current Size</td>
                                            <td class="font-weight-medium">{{
                                                assetStats.assets.cache.totalMegabytes?.toFixed(2) }} MB</td>
                                        </tr>
                                        <tr>
                                            <td class="text-medium-emphasis">Files Cached</td>
                                            <td class="font-weight-medium">{{ assetStats.assets.cache.fileCount }}</td>
                                        </tr>
                                        <tr>
                                            <td class="text-medium-emphasis">In Flight</td>
                                            <td class="font-weight-medium">{{ assetStats.assets.cache.inFlight }}</td>
                                        </tr>
                                    </tbody>
                                </v-table>
                            </template>
                        </ServiceStatsPanel>
                    </v-tabs-window-item>

                    <!-- Auth Stats Tab -->
                    <v-tabs-window-item value="auth">
                        <ServiceStatsPanel :stats="authStats" :loading="authLoading" :error="authError ?? undefined"
                            service-name="Auth Service" @refresh="fetchAuthStats" />
                    </v-tabs-window-item>

                    <!-- Inference Stats Tab -->
                    <v-tabs-window-item value="inference">
                        <ServiceStatsPanel :stats="inferenceStats" :loading="inferenceLoading"
                            :error="inferenceError ?? undefined" service-name="Inference Service"
                            @refresh="fetchInferenceStats" />
                    </v-tabs-window-item>

                    <!-- WS Stats Tab -->
                    <v-tabs-window-item value="ws">
                        <ServiceStatsPanel :stats="wsStats" :loading="wsLoading" :error="wsError ?? undefined"
                            service-name="WebSocket Service" @refresh="fetchWsStats">
                            <template #extra v-if="wsStats?.queries">
                                <v-divider class="my-3"></v-divider>
                                <div class="text-subtitle-2 mb-2">Query Metrics</div>
                                <v-table density="compact">
                                    <tbody>
                                        <tr>
                                            <td class="text-medium-emphasis">Queries/sec</td>
                                            <td class="font-weight-medium">{{
                                                wsStats.queries.queriesPerSecond?.current?.toFixed(1) }} (peak: {{
                                                    wsStats.queries.queriesPerSecond?.peak?.toFixed(1) }})</td>
                                        </tr>
                                        <tr>
                                            <td class="text-medium-emphasis">Total Queries</td>
                                            <td class="font-weight-medium">{{ wsStats.queries.totalQueries }}</td>
                                        </tr>
                                        <tr>
                                            <td class="text-medium-emphasis">Success Rate</td>
                                            <td class="font-weight-medium">{{ wsStats.queries.successRate?.toFixed(2)
                                            }}%</td>
                                        </tr>
                                    </tbody>
                                </v-table>
                            </template>
                        </ServiceStatsPanel>
                    </v-tabs-window-item>
                </v-tabs-window>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="grey" variant="text" @click="dialog = false">Close</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, defineComponent, h } from "vue";

const props = defineProps<{
    modelValue: boolean;
}>();

const emit = defineEmits(["update:modelValue"]);

const dialog = computed({
    get: () => props.modelValue,
    set: (val) => emit("update:modelValue", val),
});

const activeTab = ref("speedtest");

// =================== SPEED TEST ===================

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
const speedTestError = ref<string | null>(null);

const services = ref<ServiceResult[]>([
    { name: 'Asset', path: '/world/rest/asset', latency: null, downloadSpeed: null, uploadSpeed: null, status: 'pending' },
    { name: 'Auth', path: '/world/rest/auth', latency: null, downloadSpeed: null, uploadSpeed: null, status: 'pending' },
    { name: 'Inference', path: '/world/rest/inference', latency: null, downloadSpeed: null, uploadSpeed: null, status: 'pending' },
    { name: 'WS', path: '/world/rest/ws', latency: null, downloadSpeed: null, uploadSpeed: null, status: 'pending' },
]);

const DOWNLOAD_SIZE = 5 * 1024 * 1024; // 5MB
const UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB

const getBaseUrl = () => window.location.origin;

async function startSpeedTest() {
    isRunning.value = true;
    progress.value = 0;
    speedTestError.value = null;
    statusText.value = "Starting tests...";

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
                // Ping
                const startPing = performance.now();
                const pingRes = await fetch(`${baseUrl}${service.path}/speedtest/ping`);
                if (!pingRes.ok) throw new Error(`Ping failed: HTTP ${pingRes.status}`);
                await pingRes.text();
                service.latency = Math.round(performance.now() - startPing);
                completedSteps++;
                updateProgress();

                // Download
                const startDl = performance.now();
                const dlRes = await fetch(`${baseUrl}${service.path}/speedtest/download?size=${DOWNLOAD_SIZE}`);
                if (!dlRes.ok) throw new Error(`HTTP ${dlRes.status}`);
                await dlRes.arrayBuffer();
                const dlDurationSec = (performance.now() - startDl) / 1000;
                const dlMbps = (DOWNLOAD_SIZE * 8 / dlDurationSec) / (1024 * 1024);
                service.downloadSpeed = dlMbps.toFixed(2);
                completedSteps++;
                updateProgress();

                // Upload
                const randomData = new Uint8Array(UPLOAD_SIZE);
                for (let i = 0; i < UPLOAD_SIZE; i += 1024) {
                    randomData[i] = Math.floor(Math.random() * 255);
                }
                const startUl = performance.now();
                const ulRes = await fetch(`${baseUrl}${service.path}/speedtest/upload`, {
                    method: "POST",
                    body: randomData,
                    headers: { "Content-Type": "application/octet-stream" }
                });
                if (!ulRes.ok) throw new Error(`HTTP ${ulRes.status}`);
                const ulDurationSec = (performance.now() - startUl) / 1000;
                const ulMbps = (UPLOAD_SIZE * 8 / ulDurationSec) / (1024 * 1024);
                service.uploadSpeed = ulMbps.toFixed(2);
                completedSteps++;
                updateProgress();

                service.status = 'done';
            } catch (e: any) {
                console.error(`Error testing ${service.name}:`, e);
                service.status = 'error';
                completedSteps += (3 - (completedSteps % 3));
                updateProgress();
            }
        }
        progress.value = 100;
        statusText.value = "All Tests Complete";
    } catch (e: any) {
        console.error(e);
        speedTestError.value = "Test Suite Failed: " + (e.message || "Unknown error");
        statusText.value = "Error";
    } finally {
        isRunning.value = false;
    }
}

// =================== SERVICE STATS ===================

interface SystemMetrics {
    current: number;
    average: number;
    p99: number;
    p999: number;
}

interface BaseServiceStats {
    success?: boolean;
    uptime?: number;
    connections?: {
        active: SystemMetrics;
        total: number;
        failed: number;
        successRate: number;
    };
    database?: {
        connected: boolean;
        connections: SystemMetrics;
    };
    memory?: {
        heapUsed: SystemMetrics;
        heapTotal: SystemMetrics;
        external: SystemMetrics;
        rss: SystemMetrics;
    };
    cpu?: {
        user: SystemMetrics;
        system: SystemMetrics;
    };
    [key: string]: any;
}

// Asset stats
const assetStats = ref<BaseServiceStats | null>(null);
const assetLoading = ref(false);
const assetError = ref<string | null>(null);

async function fetchAssetStats() {
    assetLoading.value = true;
    assetError.value = null;
    try {
        const res = await fetch(`${getBaseUrl()}/world/rest/asset/stats`);
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            throw new Error(`Stats endpoint not available (got ${contentType.split(';')[0] || 'unknown'} instead of JSON)`);
        }
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${res.status}`);
        }
        assetStats.value = await res.json();
    } catch (e: any) {
        assetError.value = e.message || "Failed to fetch stats";
    } finally {
        assetLoading.value = false;
    }
}

// Auth stats
const authStats = ref<BaseServiceStats | null>(null);
const authLoading = ref(false);
const authError = ref<string | null>(null);

async function fetchAuthStats() {
    authLoading.value = true;
    authError.value = null;
    try {
        const res = await fetch(`${getBaseUrl()}/world/rest/auth/stats`);
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            throw new Error(`Stats endpoint not available (got ${contentType.split(';')[0] || 'unknown'} instead of JSON)`);
        }
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${res.status}`);
        }
        authStats.value = await res.json();
    } catch (e: any) {
        authError.value = e.message || "Failed to fetch stats";
    } finally {
        authLoading.value = false;
    }
}

// Inference stats
const inferenceStats = ref<BaseServiceStats | null>(null);
const inferenceLoading = ref(false);
const inferenceError = ref<string | null>(null);

async function fetchInferenceStats() {
    inferenceLoading.value = true;
    inferenceError.value = null;
    try {
        const res = await fetch(`${getBaseUrl()}/world/rest/inference/stats`);
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            throw new Error(`Stats endpoint not available (got ${contentType.split(';')[0] || 'unknown'} instead of JSON)`);
        }
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${res.status}`);
        }
        inferenceStats.value = await res.json();
    } catch (e: any) {
        inferenceError.value = e.message || "Failed to fetch stats";
    } finally {
        inferenceLoading.value = false;
    }
}

// WS stats
const wsStats = ref<BaseServiceStats | null>(null);
const wsLoading = ref(false);
const wsError = ref<string | null>(null);

async function fetchWsStats() {
    wsLoading.value = true;
    wsError.value = null;
    try {
        const res = await fetch(`${getBaseUrl()}/world/rest/ws/stats`);
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            throw new Error(`Stats endpoint not available (got ${contentType.split(';')[0] || 'unknown'} instead of JSON)`);
        }
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${res.status}`);
        }
        wsStats.value = await res.json();
    } catch (e: any) {
        wsError.value = e.message || "Failed to fetch stats";
    } finally {
        wsLoading.value = false;
    }
}

// =================== SERVICE STATS PANEL COMPONENT ===================

const ServiceStatsPanel = defineComponent({
    name: 'ServiceStatsPanel',
    props: {
        stats: { type: Object as () => BaseServiceStats | null, default: null },
        loading: { type: Boolean, default: false },
        error: { type: String, default: null },
        serviceName: { type: String, required: true },
    },
    emits: ['refresh'],
    setup(props, { emit, slots }) {
        const formatBytes = (bytes: number) => {
            if (bytes < 1024) return `${bytes.toFixed(0)} B`;
            if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
            return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        };

        const formatUptime = (seconds: number) => {
            const hrs = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
            if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
            if (mins > 0) return `${mins}m ${secs}s`;
            return `${secs}s`;
        };

        return () => {
            const children: any[] = [];

            // Refresh button
            children.push(
                h('div', { class: 'd-flex justify-end mb-4' }, [
                    h('v-btn', {
                        color: 'primary',
                        variant: 'tonal',
                        loading: props.loading,
                        onClick: () => emit('refresh'),
                    }, [
                        h('v-icon', { start: true }, 'mdi-refresh'),
                        'Fetch Stats'
                    ])
                ])
            );

            // Error
            if (props.error) {
                children.push(
                    h('v-alert', { type: 'error', density: 'compact', class: 'mb-4' }, props.error)
                );
            }

            // Loading
            if (props.loading && !props.stats) {
                children.push(
                    h('div', { class: 'd-flex justify-center align-center py-8' }, [
                        h('v-progress-circular', { indeterminate: true, color: 'primary' })
                    ])
                );
            }

            // Stats
            if (props.stats && !props.loading) {
                const rows: any[] = [];

                // Uptime
                if (props.stats.uptime !== undefined) {
                    rows.push(h('tr', [
                        h('td', { class: 'text-medium-emphasis' }, 'Uptime'),
                        h('td', { class: 'font-weight-medium' }, formatUptime(props.stats.uptime))
                    ]));
                }

                // Database
                if (props.stats.database) {
                    rows.push(h('tr', [
                        h('td', { class: 'text-medium-emphasis' }, 'Database'),
                        h('td', { class: 'font-weight-medium' }, [
                            h('v-chip', {
                                size: 'small',
                                color: props.stats.database.connected ? 'success' : 'error',
                            }, props.stats.database.connected ? 'Connected' : 'Disconnected')
                        ])
                    ]));
                }

                // Connections
                if (props.stats.connections) {
                    rows.push(h('tr', [
                        h('td', { class: 'text-medium-emphasis' }, 'Active Connections'),
                        h('td', { class: 'font-weight-medium' }, props.stats.connections.active?.current ?? 0)
                    ]));
                    rows.push(h('tr', [
                        h('td', { class: 'text-medium-emphasis' }, 'Total Connections'),
                        h('td', { class: 'font-weight-medium' }, props.stats.connections.total)
                    ]));
                    rows.push(h('tr', [
                        h('td', { class: 'text-medium-emphasis' }, 'Success Rate'),
                        h('td', { class: 'font-weight-medium' }, `${props.stats.connections.successRate?.toFixed(2)}%`)
                    ]));
                }

                // Memory
                if (props.stats.memory) {
                    rows.push(h('tr', [
                        h('td', { class: 'text-medium-emphasis' }, 'Heap Used'),
                        h('td', { class: 'font-weight-medium' }, formatBytes(props.stats.memory.heapUsed?.current ?? 0))
                    ]));
                    rows.push(h('tr', [
                        h('td', { class: 'text-medium-emphasis' }, 'Heap Total'),
                        h('td', { class: 'font-weight-medium' }, formatBytes(props.stats.memory.heapTotal?.current ?? 0))
                    ]));
                    rows.push(h('tr', [
                        h('td', { class: 'text-medium-emphasis' }, 'RSS'),
                        h('td', { class: 'font-weight-medium' }, formatBytes(props.stats.memory.rss?.current ?? 0))
                    ]));
                }

                // CPU
                if (props.stats.cpu) {
                    rows.push(h('tr', [
                        h('td', { class: 'text-medium-emphasis' }, 'CPU User'),
                        h('td', { class: 'font-weight-medium' }, `${((props.stats.cpu.user?.current ?? 0) / 1000000).toFixed(2)}s`)
                    ]));
                    rows.push(h('tr', [
                        h('td', { class: 'text-medium-emphasis' }, 'CPU System'),
                        h('td', { class: 'font-weight-medium' }, `${((props.stats.cpu.system?.current ?? 0) / 1000000).toFixed(2)}s`)
                    ]));
                }

                children.push(
                    h('v-table', { density: 'compact' }, [
                        h('tbody', rows)
                    ])
                );

                // Extra slot
                if (slots.extra) {
                    children.push(slots.extra());
                }
            }

            // No stats yet
            if (!props.stats && !props.loading && !props.error) {
                children.push(
                    h('v-alert', { type: 'info', density: 'compact', variant: 'tonal' },
                        `Click "Fetch Stats" to load ${props.serviceName} statistics.`
                    )
                );
            }

            return h('div', { class: 'pa-2' }, children);
        };
    }
});

</script>
