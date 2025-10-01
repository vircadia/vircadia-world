<template>
    <v-dialog v-model="dialogVisible" max-width="800px">
        <v-card class="webrtc-status" variant="elevated" color="surface">
            <v-card-title class="d-flex align-center">
                <span class="text-subtitle-1">WebRTC Status</span>
                <v-spacer />
                <v-btn icon size="small" variant="text" @click="refreshConnections" :loading="isRefreshing">
                    <v-icon>mdi-refresh</v-icon>
                </v-btn>
            </v-card-title>

            <v-card-text>
                <!-- Local Session Info -->
                <v-list dense>
                    <v-list-subheader>Local Session</v-list-subheader>
                    <v-list-item>
                        <v-list-item-title>
                            Session: {{ fullSessionId || 'Not connected' }}
                        </v-list-item-title>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>
                            Status:
                            <v-chip :color="isReady ? 'success' : 'warning'" size="small" variant="flat">
                                {{ isReady ? 'Ready' : 'Not Ready' }}
                            </v-chip>
                        </v-list-item-title>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>
                            Local Stream:
                            <v-chip :color="localStream ? 'success' : 'error'" size="small" variant="flat">
                                {{ localStream ? 'Active' : 'Inactive' }}
                            </v-chip>
                        </v-list-item-title>
                    </v-list-item>

                    <!-- Audio Context Status -->
                    <v-list-item v-if="localStream">
                        <v-list-item-title>
                            Audio Context:
                            <v-chip :color="audioContextResumed ? 'success' : 'warning'" size="small" variant="flat">
                                {{ audioContextResumed ? 'Resumed' : 'Suspended' }}
                            </v-chip>
                            <span v-if="!audioContextResumed" class="text-caption text-grey ml-2">
                                Click anywhere to enable audio
                            </span>
                        </v-list-item-title>
                    </v-list-item>

                    <!-- Debug Info Section -->
                    <v-list-item>
                        <v-list-item-title class="d-flex align-center">
                            <span class="text-caption mr-2">Debug Mode:</span>
                            <v-btn :icon="debugMode ? 'mdi-bug' : 'mdi-bug-off'" :color="debugMode ? 'warning' : 'grey'"
                                size="small" variant="flat" @click="toggleDebugMode" />
                            <v-btn v-if="debugMode" icon="mdi-refresh" size="small" variant="text"
                                @click="runDebugTests" :loading="isRunningDebugTests" class="ml-2">
                                <v-icon>mdi-test-tube</v-icon>
                            </v-btn>
                        </v-list-item-title>
                    </v-list-item>

                    <!-- Mic Controls -->
                    <v-list-item v-if="localStream">
                        <v-list-item-title class="d-flex align-center">
                            <span class="text-caption mr-2">Microphone:</span>
                            <v-btn :icon="isMuted ? 'mdi-microphone-off' : 'mdi-microphone'"
                                :color="isMuted ? 'error' : 'success'" size="small" variant="flat"
                                @click="toggleMute" />
                            <v-slider v-model="micVolume" :disabled="isMuted" class="ml-4" density="compact"
                                hide-details min="0" max="100" step="1" thumb-label style="max-width: 200px"
                                @update:model-value="updateMicVolume" />
                            <span class="ml-2 text-caption">{{ micVolume }}%</span>
                        </v-list-item-title>
                    </v-list-item>
                </v-list>

                <!-- Debug Panel (only show in debug mode) -->
                <v-card v-if="debugMode" variant="elevated" class="ma-2" color="surface">
                    <v-card-title class="text-caption pa-2">
                        <v-icon size="small" class="mr-1">mdi-bug</v-icon>
                        Debug Information
                    </v-card-title>
                    <v-card-text class="pa-2">
                        <v-row dense>
                            <v-col cols="6">
                                <v-list-item-title class="text-caption">
                                    <strong>Reflect API Status:</strong>
                                </v-list-item-title>
                                <v-chip :color="reflectApi.isInitialized.value ? 'success' : 'error'" size="x-small"
                                    variant="flat" class="mt-1">
                                    {{ reflectApi.isInitialized.value ? 'Initialized' : 'Not Initialized' }}
                                </v-chip>
                            </v-col>
                            <v-col cols="6">
                                <v-list-item-title class="text-caption">
                                    <strong>Active Peers (internal):</strong> {{ reflectApi.activePeers.value.size }}
                                </v-list-item-title>
                                <div v-if="reflectApi.activePeers.value.size > 0" class="text-caption text-grey mt-1">
                                    <div v-for="[peerId, announcement] in reflectApi.activePeers.value" :key="peerId">
                                        {{ peerId.substring(0, 8) }}... ({{ Math.floor((Date.now() -
                                            announcement.timestamp) / 1000) }}s ago)
                                    </div>
                                </div>
                            </v-col>
                        </v-row>

                        <v-row dense class="mt-2">
                            <v-col cols="6">
                                <v-list-item-title class="text-caption">
                                    <strong>Message Handlers:</strong> {{ reflectApiHandlersCount }}
                                </v-list-item-title>
                            </v-col>
                            <v-col cols="6">
                                <v-list-item-title class="text-caption">
                                    <strong>Sync Group:</strong> {{ reflectApiSyncGroup }}
                                </v-list-item-title>
                            </v-col>
                        </v-row>

                        <v-row dense class="mt-2">
                            <v-col cols="6">
                                <v-list-item-title class="text-caption">
                                    <strong>Reconnection:</strong>
                                    <v-chip :color="reflectApi.isReconnecting.value ? 'warning' : 'success'"
                                        size="x-small" variant="flat" class="ml-1">
                                        {{ reflectApi.isReconnecting.value ? `Attempt
                                        ${reflectApi.reconnectAttempts.value}` : 'Ready' }}
                                    </v-chip>
                                </v-list-item-title>
                            </v-col>
                            <v-col cols="6">
                                <v-list-item-title class="text-caption">
                                    <strong>Queued Messages:</strong>
                                    <v-chip :color="reflectApi.messageQueueSize.value > 0 ? 'warning' : 'success'"
                                        size="x-small" variant="flat" class="ml-1">
                                        {{ reflectApi.messageQueueSize.value }}
                                    </v-chip>
                                </v-list-item-title>
                            </v-col>
                        </v-row>

                        <v-row dense class="mt-2">
                            <v-col cols="6">
                                <v-list-item-title class="text-caption">
                                    <strong>Last Debug Test:</strong>
                                </v-list-item-title>
                                <div class="text-caption text-grey">
                                    {{ debugTestResults ? `${Math.floor((Date.now() - debugTestTimestamp) / 1000)}s ago`
                                        : 'Never' }}
                                </div>
                            </v-col>
                            <v-col cols="6">
                                <v-list-item-title class="text-caption">
                                    <strong>Network Status:</strong>
                                </v-list-item-title>
                                <v-chip :color="networkStatus" size="x-small" variant="flat">
                                    {{ networkStatus }}
                                </v-chip>
                            </v-col>
                            <v-col cols="6">
                                <v-list-item-title class="text-caption">
                                    <strong>Audio Quality:</strong>
                                </v-list-item-title>
                                <v-chip :color="bidirectionalAudioPeers > 0 ? 'success' : 'warning'" size="x-small"
                                    variant="flat">
                                    {{ bidirectionalAudioPeers }}/{{ peers.size }} bidirectional
                                </v-chip>
                            </v-col>
                        </v-row>

                        <v-row dense class="mt-2" v-if="debugTestResults">
                            <v-col cols="12">
                                <v-list-item-title class="text-caption">
                                    <strong>Test Results:</strong>
                                </v-list-item-title>
                                <pre class="text-caption text-grey mt-1 pa-1"
                                    style="background: #f5f5f5; border-radius: 4px; overflow-x: auto; font-size: 10px;">
{{ debugTestResults }}
                </pre>
                            </v-col>
                        </v-row>
                    </v-card-text>
                </v-card>

                <!-- Peer Connections -->
                <v-list dense>
                    <v-list-subheader>
                        Peer Connections ({{ peers.size }})
                        <v-chip size="x-small" class="ml-2" v-if="reflectApi.discoveredPeers.value.length > peers.size">
                            {{ reflectApi.discoveredPeers.value.length - peers.size }} discovered
                        </v-chip>
                        <v-chip size="x-small" class="ml-2" :color="bidirectionalAudioPeers > 0 ? 'success' : 'warning'"
                            variant="flat">
                            {{ bidirectionalAudioPeers }} bidirectional
                        </v-chip>
                    </v-list-subheader>

                    <v-list-item v-if="peers.size === 0">
                        <v-list-item-title class="text-caption text-grey">
                            No active connections
                        </v-list-item-title>
                    </v-list-item>

                    <!-- Use v-for with BabylonWebRTCPeer components -->
                    <v-expansion-panels v-if="peers.size > 0" variant="accordion">
                        <BabylonWebRTCPeer v-for="[peerId, peer] in peers" :key="peerId" :peer-id="peerId" :peer="peer"
                            :avatar-data="avatarDataMap?.[peerId]" :position-data="positionDataMap?.[peerId]"
                            :my-position="myPositionData" :volume="peerVolumes.get(peerId)"
                            :spatial-audio-node="spatialAudioNodes.get(peerId)" @disconnect="disconnectFromPeer(peerId)"
                            @debug="debugPeer(peerId)" @volume-change="(volume) => updatePeerVolume(peerId, volume)"
                            @spatial-node-created="(node) => handleSpatialNodeCreated(peerId, node)"
                            @spatial-node-removed="() => handleSpatialNodeRemoved(peerId)" />
                    </v-expansion-panels>
                </v-list>

                <!-- Discovered Peers (not connected) -->
                <v-list dense v-if="unconnectedPeers.length > 0">
                    <v-list-subheader>Discovered Peers</v-list-subheader>
                    <v-list-item v-for="peerId in unconnectedPeers" :key="`discovered-${peerId}`">
                        <v-list-item-title class="d-flex align-center">
                            <span class="text-caption">{{ peerId.substring(0, 16) }}...</span>
                            <v-spacer />
                            <v-btn size="small" variant="outlined" @click="connectToPeer(peerId)"
                                :loading="connectingPeers.has(peerId)">
                                Connect
                            </v-btn>
                        </v-list-item-title>
                    </v-list-item>
                </v-list>

                <!-- Debug Controls (only show in debug mode) -->
                <v-card v-if="debugMode" variant="elevated" class="ma-2" color="surface">
                    <v-card-title class="text-caption pa-2">
                        <v-icon size="small" class="mr-1">mdi-cog</v-icon>
                        Debug Controls
                    </v-card-title>
                    <v-card-text class="pa-2">
                        <v-row dense>
                            <v-col cols="6">
                                <v-btn size="small" variant="outlined" @click="manualAnnouncePresence"
                                    :disabled="!isReady" block>
                                    Announce Presence
                                </v-btn>
                            </v-col>
                            <v-col cols="6">
                                <v-btn size="small" variant="outlined" @click="forceRefreshPeers"
                                    :loading="isForceRefreshing" block>
                                    Refresh Peers
                                </v-btn>
                            </v-col>
                        </v-row>

                        <v-row dense class="mt-2">
                            <v-col cols="6">
                                <v-btn size="small" variant="outlined" @click="testReflectConnectivity"
                                    :loading="isTestingConnectivity" block>
                                    Test Connectivity
                                </v-btn>
                            </v-col>
                            <v-col cols="6">
                                <v-btn size="small" variant="outlined" @click="resumeAudioContext"
                                    :loading="isResumingAudio" block>
                                    Resume Audio
                                </v-btn>
                            </v-col>
                        </v-row>

                        <v-row dense class="mt-2">
                            <v-col cols="6">
                                <v-btn size="small" variant="outlined" @click="debugAudioProcessing"
                                    :loading="isDebuggingAudio" block>
                                    Debug Audio
                                </v-btn>
                            </v-col>
                            <v-col cols="6">
                                <v-btn size="small" variant="outlined" @click="checkAndRecoverAudioConnections"
                                    :disabled="peers.size === 0" block>
                                    Fix Audio
                                </v-btn>
                            </v-col>
                        </v-row>

                        <v-row dense class="mt-2">
                            <v-col cols="6">
                                <v-btn size="small" variant="outlined" @click="clearAllPeers"
                                    :disabled="peers.size === 0" block>
                                    Clear All Peers
                                </v-btn>
                            </v-col>
                            <v-col cols="6">
                                <v-btn size="small" variant="outlined" @click="runDebugTests"
                                    :loading="isRunningDebugTests" block>
                                    Run Diagnostics
                                </v-btn>
                            </v-col>
                        </v-row>

                        <v-row dense class="mt-2">
                            <v-col cols="6">
                                <v-btn size="small" variant="outlined" @click="forceReconnectToSelectedPeer"
                                    :disabled="!debugTestPeerId || connectingPeers.has(debugTestPeerId)" block>
                                    Force Reconnect
                                </v-btn>
                            </v-col>
                            <v-col cols="6">
                                <v-btn size="small" variant="outlined" @click="refreshConnections"
                                    :loading="isRefreshing" block>
                                    Refresh All
                                </v-btn>
                            </v-col>
                        </v-row>

                        <v-row dense class="mt-2">
                            <v-col cols="6">
                                <v-btn size="small" variant="outlined" @click="fixStuckConnections"
                                    :disabled="peers.size === 0" block>
                                    Fix Stuck Connections
                                </v-btn>
                            </v-col>
                            <v-col cols="6">
                                <v-btn size="small" variant="outlined" @click="checkNegotiationState"
                                    :disabled="peers.size === 0" block>
                                    Check Negotiation
                                </v-btn>
                            </v-col>
                        </v-row>

                        <v-row dense class="mt-2">
                            <v-col cols="6">
                                <v-btn size="small" variant="outlined" @click="checkIceCandidateIssues"
                                    :disabled="peers.size === 0" block>
                                    Check ICE Issues
                                </v-btn>
                            </v-col>
                            <v-col cols="6">
                                <v-btn size="small" variant="outlined" @click="checkAndRecoverAudioConnections"
                                    :disabled="peers.size === 0" block>
                                    Fix Audio
                                </v-btn>
                            </v-col>
                        </v-row>

                        <v-row dense class="mt-2">
                            <v-col cols="12">
                                <v-text-field v-model="debugTestPeerId" label="Test Peer ID"
                                    placeholder="Enter session ID to test..." dense hide-details />
                            </v-col>
                        </v-row>

                        <v-row dense class="mt-2">
                            <v-col cols="6">
                                <v-btn size="small" variant="outlined" @click="sendTestMessage"
                                    :disabled="!debugTestPeerId" block>
                                    Send Test Message
                                </v-btn>
                            </v-col>
                            <v-col cols="6">
                                <v-btn size="small" variant="outlined" @click="pingTestPeer"
                                    :disabled="!debugTestPeerId" block>
                                    Ping Test Peer
                                </v-btn>
                            </v-col>
                        </v-row>
                    </v-card-text>
                </v-card>
            </v-card-text>
        </v-card>
    </v-dialog>
</template>

<script setup lang="ts">
import type {
    AvatarBaseData,
    AvatarPositionData,
    AvatarRotationData,
    PeerInfo,
} from "@schemas";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";
import {
    useWebRTCReflect,
    type WebRTCReflectMessage,
} from "@/composables/useWebRTCReflect";
import { useWebRTCSpatialAudio } from "@/composables/useWebRTCSpatialAudio";
import BabylonWebRTCPeer from "./BabylonWebRTCPeer.vue";

interface Props {
    vircadiaWorld: VircadiaWorldInstance;
    // Avatar data streams
    avatarDataMap?: Record<string, AvatarBaseData>;
    positionDataMap?: Record<string, AvatarPositionData>;
    rotationDataMap?: Record<string, AvatarRotationData>;
    // My position for spatial audio
    myPositionData?: AvatarPositionData | null;
    myCameraOrientation?: {
        alpha: number;
        beta: number;
        radius: number;
    } | null;
    // Audio state callbacks
    onSetPeerAudioState?: (
        sessionId: string,
        state: Partial<{
            volume: number;
            isMuted: boolean;
            isReceiving: boolean;
            isSending: boolean;
        }>,
    ) => void;
    onRemovePeerAudioState?: (sessionId: string) => void;
    // Dialog visibility
    modelValue?: boolean;
    // WebRTC sync group - should match other avatar communication
    webrtcSyncGroup?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
    "update:modelValue": [value: boolean];
    permissions: [
        {
            microphone: "granted" | "denied" | "prompt" | "unknown";
            audioContext: "resumed" | "suspended" | "unknown";
            localStreamActive: boolean;
        },
    ];
}>();

// Dialog visibility
const dialogVisible = computed({
    get: () => props.modelValue ?? false,
    set: (value: boolean) => emit("update:modelValue", value),
});

// Core refs
const vircadiaWorld = props.vircadiaWorld;
const fullSessionId = computed(
    () => vircadiaWorld.connectionInfo.value.fullSessionId ?? null,
);

// WebRTC state
const peers = ref<Map<string, PeerInfo>>(new Map());
const localStream = ref<MediaStream | null>(null);
const isMuted = ref(false);
const micVolume = ref(100);
const peerVolumes = ref<Map<string, number>>(new Map());
const spatialAudioNodes = ref<Map<string, HTMLAudioElement>>(new Map());
const connectingPeers = ref<Set<string>>(new Set());
const isRefreshing = ref(false);
const registeredMessageHandlers = ref<Set<string>>(new Set());

// Connection recovery state
const peerRecoveryAttempts = ref<Map<string, number>>(new Map());
const peerRecoveryTimeouts = ref<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
);
const maxRecoveryAttempts = 3;
const recoveryBackoffMs = [1000, 2000, 5000]; // Progressive backoff

// Negotiation state tracking
// REMOVED: negotiationTimeouts - not needed with perfect negotiation

// Debug state
const debugMode = ref(false);
const isRunningDebugTests = ref(false);
const isForceRefreshing = ref(false);
const isTestingConnectivity = ref(false);
const isResumingAudio = ref(false);
const isDebuggingAudio = ref(false);
const debugTestPeerId = ref("");
const debugTestResults = ref<string>("");
const debugTestTimestamp = ref<number>(0);
const networkStatus = ref<"unknown" | "online" | "offline">("unknown");
const audioContextResumed = ref(false);

// Microphone permission state
const microphonePermission = ref<"granted" | "denied" | "prompt" | "unknown">(
    "unknown",
);

function emitPermissionState() {
    const audioState: "resumed" | "suspended" | "unknown" =
        audioContextResumed.value
            ? "resumed"
            : spatialAudio.isInitialized.value
                ? "suspended"
                : "unknown";
    emit("permissions", {
        microphone: microphonePermission.value,
        audioContext: audioState,
        localStreamActive: !!localStream.value,
    });
}

async function queryMicrophonePermission() {
    try {
        if (
            "permissions" in navigator &&
            (navigator as any).permissions?.query
        ) {
            const status = await (navigator as any).permissions.query({
                name: "microphone" as PermissionName,
            });
            microphonePermission.value = status.state as
                | "granted"
                | "denied"
                | "prompt";
            emitPermissionState();
            status.onchange = () => {
                microphonePermission.value = status.state as
                    | "granted"
                    | "denied"
                    | "prompt";
                emitPermissionState();
            };
        } else {
            // Fallback when Permissions API is unavailable
            microphonePermission.value = localStream.value
                ? "granted"
                : "unknown";
            emitPermissionState();
        }
    } catch {
        microphonePermission.value = "unknown";
        emitPermissionState();
    }
}

// WebRTC configuration with TURN servers for NAT traversal
const rtcConfig: RTCConfiguration = {
    iceServers: [
        // STUN servers for basic connectivity
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        { urls: "stun:stun.services.mozilla.com" },
        // Add TURN servers if available (replace with your actual TURN server URLs)
        // { urls: 'turn:your-turn-server.com:3478', username: 'user', credential: 'pass' },
        // { urls: 'turn:your-turn-server.com:3478?transport=tcp', username: 'user', credential: 'pass' },
    ],
    iceCandidatePoolSize: 10,
    iceTransportPolicy: "all", // Try all candidates, not just relay
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
};

// Add ICE candidate debugging
function setupIceCandidateDebugging(peerId: string, pc: RTCPeerConnection) {
    let candidateCount = 0;
    let localCandidates: RTCIceCandidate[] = [];
    let remoteCandidates: RTCIceCandidate[] = [];

    // Override the onicecandidate handler to add debugging
    const originalHandler = pc.onicecandidate;
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            candidateCount++;
            localCandidates.push(event.candidate);

            console.log(
                `[WebRTC ICE] ${peerId}: ICE candidate ${candidateCount}:`,
                {
                    type: event.candidate.type,
                    protocol: event.candidate.protocol,
                    address: event.candidate.address,
                    port: event.candidate.port,
                    candidate: event.candidate.candidate,
                    foundation: event.candidate.foundation,
                    priority: event.candidate.priority,
                    component: event.candidate.component,
                },
            );

            // Log detailed candidate info
            if (event.candidate.type === "srflx") {
                console.log(
                    `[WebRTC ICE] ${peerId}: Server-reflexive candidate found - this is good for NAT traversal`,
                );
            } else if (event.candidate.type === "relay") {
                console.log(
                    `[WebRTC ICE] ${peerId}: Relay candidate found - using TURN server`,
                );
            } else if (event.candidate.type === "host") {
                console.log(
                    `[WebRTC ICE] ${peerId}: Host candidate found - direct connection`,
                );
            }
        } else {
            console.log(
                `[WebRTC ICE] ${peerId}: ICE candidate gathering completed. Total candidates: ${candidateCount}`,
            );
            console.log(`[WebRTC ICE] ${peerId}: Candidate summary:`, {
                total: candidateCount,
                host: localCandidates.filter((c) => c.type === "host").length,
                srflx: localCandidates.filter((c) => c.type === "srflx").length,
                relay: localCandidates.filter((c) => c.type === "relay").length,
                prflx: localCandidates.filter((c) => c.type === "prflx").length,
            });

            // Warn if no candidates found
            if (candidateCount === 0) {
                console.warn(
                    `[WebRTC ICE] ${peerId}: NO ICE CANDIDATES GENERATED! This indicates a serious connectivity issue.`,
                );
                console.warn(`[WebRTC ICE] ${peerId}: Possible causes: `);
                console.warn(`  - Network interface issues`);
                console.warn(`  - Firewall blocking STUN/TURN`);
                console.warn(`  - WebRTC not properly initialized`);
                console.warn(`  - Browser security restrictions`);
            }
        }

        // Call original handler if it exists
        if (originalHandler) {
            originalHandler.call(pc, event);
        }
    };

    // Monitor ICE gathering state changes
    pc.onicegatheringstatechange = () => {
        console.log(
            `[WebRTC ICE] ${peerId}: ICE gathering state changed to: ${pc.iceGatheringState} (${candidateCount} candidates so far)`,
        );

        if (pc.iceGatheringState === "complete" && candidateCount === 0) {
            console.error(
                `[WebRTC ICE] ${peerId}: ICE gathering completed with 0 candidates!`,
            );
        }
    };

    // Monitor ICE connection state changes
    pc.oniceconnectionstatechange = () => {
        console.log(
            `[WebRTC ICE] ${peerId}: ICE connection state changed to: ${pc.iceConnectionState} (${candidateCount} local candidates)`,
        );

        if (pc.iceConnectionState === "failed" && candidateCount === 0) {
            console.error(
                `[WebRTC ICE] ${peerId}: ICE connection failed with no candidates - this is a critical issue`,
            );
        }
    };

    return { candidateCount, localCandidates, remoteCandidates };
}

// Initialize Reflect API for WebRTC signaling
const reflectApi = useWebRTCReflect(vircadiaWorld, fullSessionId, {
    syncGroup: props.webrtcSyncGroup ?? "public.NORMAL", // Use passed sync group or default to 'webrtc'
    announceIntervalMs: 5000,
    presenceTimeoutMs: 15000,
});

// Initialize spatial audio
const spatialAudio = useWebRTCSpatialAudio(
    {
        refDistance: 1,
        maxDistance: 30,
        rolloffFactor: 2,
        panningModel: "HRTF",
        distanceModel: "inverse",
    },
    {
        myPosition: computed(() => props.myPositionData ?? null),
        myCameraOrientation: computed(() => props.myCameraOrientation ?? null),
        otherPositions: computed(() => props.positionDataMap ?? {}),
    },
);

// Add audio context resume functionality
async function ensureAudioContextResumed() {
    if (spatialAudio.isInitialized.value) {
        const resumed = await spatialAudio.resumeContext();
        if (resumed) {
            console.log("[WebRTC] Audio context resumed successfully");
            audioContextResumed.value = true;
            emitPermissionState();
        } else {
            console.warn(
                "[WebRTC] Audio context could not be resumed - user interaction may be required",
            );
            audioContextResumed.value = false;
            emitPermissionState();
        }
        return resumed;
    }
    return false;
}

// Set up user interaction handlers for audio context resume
function setupUserInteractionHandlers() {
    const handleUserInteraction = async () => {
        await ensureAudioContextResumed();
    };

    // Add event listeners for various user interactions
    const events = [
        "click",
        "keydown",
        "touchstart",
        "mousedown",
        "pointerdown",
    ];
    events.forEach((event) => {
        document.addEventListener(event, handleUserInteraction, {
            once: false,
        });
    });

    console.log(
        "[WebRTC] User interaction handlers set up for audio context resume",
    );
}

// Check audio context state periodically
function setupAudioContextStateMonitoring() {
    if (spatialAudio.isInitialized.value) {
        // Check immediately
        updateAudioContextState();

        // Check every 2 seconds
        const interval = setInterval(updateAudioContextState, 2000);

        // Clean up interval on unmount
        onUnmounted(() => {
            clearInterval(interval);
        });
    }
}

function updateAudioContextState() {
    // This function will be called to check if the audio context is running
    // For now, we'll assume it's running if spatial audio is initialized
    // In a real implementation, you'd need to expose the audio context state from the composable
    if (spatialAudio.isInitialized.value) {
        audioContextResumed.value = true; // Assume resumed if initialized
    }
}

// Computed
const isReady = computed(
    () =>
        !!fullSessionId.value &&
        reflectApi.isInitialized.value &&
        !!localStream.value,
);

const unconnectedPeers = computed(() => {
    const discovered = reflectApi.discoveredPeers.value;
    return discovered.filter((peerId) => !peers.value.has(peerId));
});

const bidirectionalAudioPeers = computed(() => {
    let count = 0;
    for (const peer of peers.value.values()) {
        const senders = peer.pc.getSenders();
        const receivers = peer.pc.getReceivers();

        const isSending = senders.some(
            (sender) =>
                sender.track?.kind === "audio" &&
                sender.track.readyState === "live" &&
                sender.track.enabled,
        );

        const isReceiving = receivers.some(
            (receiver) =>
                receiver.track?.kind === "audio" &&
                receiver.track.readyState === "live",
        );

        if (isSending && isReceiving) {
            count++;
        }
    }
    return count;
});

// Debug computed properties
const reflectApiHandlersCount = computed(() => {
    // Access the internal messageHandlers from reflectApi
    // This is a workaround since it's not exposed in the API
    return Object.keys(reflectApi).filter(
        (key) => key.includes("handler") || key.includes("Handler"),
    ).length;
});

const reflectApiSyncGroup = computed(() => {
    // Try to access sync group from reflect API
    return (reflectApi as any).syncGroup || "default";
});

// Initialize WebRTC
async function initialize() {
    if (!fullSessionId.value) {
        console.warn("[WebRTC] Cannot initialize: no session ID");
        return;
    }

    try {
        // Query permission as early as possible
        await queryMicrophonePermission();
        // Initialize spatial audio
        spatialAudio.initialize();

        // Get user media
        localStream.value = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
            video: false,
        });

        console.log("[WebRTC] Got local media stream");
        // If we successfully got media, permission is effectively granted
        if (localStream.value) {
            microphonePermission.value = "granted";
            emitPermissionState();
        }

        // Initialize Reflect API
        await reflectApi.initialize();

        // Start automatic peer discovery and connection
        startPeerDiscovery();
    } catch (err) {
        console.error("[WebRTC] Failed to initialize:", err);
        // If getUserMedia failed, update permission state (could be denied)
        if (
            typeof (err as any)?.name === "string" &&
            (err as any).name === "NotAllowedError"
        ) {
            microphonePermission.value = "denied";
        }
        emitPermissionState();
    }
}

// Start automatic peer discovery
function startPeerDiscovery() {
    // Watch for discovered peers with immediate execution
    watch(
        () => reflectApi.discoveredPeers.value,
        (discovered) => {
            console.log(
                "[WebRTC] Peer discovery update:",
                discovered.length,
                "peers discovered",
            );

            // Auto-connect to new peers
            for (const peerId of discovered) {
                if (
                    !peers.value.has(peerId) &&
                    !connectingPeers.value.has(peerId)
                ) {
                    console.log(
                        `[WebRTC] Attempting to connect to discovered peer: ${peerId}`,
                    );
                    connectToPeer(peerId);
                }
            }

            // Clean up disconnected peers - only remove if they're not announcing AND connection is failed/closed
            for (const [peerId] of [...peers.value.keys()]) {
                if (!discovered.includes(peerId)) {
                    console.log(
                        `[WebRTC] Peer ${peerId} is no longer announcing, checking connection state...`,
                    );
                    const peer = peers.value.get(peerId);
                    if (
                        peer &&
                        (peer.pc.connectionState === "failed" ||
                            peer.pc.connectionState === "closed")
                    ) {
                        console.log(
                            `[WebRTC] Removing failed/closed peer: ${peerId}`,
                        );
                        disconnectFromPeer(peerId);
                    } else if (peer) {
                        console.log(
                            `[WebRTC] Peer ${peerId} still has active connection (${peer.pc.connectionState}), keeping`,
                        );
                    }
                }
            }

            // Clean up stale message handlers for peers that are truly gone
            cleanupStaleMessageHandlers(discovered);
        },
        { immediate: true },
    );
}

// Clean up message handlers for peers that are no longer announcing and not connected
function cleanupStaleMessageHandlers(discoveredPeers: string[]) {
    // Get all currently registered message handlers from our local tracking
    for (const handlerPeerId of registeredMessageHandlers.value) {
        // Skip if peer is currently connected
        if (peers.value.has(handlerPeerId)) {
            continue;
        }

        // Skip if peer is still announcing
        if (discoveredPeers.includes(handlerPeerId)) {
            continue;
        }

        // Skip if peer is currently connecting
        if (connectingPeers.value.has(handlerPeerId)) {
            continue;
        }

        // If we reach here, the peer is not connected, not announcing, and not connecting
        // This means they're truly gone, so we can safely remove the message handler
        console.log(
            `[WebRTC] Cleaning up stale message handler for ${handlerPeerId}`,
        );
        reflectApi.unregisterMessageHandler(handlerPeerId);
        registeredMessageHandlers.value.delete(handlerPeerId);
    }
}

// Connect to a peer
async function connectToPeer(remoteSessionId: string) {
    if (!fullSessionId.value) {
        return;
    }

    // If we already have a connection, don't create another one
    if (peers.value.has(remoteSessionId)) {
        console.log(
            `[WebRTC] Already have connection to peer ${remoteSessionId}, skipping`,
        );
        return;
    }

    connectingPeers.value.add(remoteSessionId);

    try {
        console.log(`[WebRTC] Connecting to peer: ${remoteSessionId}`);

        const pc = new RTCPeerConnection(rtcConfig);

        // Create peer info
        const peerInfo: PeerInfo = {
            pc,
            polite: fullSessionId.value < remoteSessionId,
            localStream: localStream.value,
            remoteStream: null,
            dataChannel: null,
            makingOffer: false,
            ignoreOffer: false,
            isSettingRemoteAnswerPending: false,
        };

        peers.value.set(remoteSessionId, peerInfo);

        // Set up ICE candidate debugging
        const iceDebugData = setupIceCandidateDebugging(remoteSessionId, pc);

        // Log initial setup
        console.log(
            `[WebRTC ICE] ${remoteSessionId}: ICE debugging initialized`,
            {
                candidateCount: iceDebugData.candidateCount,
                iceServers: rtcConfig.iceServers?.length || 0,
            },
        );

        // Set up perfect negotiation BEFORE adding tracks
        setupPerfectNegotiation(remoteSessionId, pc, peerInfo);

        // Register message handler BEFORE adding tracks
        reflectApi.registerMessageHandler(remoteSessionId, (msg) => {
            handlePeerMessage(remoteSessionId, msg);
        });
        registeredMessageHandlers.value.add(remoteSessionId);

        // Add local stream AFTER setting up negotiation and message handlers
        // This ensures offers can be sent when onnegotiationneeded fires
        if (localStream.value) {
            for (const track of localStream.value.getTracks()) {
                pc.addTrack(track, localStream.value);
            }
        }

        console.log(
            `[WebRTC] Connection setup completed for ${remoteSessionId}`,
        );
    } catch (err) {
        console.error(
            `[WebRTC] Failed to connect to peer ${remoteSessionId}:`,
            err,
        );
        peers.value.delete(remoteSessionId);
    } finally {
        connectingPeers.value.delete(remoteSessionId);
    }
}

// Set up perfect negotiation for a peer
function setupPerfectNegotiation(
    remoteSessionId: string,
    pc: RTCPeerConnection,
    peerInfo: PeerInfo,
) {
    // Handle negotiation needed - following perfect negotiation pattern
    pc.onnegotiationneeded = async () => {
        try {
            console.log(
                `[WebRTC] Negotiation needed for ${remoteSessionId}, current state:`,
                {
                    signalingState: pc.signalingState,
                    iceState: pc.iceConnectionState,
                    polite: peerInfo.polite,
                    isInitialized: reflectApi.isInitialized.value,
                    hasMessageHandler:
                        registeredMessageHandlers.value.has(remoteSessionId),
                },
            );

            // Set makingOffer immediately before setLocalDescription to prevent races
            peerInfo.makingOffer = true;
            await pc.setLocalDescription(); // Let WebRTC create the appropriate offer
            peerInfo.makingOffer = false; // Reset immediately after setLocalDescription

            console.log(
                `[WebRTC] Created ${pc.localDescription?.type} for ${remoteSessionId}, sending...`,
            );

            // Send the offer through signaling
            await reflectApi
                .sendOffer(remoteSessionId, pc.localDescription!.sdp)
                .catch((err: unknown) => {
                    console.error(
                        `[WebRTC] Failed to send offer to ${remoteSessionId}:`,
                        err,
                    );
                });

            console.log(`[WebRTC] Sent offer to ${remoteSessionId}`);
        } catch (err) {
            console.error("[WebRTC] Negotiation failed:", err);
            peerInfo.makingOffer = false; // Ensure flag is reset on error
        }
    };

    // Handle ICE candidates
    pc.onicecandidate = ({ candidate }) => {
        reflectApi.sendIceCandidate(remoteSessionId, candidate);
    };

    // Handle tracks
    pc.ontrack = ({ streams }) => {
        const [remoteStream] = streams;
        peerInfo.remoteStream = remoteStream;

        console.log(
            `[WebRTC] Received remote stream from ${remoteSessionId}:`,
            {
                tracks: remoteStream
                    .getTracks()
                    .map((t) => `${t.kind}(${t.readyState})`),
                id: remoteStream.id,
            },
        );

        // Ensure audio context is resumed when we receive audio
        ensureAudioContextResumed();

        // Create spatial audio node
        try {
            handleSpatialNodeCreated(remoteSessionId, new Audio());
        } catch (err) {
            console.error(`[WebRTC] Failed to create spatial audio node:`, err);
        }

        // Notify audio state
        props.onSetPeerAudioState?.(remoteSessionId, {
            isReceiving: true,
            isSending: true,
        });
    };

    // Connection state monitoring - simplified for perfect negotiation
    pc.onconnectionstatechange = () => {
        console.log(
            `[WebRTC] Peer ${remoteSessionId} connection state: ${pc.connectionState} (ICE: ${pc.iceConnectionState})`,
        );

        switch (pc.connectionState) {
            case "connected":
                // Clear any recovery attempts on successful connection
                peerRecoveryAttempts.value.delete(remoteSessionId);
                console.log(
                    `[WebRTC] Peer ${remoteSessionId} successfully connected`,
                );
                break;

            case "failed":
                console.log(
                    `[WebRTC] Connection failed for ${remoteSessionId}`,
                );
                // With perfect negotiation, peer discovery will handle reconnection
                // Clean disconnect to avoid complex recovery that can interfere
                disconnectFromPeer(remoteSessionId);
                break;

            case "closed":
                console.log(
                    `[WebRTC] Peer ${remoteSessionId} connection closed`,
                );
                disconnectFromPeer(remoteSessionId);
                break;
        }
    };

    // ICE connection state monitoring - simplified for perfect negotiation
    pc.oniceconnectionstatechange = () => {
        console.log(
            `[WebRTC] Peer ${remoteSessionId} ICE connection state: ${pc.iceConnectionState}`,
        );

        // For perfect negotiation, we rely on the connection state handler
        // and avoid complex ICE restart logic that can interfere
    };
}

// Handle incoming peer messages
async function handlePeerMessage(
    remoteSessionId: string,
    msg: WebRTCReflectMessage,
) {
    console.log(`[WebRTC] Received message from ${remoteSessionId}:`, {
        type: msg.type,
        hasPeerInfo: peers.value.has(remoteSessionId),
    });

    let peerInfo = peers.value.get(remoteSessionId);

    // If we don't have a peer connection but received a message, try to create one
    if (!peerInfo) {
        console.log(
            `[WebRTC] Received ${msg.type} from ${remoteSessionId} but no active connection. Attempting to reconnect...`,
        );

        // Check if this peer is in discovered peers (they're announcing presence)
        if (
            reflectApi.discoveredPeers.value.includes(remoteSessionId) &&
            !connectingPeers.value.has(remoteSessionId)
        ) {
            console.log(
                `[WebRTC] Peer ${remoteSessionId} is discovered and announcing, creating new connection...`,
            );
            await connectToPeer(remoteSessionId);
            peerInfo = peers.value.get(remoteSessionId);

            if (!peerInfo) {
                console.log(
                    `[WebRTC] Failed to create connection for ${remoteSessionId}`,
                );
                return;
            }
        } else {
            console.log(
                `[WebRTC] Ignoring ${msg.type} from ${remoteSessionId} - peer not discovered or already connecting`,
            );
            return;
        }
    }

    const pc = peerInfo.pc;

    try {
        switch (msg.type) {
            case "offer": {
                console.log(
                    `[WebRTC] Received offer from ${remoteSessionId}, current state:`,
                    {
                        signalingState: pc.signalingState,
                        iceState: pc.iceConnectionState,
                        polite: peerInfo.polite,
                    },
                );

                // Perfect negotiation collision detection
                const readyForOffer =
                    !peerInfo.makingOffer &&
                    (pc.signalingState === "stable" ||
                        peerInfo.isSettingRemoteAnswerPending);
                const offerCollision = !!msg.payload.sdp && !readyForOffer;

                peerInfo.ignoreOffer = !peerInfo.polite && offerCollision;
                if (peerInfo.ignoreOffer) {
                    console.log(
                        `[WebRTC] Ignoring offer due to collision (impolite peer)`,
                    );
                    return;
                }

                // Set the remote description
                await pc.setRemoteDescription({
                    type: "offer",
                    sdp: msg.payload.sdp as string,
                });

                // Create and send answer using simplified pattern
                await pc.setLocalDescription(); // Let WebRTC create the answer
                await reflectApi
                    .sendAnswer(remoteSessionId, pc.localDescription!.sdp)
                    .catch((err: unknown) => {
                        console.error(
                            `[WebRTC] Failed to send answer to ${remoteSessionId}:`,
                            err,
                        );
                    });

                console.log(`[WebRTC] Sent answer to ${remoteSessionId}`);
                break;
            }

            case "answer": {
                console.log(
                    `[WebRTC] Received answer from ${remoteSessionId}, current state:`,
                    {
                        signalingState: pc.signalingState,
                        iceState: pc.iceConnectionState,
                        connectionState: pc.connectionState,
                    },
                );

                // Mark that we're setting a remote answer to handle glare scenarios
                peerInfo.isSettingRemoteAnswerPending = true;
                await pc.setRemoteDescription({
                    type: "answer",
                    sdp: msg.payload.sdp as string,
                });
                peerInfo.isSettingRemoteAnswerPending = false;

                console.log(
                    `[WebRTC] Successfully set remote answer from ${remoteSessionId}`,
                );
                break;
            }

            case "ice-candidate": {
                const candidateData = msg.payload.candidate as string | null;
                if (candidateData) {
                    try {
                        const candidate = JSON.parse(candidateData);
                        await pc.addIceCandidate(candidate);
                    } catch (err) {
                        // If we ignored an offer, we may get ICE candidates for it - that's expected
                        if (!peerInfo.ignoreOffer) {
                            console.error(
                                `[WebRTC] Failed to add ICE candidate from ${remoteSessionId}:`,
                                err,
                            );
                        }
                    }
                }
                break;
            }

            case "session-end": {
                disconnectFromPeer(remoteSessionId);
                break;
            }
        }
    } catch (err) {
        console.error(
            `[WebRTC] Error handling message from ${remoteSessionId}:`,
            err,
        );
    }
}

// Attempt to recover a peer connection
async function attemptPeerRecovery(remoteSessionId: string) {
    const peerInfo = peers.value.get(remoteSessionId);
    if (!peerInfo) return;

    console.log(`[WebRTC] Attempting recovery for peer: ${remoteSessionId}`);

    try {
        // Don't attempt recovery if we're already connecting
        if (connectingPeers.value.has(remoteSessionId)) {
            console.log(
                `[WebRTC] Already connecting to ${remoteSessionId}, skipping recovery`,
            );
            return;
        }

        // Close existing connection
        peerInfo.pc.close();

        // Create new peer connection
        const pc = new RTCPeerConnection(rtcConfig);

        // Update peer info
        peerInfo.pc = pc;
        peerInfo.remoteStream = null;
        peerInfo.makingOffer = false;
        peerInfo.ignoreOffer = false;
        peerInfo.isSettingRemoteAnswerPending = false;

        // Set up ICE candidate debugging
        const iceDebugDataRecovery = setupIceCandidateDebugging(
            remoteSessionId,
            pc,
        );

        // Log recovery setup
        console.log(
            `[WebRTC ICE] ${remoteSessionId}: ICE debugging initialized for recovery`,
            {
                candidateCount: iceDebugDataRecovery.candidateCount,
                iceServers: rtcConfig.iceServers?.length || 0,
            },
        );

        // Set up perfect negotiation BEFORE adding tracks
        setupPerfectNegotiation(remoteSessionId, pc, peerInfo);

        // Re-register message handler BEFORE adding tracks
        reflectApi.registerMessageHandler(remoteSessionId, (msg) => {
            handlePeerMessage(remoteSessionId, msg);
        });

        // Add local stream AFTER setting up negotiation and message handlers
        if (localStream.value) {
            for (const track of localStream.value.getTracks()) {
                pc.addTrack(track, localStream.value);
            }
        }

        console.log(
            `[WebRTC] Recovery attempt completed for ${remoteSessionId}`,
        );
    } catch (err) {
        console.error(
            `[WebRTC] Failed to recover peer ${remoteSessionId}:`,
            err,
        );
        disconnectFromPeer(remoteSessionId);
    }
}

// REMOVED: setupNegotiationTimeout and attemptNegotiationRecovery
// These functions are not needed with proper perfect negotiation pattern.
// Perfect negotiation handles all cases without complex timeout/recovery logic.

// Disconnect from a peer (final cleanup)
function disconnectFromPeer(remoteSessionId: string) {
    const peerInfo = peers.value.get(remoteSessionId);
    if (!peerInfo) return;

    console.log(`[WebRTC] Disconnecting from peer: ${remoteSessionId}`);

    // Clear any pending recovery attempts
    const timeout = peerRecoveryTimeouts.value.get(remoteSessionId);
    if (timeout) {
        clearTimeout(timeout);
        peerRecoveryTimeouts.value.delete(remoteSessionId);
    }
    peerRecoveryAttempts.value.delete(remoteSessionId);

    // Clear negotiation timeout
    // Perfect negotiation handles cleanup automatically

    // Send session end
    reflectApi.sendSessionEnd(remoteSessionId).catch(() => { });

    // Only unregister message handler if peer is not in discovered peers (truly gone)
    // If they're still announcing, keep the handler so we can reconnect
    if (!reflectApi.discoveredPeers.value.includes(remoteSessionId)) {
        reflectApi.unregisterMessageHandler(remoteSessionId);
        registeredMessageHandlers.value.delete(remoteSessionId);
        console.log(
            `[WebRTC] Unregistered message handler for ${remoteSessionId} (peer not announcing)`,
        );
    } else {
        console.log(
            `[WebRTC] Keeping message handler for ${remoteSessionId} (peer still announcing)`,
        );
    }

    // Clean up spatial audio
    handleSpatialNodeRemoved(remoteSessionId);

    // Close peer connection
    peerInfo.pc.close();

    // Remove from peers
    peers.value.delete(remoteSessionId);

    // Notify audio state removal
    props.onRemovePeerAudioState?.(remoteSessionId);
}

// Handle spatial audio node creation
function handleSpatialNodeCreated(peerId: string, node: HTMLAudioElement) {
    const peerInfo = peers.value.get(peerId);
    if (!peerInfo?.remoteStream) return;

    try {
        const audioNode = spatialAudio.createPeerAudioNode(
            peerId,
            peerInfo.remoteStream,
            peerVolumes.value.get(peerId) ?? 100,
        );
        spatialAudioNodes.value.set(peerId, audioNode);
    } catch (err) {
        console.error(
            `[WebRTC] Failed to create spatial audio for ${peerId}:`,
            err,
        );
    }
}

// Handle spatial audio node removal
function handleSpatialNodeRemoved(peerId: string) {
    spatialAudio.removePeerAudio(peerId);
    spatialAudioNodes.value.delete(peerId);
}

// Update peer volume
function updatePeerVolume(peerId: string, volume: number) {
    peerVolumes.value.set(peerId, volume);
    spatialAudio.setPeerVolume(peerId, volume);
    props.onSetPeerAudioState?.(peerId, { volume });
}

// Check and recover failed audio connections
function checkAndRecoverAudioConnections() {
    for (const [peerId, peer] of peers.value) {
        const senders = peer.pc.getSenders();
        const receivers = peer.pc.getReceivers();

        const hasAudioSender = senders.some(
            (sender) => sender.track?.kind === "audio",
        );
        const hasAudioReceiver = receivers.some(
            (receiver) => receiver.track?.kind === "audio",
        );

        // If we have a connected peer but no audio tracks, try to add them
        if (
            peer.pc.connectionState === "connected" &&
            !hasAudioSender &&
            localStream.value
        ) {
            console.log(`[WebRTC] Recovering audio sender for peer ${peerId}`);
            try {
                for (const track of localStream.value.getAudioTracks()) {
                    peer.pc.addTrack(track, localStream.value);
                }
            } catch (err) {
                console.error(
                    `[WebRTC] Failed to recover audio sender for ${peerId}:`,
                    err,
                );
            }
        }

        // If we have a connected peer but no audio receivers, the remote peer should be sending
        // This is expected if we're not receiving audio from them
        if (peer.pc.connectionState === "connected" && !hasAudioReceiver) {
            console.log(
                `[WebRTC] Peer ${peerId} has no audio receiver - they might not be sending audio`,
            );
        }
    }
}

// Toggle mute
function toggleMute() {
    isMuted.value = !isMuted.value;

    if (localStream.value) {
        for (const track of localStream.value.getAudioTracks()) {
            track.enabled = !isMuted.value;
        }
    }
}

// Update mic volume
function updateMicVolume(volume: number) {
    micVolume.value = volume;
    // You could implement actual volume control here with Web Audio API
}

// Refresh connections
async function refreshConnections() {
    isRefreshing.value = true;
    try {
        console.log("[WebRTC] Starting connection refresh...");

        // Disconnect all peers
        for (const [peerId] of [...peers.value]) {
            disconnectFromPeer(peerId);
        }

        // Clean up reflect API state to ensure fresh start
        reflectApi.cleanup();

        // Wait a bit for cleanup to complete
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Reinitialize reflect API
        await reflectApi.initialize();

        // Wait another moment before announcing presence
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Force re-announce
        await reflectApi.announcePresence();

        console.log("[WebRTC] Connection refresh completed");
    } catch (err) {
        console.error("[WebRTC] Failed to refresh connections:", err);
    } finally {
        isRefreshing.value = false;
    }
}

// Debug a peer
function debugPeer(peerId: string) {
    const peer = peers.value.get(peerId);
    if (!peer) return;

    console.log(`[WebRTC] Debug info for ${peerId}:`, {
        connectionState: peer.pc.connectionState,
        iceConnectionState: peer.pc.iceConnectionState,
        signalingState: peer.pc.signalingState,
        polite: peer.polite,
        hasRemoteStream: !!peer.remoteStream,
        hasLocalStream: !!peer.localStream,
    });
}

// Lifecycle
onMounted(() => {
    // Set up user interaction handlers for audio context resume
    setupUserInteractionHandlers();
    setupAudioContextStateMonitoring();

    if (fullSessionId.value) {
        initialize();
    }
    // initial permission ping
    queryMicrophonePermission();
});

onUnmounted(() => {
    // Clear all recovery timeouts
    for (const timeout of peerRecoveryTimeouts.value.values()) {
        clearTimeout(timeout);
    }
    peerRecoveryTimeouts.value.clear();
    peerRecoveryAttempts.value.clear();

    // Clear all negotiation timeouts
    // Perfect negotiation doesn't use timeouts

    // Disconnect all peers
    for (const [peerId] of peers.value) {
        disconnectFromPeer(peerId);
    }

    // Clean up any remaining message handlers
    for (const peerId of registeredMessageHandlers.value) {
        reflectApi.unregisterMessageHandler(peerId);
    }
    registeredMessageHandlers.value.clear();

    // Cleanup
    reflectApi.cleanup();
    spatialAudio.cleanup();

    // Stop local stream
    if (localStream.value) {
        for (const track of localStream.value.getTracks()) {
            track.stop();
        }
        localStream.value = null;
    }
});

// Debug functions
function toggleDebugMode() {
    debugMode.value = !debugMode.value;
    if (debugMode.value) {
        console.log("[WebRTC Debug] Debug mode enabled");
        checkNetworkStatus();
    } else {
        console.log("[WebRTC Debug] Debug mode disabled");
    }
}

async function runDebugTests() {
    if (!debugMode.value) return;

    isRunningDebugTests.value = true;
    const results: string[] = [];
    const timestamp = Date.now();

    try {
        // Test 1: Reflect API status
        results.push(
            `Reflect API Initialized: ${reflectApi.isInitialized.value}`,
        );
        results.push(
            `Active Peers (internal): ${reflectApi.activePeers.value.size}`,
        );
        results.push(
            `Discovered Peers: ${reflectApi.discoveredPeers.value.length}`,
        );
        results.push(`Connected Peers: ${peers.value.size}`);
        results.push(
            `Bidirectional Audio Peers: ${bidirectionalAudioPeers.value}`,
        );
        results.push(`Sync Group: ${reflectApiSyncGroup.value}`);
        results.push(`Session ID: ${fullSessionId.value || "None"}`);
        results.push(
            `Local Stream: ${localStream.value ? "Active" : "Inactive"}`,
        );

        // Detailed peer audio status
        results.push("--- Peer Audio Status ---");
        for (const [peerId, peer] of peers.value) {
            const senders = peer.pc.getSenders();
            const receivers = peer.pc.getReceivers();

            const isSending = senders.some(
                (sender) =>
                    sender.track?.kind === "audio" &&
                    sender.track.readyState === "live" &&
                    sender.track.enabled,
            );

            const isReceiving = receivers.some(
                (receiver) =>
                    receiver.track?.kind === "audio" &&
                    receiver.track.readyState === "live",
            );

            const status =
                isSending && isReceiving
                    ? "✅ Bidirectional"
                    : isSending
                        ? "⬆️ Send only"
                        : isReceiving
                            ? "⬇️ Receive only"
                            : "❌ No audio";

            results.push(
                `  ${peerId.substring(0, 8)}...: ${peer.pc.connectionState} (${status})`,
            );
        }

        // Test 2: Network connectivity
        results.push(`Network Status: ${networkStatus.value}`);

        // Test 3: Message handlers
        results.push(`Message Handlers: ${reflectApiHandlersCount.value}`);

        // Test 4: Try to announce presence
        if (isReady.value) {
            await reflectApi.announcePresence();
            results.push("Manual presence announcement: Sent");
        } else {
            results.push("Manual presence announcement: Skipped (not ready)");
        }

        // Test 5: Check for stale peers
        const now = Date.now();
        const staleCount = Array.from(
            reflectApi.activePeers.value.values(),
        ).filter((announcement) => now - announcement.timestamp > 15000).length;
        results.push(`Stale Peers (>15s): ${staleCount}`);

        debugTestResults.value = results.join("\n");
        debugTestTimestamp.value = timestamp;

        console.log("[WebRTC Debug] Test results:", results);
    } catch (err) {
        console.error("[WebRTC Debug] Test failed:", err);
        debugTestResults.value = `Test failed: ${err}`;
        debugTestTimestamp.value = timestamp;
    } finally {
        isRunningDebugTests.value = false;
    }
}

async function manualAnnouncePresence() {
    if (!isReady.value) return;

    try {
        await reflectApi.announcePresence();
        console.log("[WebRTC Debug] Manual presence announcement sent");
        // Run a quick test to see if it worked
        setTimeout(runDebugTests, 1000);
    } catch (err) {
        console.error("[WebRTC Debug] Failed to announce presence:", err);
    }
}

async function forceRefreshPeers() {
    if (!debugMode.value) return;

    isForceRefreshing.value = true;
    try {
        console.log("[WebRTC Debug] Starting force refresh...");

        // Disconnect all peers
        for (const [peerId] of [...peers.value]) {
            disconnectFromPeer(peerId);
        }

        // Clean up reflect API
        reflectApi.cleanup();

        // Wait for cleanup
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Reinitialize
        await initialize();

        console.log("[WebRTC Debug] Force refresh completed");
    } catch (err) {
        console.error("[WebRTC Debug] Force refresh failed:", err);
    } finally {
        isForceRefreshing.value = false;
    }
}

async function forceReconnectToPeer(peerId: string) {
    if (!debugMode.value) return;

    console.log(`[WebRTC Debug] Forcing reconnection to peer: ${peerId}`);

    // Disconnect if already connected
    if (peers.value.has(peerId)) {
        disconnectFromPeer(peerId);
    }

    // Wait a moment
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Try to reconnect
    if (!peers.value.has(peerId) && !connectingPeers.value.has(peerId)) {
        connectToPeer(peerId);
    }
}

async function forceReconnectToSelectedPeer() {
    if (!debugMode.value || !debugTestPeerId.value) return;

    await forceReconnectToPeer(debugTestPeerId.value);
}

async function fixStuckConnections() {
    if (!debugMode.value) return;

    console.log("[WebRTC Debug] Checking for stuck connections...");

    for (const [peerId, peer] of peers.value) {
        const pc = peer.pc;
        const stuckStates = ["have-local-offer", "have-remote-offer"];

        if (stuckStates.includes(pc.signalingState)) {
            console.log(
                `[WebRTC Debug] Found stuck connection: ${peerId} (${pc.signalingState})`,
            );
            console.log(`  ICE State: ${pc.iceConnectionState}`);
            console.log(`  Connection State: ${pc.connectionState}`);

            // Try to recover the stuck connection
            if (pc.signalingState === "have-local-offer") {
                console.log(
                    `[WebRTC Debug] Attempting recovery for stuck offer...`,
                );
                try {
                    pc.restartIce();
                } catch (err) {
                    console.error(`[WebRTC Debug] ICE restart failed:`, err);
                }
            }

            // If we're polite and stable, create new offer
            if (peer.polite && pc.signalingState === "stable") {
                console.log(
                    `[WebRTC Debug] Creating new offer as polite peer...`,
                );
                try {
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    await reflectApi.sendOffer(peerId, offer.sdp!);
                } catch (err) {
                    console.error(
                        `[WebRTC Debug] Failed to create new offer:`,
                        err,
                    );
                }
            }
        }
    }
}

async function checkNegotiationState() {
    if (!debugMode.value) return;

    console.log("[WebRTC Debug] Checking negotiation state for all peers...");

    for (const [peerId, peer] of peers.value) {
        const pc = peer.pc;
        console.log(`[WebRTC Debug] Peer ${peerId}:`, {
            signalingState: pc.signalingState,
            iceState: pc.iceConnectionState,
            connectionState: pc.connectionState,
            polite: peer.polite,
            makingOffer: peer.makingOffer,
            ignoreOffer: peer.ignoreOffer,
        });

        // Count ICE candidates
        const senders = pc.getSenders();
        const receivers = pc.getReceivers();
        console.log(
            `  Senders: ${senders.length}, Receivers: ${receivers.length}`,
        );
        console.log(`  Local tracks: ${senders.filter((s) => s.track).length}`);
        console.log(
            `  Remote tracks: ${receivers.filter((r) => r.track).length}`,
        );

        // Check ICE gathering state and candidate count
        if (pc.iceGatheringState !== "complete") {
            console.log(
                `  ICE gathering state: ${pc.iceGatheringState} (not complete yet)`,
            );
        } else {
            console.log(`  ICE gathering complete`);
        }
    }
}

// Check for ICE candidate issues
async function checkIceCandidateIssues() {
    if (!debugMode.value) return;

    console.log("[WebRTC Debug] Checking for ICE candidate issues...");

    let peersWithNoCandidates = 0;
    let peersWithFewCandidates = 0;
    let peersWithManyCandidates = 0;

    for (const [peerId, peer] of peers.value) {
        const pc = peer.pc;
        console.log(`[WebRTC Debug] Peer ${peerId} ICE candidate analysis:`);

        // We don't have direct access to candidate count here, but we can check ICE gathering state
        if (pc.iceGatheringState === "new") {
            console.log(`  ICE gathering hasn't started yet`);
            peersWithNoCandidates++;
        } else if (pc.iceGatheringState === "gathering") {
            console.log(`  ICE gathering in progress`);
        } else if (pc.iceGatheringState === "complete") {
            console.log(`  ICE gathering complete`);
            if (pc.iceConnectionState === "checking") {
                console.log(
                    `  ICE connection state: checking (this is normal)`,
                );
            } else if (pc.iceConnectionState === "connected") {
                console.log(`  ICE connection state: connected (good!)`);
                peersWithManyCandidates++;
            } else if (pc.iceConnectionState === "failed") {
                console.log(`  ICE connection state: failed (bad!)`);
                peersWithFewCandidates++;
            } else {
                console.log(`  ICE connection state: ${pc.iceConnectionState}`);
            }
        }

        // Check if we have any candidates by looking at ICE connection state
        if (
            pc.iceConnectionState === "new" ||
            pc.iceConnectionState === "checking"
        ) {
            console.log(`  This peer is still establishing ICE connectivity`);
        }

        console.log("");
    }

    console.log(`[WebRTC Debug] ICE candidate summary:`);
    console.log(
        `  Peers that haven't started gathering: ${peersWithNoCandidates}`,
    );
    console.log(`  Peers with potential issues: ${peersWithFewCandidates}`);
    console.log(`  Peers with good connectivity: ${peersWithManyCandidates}`);

    if (peersWithNoCandidates > 0) {
        console.warn(
            `[WebRTC Debug] ${peersWithNoCandidates} peer(s) haven't started ICE candidate gathering yet. This might indicate a timing issue.`,
        );
    }

    if (peersWithFewCandidates > 0) {
        console.warn(
            `[WebRTC Debug] ${peersWithFewCandidates} peer(s) have ICE connectivity issues. This might indicate network problems.`,
        );
    }
}

async function testReflectConnectivity() {
    if (!debugMode.value || !fullSessionId.value) return;

    isTestingConnectivity.value = true;
    const results: string[] = [];

    try {
        // Test 1: Send a test announcement
        const testAnnouncement = {
            sessionId: fullSessionId.value,
            timestamp: Date.now(),
            status: "online" as const,
            test: true,
        };

        vircadiaWorld.client.connection.publishReflect({
            syncGroup: reflectApiSyncGroup.value,
            channel: "webrtc.announce",
            payload: testAnnouncement,
        });

        results.push("Test announcement: Sent successfully");

        // Test 2: Try to subscribe to our own messages
        const testSubscription =
            vircadiaWorld.client.connection.subscribeReflect(
                reflectApiSyncGroup.value,
                "webrtc.announce",
                (msg) => {
                    if (msg.payload.test) {
                        results.push("Self-received test message: ✓");
                    }
                },
            );

        // Test 3: Send a test signaling message to ourselves
        vircadiaWorld.client.connection.publishReflect({
            syncGroup: reflectApiSyncGroup.value,
            channel: "webrtc.signal",
            payload: {
                type: "peer-announce" as const,
                fromSession: fullSessionId.value,
                payload: { test: true },
                timestamp: Date.now(),
            },
        });

        results.push("Test signaling message: Sent successfully");

        // Test 4: Test network connectivity (STUN servers)
        results.push("--- Network Connectivity Test ---");
        await testNetworkConnectivityInternal();

        // Clean up test subscription
        setTimeout(() => testSubscription(), 5000);

        debugTestResults.value = results.join("\n");
        console.log("[WebRTC Debug] Connectivity test results:", results);
    } catch (err) {
        console.error("[WebRTC Debug] Connectivity test failed:", err);
        debugTestResults.value = `Connectivity test failed: ${err}`;
    } finally {
        isTestingConnectivity.value = false;
    }

    async function testNetworkConnectivityInternal() {
        const stunServers = [
            "stun:stun.l.google.com:19302",
            "stun:stun.services.mozilla.com",
        ];

        for (const serverUrl of stunServers) {
            try {
                const pc = new RTCPeerConnection({
                    iceServers: [{ urls: serverUrl }],
                });

                pc.createDataChannel("test");

                await new Promise<void>((resolve, reject) => {
                    pc.onicecandidate = (event) => {
                        if (!event.candidate) resolve();
                    };

                    pc.onicegatheringstatechange = () => {
                        if (pc.iceGatheringState === "complete") resolve();
                    };

                    setTimeout(() => reject(new Error("timeout")), 3000);
                    pc.createOffer().then((offer) =>
                        pc.setLocalDescription(offer),
                    );
                });

                results.push(`  ${serverUrl}: ✓`);
                pc.close();
            } catch (err) {
                results.push(`  ${serverUrl}: ✗ (${err})`);
            }
        }
    }
}

async function clearAllPeers() {
    if (!debugMode.value) return;

    for (const [peerId] of [...peers.value]) {
        disconnectFromPeer(peerId);
    }

    console.log("[WebRTC Debug] All peers cleared");
}

async function sendTestMessage() {
    if (!debugMode.value || !debugTestPeerId.value) return;

    try {
        await reflectApi.sendSignalingMessage(
            debugTestPeerId.value,
            "peer-announce",
            { test: true, timestamp: Date.now() },
        );

        console.log(
            `[WebRTC Debug] Test message sent to ${debugTestPeerId.value}`,
        );
        debugTestResults.value = `Test message sent to ${debugTestPeerId.value.substring(0, 8)}...`;
    } catch (err) {
        console.error("[WebRTC Debug] Failed to send test message:", err);
        debugTestResults.value = `Failed to send test message: ${err}`;
    }
}

async function pingTestPeer() {
    if (!debugMode.value || !debugTestPeerId.value) return;

    const startTime = Date.now();

    try {
        await reflectApi.sendSignalingMessage(
            debugTestPeerId.value,
            "peer-announce",
            { ping: true, timestamp: startTime },
        );

        console.log(`[WebRTC Debug] Ping sent to ${debugTestPeerId.value}`);
        debugTestResults.value = `Ping sent to ${debugTestPeerId.value.substring(0, 8)}... (waiting for response)`;

        // Set up a temporary handler to listen for pong
        const tempHandler = (msg: any) => {
            if (msg.payload.pong && msg.fromSession === debugTestPeerId.value) {
                const latency = Date.now() - startTime;
                debugTestResults.value = `Ping response received! Latency: ${latency}ms`;
                console.log(
                    `[WebRTC Debug] Ping response from ${debugTestPeerId.value}: ${latency}ms`,
                );
            }
        };

        // Register temporary handler
        reflectApi.registerMessageHandler(debugTestPeerId.value, tempHandler);

        // Remove handler after timeout
        setTimeout(() => {
            reflectApi.unregisterMessageHandler(debugTestPeerId.value);
            if (debugTestResults.value.includes("waiting")) {
                debugTestResults.value = "Ping timeout - no response received";
            }
        }, 5000);
    } catch (err) {
        console.error("[WebRTC Debug] Failed to ping peer:", err);
        debugTestResults.value = `Failed to ping peer: ${err}`;
    }
}

async function resumeAudioContext() {
    if (!debugMode.value) return;

    isResumingAudio.value = true;
    try {
        const resumed = await ensureAudioContextResumed();
        debugTestResults.value = resumed
            ? "Audio context resumed successfully"
            : "Audio context could not be resumed - may need user interaction";
        debugTestTimestamp.value = Date.now();
        console.log("[WebRTC Debug] Audio context resume result:", resumed);
    } catch (err) {
        console.error("[WebRTC Debug] Failed to resume audio context:", err);
        debugTestResults.value = `Failed to resume audio context: ${err}`;
        debugTestTimestamp.value = Date.now();
    } finally {
        isResumingAudio.value = false;
    }
}

async function debugAudioProcessing() {
    if (!debugMode.value) return;

    isDebuggingAudio.value = true;
    const results: string[] = [];
    const timestamp = Date.now();

    try {
        // Test 1: Audio context state
        if (spatialAudio.isInitialized.value) {
            results.push(`Audio Context Initialized: Yes`);
            // Note: We can't directly access audioContext.value from here as it's internal to the composable
            results.push(
                `Spatial Audio Ready: ${spatialAudio.isInitialized.value ? "Yes" : "No"}`,
            );
            results.push(
                `Active Spatial Audio Peers: ${spatialAudio.activePeerCount.value || 0}`,
            );
        } else {
            results.push(`Audio Context Initialized: No`);
        }

        // Test 2: Local stream tracks
        if (localStream.value) {
            const audioTracks = localStream.value.getAudioTracks();
            results.push(`Local Audio Tracks: ${audioTracks.length}`);
            audioTracks.forEach((track, i) => {
                results.push(
                    `  Track ${i}: ${track.kind} (${track.readyState})`,
                );
                results.push(
                    `    Settings: ${JSON.stringify(track.getSettings(), null, 2)}`,
                );
            });
        } else {
            results.push(`Local Stream: None`);
        }

        // Test 3: Connected peers audio status
        for (const [peerId, peer] of peers.value) {
            if (peer.remoteStream) {
                const audioTracks = peer.remoteStream.getAudioTracks();
                results.push(
                    `Peer ${peerId.substring(0, 8)}...: Remote Audio Tracks: ${audioTracks.length}`,
                );
                audioTracks.forEach((track, i) => {
                    results.push(
                        `  Track ${i}: ${track.kind} (${track.readyState})`,
                    );
                });
            } else {
                results.push(
                    `Peer ${peerId.substring(0, 8)}...: No remote stream`,
                );
            }
        }

        // Test 4: Try to resume audio context
        await ensureAudioContextResumed();
        results.push("Attempted audio context resume");

        // Test 5: Check for audio permissions
        if (navigator.permissions) {
            try {
                const permissionStatus = await navigator.permissions.query({
                    name: "microphone" as PermissionName,
                });
                results.push(
                    `Microphone Permission: ${permissionStatus.state}`,
                );
            } catch (e) {
                results.push("Microphone Permission: Unable to check");
            }
        }

        debugTestResults.value = results.join("\n");
        debugTestTimestamp.value = timestamp;

        console.log("[WebRTC Debug] Audio processing test results:", results);
    } catch (err) {
        console.error("[WebRTC Debug] Audio processing test failed:", err);
        debugTestResults.value = `Audio processing test failed: ${err}`;
        debugTestTimestamp.value = timestamp;
    } finally {
        isDebuggingAudio.value = false;
    }
}

async function testNetworkConnectivity() {
    if (!debugMode.value) return;

    isTestingConnectivity.value = true;
    const results: string[] = [];
    const timestamp = Date.now();

    try {
        // Test 1: Basic network connectivity
        results.push(`Network Status: ${networkStatus.value}`);

        // Test 2: Test STUN server connectivity
        results.push("Testing STUN servers...");

        const stunServers = [
            "stun:stun.l.google.com:19302",
            "stun:stun.services.mozilla.com",
        ];

        for (const serverUrl of stunServers) {
            try {
                const pc = new RTCPeerConnection({
                    iceServers: [{ urls: serverUrl }],
                });

                // Create a data channel to trigger ICE gathering
                pc.createDataChannel("test");

                // Wait for ICE gathering to complete
                await new Promise<void>((resolve, reject) => {
                    let candidatesFound = 0;

                    pc.onicecandidate = (event) => {
                        if (event.candidate) {
                            candidatesFound++;
                        } else {
                            resolve();
                        }
                    };

                    pc.onicegatheringstatechange = () => {
                        if (pc.iceGatheringState === "complete") {
                            resolve();
                        }
                    };

                    // Timeout after 5 seconds
                    setTimeout(() => {
                        reject(new Error("STUN test timeout"));
                    }, 5000);

                    pc.createOffer().then((offer) =>
                        pc.setLocalDescription(offer),
                    );
                });

                results.push(`  ${serverUrl}: ✓ (${pc.iceConnectionState})`);
                pc.close();
            } catch (err) {
                results.push(`  ${serverUrl}: ✗ (${err})`);
            }
        }

        // Test 3: Test WebRTC basic functionality
        try {
            const testPc = new RTCPeerConnection(rtcConfig);
            const testChannel = testPc.createDataChannel("test");

            results.push(`WebRTC Basic Test: ✓ (DataChannel created)`);

            testPc.close();
        } catch (err) {
            results.push(`WebRTC Basic Test: ✗ (${err})`);
        }

        debugTestResults.value = results.join("\n");
        debugTestTimestamp.value = timestamp;

        console.log(
            "[WebRTC Debug] Network connectivity test results:",
            results,
        );
    } catch (err) {
        console.error("[WebRTC Debug] Network connectivity test failed:", err);
        debugTestResults.value = `Network connectivity test failed: ${err}`;
        debugTestTimestamp.value = timestamp;
    } finally {
        isTestingConnectivity.value = false;
    }
}

function checkNetworkStatus() {
    if (navigator.onLine) {
        networkStatus.value = "online";
    } else {
        networkStatus.value = "offline";
    }

    // Listen for network changes
    window.addEventListener("online", () => {
        networkStatus.value = "online";
        console.log("[WebRTC Debug] Network status changed: online");
    });

    window.addEventListener("offline", () => {
        networkStatus.value = "offline";
        console.log("[WebRTC Debug] Network status changed: offline");
    });
}

// Watch for session changes
watch(fullSessionId, (newSession, oldSession) => {
    if (oldSession && newSession !== oldSession) {
        // Session changed, reinitialize
        reflectApi.cleanup();
        initialize();
    } else if (newSession && !oldSession) {
        // New session, initialize
        initialize();
    }
});
</script>
