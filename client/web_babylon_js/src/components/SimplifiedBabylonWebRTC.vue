<template>
  <v-card class="webrtc-status" variant="outlined">
    <v-card-title>WebRTC Status (Simplified)</v-card-title>
    
    <v-card-text>
      <!-- Local Info -->
      <v-list dense>
        <v-list-subheader>Local Session</v-list-subheader>
        <v-list-item>
          <v-list-item-title>
            Entity: {{ webrtc.myEntityName }}
          </v-list-item-title>
        </v-list-item>
        <v-list-item>
          <v-list-item-title>
            Peers: {{ webrtc.peers.value.size }}
          </v-list-item-title>
        </v-list-item>
      </v-list>

      <!-- Active Peers -->
      <v-list dense>
        <v-list-subheader>Active Peers</v-list-subheader>
        <v-list-item v-for="[peerId, pc] in webrtc.peers.value" :key="peerId">
          <v-list-item-title>
            {{ peerId.substring(0, 8) }}...
            <v-chip size="small" :color="getConnectionColor(pc.connectionState)">
              {{ pc.connectionState }}
            </v-chip>
          </v-list-item-title>
        </v-list-item>
      </v-list>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

import { useSimplifiedWebRTC } from "@/composables/useSimplifiedWebRTC";
import { useWebRTCSpatialAudio } from "@/composables/useWebRTCSpatialAudio";

interface Props {
    instanceId: string;
    vircadiaWorld: any;
}

const props = defineProps<Props>();

const vircadiaWorld = props.vircadiaWorld;

// Computed session ID
const fullSessionId = computed(() => {
    const base = vircadiaWorld?.connectionInfo?.value?.sessionId ?? null;
    if (!base) return null;
    return `${base}-${props.instanceId}`;
});

// Initialize simplified WebRTC
const webrtc = fullSessionId.value
    ? useSimplifiedWebRTC(vircadiaWorld, fullSessionId.value)
    : null;

if (!webrtc) {
    throw new Error("Failed to initialize WebRTC");
}

// Initialize spatial audio
const spatialAudio = useWebRTCSpatialAudio({
    refDistance: 1,
    maxDistance: 30,
    rolloffFactor: 2,
    panningModel: "HRTF",
    distanceModel: "inverse",
});

// Local stream management
const localStream = ref<MediaStream | null>(null);

// WebRTC configuration
const rtcConfig: RTCConfiguration = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
    ],
    iceCandidatePoolSize: 10,
};

// Initialize local media stream
async function initializeLocalStream() {
    if (localStream.value) return;

    try {
        localStream.value = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
            video: false,
        });
    } catch (error) {
        console.error("Failed to get user media:", error);
        throw error;
    }
}

// Connect to a peer
async function connectToPeer(remoteSessionId: string) {
    if (!webrtc || webrtc.peers.value.has(remoteSessionId)) return;

    const pc = new RTCPeerConnection(rtcConfig);

    // Add local tracks
    if (localStream.value) {
        for (const track of localStream.value.getTracks()) {
            pc.addTrack(track, localStream.value);
        }
    }

    // Store peer connection
    webrtc.peers.value.set(remoteSessionId, pc);

    // Setup perfect negotiation
    setupPerfectNegotiation(remoteSessionId, pc);

    // Handle incoming tracks
    pc.ontrack = (event) => {
        if (event.streams[0]) {
            spatialAudio.createPeerAudioNode(
                remoteSessionId,
                event.streams[0],
                100,
            );
        }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
        if (
            pc.connectionState === "failed" ||
            pc.connectionState === "closed"
        ) {
            disconnectFromPeer(remoteSessionId);
        }
    };
}

// Disconnect from a peer
function disconnectFromPeer(remoteSessionId: string) {
    if (!webrtc) return;

    const pc = webrtc.peers.value.get(remoteSessionId);
    if (pc) {
        pc.close();
        webrtc.peers.value.delete(remoteSessionId);
    }

    spatialAudio.removePeerAudio(remoteSessionId);

    // Send session end message
    webrtc.sendMessage(remoteSessionId, "session-end", {});
}

// Setup perfect negotiation (simplified)
function setupPerfectNegotiation(
    remoteSessionId: string,
    pc: RTCPeerConnection,
) {
    if (!webrtc || !fullSessionId.value) return;

    const isPolite = fullSessionId.value < remoteSessionId;
    let makingOffer = false;
    let ignoreOffer = false;
    let isSettingRemoteAnswerPending = false;

    // Handle negotiation needed
    pc.onnegotiationneeded = async () => {
        try {
            makingOffer = true;
            await pc.setLocalDescription();

            if (pc.localDescription?.sdp) {
                await webrtc.sendMessage(remoteSessionId, "offer", {
                    sdp: pc.localDescription.sdp,
                });
            }
        } catch (err) {
            console.error("Failed to create offer:", err);
        } finally {
            makingOffer = false;
        }
    };

    // Handle ICE candidates
    pc.onicecandidate = ({ candidate }) => {
        webrtc.sendMessage(remoteSessionId, "ice-candidate", {
            candidate: candidate ? JSON.stringify(candidate) : null,
            sdpMLineIndex: candidate?.sdpMLineIndex || null,
            sdpMid: candidate?.sdpMid || null,
        });
    };

    // Process messages for this peer
    const processMessages = async () => {
        const messages = await webrtc.receiveMessages();

        for (const message of messages) {
            if (message.fromSession !== remoteSessionId) continue;

            try {
                if (message.type === "offer" || message.type === "answer") {
                    const offerAnswerPayload = message.payload as {
                        sdp: string;
                    };
                    const description = {
                        type: message.type as RTCSdpType,
                        sdp: offerAnswerPayload.sdp,
                    };

                    // Perfect negotiation collision detection
                    const readyForOffer =
                        !makingOffer &&
                        (pc.signalingState === "stable" ||
                            isSettingRemoteAnswerPending);
                    const offerCollision =
                        description.type === "offer" && !readyForOffer;
                    ignoreOffer = !isPolite && offerCollision;

                    if (ignoreOffer) {
                        continue;
                    }

                    isSettingRemoteAnswerPending =
                        description.type === "answer";
                    await pc.setRemoteDescription(description);
                    isSettingRemoteAnswerPending = false;

                    if (description.type === "offer") {
                        await pc.setLocalDescription();
                        if (pc.localDescription?.sdp) {
                            await webrtc.sendMessage(
                                remoteSessionId,
                                "answer",
                                {
                                    sdp: pc.localDescription.sdp,
                                },
                            );
                        }
                    }
                } else if (message.type === "ice-candidate") {
                    const candidatePayload = message.payload as {
                        candidate: string | null;
                        sdpMLineIndex: number | null;
                        sdpMid: string | null;
                    };
                    if (candidatePayload.candidate) {
                        const candidate = new RTCIceCandidate(
                            JSON.parse(candidatePayload.candidate),
                        );
                        await pc.addIceCandidate(candidate);
                    }
                } else if (message.type === "session-end") {
                    disconnectFromPeer(remoteSessionId);
                }

                // Update last processed timestamp
                webrtc.updateLastProcessed(
                    message.fromSession,
                    message.timestamp,
                );
            } catch (error) {
                console.error("Error processing message:", error);
            }
        }
    };

    // Start polling for messages (simplified)
    const messageInterval = setInterval(processMessages, 200);

    // Store cleanup function
    const originalClose = pc.close.bind(pc);
    pc.close = () => {
        clearInterval(messageInterval);
        originalClose();
    };
}

// Connection management
async function manageConnections() {
    if (!webrtc) return;

    const activePeers = await webrtc.discoverPeers();
    const currentPeers = new Set(webrtc.peers.value.keys());

    // Connect to new peers
    for (const peerId of activePeers) {
        if (!currentPeers.has(peerId)) {
            await connectToPeer(peerId);
        }
    }

    // Disconnect from inactive peers
    for (const peerId of currentPeers) {
        if (!activePeers.includes(peerId)) {
            disconnectFromPeer(peerId);
        }
    }
}

// Helper function for connection color
function getConnectionColor(state: RTCPeerConnectionState): string {
    switch (state) {
        case "connected":
            return "success";
        case "connecting":
            return "warning";
        case "failed":
            return "error";
        case "disconnected":
            return "error";
        case "closed":
            return "grey";
        case "new":
            return "info";
        default:
            return "grey";
    }
}

// Lifecycle management
const intervals: ReturnType<typeof setInterval>[] = [];

onMounted(async () => {
    // Initialize everything
    spatialAudio.initialize();
    await initializeLocalStream();
    await webrtc.initializePresence();
    await manageConnections();

    // Set up periodic tasks
    intervals.push(setInterval(() => webrtc.initializePresence(), 10000)); // Keep alive
    intervals.push(setInterval(manageConnections, 5000)); // Discover peers
    intervals.push(setInterval(() => webrtc.cleanupOldMessages(), 60000)); // Cleanup
});

onUnmounted(async () => {
    // Clean up intervals
    for (const interval of intervals) {
        clearInterval(interval);
    }

    // Disconnect from all peers
    for (const peerId of webrtc.peers.value.keys()) {
        disconnectFromPeer(peerId);
    }

    // Clean up local stream
    if (localStream.value) {
        for (const track of localStream.value.getTracks()) {
            track.stop();
        }
        localStream.value = null;
    }

    // Clean up WebRTC entity
    await webrtc.cleanup();

    // Clean up spatial audio
    spatialAudio.cleanup();
});
</script>

<style scoped>
.webrtc-status {
    min-width: 400px;
    max-width: 500px;
}
</style> 