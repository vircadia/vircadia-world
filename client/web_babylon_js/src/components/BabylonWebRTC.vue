<template>
  <v-card class="webrtc-status" variant="outlined">
    <v-card-title class="d-flex align-center">
      <span class="text-subtitle-1">WebRTC Status</span>
      <v-spacer />
      <v-btn 
        icon 
        size="small" 
        variant="text"
        @click="refreshConnections"
        :loading="isRefreshing"
      >
        <v-icon>mdi-refresh</v-icon>
      </v-btn>
    </v-card-title>
    
    <v-card-text>
      <!-- Local Session Info -->
      <v-list dense>
        <v-list-subheader>Local Session</v-list-subheader>
        <v-list-item>
          <v-list-item-title>Session ID: {{ sessionId || 'Not connected' }}</v-list-item-title>
        </v-list-item>
        <v-list-item>
          <v-list-item-title>
            Local Stream: 
            <v-chip 
              :color="localStream ? 'success' : 'error'" 
              size="small"
              variant="flat"
            >
              {{ localStream ? 'Active' : 'Inactive' }}
            </v-chip>
            <span v-if="localStream && audioTracks.length > 0" class="ml-2">
              ({{ audioTracks.length }} audio track{{ audioTracks.length > 1 ? 's' : '' }})
            </span>
          </v-list-item-title>
        </v-list-item>
        
        <!-- Mic Controls -->
        <v-list-item v-if="localStream">
          <v-list-item-title class="d-flex align-center">
            <span class="text-caption mr-2">Microphone:</span>
            <v-btn
              :icon="isMuted ? 'mdi-microphone-off' : 'mdi-microphone'"
              :color="isMuted ? 'error' : 'success'"
              size="small"
              variant="flat"
              @click="toggleMute"
            />
            <v-slider
              v-model="micVolume"
              :disabled="isMuted"
              class="ml-4"
              density="compact"
              hide-details
              min="0"
              max="100"
              step="1"
              thumb-label
              style="max-width: 200px"
              @update:model-value="updateMicVolume"
            >
              <template v-slot:prepend>
                <v-icon size="small">mdi-volume-low</v-icon>
              </template>
              <template v-slot:append>
                <v-icon size="small">mdi-volume-high</v-icon>
              </template>
            </v-slider>
            <span class="ml-2 text-caption">{{ micVolume }}%</span>
          </v-list-item-title>
        </v-list-item>
        
        <!-- Audio Track Details -->
        <v-list-item v-for="(track, index) in audioTracks" :key="track.id" class="ml-4">
          <v-list-item-title class="text-caption">
            Track {{ index + 1 }}: {{ track.label || track.id.substring(0, 8) }}...
            <v-chip size="x-small" :color="track.enabled ? 'success' : 'warning'">
              {{ track.enabled ? 'Enabled' : 'Disabled' }}
            </v-chip>
            <v-chip size="x-small" :color="track.readyState === 'live' ? 'success' : 'error'">
              {{ track.readyState }}
            </v-chip>
          </v-list-item-title>
        </v-list-item>
      </v-list>

      <v-divider class="my-2" />

      <!-- Peer Connections -->
      <v-list dense>
        <v-list-subheader>Peer Connections ({{ peers.size }})</v-list-subheader>
        
        <v-list-item v-if="peers.size === 0">
          <v-list-item-title class="text-caption text-grey">No active connections</v-list-item-title>
        </v-list-item>
        
        <v-expansion-panels v-if="peers.size > 0" variant="accordion">
          <v-expansion-panel v-for="[peerId, peer] in peers" :key="peerId">
            <v-expansion-panel-title>
              <div class="d-flex align-center" style="width: 100%">
                <span>{{ peerId.substring(0, 8) }}...</span>
                <v-spacer />
                <v-chip 
                  size="small" 
                  :color="getConnectionColor(peer.connectionState)"
                  class="mr-2"
                >
                  {{ peer.connectionState }}
                </v-chip>
                <v-chip 
                  size="small" 
                  :color="getIceColor(peer.iceConnectionState)"
                >
                  {{ peer.iceConnectionState }}
                </v-chip>
              </div>
            </v-expansion-panel-title>
            
            <v-expansion-panel-text>
              <!-- Connection Info -->
              <div class="mb-3">
                <strong>Status:</strong>
                <div class="ml-4 mt-1">
                  <div class="text-caption">
                    Signaling State: {{ peer.signalingState }}
                    <br>
                    Local Tracks: {{ peer.localTracks }}
                    <br>
                    Remote Tracks: {{ peer.remoteTracks }}
                    <br>
                    ICE Gathering: {{ peer.iceGatheringState }}
                  </div>
                </div>
              </div>
              
              <!-- Audio Playback Status -->
              <div class="mb-3">
                <strong>Audio:</strong>
                <div class="ml-4 mt-1">
                  <v-chip 
                    size="small" 
                    :color="peer.remoteStream ? 'success' : 'grey'"
                  >
                    {{ peer.remoteStream ? 'Receiving Audio' : 'No Audio' }}
                  </v-chip>
                  
                  <!-- Volume Control for Remote Audio -->
                  <div v-if="peer.remoteStream" class="mt-2 d-flex align-center">
                    <v-icon size="small" class="mr-2">mdi-volume-high</v-icon>
                    <v-slider
                      :model-value="getPeerVolume(peerId)"
                      @update:model-value="(value) => setPeerVolume(peerId, value)"
                      class="flex-grow-1"
                      density="compact"
                      hide-details
                      min="0"
                      max="100"
                      step="1"
                      thumb-label
                      style="max-width: 200px"
                    />
                    <span class="ml-2 text-caption">{{ getPeerVolume(peerId) }}%</span>
                  </div>
                </div>
              </div>
              
              <!-- Debug Info -->
              <div class="mb-3">
                <strong>Debug Info:</strong>
                <div class="ml-4 mt-1">
                  <div class="text-caption">
                    Entity: {{ peer.debugInfo.entityName }}
                    <br>
                    Politeness: {{ peer.debugInfo.isPolite ? 'Polite' : 'Impolite' }}
                    <br>
                    Messages Sent: {{ peer.debugInfo.messagesSent }}
                    <br>
                    Messages Received: {{ peer.debugInfo.messagesReceived }}
                    <br>
                    Last Activity: {{ peer.debugInfo.lastMessageTime ? new Date(peer.debugInfo.lastMessageTime).toLocaleTimeString() : 'Never' }}
                  </div>
                  
                  <!-- Negotiation State -->
                  <div class="mt-2">
                    <v-chip 
                      size="x-small" 
                      :color="peer.debugInfo.negotiationState.makingOffer ? 'warning' : 'grey'"
                      class="mr-1"
                    >
                      {{ peer.debugInfo.negotiationState.makingOffer ? 'Making Offer' : 'Not Offering' }}
                    </v-chip>
                    <v-chip 
                      size="x-small" 
                      :color="peer.debugInfo.negotiationState.ignoreOffer ? 'error' : 'grey'"
                      class="mr-1"
                    >
                      {{ peer.debugInfo.negotiationState.ignoreOffer ? 'Ignoring Offers' : 'Accepting Offers' }}
                    </v-chip>
                    <v-chip 
                      size="x-small" 
                      :color="peer.debugInfo.negotiationState.isSettingRemoteAnswerPending ? 'info' : 'grey'"
                    >
                      {{ peer.debugInfo.negotiationState.isSettingRemoteAnswerPending ? 'Setting Answer' : 'Idle' }}
                    </v-chip>
                  </div>
                </div>
              </div>
              
              <!-- Debug Actions -->
              <div class="mt-2">
                <v-btn 
                  size="small" 
                  variant="outlined"
                  @click="debugPeer(peerId)"
                >
                  Console Debug
                </v-btn>
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-list>

      <v-divider class="my-2" />

      <!-- Initialize Local Stream -->
      <v-list dense>
        <v-list-subheader>Stream Management</v-list-subheader>
        <v-list-item>
          <v-btn
            block
            variant="outlined"
            color="primary"
            @click="initializeStream"
            :disabled="!!localStream"
          >
            {{ localStream ? 'Stream Active' : 'Initialize Local Stream' }}
          </v-btn>
        </v-list-item>
      </v-list>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed, ref, watch, onUnmounted, onMounted, inject } from "vue";
import { useAppStore } from "@/stores/appStore";
import { useWebRTC } from "@vircadia/world-sdk/browser/vue";
import { useVircadiaInstance } from "@vircadia/world-sdk/browser/vue";

// Type definitions
interface PeerInfo {
    pc: RTCPeerConnection;
    remoteStream: MediaStream | null;
    connectionState: RTCPeerConnectionState;
    iceConnectionState: RTCIceConnectionState;
    iceGatheringState: RTCIceGatheringState;
    signalingState: RTCSignalingState;
    localTracks: number;
    remoteTracks: number;
    cleanup: (() => void) | null;
    debugInfo: {
        entityName: string;
        sessionId: string;
        isPolite: boolean;
        lastMessageTime: number;
        messagesSent: number;
        messagesReceived: number;
        negotiationState: {
            makingOffer: boolean;
            ignoreOffer: boolean;
            isSettingRemoteAnswerPending: boolean;
        };
    };
}

// Store webrtc instances separately
const webrtcInstances = ref(new Map());

// Initialize stores and services
const appStore = useAppStore();
const vircadiaWorld = inject(useVircadiaInstance());

if (!vircadiaWorld) {
    throw new Error("Vircadia instance not found");
}

// Component state
const peers = ref<Map<string, PeerInfo>>(new Map());
const localStream = ref<MediaStream | null>(null);
const isRefreshing = ref(false);
const audioElements = ref<Map<string, HTMLAudioElement>>(new Map());
const isMuted = ref(false);
const micVolume = ref(100);
const peerVolumes = ref<Map<string, number>>(new Map());

// Audio processing nodes
const audioContext = ref<AudioContext | null>(null);
const gainNode = ref<GainNode | null>(null);
const source = ref<MediaStreamAudioSourceNode | null>(null);
const destination = ref<MediaStreamAudioDestinationNode | null>(null);

// Computed properties
const sessionId = computed(() => appStore.sessionId);
const audioTracks = computed(() => {
    if (!localStream.value) return [];
    return localStream.value.getAudioTracks();
});

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
    if (localStream.value) {
        console.log("[WebRTC] Local stream already initialized");
        return;
    }

    try {
        console.log("[WebRTC] Requesting user media...");
        const rawStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
            video: false,
        });

        // Create audio context for volume control
        audioContext.value = new AudioContext();
        source.value = audioContext.value.createMediaStreamSource(rawStream);
        gainNode.value = audioContext.value.createGain();
        destination.value = audioContext.value.createMediaStreamDestination();

        // Connect the audio graph
        source.value.connect(gainNode.value);
        gainNode.value.connect(destination.value);

        // Set initial volume
        gainNode.value.gain.value = micVolume.value / 100;

        // Use the processed stream as our local stream
        localStream.value = destination.value.stream;

        const audioTracks = localStream.value.getAudioTracks();
        console.log(
            `[WebRTC] Local stream initialized with ${audioTracks.length} audio tracks`,
        );
    } catch (error) {
        console.error("[WebRTC] Failed to get user media:", error);
        throw error;
    }
}

// Connect to a peer using perfect negotiation
async function connectToPeer(remoteSessionId: string) {
    console.log(
        `[WebRTC] connectToPeer called for ${remoteSessionId}, local session: ${sessionId.value}`,
    );

    if (!sessionId.value) {
        console.error("[WebRTC] Cannot connect without a local session ID");
        return;
    }
    
    if (peers.value.has(remoteSessionId)) {
        console.log(
            `[WebRTC] Already connected to ${remoteSessionId}`,
        );
        return;
    }

    console.log(`[WebRTC] Connecting to peer ${remoteSessionId}`);

    if (!localStream.value) {
        console.log(
            "[WebRTC] Local stream not initialized, initializing now...",
        );
        await initializeLocalStream();
    }

    // Create unique channel ID (both peers use same channel)
    const channelId = [sessionId.value, remoteSessionId].sort().join("-");

    console.log(`[WebRTC] Connecting with:`, {
        localSession: sessionId.value,
        remoteSession: remoteSessionId,
        channelId,
        isPolite: sessionId.value < remoteSessionId,
    });

    // Initialize WebRTC with perfect negotiation
    const webrtc = useWebRTC({
        instance: vircadiaWorld,
        channelId,
        localSessionId: sessionId.value,
    });

    try {
        // Initialize signaling channel
        await webrtc.initializeSignaling();

        // Create peer connection
        const pc = new RTCPeerConnection(rtcConfig);

        // Add local tracks
        if (localStream.value) {
            for (const track of localStream.value.getTracks()) {
                pc.addTrack(track, localStream.value);
            }
        }

        // Store peer info
        const peerInfo: PeerInfo = {
            pc,
            remoteStream: null,
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            iceGatheringState: pc.iceGatheringState,
            signalingState: pc.signalingState,
            localTracks: localStream.value?.getTracks().length || 0,
            remoteTracks: 0,
            cleanup: null,
            debugInfo: {
                entityName: `webrtc-${[sessionId.value, remoteSessionId].sort().join("-")}`,
                sessionId: remoteSessionId,
                isPolite: sessionId.value < remoteSessionId,
                lastMessageTime: Date.now(),
                messagesSent: 0,
                messagesReceived: 0,
                negotiationState: {
                    makingOffer: false,
                    ignoreOffer: false,
                    isSettingRemoteAnswerPending: false,
                },
            },
        };

        peers.value.set(remoteSessionId, peerInfo);
        webrtcInstances.value.set(remoteSessionId, webrtc);

        // Set up event handlers
        pc.oniceconnectionstatechange = () => {
            console.log(
                `[WebRTC] ICE state for ${remoteSessionId}: ${pc.iceConnectionState}`,
            );
            peerInfo.iceConnectionState = pc.iceConnectionState;
        };

        pc.onicegatheringstatechange = () => {
            console.log(
                `[WebRTC] ICE gathering state for ${remoteSessionId}: ${pc.iceGatheringState}`,
            );
            peerInfo.iceGatheringState = pc.iceGatheringState;
        };

        pc.onconnectionstatechange = () => {
            console.log(
                `[WebRTC] Connection state for ${remoteSessionId}: ${pc.connectionState}`,
            );
            peerInfo.connectionState = pc.connectionState;

            if (
                pc.connectionState === "failed" ||
                pc.connectionState === "closed"
            ) {
                disconnectFromPeer(remoteSessionId);
            }
        };

        pc.onsignalingstatechange = () => {
            console.log(
                `[WebRTC] Signaling state for ${remoteSessionId}: ${pc.signalingState}`,
            );
            peerInfo.signalingState = pc.signalingState;
        };

        pc.ontrack = (event) => {
            console.log(`[WebRTC] Received track from ${remoteSessionId}`);
            if (event.streams[0]) {
                peerInfo.remoteStream = event.streams[0];
                peerInfo.remoteTracks = event.streams[0].getTracks().length;
                setupAudioPlayback(remoteSessionId, event.streams[0]);
            }
        };

        // Set up perfect negotiation (handles all offer/answer/ICE logic automatically)
        const { cleanup } = webrtc.setupPerfectNegotiation(pc);
        peerInfo.cleanup = cleanup;

        // Update debug info periodically from webrtc stats
        const debugInterval = setInterval(() => {
            if (webrtc.debugStats?.value) {
                peerInfo.debugInfo.messagesSent = webrtc.debugStats.value.messagesSent;
                peerInfo.debugInfo.messagesReceived = webrtc.debugStats.value.messagesReceived;
                peerInfo.debugInfo.lastMessageTime = webrtc.debugStats.value.lastMessageTime;
            }
            if (webrtc.state?.value) {
                peerInfo.debugInfo.negotiationState = {
                    makingOffer: webrtc.state.value.makingOffer,
                    ignoreOffer: webrtc.state.value.ignoreOffer,
                    isSettingRemoteAnswerPending: webrtc.state.value.isSettingRemoteAnswerPending,
                };
            }
        }, 500);

        // Store interval cleanup
        const originalCleanup = peerInfo.cleanup;
        peerInfo.cleanup = () => {
            clearInterval(debugInterval);
            if (originalCleanup) originalCleanup();
        };

        console.log(
            `[WebRTC] Perfect negotiation set up for ${remoteSessionId}`,
        );
    } catch (error) {
        console.error(
            `[WebRTC] Failed to connect to ${remoteSessionId}:`,
            error,
        );
        peers.value.delete(remoteSessionId);
        throw error;
    }
}

// Setup audio playback for remote stream
function setupAudioPlayback(remoteSessionId: string, stream: MediaStream) {
    // Remove existing audio element if any
    const existingAudio = audioElements.value.get(remoteSessionId);
    if (existingAudio) {
        existingAudio.pause();
        existingAudio.srcObject = null;
        existingAudio.remove();
    }

    // Create new audio element
    const audio = new Audio();
    audio.srcObject = stream;
    audio.autoplay = true;

    // Set volume from stored value or default to 100%
    const storedVolume = peerVolumes.value.get(remoteSessionId);
    audio.volume = storedVolume !== undefined ? storedVolume / 100 : 1.0;

    // Add to DOM (hidden)
    audio.style.display = "none";
    document.body.appendChild(audio);

    // Store reference
    audioElements.value.set(remoteSessionId, audio);

    // Try to play
    audio.play().catch((error) => {
        console.error(
            `[WebRTC] Failed to play audio for ${remoteSessionId}:`,
            error,
        );
    });
}

// Disconnect from a peer
function disconnectFromPeer(remoteSessionId: string) {
    const peer = peers.value.get(remoteSessionId);
    const webrtc = webrtcInstances.value.get(remoteSessionId);

    if (peer) {
        // Clean up perfect negotiation handlers
        if (peer.cleanup) {
            peer.cleanup();
        }

        // Close peer connection
        peer.pc.close();

        // Remove from peers map
        peers.value.delete(remoteSessionId);
    }

    if (webrtc) {
        // Send session end signal
        webrtc.sendSessionEnd();

        // Remove from webrtc instances
        webrtcInstances.value.delete(remoteSessionId);
    }

    // Clean up audio element
    const audioElement = audioElements.value.get(remoteSessionId);
    if (audioElement) {
        audioElement.pause();
        audioElement.srcObject = null;
        audioElement.remove();
        audioElements.value.delete(remoteSessionId);
    }

    // Clean up volume setting
    peerVolumes.value.delete(remoteSessionId);

    console.log(`[WebRTC] Disconnected from ${remoteSessionId}`);
}

// Get connection state color
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

// Get ICE connection state color
function getIceColor(state: RTCIceConnectionState): string {
    switch (state) {
        case "connected":
            return "success";
        case "completed":
            return "success";
        case "checking":
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

// Debug peer connection
function debugPeer(peerId: string) {
    const peer = peers.value.get(peerId);
    const webrtc = webrtcInstances.value.get(peerId);
    if (!peer) return;

    console.log(`[WebRTC Debug] Peer ${peerId}:`, {
        connectionState: peer.pc.connectionState,
        iceConnectionState: peer.pc.iceConnectionState,
        iceGatheringState: peer.pc.iceGatheringState,
        signalingState: peer.pc.signalingState,
        localTracks: peer.localTracks,
        remoteTracks: peer.remoteTracks,
        hasRemoteStream: !!peer.remoteStream,
        debugInfo: peer.debugInfo,
        webrtcStats: webrtc
            ? {
                  sessionId: webrtc.sessionId?.value,
                  isPolite: webrtc.isPolite?.value,
                  entityName: webrtc.entityName?.value,
                  debugStats: webrtc.debugStats?.value,
              }
            : null,
    });

    // Get stats
    peer.pc.getStats().then((stats) => {
        for (const report of stats.values()) {
            if (
                report.type === "candidate-pair" &&
                report.state === "succeeded"
            ) {
                console.log("[WebRTC Debug] Active candidate pair:", report);
            }
        }
    });
}

// Initialize local stream wrapper
async function initializeStream() {
    try {
        await initializeLocalStream();
    } catch (error) {
        console.error("Failed to initialize stream:", error);
    }
}

// Refresh connections
async function refreshConnections() {
    isRefreshing.value = true;

    // Disconnect from all peers
    const currentPeers = Array.from(peers.value.keys());
    for (const peerId of currentPeers) {
        disconnectFromPeer(peerId);
    }

    // Wait a bit before reconnecting
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Reconnect to all avatars
    for (const sessionId in appStore.otherAvatarsMetadata) {
        await connectToPeer(sessionId);
    }

    isRefreshing.value = false;
}

// Watch for changes in other avatars
watch(
    () => appStore.otherAvatarsMetadata,
    async (newMetadata, oldMetadata) => {
        console.log("[WebRTC] otherAvatarsMetadata changed:", {
            newKeys: Object.keys(newMetadata),
            oldKeys: oldMetadata ? Object.keys(oldMetadata) : [],
            localSessionId: sessionId.value,
        });

        // Connect to new avatars
        for (const sessionId in newMetadata) {
            if (!oldMetadata || !(sessionId in oldMetadata)) {
                console.log(`[WebRTC] New avatar detected: ${sessionId}`);
                await connectToPeer(sessionId);
            }
        }

        // Disconnect from removed avatars
        if (oldMetadata) {
            for (const sessionId in oldMetadata) {
                if (!(sessionId in newMetadata)) {
                    console.log(`[WebRTC] Avatar left: ${sessionId}`);
                    disconnectFromPeer(sessionId);
                }
            }
        }
    },
    { deep: true },
);

// Initial setup
onMounted(async () => {
    console.log("[WebRTC] Component mounted, session ID:", sessionId.value);

    // Initialize local stream
    try {
        await initializeLocalStream();
        console.log("[WebRTC] Local stream initialized successfully");
    } catch (error) {
        console.error("[WebRTC] Failed to initialize on mount:", error);
    }

    // Log current avatars
    const currentAvatars = Object.keys(appStore.otherAvatarsMetadata);
    console.log("[WebRTC] Current avatars on mount:", currentAvatars);

    // Connect to existing avatars
    for (const sessionId in appStore.otherAvatarsMetadata) {
        console.log(`[WebRTC] Connecting to existing avatar: ${sessionId}`);
        await connectToPeer(sessionId);
    }
});

// Cleanup on unmount
onUnmounted(() => {
    // Close all peer connections
    for (const [sessionId, _] of peers.value) {
        disconnectFromPeer(sessionId);
    }

    // Stop local stream
    if (localStream.value) {
        for (const track of localStream.value.getTracks()) {
            track.stop();
        }
        localStream.value = null;
    }

    // Clean up audio context
    if (source.value) {
        source.value.disconnect();
        source.value = null;
    }
    if (gainNode.value) {
        gainNode.value.disconnect();
        gainNode.value = null;
    }
    if (destination.value) {
        destination.value = null;
    }
    if (audioContext.value) {
        audioContext.value.close();
        audioContext.value = null;
    }
});

// Expose peers for parent components
defineExpose({
    peers,
});

// Mic controls
function toggleMute() {
    isMuted.value = !isMuted.value;

    if (localStream.value) {
        const audioTracks = localStream.value.getAudioTracks();
        for (const track of audioTracks) {
            track.enabled = !isMuted.value;
        }
        console.log(
            `[WebRTC] Microphone ${isMuted.value ? "muted" : "unmuted"}`,
        );
    }
}

function updateMicVolume(value: number) {
    micVolume.value = value;

    if (gainNode.value) {
        gainNode.value.gain.value = value / 100;
        console.log(`[WebRTC] Mic volume set to ${value}%`);
    }
}

// Get peer volume
function getPeerVolume(peerId: string): number {
    return peerVolumes.value.get(peerId) || 100;
}

// Set peer volume
function setPeerVolume(peerId: string, volume: number) {
    peerVolumes.value.set(peerId, volume);

    const audioElement = audioElements.value.get(peerId);
    if (audioElement) {
        audioElement.volume = volume / 100;
        console.log(`[WebRTC] Volume for ${peerId} set to ${volume}%`);
    }
}
</script>

<style scoped>
.webrtc-status {
  min-width: 400px;
  max-width: 500px;
  max-height: 80vh;
  overflow-y: auto;
}

.v-expansion-panel-text {
  font-size: 0.875rem;
}
</style> 