<template>
    <v-dialog v-model="dialogVisible" max-width="800px">
        <v-card class="pa-4">
            <v-card-title>WebRTC Audio</v-card-title>

            <v-card-text>
                <div class="d-flex align-center mb-4">
                    <v-switch v-model="audioEnabled" label="Microphone" color="primary" hide-details
                        density="compact" />
                    <v-chip :color="localStream ? 'success' : 'error'" size="small" class="ml-2">
                        {{ localStream ? 'Active' : 'Inactive' }}
                    </v-chip>
                    <v-chip :color="spatialAudio.isInitialized.value ? 'success' : 'warning'" size="small" class="ml-2">
                        Spatial: {{ spatialAudio.isInitialized.value ? 'Ready' : 'Not Ready' }}
                    </v-chip>
                </div>

                <v-divider class="my-4" />

                <div class="text-subtitle-2 mb-2">
                    Connected Peers ({{ peers.size }})
                </div>

                <v-expansion-panels v-if="peers.size > 0">
                    <!-- Inlined Peer Component -->
                    <v-expansion-panel v-for="[peerId, peer] of peers" :key="peerId" :value="peerId">
                        <v-expansion-panel-title>
                            <v-row no-gutters align="center">
                                <v-col cols="auto">
                                    <v-avatar size="32" :color="getPeerAvatarColor(peerId, peer)">
                                        <span class="text-caption">{{ getPeerInitials(peerId) }}</span>
                                    </v-avatar>
                                </v-col>
                                <v-col class="ml-3">
                                    <div class="text-subtitle-2">{{ getPeerDisplayName(peerId) }}</div>
                                    <div class="text-caption text-grey">{{ getPeerShortId(peerId) }}</div>
                                </v-col>
                                <v-spacer />
                                <v-col cols="auto" class="d-flex align-center">
                                    <!-- Connection Status -->
                                    <v-chip size="small" :color="getConnectionStateColor(peer)" variant="flat"
                                        class="mr-1">
                                        {{ getConnectionStateLabel(peer) }}
                                    </v-chip>

                                    <!-- Audio Status Indicators -->
                                    <v-tooltip text="Audio being sent">
                                        <template v-slot:activator="{ props: tooltipProps }">
                                            <v-icon v-bind="tooltipProps" size="small"
                                                :color="isPeerSendingAudio(peer) ? 'success' : 'grey'" class="ml-1">
                                                {{ isPeerSendingAudio(peer) ? 'mdi-microphone' : 'mdi-microphone-off' }}
                                            </v-icon>
                                        </template>
                                    </v-tooltip>

                                    <v-tooltip
                                        :text="`Audio being received (Level: ${getPeerAudioLevel(peerId).toFixed(1)}%)`">
                                        <template v-slot:activator="{ props: tooltipProps }">
                                            <v-icon v-bind="tooltipProps" size="small"
                                                :color="isPeerReceivingAudio(peer) ? 'success' : 'grey'" class="ml-1">
                                                {{ isPeerReceivingAudio(peer) ? 'mdi-volume-high' : 'mdi-volume-off' }}
                                            </v-icon>
                                        </template>
                                    </v-tooltip>

                                    <!-- Audio Level Indicator -->
                                    <v-tooltip text="Audio level indicator">
                                        <template v-slot:activator="{ props: tooltipProps }">
                                            <v-progress-circular v-bind="tooltipProps" size="20" width="3"
                                                :value="getPeerAudioLevel(peerId)" :color="getAudioLevelColor(peerId)"
                                                class="ml-1">
                                                <v-icon size="10" :color="getAudioLevelColor(peerId)">
                                                    {{ getPeerAudioLevel(peerId) > 50 ? 'mdi-volume-high' :
                                                        getPeerAudioLevel(peerId) > 25 ? 'mdi-volume-medium' :
                                                            'mdi-volume-low' }}
                                                </v-icon>
                                            </v-progress-circular>
                                        </template>
                                    </v-tooltip>

                                    <!-- Connection Quality Indicator -->
                                    <v-tooltip :text="getConnectionQualityText(peerId, peer)">
                                        <template v-slot:activator="{ props: tooltipProps }">
                                            <v-icon v-bind="tooltipProps" size="small"
                                                :color="getConnectionQualityColor(peerId, peer)" class="ml-1">
                                                {{ getConnectionQualityIcon(peerId, peer) }}
                                            </v-icon>
                                        </template>
                                    </v-tooltip>
                                </v-col>
                            </v-row>
                        </v-expansion-panel-title>

                        <v-expansion-panel-text>
                            <v-list density="compact">
                                <!-- Connection Info -->
                                <v-list-item>
                                    <v-list-item-title class="text-caption">
                                        Session ID: {{ peerId }}
                                    </v-list-item-title>
                                </v-list-item>

                                <v-list-item>
                                    <v-list-item-title class="text-caption">
                                        ICE State:
                                        <v-chip size="x-small" :color="getIceStateColor(peer)">
                                            {{ peer.pc.iceConnectionState }}
                                        </v-chip>
                                    </v-list-item-title>
                                </v-list-item>

                                <v-list-item>
                                    <v-list-item-title class="text-caption">
                                        Signaling State:
                                        <v-chip size="x-small" :color="getSignalingStateColor(peer)">
                                            {{ peer.pc.signalingState }}
                                        </v-chip>
                                    </v-list-item-title>
                                </v-list-item>

                                <!-- Audio Controls -->
                                <v-list-item v-if="peer.remoteStream">
                                    <v-list-item-title class="d-flex align-center">
                                        <span class="text-caption mr-2">Volume:</span>
                                        <v-slider :model-value="peerVolumes.get(peerId) ?? 100"
                                            @update:model-value="(vol) => setPeerVolume(peerId, vol)"
                                            class="flex-grow-1" density="compact" hide-details min="0" max="100"
                                            step="1" thumb-label>
                                            <template v-slot:prepend>
                                                <v-icon size="small">mdi-volume-low</v-icon>
                                            </template>
                                            <template v-slot:append>
                                                <v-icon size="small">mdi-volume-high</v-icon>
                                            </template>
                                        </v-slider>
                                        <span class="ml-2 text-caption">{{ peerVolumes.get(peerId) ?? 100 }}%</span>
                                    </v-list-item-title>
                                </v-list-item>

                                <!-- 3D Position Info -->
                                <v-list-item v-if="avatarPositions.get(peerId)">
                                    <v-list-item-title class="text-caption">
                                        Position: ({{ avatarPositions.get(peerId)?.x.toFixed(1) }}, {{
                                            avatarPositions.get(peerId)?.y.toFixed(1) }}, {{
                                            avatarPositions.get(peerId)?.z.toFixed(1) }})
                                        <span v-if="getPeerDistance(peerId) !== null" class="ml-2">
                                            Distance: {{ getPeerDistance(peerId)?.toFixed(1) }}m
                                        </span>
                                    </v-list-item-title>
                                </v-list-item>

                                <!-- Debug Information -->
                                <v-list-item>
                                    <v-list-item-title class="text-caption">
                                        <strong>Connection Details:</strong>
                                    </v-list-item-title>
                                </v-list-item>

                                <v-list-item>
                                    <v-list-item-title class="text-caption">
                                        Created: {{ getPeerConnectionAge(peerId) }}s ago
                                    </v-list-item-title>
                                </v-list-item>

                                <!-- Audio State Summary -->
                                <v-list-item>
                                    <v-list-item-title class="text-caption">
                                        <strong>Audio Status:</strong>
                                        <v-chip size="x-small" :color="isPeerSendingAudio(peer) ? 'success' : 'error'"
                                            variant="flat" class="ml-1">
                                            Send: {{ isPeerSendingAudio(peer) ? '✓' : '✗' }}
                                        </v-chip>
                                        <v-chip size="x-small" :color="isPeerReceivingAudio(peer) ? 'success' : 'error'"
                                            variant="flat" class="ml-1">
                                            Receive: {{ isPeerReceivingAudio(peer) ? '✓' : '✗' }}
                                        </v-chip>
                                        <v-chip size="x-small"
                                            :color="(isPeerSendingAudio(peer) && isPeerReceivingAudio(peer)) ? 'success' : 'warning'"
                                            variant="flat" class="ml-1">
                                            {{ (isPeerSendingAudio(peer) && isPeerReceivingAudio(peer)) ?
                                                'Bidirectional'
                                                : 'One-way' }}
                                        </v-chip>
                                    </v-list-item-title>
                                </v-list-item>

                                <!-- Audio Level Information -->
                                <v-list-item>
                                    <v-list-item-title class="text-caption">
                                        <strong>Audio Levels:</strong>
                                        <div class="d-flex align-center ml-2 mt-1">
                                            <span class="text-caption mr-2">Receiving:</span>
                                            <v-progress-linear :value="getPeerAudioLevel(peerId)"
                                                :color="getAudioLevelColor(peerId)" height="8" rounded
                                                style="min-width: 100px" class="mr-2" />
                                            <span class="text-caption">{{ getPeerAudioLevel(peerId).toFixed(1)
                                                }}%</span>
                                        </div>
                                    </v-list-item-title>
                                </v-list-item>

                                <!-- Detailed Track Information -->
                                <v-list-item>
                                    <v-list-item-title class="text-caption">
                                        <strong>Local Senders:</strong>
                                        <div v-for="sender in peer.pc.getSenders()"
                                            :key="sender.track?.id || 'no-track'" class="ml-2">
                                            <v-chip size="x-small" :color="sender.track?.enabled ? 'success' : 'error'"
                                                variant="flat">
                                                {{ sender.track?.kind || 'unknown' }}: {{ sender.track?.readyState ||
                                                    'no-track' }}
                                                {{ sender.track?.enabled ? '' : '(disabled)' }}
                                            </v-chip>
                                        </div>
                                    </v-list-item-title>
                                </v-list-item>

                                <v-list-item>
                                    <v-list-item-title class="text-caption">
                                        <strong>Remote Receivers:</strong>
                                        <div v-for="receiver in peer.pc.getReceivers()"
                                            :key="receiver.track?.id || 'no-track'" class="ml-2">
                                            <v-chip size="x-small"
                                                :color="receiver.track?.readyState === 'live' ? 'success' : 'error'"
                                                variant="flat">
                                                {{ receiver.track?.kind || 'unknown' }}: {{ receiver.track?.readyState
                                                    ||
                                                    'no-track' }}
                                            </v-chip>
                                        </div>
                                    </v-list-item-title>
                                </v-list-item>

                                <v-list-item v-if="peer.pc.getTransceivers().length > 0">
                                    <v-list-item-title class="text-caption">
                                        <strong>Transceivers:</strong>
                                        <div v-for="(transceiver, index) in peer.pc.getTransceivers()" :key="index"
                                            class="ml-2">
                                            <v-chip size="x-small"
                                                :color="transceiver.direction === 'sendrecv' ? 'success' : 'warning'"
                                                variant="flat">
                                                {{ index + 1 }}: {{ transceiver.mid || 'no-mid' }}
                                                ({{ transceiver.direction }})
                                                {{ transceiver.currentDirection ? `→ ${transceiver.currentDirection}` :
                                                    ''
                                                }}
                                            </v-chip>
                                            <span class="text-caption ml-1">
                                                {{ transceiver.sender?.track?.kind || 'no-sender' }} ↔ {{
                                                    transceiver.receiver?.track?.kind || 'no-receiver' }}
                                            </span>
                                        </div>
                                    </v-list-item-title>
                                </v-list-item>

                                <!-- Debug Actions -->
                                <v-list-item>
                                    <v-btn size="small" variant="outlined" @click="disconnectPeer(peerId)">
                                        Disconnect
                                    </v-btn>
                                </v-list-item>
                            </v-list>
                        </v-expansion-panel-text>
                    </v-expansion-panel>
                </v-expansion-panels>

                <div v-else class="text-center text-grey py-4">
                    No peers connected
                </div>
            </v-card-text>
        </v-card>
    </v-dialog>
</template>

<script setup lang="ts">
import type {
    AvatarBaseData,
    AvatarPositionData,
    PeerAudioNode,
    SpatialAudioOptions,
} from "@schemas";
import type { Communication } from "@vircadia/world-sdk/browser/vue";
import {
    computed,
    onMounted,
    onUnmounted,
    type Ref,
    ref,
    toRef,
    watch,
} from "vue";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";

// Props
interface Props {
    client: VircadiaWorldInstance;
    fullSessionId: string | null;
    avatarData: Map<string, AvatarBaseData>;
    avatarPositions: Map<string, AvatarPositionData>;
    myPosition: AvatarPositionData | null;
    myCameraOrientation?: {
        alpha: number;
        beta: number;
        radius: number;
    } | null;
    webrtcSyncGroup?: string;
    modelValue?: boolean;
}

const emit = defineEmits<{
    "update:modelValue": [value: boolean];
}>();

const props = defineProps<Props>();
const dialogVisible = computed({
    get: () => props.modelValue ?? false,
    set: (value: boolean) => emit("update:modelValue", value),
});

// Interfaces
interface PeerInfo {
    pc: RTCPeerConnection;
    polite: boolean;
    makingOffer: boolean;
    ignoreOffer: boolean;
    isSettingRemoteAnswerPending: boolean;
    remoteStream?: MediaStream;
    iceCandidateBuffer: RTCIceCandidateInit[];
    createdAt: number; // Track connection creation time
}

interface SignalingMessage {
    description?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
}

interface PeerAnnouncement {
    sessionId: string;
    timestamp: number;
    status: "online" | "offline";
}

interface WebRTCReflectMessage {
    type: "signaling" | "session-end";
    fromSession: string;
    toSession?: string;
    payload: SignalingMessage;
    timestamp: number;
}

interface AudioAnalysisData {
    analyser: AnalyserNode;
    source: MediaStreamAudioSourceNode;
    level: number;
}

// Configuration
const SYNC_GROUP = props.webrtcSyncGroup || "public.NORMAL";
const ANNOUNCE_CHANNEL = "webrtc.announce";
const SIGNALING_CHANNEL = "webrtc.signal";
const ANNOUNCE_INTERVAL = 2000;
const PRESENCE_TIMEOUT = 10000;

// RTC Configuration
const rtcConfig: RTCConfiguration = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
    ],
    iceCandidatePoolSize: 10,
    iceTransportPolicy: "all",
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
};

// State
const audioEnabled = ref(true);
const localStream = ref<MediaStream | null>(null);
const peers = ref(new Map<string, PeerInfo>());
const peerVolumes = ref(new Map<string, number>());
const activePeers = ref(new Map<string, PeerAnnouncement>());
const isInitialized = ref(false);
const currentTime = ref(Date.now());

// Per-peer audio analysis
const peerAudioAnalysis = ref(new Map<string, AudioAnalysisData>());
const peerAudioLevels = ref(new Map<string, number>());

// Intervals and subscriptions
let announceInterval: ReturnType<typeof setInterval> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let audioAnalysisInterval: ReturnType<typeof setInterval> | null = null;
let timeUpdateInterval: ReturnType<typeof setInterval> | null = null;
let unsubscribeAnnounce: (() => void) | null = null;
let unsubscribeSignaling: (() => void) | null = null;

// Convert avatarPositions Map to Record for spatial audio
const otherPositionsRecord = computed(() => {
    const record: Record<string, AvatarPositionData> = {};
    for (const [peerId, position] of props.avatarPositions.entries()) {
        if (peerId !== props.fullSessionId) {
            record[peerId] = position;
        }
    }
    return record;
});

// Normalize optional camera orientation prop to a non-undefined Ref
const myCameraOrientationRef = computed(
    () => props.myCameraOrientation ?? null,
);

// Spatial Audio (inlined)
function useWebRTCSpatialAudio(
    options: SpatialAudioOptions = {},
    sources?: {
        myPosition?: Ref<AvatarPositionData | null>;
        myCameraOrientation?: Ref<{
            alpha: number;
            beta: number;
            radius: number;
        } | null>;
        otherPositions?: Ref<Record<string, AvatarPositionData>>;
    },
) {
    // Audio context and nodes
    const audioContext = ref<AudioContext | null>(null);
    const peerAudioNodes = ref(new Map<string, PeerAudioNode>());
    const isInitialized = ref(false);

    // Default spatial audio settings
    const settings = {
        refDistance: options.refDistance ?? 1,
        maxDistance: options.maxDistance ?? 50,
        rolloffFactor: options.rolloffFactor ?? 1,
        coneInnerAngle: options.coneInnerAngle ?? 360,
        coneOuterAngle: options.coneOuterAngle ?? 360,
        panningModel: (options.panningModel ?? "HRTF") as PanningModelType,
        distanceModel: (options.distanceModel ??
            "inverse") as DistanceModelType,
    };

    // Initialize audio context
    function initialize() {
        if (isInitialized.value) return;

        try {
            audioContext.value = new AudioContext();
            isInitialized.value = true;

            // Set initial listener position
            updateListenerPosition();

            // Resume audio context if suspended (due to browser autoplay policies)
            if (audioContext.value.state === "suspended") {
                audioContext.value.resume().catch((error) => {
                    console.error(
                        "[SpatialAudio] Failed to resume audio context:",
                        error,
                    );
                });
            }

            // Monitor audio context state changes
            audioContext.value.onstatechange = () => {
                console.log(
                    "[SpatialAudio] Audio context state changed to:",
                    audioContext.value?.state,
                );
            };
        } catch (error) {
            console.error(
                "[SpatialAudio] Failed to initialize audio context:",
                error,
            );
        }
    }

    // Calculate forward vector from camera orientation (spherical to cartesian)
    function calculateForwardVector(cameraOrientation: {
        alpha: number;
        beta: number;
        radius: number;
    }) {
        const { alpha, beta } = cameraOrientation;
        const x = Math.sin(alpha) * Math.sin(beta);
        const y = -Math.cos(beta);
        const z = Math.cos(alpha) * Math.sin(beta);
        return { x, y, z };
    }

    // Update listener (my avatar) position and orientation
    function updateListenerPosition() {
        if (!audioContext.value) return;

        const pos = sources?.myPosition?.value ?? null;
        const cam = sources?.myCameraOrientation?.value ?? null;
        if (!pos || !cam) return;

        type ListenerLike = AudioListener & {
            positionX?: AudioParam;
            positionY?: AudioParam;
            positionZ?: AudioParam;
            forwardX?: AudioParam;
            forwardY?: AudioParam;
            forwardZ?: AudioParam;
            upX?: AudioParam;
            upY?: AudioParam;
            upZ?: AudioParam;
            setPosition?: (x: number, y: number, z: number) => void;
            setOrientation?: (
                fx: number,
                fy: number,
                fz: number,
                ux: number,
                uy: number,
                uz: number,
            ) => void;
        };
        const listener = audioContext.value.listener as ListenerLike;

        try {
            // Set position
            if (listener.positionX) {
                listener.positionX.setValueAtTime(
                    pos.x,
                    audioContext.value.currentTime,
                );
                listener.positionY.setValueAtTime(
                    pos.y,
                    audioContext.value.currentTime,
                );
                listener.positionZ.setValueAtTime(
                    pos.z,
                    audioContext.value.currentTime,
                );
            } else {
                listener.setPosition?.(pos.x, pos.y, pos.z);
            }

            // Calculate forward and up vectors from camera orientation
            const forward = calculateForwardVector(cam);
            const up = { x: 0, y: 1, z: 0 }; // Y-up coordinate system

            if (listener.forwardX) {
                listener.forwardX.setValueAtTime(
                    forward.x,
                    audioContext.value.currentTime,
                );
                listener.forwardY.setValueAtTime(
                    forward.y,
                    audioContext.value.currentTime,
                );
                listener.forwardZ.setValueAtTime(
                    forward.z,
                    audioContext.value.currentTime,
                );
                listener.upX.setValueAtTime(
                    up.x,
                    audioContext.value.currentTime,
                );
                listener.upY.setValueAtTime(
                    up.y,
                    audioContext.value.currentTime,
                );
                listener.upZ.setValueAtTime(
                    up.z,
                    audioContext.value.currentTime,
                );
            } else {
                listener.setOrientation?.(
                    forward.x,
                    forward.y,
                    forward.z,
                    up.x,
                    up.y,
                    up.z,
                );
            }
        } catch (error) {
            console.error(
                "[SpatialAudio] Failed to update listener position:",
                error,
            );
        }
    }

    // Create spatial audio node for a peer
    function createPeerAudioNode(
        peerId: string,
        remoteStream: MediaStream,
        initialVolume = 100,
    ): HTMLAudioElement {
        if (!audioContext.value) {
            throw new Error("[SpatialAudio] Audio context not initialized");
        }

        // Validate stream
        const audioTracks = remoteStream.getAudioTracks();
        if (audioTracks.length === 0) {
            console.warn(
                `[SpatialAudio] No audio tracks in remote stream for peer ${peerId.substring(0, 8)}...`,
            );
        }

        try {
            // Create audio element
            const audio = new Audio();
            audio.srcObject = remoteStream;
            audio.autoplay = true;
            audio.style.display = "none"; // Hidden
            // CRITICAL: Mute the audio element to prevent double playback
            // Audio should only play through Web Audio API for spatial processing
            audio.muted = true;
            audio.volume = 0;
            document.body.appendChild(audio);

            // Create Web Audio nodes
            const source =
                audioContext.value.createMediaStreamSource(remoteStream);
            const panner = audioContext.value.createPanner();
            const gain = audioContext.value.createGain();

            // Configure panner
            panner.panningModel = settings.panningModel;
            panner.distanceModel = settings.distanceModel;
            panner.refDistance = settings.refDistance;
            panner.maxDistance = settings.maxDistance;
            panner.rolloffFactor = settings.rolloffFactor;
            panner.coneInnerAngle = settings.coneInnerAngle;
            panner.coneOuterAngle = settings.coneOuterAngle;
            panner.coneOuterGain = 0.3;

            // Set initial volume
            gain.gain.value = initialVolume / 100;

            // Connect nodes: source -> panner -> gain -> destination
            source.connect(panner);
            panner.connect(gain);
            gain.connect(audioContext.value.destination);

            // Store node references
            const nodeInfo: PeerAudioNode = {
                audioElement: audio,
                source,
                panner,
                gain,
            };
            peerAudioNodes.value.set(peerId, nodeInfo);

            // Set initial position
            updatePeerPosition(peerId);

            // Try to play (may be blocked by autoplay policy)
            audio.play().catch((error) => {
                console.warn(
                    `[SpatialAudio] Audio autoplay blocked for peer ${peerId.substring(0, 8)}...:`,
                    error,
                );
                // This is expected in most browsers, the Web Audio API should still work
            });

            return audio;
        } catch (error) {
            console.error(
                `[{SpatialAudio}] Failed to create audio node for peer ${peerId}:`,
                error,
            );
            throw error;
        }
    }

    // Update peer audio position based on their avatar metadata
    function updatePeerPosition(peerId: string) {
        const nodeInfo = peerAudioNodes.value.get(peerId);
        if (!nodeInfo || !audioContext.value) return;

        const otherPositions = sources?.otherPositions?.value;
        const pos = otherPositions ? otherPositions[peerId] : undefined;
        if (!pos) return;
        type PannerLike = PannerNode & {
            positionX?: AudioParam;
            positionY?: AudioParam;
            positionZ?: AudioParam;
            setPosition?: (x: number, y: number, z: number) => void;
        };
        const panner = nodeInfo.panner as PannerLike;

        try {
            if (panner.positionX) {
                panner.positionX.setValueAtTime(
                    pos.x,
                    audioContext.value.currentTime,
                );
                panner.positionY.setValueAtTime(
                    pos.y,
                    audioContext.value.currentTime,
                );
                panner.positionZ.setValueAtTime(
                    pos.z,
                    audioContext.value.currentTime,
                );
            } else {
                panner.setPosition?.(pos.x, pos.y, pos.z);
            }
        } catch (error) {
            console.error(
                `[SpatialAudio] Failed to update position for peer ${peerId}:`,
                error,
            );
        }
    }

    // Update all peer positions (useful when many peers change at once)
    function updateAllPeerPositions() {
        for (const peerId of peerAudioNodes.value.keys()) {
            updatePeerPosition(peerId);
        }
    }

    // Set peer volume
    function setPeerVolume(peerId: string, volume: number) {
        const nodeInfo = peerAudioNodes.value.get(peerId);
        if (!nodeInfo || !audioContext.value) return;
        try {
            nodeInfo.gain.gain.setValueAtTime(
                volume / 100,
                audioContext.value.currentTime,
            );
        } catch (error) {
            console.error(
                `[SpatialAudio] Failed to set volume for peer ${peerId}:`,
                error,
            );
        }
    }

    // Get peer volume
    function getPeerVolume(peerId: string): number {
        const nodeInfo = peerAudioNodes.value.get(peerId);
        if (!nodeInfo) return 100;
        return Math.round(nodeInfo.gain.gain.value * 100);
    }

    // Remove peer audio node and clean up
    function removePeerAudio(peerId: string) {
        const nodeInfo = peerAudioNodes.value.get(peerId);
        if (!nodeInfo) return;
        try {
            // Disconnect nodes
            nodeInfo.source.disconnect();
            nodeInfo.panner.disconnect();
            nodeInfo.gain.disconnect();

            // Remove and clean up audio element
            if (nodeInfo.audioElement.parentNode) {
                nodeInfo.audioElement.parentNode.removeChild(
                    nodeInfo.audioElement,
                );
            }
            nodeInfo.audioElement.pause();
            nodeInfo.audioElement.srcObject = null;

            // Remove from map
            peerAudioNodes.value.delete(peerId);
        } catch (error) {
            console.error(
                `[SpatialAudio] Error cleaning up audio node for peer ${peerId}:`,
                error,
            );
        }
    }

    // Cleanup all resources
    function cleanup() {
        for (const peerId of peerAudioNodes.value.keys()) {
            removePeerAudio(peerId);
        }
        if (audioContext.value) {
            audioContext.value.close().catch((error) => {
                console.error(
                    "[SpatialAudio] Error closing audio context:",
                    error,
                );
            });
            audioContext.value = null;
        }
        isInitialized.value = false;
    }

    // Resume audio context on user interaction (needed for browser autoplay policies)
    async function resumeContext() {
        if (!audioContext.value) {
            console.warn("[SpatialAudio] No audio context to resume");
            return false;
        }
        try {
            if (audioContext.value.state === "suspended") {
                await audioContext.value.resume();
                return true;
            }
            return audioContext.value.state === "running";
        } catch (error) {
            console.error(
                "[SpatialAudio] Failed to resume audio context:",
                error,
            );
            return false;
        }
    }

    // Watchers
    if (sources?.myPosition) {
        watch(sources.myPosition, () => updateListenerPosition(), {
            deep: true,
        });
    }
    if (sources?.myCameraOrientation) {
        watch(sources.myCameraOrientation, () => updateListenerPosition(), {
            deep: true,
        });
    }
    if (sources?.otherPositions) {
        watch(sources.otherPositions, () => updateAllPeerPositions(), {
            deep: true,
        });
    }

    // Computed helpers
    const activePeerCount = computed(() => peerAudioNodes.value.size);
    const isReady = computed(() => isInitialized.value && !!audioContext.value);

    // Expose context and nodes for analysis
    function getAudioContext() {
        return audioContext.value;
    }
    function getPeerNode(peerId: string) {
        return peerAudioNodes.value.get(peerId);
    }

    return {
        // State
        isInitialized: isReady,
        activePeerCount,

        // Core functions
        initialize,
        cleanup,

        // Peer management
        createPeerAudioNode,
        removePeerAudio,
        updatePeerPosition,
        updateAllPeerPositions,

        // Volume control
        setPeerVolume,
        getPeerVolume,

        // Manual position updates
        updateListenerPosition,

        // Settings
        settings,

        // Resume context
        resumeContext,

        // Analysis helpers
        getAudioContext,
        getPeerNode,
    };
}

// Spatial Audio Instance
const spatialAudio = useWebRTCSpatialAudio(
    {
        refDistance: 1,
        maxDistance: 50,
        rolloffFactor: 1,
        panningModel: "HRTF",
        distanceModel: "inverse",
    },
    {
        myPosition: toRef(props, "myPosition"),
        myCameraOrientation: myCameraOrientationRef,
        otherPositions: otherPositionsRecord,
    },
);

// Computed
const discoveredPeers = computed(() => Array.from(activePeers.value.keys()));

// ============================================================================
// Peer Display Helper Functions
// ============================================================================

function getPeerDisplayName(peerId: string): string {
    return peerId.split("@")[0] || "Unknown User";
}

function getPeerInitials(peerId: string): string {
    const name = getPeerDisplayName(peerId);
    return name
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .substring(0, 2)
        .toUpperCase();
}

function getPeerShortId(peerId: string): string {
    return peerId.substring(0, 8) + "...";
}

function getPeerAvatarColor(_peerId: string, peer: PeerInfo): string {
    if (peer.pc.connectionState !== "connected") {
        return "grey";
    }

    const iceState = peer.pc.iceConnectionState;
    if (iceState === "connected" || iceState === "completed") {
        const receiving = isPeerReceivingAudio(peer);
        const sending = isPeerSendingAudio(peer);

        if (receiving && sending) return "success";
        if (receiving || sending) return "warning";
        return "error";
    }

    return iceState === "checking" ? "info" : "error";
}

function getConnectionStateLabel(peer: PeerInfo): string {
    const state = peer.pc.connectionState;
    const labels: Record<string, string> = {
        connected: "Connected",
        connecting: "Connecting",
        disconnected: "Disconnected",
        failed: "Failed",
        closed: "Closed",
    };
    return labels[state] || state;
}

function getConnectionStateColor(peer: PeerInfo): string {
    const state = peer.pc.connectionState;
    const colors: Record<string, string> = {
        connected: "success",
        connecting: "warning",
        disconnected: "error",
        failed: "error",
    };
    return colors[state] || "grey";
}

function getIceStateColor(peer: PeerInfo): string {
    const state = peer.pc.iceConnectionState;
    const colors: Record<string, string> = {
        connected: "success",
        completed: "success",
        checking: "warning",
        disconnected: "error",
        failed: "error",
    };
    return colors[state] || "grey";
}

function getSignalingStateColor(peer: PeerInfo): string {
    const state = peer.pc.signalingState;
    if (state === "stable") return "success";
    if (state === "closed") return "error";
    return "warning";
}

function isPeerSendingAudio(peer: PeerInfo): boolean {
    return peer.pc
        .getSenders()
        .some(
            (sender) =>
                sender.track?.kind === "audio" &&
                sender.track.readyState === "live" &&
                sender.track.enabled,
        );
}

function isPeerReceivingAudio(peer: PeerInfo): boolean {
    return peer.pc
        .getReceivers()
        .some(
            (receiver) =>
                receiver.track?.kind === "audio" &&
                receiver.track.readyState === "live",
        );
}

function getPeerDistance(peerId: string): number | null {
    const peerPosition = props.avatarPositions.get(peerId);
    if (!peerPosition || !props.myPosition) return null;

    const dx = peerPosition.x - props.myPosition.x;
    const dy = peerPosition.y - props.myPosition.y;
    const dz = peerPosition.z - props.myPosition.z;

    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function getPeerConnectionAge(peerId: string): number {
    const peer = peers.value.get(peerId);
    if (!peer) return 0;
    return Math.floor((currentTime.value - peer.createdAt) / 1000);
}

function getPeerAudioLevel(peerId: string): number {
    return peerAudioLevels.value.get(peerId) ?? 0;
}

function getAudioLevelColor(peerId: string): string {
    const level = getPeerAudioLevel(peerId);
    if (level < 10) return "grey";
    if (level < 25) return "success";
    if (level < 50) return "warning";
    return "error";
}

function getConnectionQualityColor(_peerId: string, peer: PeerInfo): string {
    if (peer.pc.connectionState !== "connected") return "grey";

    const iceState = peer.pc.iceConnectionState;
    if (iceState === "connected" || iceState === "completed") {
        const receiving = isPeerReceivingAudio(peer);
        const sending = isPeerSendingAudio(peer);
        return receiving && sending
            ? "success"
            : receiving || sending
                ? "warning"
                : "error";
    }

    return iceState === "checking" ? "warning" : "error";
}

function getConnectionQualityIcon(_peerId: string, peer: PeerInfo): string {
    if (peer.pc.connectionState !== "connected") return "mdi-wifi-off";

    const iceState = peer.pc.iceConnectionState;
    if (iceState === "connected" || iceState === "completed") {
        const receiving = isPeerReceivingAudio(peer);
        const sending = isPeerSendingAudio(peer);

        if (receiving && sending) return "mdi-wifi-strength-4";
        if (receiving || sending) return "mdi-wifi-strength-2";
        return "mdi-wifi-strength-1";
    }

    return iceState === "checking"
        ? "mdi-wifi-strength-outline"
        : "mdi-wifi-off";
}

function getConnectionQualityText(_peerId: string, peer: PeerInfo): string {
    if (peer.pc.connectionState !== "connected") {
        return `Disconnected: ${peer.pc.connectionState}`;
    }

    const iceState = peer.pc.iceConnectionState;
    const audioStatus = [];

    if (isPeerSendingAudio(peer)) audioStatus.push("sending audio");
    if (isPeerReceivingAudio(peer)) audioStatus.push("receiving audio");

    const audioText =
        audioStatus.length > 0 ? ` (${audioStatus.join(", ")})` : " (no audio)";
    return `ICE: ${iceState}${audioText}`;
}

// ============================================================================
// Audio Analysis
// ============================================================================

function setupAudioAnalysisForPeer(peerId: string) {
    try {
        const ctx = spatialAudio.getAudioContext();
        const nodeInfo = spatialAudio.getPeerNode(peerId);
        if (!ctx || !nodeInfo) return;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;

        // Tap the existing source so analysis shares the same AudioContext
        nodeInfo.source.connect(analyser);

        peerAudioAnalysis.value.set(peerId, {
            analyser,
            source: nodeInfo.source,
            level: 0,
        });

        console.log(`[WebRTC] Audio analysis setup for peer ${peerId}`);
    } catch (err) {
        console.error(
            `[WebRTC] Failed to setup audio analysis for peer ${peerId}:`,
            err,
        );
    }
}

function updateAudioLevels() {
    for (const [peerId, analysisData] of peerAudioAnalysis.value.entries()) {
        const { analyser } = analysisData;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += (dataArray[i] / 255) ** 2;
        }
        const rms = Math.sqrt(sum / bufferLength);
        const rmsLevel = Math.min(rms * 100 * 2, 100);

        peerAudioLevels.value.set(peerId, rmsLevel);
        analysisData.level = rmsLevel;
    }
}

function stopAudioAnalysisForPeer(peerId: string) {
    const analysisData = peerAudioAnalysis.value.get(peerId);
    if (analysisData) {
        analysisData.source.disconnect();
        analysisData.analyser.disconnect();
        peerAudioAnalysis.value.delete(peerId);
        peerAudioLevels.value.delete(peerId);
        console.log(`[WebRTC] Stopped audio analysis for peer ${peerId}`);
    }
}

// ============================================================================
// Reflect API Integration
// ============================================================================

async function announcePresence() {
    if (!props.client || !props.fullSessionId) return;

    const announcement: PeerAnnouncement = {
        sessionId: props.fullSessionId,
        timestamp: Date.now(),
        status: "online",
    };

    try {
        await props.client.client.connection.publishReflect({
            syncGroup: SYNC_GROUP,
            channel: ANNOUNCE_CHANNEL,
            payload: announcement,
        });
    } catch (err) {
        console.error("[WebRTC Reflect] Failed to announce presence:", err);
    }
}

function handleAnnouncement(
    msg: Communication.WebSocket.ReflectDeliveryMessage,
) {
    try {
        const announcement = msg.payload as PeerAnnouncement;

        if (
            !announcement.sessionId ||
            announcement.sessionId === props.fullSessionId
        ) {
            return;
        }

        if (announcement.status === "offline") {
            activePeers.value.delete(announcement.sessionId);
            console.log(
                "[WebRTC Reflect] Peer went offline:",
                announcement.sessionId,
            );
        } else {
            activePeers.value.set(announcement.sessionId, announcement);
            console.log(
                "[WebRTC Reflect] Peer announced:",
                announcement.sessionId,
            );
        }
    } catch (err) {
        console.error("[WebRTC Reflect] Failed to handle announcement:", err);
    }
}

function handleSignalingMessage(
    msg: Communication.WebSocket.ReflectDeliveryMessage,
) {
    try {
        const message = msg.payload as WebRTCReflectMessage;

        if (message.fromSession === props.fullSessionId) return;
        if (message.toSession && message.toSession !== props.fullSessionId)
            return;

        if (message.type === "session-end") {
            disconnectPeer(message.fromSession);
            return;
        }

        if (message.type === "signaling") {
            handlePeerMessage(message.fromSession, message.payload);
        }
    } catch (err) {
        console.error(
            "[WebRTC Reflect] Failed to handle signaling message:",
            err,
        );
    }
}

function cleanupStalePeers() {
    const now = Date.now();
    const staleThreshold = now - PRESENCE_TIMEOUT;

    for (const [sessionId, announcement] of activePeers.value.entries()) {
        if (announcement.timestamp < staleThreshold) {
            activePeers.value.delete(sessionId);
            console.log("[WebRTC Reflect] Removed stale peer:", sessionId);
        }
    }
}

async function sendSignalingMessage(
    toSession: string,
    payload: SignalingMessage,
) {
    if (!props.client || !props.fullSessionId) {
        console.error("[WebRTC Reflect] Cannot send message: not initialized");
        return;
    }

    const message: WebRTCReflectMessage = {
        type: "signaling",
        fromSession: props.fullSessionId,
        toSession,
        payload,
        timestamp: Date.now(),
    };

    try {
        await props.client.client.connection.publishReflect({
            syncGroup: SYNC_GROUP,
            channel: SIGNALING_CHANNEL,
            payload: message,
        });
    } catch (err) {
        console.error(
            "[WebRTC Reflect] Failed to send signaling message:",
            err,
        );
    }
}

async function sendSessionEnd(toSession: string) {
    if (!props.client || !props.fullSessionId) return;

    const message: WebRTCReflectMessage = {
        type: "session-end",
        fromSession: props.fullSessionId,
        toSession,
        payload: {},
        timestamp: Date.now(),
    };

    try {
        await props.client.client.connection.publishReflect({
            syncGroup: SYNC_GROUP,
            channel: SIGNALING_CHANNEL,
            payload: message,
        });
    } catch (err) {
        console.error("[WebRTC Reflect] Failed to send session end:", err);
    }
}

// ============================================================================
// WebRTC Connection Management
// ============================================================================

async function initLocalMedia() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
            video: false,
        });

        localStream.value = stream;
        console.log("[WebRTC] Local media initialized");

        for (const [peerId, peerInfo] of peers.value) {
            for (const track of stream.getTracks()) {
                peerInfo.pc.addTrack(track, stream);
                console.log(
                    `[WebRTC] Added ${track.kind} track to existing peer ${peerId}`,
                );
            }
        }
    } catch (err) {
        console.error("[WebRTC] Failed to get local media:", err);
    }
}

function stopLocalMedia() {
    if (localStream.value) {
        for (const track of localStream.value.getTracks()) {
            track.stop();
        }
        localStream.value = null;
        console.log("[WebRTC] Local media stopped");
    }
}

function setupPerfectNegotiation(peerId: string, peerInfo: PeerInfo) {
    const { pc } = peerInfo;

    pc.addEventListener("negotiationneeded", async () => {
        try {
            peerInfo.makingOffer = true;
            await pc.setLocalDescription();

            if (pc.localDescription) {
                await sendSignalingMessage(peerId, {
                    description: pc.localDescription,
                });
            }

            console.log(
                `[WebRTC] Sent ${pc.localDescription?.type ?? "unknown"} to ${peerId}`,
            );
        } catch (err) {
            console.error("[WebRTC] Negotiation failed:", err);
        } finally {
            peerInfo.makingOffer = false;
        }
    });

    pc.addEventListener("icecandidate", ({ candidate }) => {
        if (candidate) {
            sendSignalingMessage(peerId, { candidate });
        }
    });

    pc.addEventListener("track", (event) => {
        const [remoteStream] = event.streams;
        peerInfo.remoteStream = remoteStream;
        console.log(
            `[WebRTC] Received ${event.track.kind} track from ${peerId}`,
        );

        if (event.track.kind === "audio") {
            if (!spatialAudio.isInitialized.value) {
                spatialAudio.initialize();
            }

            spatialAudio.resumeContext().then((resumed) => {
                if (resumed) {
                    console.log(
                        "[WebRTC] Audio context resumed for spatial audio",
                    );
                }
            });

            try {
                const initialVolume = peerVolumes.value.get(peerId) ?? 100;
                spatialAudio.createPeerAudioNode(
                    peerId,
                    remoteStream,
                    initialVolume,
                );
                console.log(
                    `[WebRTC] Created spatial audio for peer ${peerId}`,
                );

                // Setup audio analysis using shared AudioContext
                setupAudioAnalysisForPeer(peerId);
            } catch (err) {
                console.error(
                    `[WebRTC] Failed to create spatial audio for peer ${peerId}:`,
                    err,
                );
            }
        }
    });

    pc.addEventListener("connectionstatechange", () => {
        console.log(
            `[WebRTC] ${peerId} connection state: ${pc.connectionState}`,
        );

        if (pc.connectionState === "failed") {
            console.warn(
                `[WebRTC] Connection failed for ${peerId}, restarting ICE`,
            );
            pc.restartIce();
        } else if (pc.connectionState === "closed") {
            disconnectPeer(peerId);
        }
    });

    pc.addEventListener("iceconnectionstatechange", () => {
        console.log(`[WebRTC] ${peerId} ICE state: ${pc.iceConnectionState}`);
    });
}

async function processBufferedCandidates(peerInfo: PeerInfo, peerId: string) {
    if (peerInfo.iceCandidateBuffer.length === 0) return;

    console.log(
        `[WebRTC] Processing ${peerInfo.iceCandidateBuffer.length} buffered candidates for ${peerId}`,
    );

    for (const candidate of peerInfo.iceCandidateBuffer) {
        try {
            await peerInfo.pc.addIceCandidate(candidate);
        } catch (err) {
            console.error("[WebRTC] Failed to add buffered candidate:", err);
        }
    }

    peerInfo.iceCandidateBuffer = [];
}

async function handlePeerMessage(
    peerId: string,
    signalingMessage: SignalingMessage,
) {
    let peerInfo = peers.value.get(peerId);

    if (signalingMessage.candidate) {
        if (!peerInfo) {
            console.warn(`[WebRTC] ICE candidate for unknown peer: ${peerId}`);
            return;
        }

        try {
            if (peerInfo.pc.remoteDescription) {
                await peerInfo.pc.addIceCandidate(signalingMessage.candidate);
            } else {
                peerInfo.iceCandidateBuffer.push(signalingMessage.candidate);
                console.log(
                    `[WebRTC] Buffered ICE candidate from ${peerId} (${peerInfo.iceCandidateBuffer.length} total)`,
                );
            }
        } catch (err) {
            console.error("[WebRTC] Failed to handle ICE candidate:", err);
        }
        return;
    }

    if (signalingMessage.description) {
        if (!peerInfo) {
            const mySession = props.fullSessionId ?? "";
            const polite = peerId > mySession;
            peerInfo = await createPeerConnection(peerId, polite);
        }

        const { description } = signalingMessage;
        const { pc } = peerInfo;

        const offerCollision =
            description.type === "offer" &&
            (peerInfo.makingOffer || pc.signalingState !== "stable");

        peerInfo.ignoreOffer = !peerInfo.polite && offerCollision;

        if (peerInfo.ignoreOffer) {
            console.log(
                `[WebRTC] Ignored offer collision from ${peerId} (impolite)`,
            );
            return;
        }

        peerInfo.isSettingRemoteAnswerPending = description.type === "answer";

        try {
            await pc.setRemoteDescription(description);
            console.log(
                `[WebRTC] Set remote ${description.type} from ${peerId}`,
            );

            await processBufferedCandidates(peerInfo, peerId);
        } catch (err) {
            console.error("[WebRTC] Failed to set remote description:", err);
            return;
        } finally {
            peerInfo.isSettingRemoteAnswerPending = false;
        }

        if (description.type === "offer") {
            try {
                await pc.setLocalDescription();

                if (pc.localDescription) {
                    await sendSignalingMessage(peerId, {
                        description: pc.localDescription,
                    });
                }

                console.log(`[WebRTC] Sent answer to ${peerId}`);
            } catch (err) {
                console.error("[WebRTC] Failed to create answer:", err);
            }
        }
    }
}

async function createPeerConnection(
    peerId: string,
    polite: boolean,
): Promise<PeerInfo> {
    console.log(
        `[WebRTC] Creating connection for ${peerId} (polite: ${polite})`,
    );

    const pc = new RTCPeerConnection(rtcConfig);

    const peerInfo: PeerInfo = {
        pc,
        polite,
        makingOffer: false,
        ignoreOffer: false,
        isSettingRemoteAnswerPending: false,
        iceCandidateBuffer: [],
        createdAt: Date.now(),
    };

    peers.value.set(peerId, peerInfo);

    if (localStream.value) {
        for (const track of localStream.value.getTracks()) {
            pc.addTrack(track, localStream.value);
        }
    }

    setupPerfectNegotiation(peerId, peerInfo);

    return peerInfo;
}

async function disconnectPeer(peerId: string) {
    const peerInfo = peers.value.get(peerId);
    if (!peerInfo) return;

    console.log(`[WebRTC] Disconnecting peer ${peerId}`);

    await sendSessionEnd(peerId);
    peerInfo.pc.close();
    spatialAudio.removePeerAudio(peerId);
    stopAudioAnalysisForPeer(peerId);
    peers.value.delete(peerId);
    peerVolumes.value.delete(peerId);
}

function setPeerVolume(peerId: string, volume: number) {
    peerVolumes.value.set(peerId, volume);
    spatialAudio.setPeerVolume(peerId, volume / 100);
}

// ============================================================================
// Lifecycle and Watchers
// ============================================================================

watch(discoveredPeers, (newPeers) => {
    for (const peerId of newPeers) {
        if (peerId === props.fullSessionId) continue;
        if (peers.value.has(peerId)) continue;

        const mySession = props.fullSessionId ?? "";
        const polite = peerId > mySession;
        createPeerConnection(peerId, polite);
    }

    for (const peerId of peers.value.keys()) {
        if (!newPeers.includes(peerId)) {
            disconnectPeer(peerId);
        }
    }
});

watch(audioEnabled, (enabled) => {
    if (localStream.value) {
        for (const track of localStream.value.getAudioTracks()) {
            track.enabled = enabled;
        }
    }
});

onMounted(async () => {
    if (!props.client || !props.fullSessionId) {
        console.error("[WebRTC] Cannot initialize: missing client or session");
        return;
    }

    await initLocalMedia();

    spatialAudio.initialize();
    console.log("[WebRTC] Spatial audio initialized");

    unsubscribeAnnounce = props.client.client.connection.subscribeReflect(
        SYNC_GROUP,
        ANNOUNCE_CHANNEL,
        handleAnnouncement,
    );

    unsubscribeSignaling = props.client.client.connection.subscribeReflect(
        SYNC_GROUP,
        SIGNALING_CHANNEL,
        handleSignalingMessage,
    );

    announcePresence();
    announceInterval = setInterval(announcePresence, ANNOUNCE_INTERVAL);
    cleanupInterval = setInterval(cleanupStalePeers, PRESENCE_TIMEOUT / 2);
    audioAnalysisInterval = setInterval(updateAudioLevels, 100);
    timeUpdateInterval = setInterval(() => {
        currentTime.value = Date.now();
    }, 1000);

    isInitialized.value = true;

    console.log("[WebRTC Reflect] Initialized", {
        syncGroup: SYNC_GROUP,
        session: props.fullSessionId,
    });
});

onUnmounted(async () => {
    if (announceInterval) clearInterval(announceInterval);
    if (cleanupInterval) clearInterval(cleanupInterval);
    if (audioAnalysisInterval) clearInterval(audioAnalysisInterval);
    if (timeUpdateInterval) clearInterval(timeUpdateInterval);

    if (props.client && props.fullSessionId) {
        const announcement: PeerAnnouncement = {
            sessionId: props.fullSessionId,
            timestamp: Date.now(),
            status: "offline",
        };

        try {
            await props.client.client.connection.publishReflect({
                syncGroup: SYNC_GROUP,
                channel: ANNOUNCE_CHANNEL,
                payload: announcement,
            });
        } catch (err) {
            console.error(
                "[WebRTC Reflect] Failed to send offline announcement:",
                err,
            );
        }
    }

    unsubscribeAnnounce?.();
    unsubscribeSignaling?.();

    for (const peerId of peers.value.keys()) {
        await disconnectPeer(peerId);
    }

    stopLocalMedia();
    spatialAudio.cleanup();

    for (const peerId of peerAudioAnalysis.value.keys()) {
        stopAudioAnalysisForPeer(peerId);
    }

    activePeers.value.clear();
    isInitialized.value = false;

    console.log("[WebRTC] Cleaned up");
});
</script>

<style scoped></style>
