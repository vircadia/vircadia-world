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
                    <BabylonWebRTCPeer v-for="[peerId, peer] of peers" :key="peerId" :peer-id="peerId" :peer="peer"
                        :avatar-data="avatarData.get(peerId)" :position-data="avatarPositions.get(peerId)"
                        :my-position="myPosition" :volume="peerVolumes.get(peerId)"
                        @volume-change="(vol) => setPeerVolume(peerId, vol)"
                        @disconnect="() => disconnectPeer(peerId)" />
                </v-expansion-panels>

                <div v-else class="text-center text-grey py-4">
                    No peers connected
                </div>
            </v-card-text>
        </v-card>
    </v-dialog>
</template>

<script setup lang="ts">
import type { AvatarBaseData, AvatarPositionData } from "@schemas";
import type { Communication } from "@vircadia/world-sdk/browser/vue";
import { computed, onMounted, onUnmounted, ref, toRef, watch } from "vue";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";
import { useWebRTCSpatialAudio } from "@/composables/useWebRTCSpatialAudio";
import BabylonWebRTCPeer from "./BabylonWebRTCPeer.vue";

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

// Intervals and subscriptions
let announceInterval: ReturnType<typeof setInterval> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
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

// Spatial Audio Composable with proper sources
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
        myCameraOrientation: toRef(props, "myCameraOrientation"),
        otherPositions: otherPositionsRecord,
    },
);

// Computed
const discoveredPeers = computed(() => Array.from(activePeers.value.keys()));

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
        console.log("[WebRTC Reflect] Announced presence");
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

        if (message.fromSession === props.fullSessionId) {
            return;
        }

        if (message.toSession && message.toSession !== props.fullSessionId) {
            return;
        }

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
            stream.getTracks().forEach((track) => {
                peerInfo.pc.addTrack(track, stream);
                console.log(
                    `[WebRTC] Added ${track.kind} track to existing peer ${peerId}`,
                );
            });
        }
    } catch (err) {
        console.error("[WebRTC] Failed to get local media:", err);
    }
}

function stopLocalMedia() {
    if (localStream.value) {
        localStream.value.getTracks().forEach((track) => track.stop());
        localStream.value = null;
        console.log("[WebRTC] Local media stopped");
    }
}

function setupPerfectNegotiation(peerId: string, peerInfo: PeerInfo) {
    const { pc, polite } = peerInfo;

    pc.addEventListener("negotiationneeded", async () => {
        try {
            peerInfo.makingOffer = true;
            await pc.setLocalDescription();

            await sendSignalingMessage(peerId, {
                description: pc.localDescription!,
            });

            console.log(
                `[WebRTC] Sent ${pc.localDescription!.type} to ${peerId}`,
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
            // Initialize spatial audio if not already done
            if (!spatialAudio.isInitialized.value) {
                spatialAudio.initialize();
            }

            // Resume audio context on first track (handles autoplay policy)
            spatialAudio.resumeContext().then((resumed) => {
                if (resumed) {
                    console.log(
                        "[WebRTC] Audio context resumed for spatial audio",
                    );
                }
            });

            // Create spatial audio node for this peer
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
            const polite = peerId > props.fullSessionId!;
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

                await sendSignalingMessage(peerId, {
                    description: pc.localDescription!,
                });

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
    };

    peers.value.set(peerId, peerInfo);

    if (localStream.value) {
        localStream.value.getTracks().forEach((track) => {
            pc.addTrack(track, localStream.value!);
        });
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
    peers.value.delete(peerId);
    peerVolumes.value.delete(peerId);
}

function setPeerVolume(peerId: string, volume: number) {
    peerVolumes.value.set(peerId, volume);
    // Convert percentage (0-100) to decimal (0-1) for spatial audio
    spatialAudio.setPeerVolume(peerId, volume / 100);
}

// ============================================================================
// Lifecycle and Watchers
// ============================================================================

watch(discoveredPeers, (newPeers) => {
    for (const peerId of newPeers) {
        if (peerId === props.fullSessionId) continue;
        if (peers.value.has(peerId)) continue;

        const polite = peerId > props.fullSessionId!;
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
        localStream.value.getAudioTracks().forEach((track) => {
            track.enabled = enabled;
        });
    }
});

onMounted(async () => {
    if (!props.client || !props.fullSessionId) {
        console.error("[WebRTC] Cannot initialize: missing client or session");
        return;
    }

    // Initialize local media first
    await initLocalMedia();

    // Initialize spatial audio
    spatialAudio.initialize();
    console.log("[WebRTC] Spatial audio initialized");

    // Set up Reflect subscriptions
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

    // Start announcing presence
    announcePresence();
    announceInterval = setInterval(announcePresence, ANNOUNCE_INTERVAL);
    cleanupInterval = setInterval(cleanupStalePeers, PRESENCE_TIMEOUT / 2);

    isInitialized.value = true;

    console.log("[WebRTC Reflect] Initialized", {
        syncGroup: SYNC_GROUP,
        session: props.fullSessionId,
    });
});

onUnmounted(async () => {
    if (announceInterval) {
        clearInterval(announceInterval);
    }
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
    }

    // Send offline announcement
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

    // Unsubscribe from Reflect channels
    unsubscribeAnnounce?.();
    unsubscribeSignaling?.();

    // Disconnect all peers
    for (const peerId of peers.value.keys()) {
        await disconnectPeer(peerId);
    }

    // Clean up local media
    stopLocalMedia();

    // Clean up spatial audio
    spatialAudio.cleanup();

    // Clear state
    activePeers.value.clear();
    isInitialized.value = false;

    console.log("[WebRTC] Cleaned up");
});
</script>

<style scoped></style>
