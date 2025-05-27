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
        
        <!-- Microphone Device Info -->
        <v-list-item v-if="currentMicDevice" class="ml-4">
          <v-list-item-title class="text-caption">
            Mic Device: {{ currentMicDevice.label || 'Unknown Device' }}
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
              <!-- Outgoing Audio (What we're sending) -->
              <div class="mb-3">
                <strong>Outgoing Audio (Our Mic → Peer):</strong>
                <div class="ml-4 mt-1">
                  <div v-if="getOutgoingAudioTracks(peer).length > 0">
                    <v-chip 
                      size="small" 
                      color="success"
                      class="mb-1"
                    >
                      Sending {{ getOutgoingAudioTracks(peer).length }} track(s)
                    </v-chip>
                    <div v-for="sender in getOutgoingAudioTracks(peer)" :key="sender.track?.id" class="text-caption">
                      • Track: {{ sender.track?.label || sender.track?.id?.substring(0, 8) }}...
                      <v-chip size="x-small" :color="sender.track?.enabled ? 'success' : 'warning'">
                        {{ sender.track?.enabled ? 'Enabled' : 'Disabled' }}
                      </v-chip>
                      <v-chip size="x-small" :color="sender.track?.readyState === 'live' ? 'success' : 'error'">
                        {{ sender.track?.readyState }}
                      </v-chip>
                    </div>
                  </div>
                  <div v-else>
                    <v-chip size="small" color="error">
                      No audio being sent!
                    </v-chip>
                  </div>
                </div>
              </div>
              
              <!-- Incoming Audio (What we're receiving) -->
              <div class="mb-3">
                <strong>Incoming Audio (Peer → Us):</strong>
                <div class="ml-4 mt-1">
                  <div v-if="peer.remoteStream">
                    <v-chip 
                      size="small" 
                      color="success"
                      class="mb-1"
                    >
                      Receiving stream
                    </v-chip>
                    <div v-for="track in peer.remoteStream.getAudioTracks()" :key="track.id" class="text-caption">
                      • {{ track.label || track.id.substring(0, 8) }}...
                      <v-chip size="x-small" :color="track.enabled ? 'success' : 'warning'">
                        {{ track.enabled ? 'Enabled' : 'Disabled' }}
                      </v-chip>
                      <v-chip size="x-small" :color="track.readyState === 'live' ? 'success' : 'error'">
                        {{ track.readyState }}
                      </v-chip>
                    </div>
                  </div>
                  <div v-else>
                    <v-chip size="small" color="grey">
                      No stream received
                    </v-chip>
                  </div>
                </div>
              </div>
              
              <!-- Audio Playback Status -->
              <div class="mb-3">
                <strong>Audio Playback:</strong>
                <div class="ml-4 mt-1">
                  <div v-if="getAudioElement(peerId)">
                    <v-chip 
                      size="small" 
                      :color="getAudioPlaybackColor(peerId)"
                      class="mb-1"
                    >
                      {{ getAudioPlaybackStatus(peerId) }}
                    </v-chip>
                    <div class="text-caption">
                      Volume: {{ Math.round((getAudioElement(peerId)?.volume || 0) * 100) }}%
                      <br>
                      Muted: {{ getAudioElement(peerId)?.muted ? 'Yes' : 'No' }}
                      <br>
                      Ready State: {{ getAudioElement(peerId)?.readyState }}
                    </div>
                  </div>
                  <div v-else>
                    <v-chip size="small" color="grey">
                      No audio element
                    </v-chip>
                  </div>
                </div>
              </div>
              
              <!-- Connection Stats -->
              <div class="mt-2">
                <v-btn 
                  size="small" 
                  variant="outlined"
                  @click="getConnectionStats(peerId)"
                  :loading="loadingStats[peerId]"
                  class="mr-2"
                >
                  Get Stats
                </v-btn>
                <v-btn 
                  size="small" 
                  variant="outlined"
                  color="secondary"
                  @click="debugPeer(peerId)"
                >
                  Debug Info
                </v-btn>
              </div>
              
              <!-- Stats Display -->
              <div v-if="connectionStats[peerId]" class="mt-2 text-caption">
                <div v-for="(value, key) in connectionStats[peerId]" :key="key">
                  <strong>{{ key }}:</strong> {{ value }}
                </div>
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-list>

      <v-divider class="my-2" />

      <!-- Microphone Test -->
      <v-list dense>
        <v-list-subheader>Microphone Test</v-list-subheader>
        <v-list-item>
          <v-btn
            block
            variant="outlined"
            :color="isMicTesting ? 'error' : 'primary'"
            @click="toggleMicrophoneTest"
          >
            {{ isMicTesting ? 'Stop Microphone Test' : 'Test Microphone' }}
          </v-btn>
        </v-list-item>
        <v-list-item v-if="micLevel !== null">
          <v-progress-linear
            :model-value="micLevel"
            height="20"
            :color="micLevel > 30 ? 'success' : 'warning'"
          >
            <template v-slot:default>
              {{ micLevel.toFixed(0) }}%
            </template>
          </v-progress-linear>
        </v-list-item>
        <v-list-item v-if="micError">
          <v-alert type="error" density="compact">{{ micError }}</v-alert>
        </v-list-item>
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

      <v-divider class="my-2" />

      <!-- Manual Connection Test -->
      <v-list dense>
        <v-list-subheader>Manual Connection Test</v-list-subheader>
        <v-list-item>
          <v-text-field
            v-model="testSessionId"
            label="Remote Session ID"
            density="compact"
            variant="outlined"
            hide-details
          />
        </v-list-item>
        <v-list-item>
          <v-btn
            block
            variant="outlined"
            color="primary"
            @click="testConnection"
            :disabled="!testSessionId || connecting"
            :loading="connecting"
          >
            Test Connection
          </v-btn>
        </v-list-item>
      </v-list>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed, ref, watch, onUnmounted, onMounted, inject } from "vue";
import { useAppStore } from "@/stores/appStore";
import {
    useVircadiaInstance,
    useEntity,
} from "@vircadia/world-sdk/browser/vue";
import { z } from "zod";

// WebRTC interfaces
interface WebRTCPeerConnection {
    sessionId: string;
    pc: RTCPeerConnection;
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    connectionState: RTCPeerConnectionState;
    iceConnectionState: RTCIceConnectionState;
    audioElement?: HTMLAudioElement | null;
    audioPlaybackState?: "playing" | "paused" | "error" | "waiting";
}

// Zod schemas for offer and answer payloads
const offerSchema = z.object({
    type: z.literal("offer"),
    sdp: z.string(),
});

const answerSchema = z.object({
    type: z.literal("answer"),
    sdp: z.string(),
});

// Unified schema to accept either offer or answer
const sdpSchema = z.discriminatedUnion("type", [offerSchema, answerSchema]);

// Initialize stores and services
const appStore = useAppStore();
const vircadiaWorld = inject(useVircadiaInstance());

if (!vircadiaWorld) {
    throw new Error("Vircadia instance not found");
}

// WebRTC state
const peers = ref<Map<string, WebRTCPeerConnection>>(new Map());
const localStream = ref<MediaStream | null>(null);
const audioElements = ref<Map<string, HTMLAudioElement>>(new Map());

// Component state
const isRefreshing = ref(false);
const testSessionId = ref("");
const connecting = ref(false);
const connectionStats = ref<Record<string, Record<string, string | number>>>(
    {},
);
const loadingStats = ref<Record<string, boolean>>({});
const currentMicDevice = ref<MediaDeviceInfo | null>(null);

// Microphone test state
const isMicTesting = ref(false);
const micLevel = ref<number | null>(null);
const micError = ref<string | null>(null);
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let microphone: MediaStreamAudioSourceNode | null = null;
let micTestInterval: number | null = null;
let micTestStream: MediaStream | null = null;

// Cleanup registries
const cleanupFunctions: Array<() => void> = [];
const activeSignalingEntities = new Set<string>();

// WebRTC configuration
const rtcConfig: RTCConfiguration = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
    ],
};

// Computed properties
const sessionId = computed(() => appStore.sessionId);
const audioTracks = computed(() => {
    if (!localStream.value) return [];
    return localStream.value.getAudioTracks();
});

// Helper to delete signaling entity
async function deleteEntity(entityId: string): Promise<void> {
    if (!vircadiaWorld) return;

    try {
        await vircadiaWorld.client.Utilities.Connection.query({
            query: "DELETE FROM entity.entities WHERE general__entity_name = $1",
            parameters: [entityId],
            timeoutMs: 10000,
        });
        activeSignalingEntities.delete(entityId);
        console.log(`[WebRTC] Deleted signaling entity: ${entityId}`);
    } catch (err) {
        console.warn(`Failed to delete existing entity ${entityId}:`, err);
    }
}

// WebRTC Signaling Functions
async function createOffer(
    offerId: string,
    description: RTCSessionDescriptionInit,
): Promise<RTCSessionDescriptionInit> {
    if (!vircadiaWorld) throw new Error("Vircadia instance not available");

    console.log(`[WebRTC] Creating offer entity: ${offerId}`);
    await deleteEntity(offerId);

    const entityName = ref(offerId);
    const offerEntity = useEntity({
        instance: vircadiaWorld,
        entityName,
        metaDataSchema: offerSchema,
    });

    await offerEntity.executeCreate(
        "(general__entity_name, meta__data) VALUES ($1, $2) RETURNING general__entity_name",
        [
            offerId,
            JSON.stringify({ type: "offer", sdp: description.sdp ?? "" }),
        ],
    );

    activeSignalingEntities.add(offerId);
    console.log(`[WebRTC] Offer entity created: ${offerId}`);

    setTimeout(() => {
        if (activeSignalingEntities.has(offerId)) {
            deleteEntity(offerId);
        }
    }, 30000);

    cleanupFunctions.push(() => offerEntity.cleanup());
    return description;
}

function waitForOffer(offerId: string) {
    if (!vircadiaWorld) throw new Error("Vircadia instance not available");

    console.log(`[WebRTC] Waiting for offer on entity: ${offerId}`);
    const entityName = ref(offerId);
    const offerEntity = useEntity({
        instance: vircadiaWorld,
        entityName,
        metaDataSchema: sdpSchema,
    });

    offerEntity.executeRetrieve("meta__data", []);
    const interval = setInterval(() => {
        offerEntity.executeRetrieve("meta__data", []);
    }, 2000);

    cleanupFunctions.push(() => {
        clearInterval(interval);
        offerEntity.cleanup();
    });

    const raw = computed(() => offerEntity.entityData.value?.meta__data);
    const offer = computed(() =>
        raw.value?.type === "offer" ? raw.value : null,
    );

    return {
        offer,
        retrieving: offerEntity.retrieving,
        error: offerEntity.error,
    };
}

async function createAnswer(
    offerId: string,
    description: RTCSessionDescriptionInit,
): Promise<RTCSessionDescriptionInit> {
    if (!vircadiaWorld) throw new Error("Vircadia instance not available");

    console.log(`[WebRTC] Creating answer for entity: ${offerId}`);
    const entityName = ref(offerId);
    const answerEntity = useEntity({
        instance: vircadiaWorld,
        entityName,
    });

    await answerEntity.executeRetrieve();

    if (!answerEntity.entityData.value) {
        console.error(`[WebRTC] Entity ${offerId} not found for answer`);
        throw new Error(`Entity ${offerId} not found`);
    }

    await answerEntity.executeUpdate("meta__data = $1", [
        JSON.stringify({ type: "answer", sdp: description.sdp ?? "" }),
    ]);

    console.log(`[WebRTC] Answer sent for entity: ${offerId}`);
    cleanupFunctions.push(() => answerEntity.cleanup());
    return description;
}

function waitForAnswer(offerId: string) {
    if (!vircadiaWorld) throw new Error("Vircadia instance not available");

    console.log(`[WebRTC] Waiting for answer on entity: ${offerId}`);
    const entityName = ref(offerId);
    const answerEntity = useEntity({
        instance: vircadiaWorld,
        entityName,
        metaDataSchema: sdpSchema,
    });

    answerEntity.executeRetrieve("meta__data", []);
    const interval = setInterval(() => {
        answerEntity.executeRetrieve("meta__data", []);
    }, 2000);

    cleanupFunctions.push(() => {
        clearInterval(interval);
        answerEntity.cleanup();
    });

    const raw = computed(() => answerEntity.entityData.value?.meta__data);
    const answer = computed(() =>
        raw.value?.type === "answer" ? raw.value : null,
    );

    return {
        answer,
        retrieving: answerEntity.retrieving,
        error: answerEntity.error,
    };
}

// Initialize local media stream
async function initializeLocalStream() {
    if (localStream.value) {
        console.log("[WebRTC] Local stream already initialized");
        return;
    }

    try {
        console.log("[WebRTC] Requesting user media...");
        localStream.value = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 48000,
                autoGainControl: true,
            },
            video: false,
        });

        const audioTracks = localStream.value.getAudioTracks();
        console.log(
            "[WebRTC] Local stream initialized with",
            audioTracks.length,
            "audio tracks",
        );

        for (const track of audioTracks) {
            track.enabled = true;
            console.log("[WebRTC] Audio track:", {
                id: track.id,
                label: track.label,
                enabled: track.enabled,
                readyState: track.readyState,
            });
        }

        await updateMicrophoneInfo();
    } catch (error) {
        console.error("[WebRTC] Failed to get user media:", error);
        throw error;
    }
}

// Create peer connection
function createPeerConnection(remoteSessionId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection(rtcConfig);

    // Add local tracks
    if (localStream.value) {
        const tracks = localStream.value.getTracks();
        console.log(
            `[WebRTC] Adding ${tracks.length} local tracks to peer connection for ${remoteSessionId}`,
        );
        for (const track of tracks) {
            pc.addTrack(track, localStream.value);
        }
    } else {
        console.error(
            "[WebRTC] No local stream available when creating peer connection!",
        );
    }

    // Set up event handlers
    pc.onicecandidate = async (event) => {
        if (event.candidate) {
            console.log(
                `[WebRTC] ICE candidate for ${remoteSessionId}:`,
                event.candidate.candidate,
            );
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log(
            `[WebRTC] ICE connection state for ${remoteSessionId}:`,
            pc.iceConnectionState,
        );
        const peer = peers.value.get(remoteSessionId);
        if (peer) {
            peer.iceConnectionState = pc.iceConnectionState;
        }
    };

    pc.onconnectionstatechange = () => {
        console.log(
            `[WebRTC] Connection state for ${remoteSessionId}:`,
            pc.connectionState,
        );
        const peer = peers.value.get(remoteSessionId);
        if (peer) {
            peer.connectionState = pc.connectionState;
        }
    };

    pc.ontrack = (event) => {
        console.log(`[WebRTC] Received remote track from ${remoteSessionId}:`, {
            kind: event.track.kind,
            id: event.track.id,
            streams: event.streams.length,
        });

        const peer = peers.value.get(remoteSessionId);
        if (peer && event.streams[0]) {
            peer.remoteStream = event.streams[0];

            // Create and setup audio element for playback
            setupAudioPlayback(remoteSessionId, event.streams[0]);
        }
    };

    // Store peer connection
    peers.value.set(remoteSessionId, {
        sessionId: remoteSessionId,
        pc,
        localStream: localStream.value,
        remoteStream: null,
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
    });

    return pc;
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
    audio.volume = 1.0;

    // Add to DOM (required for some browsers)
    audio.style.display = "none";
    document.body.appendChild(audio);

    // Store reference
    audioElements.value.set(remoteSessionId, audio);

    // Play audio
    audio
        .play()
        .then(() => {
            console.log(
                `[WebRTC] Audio playback started for ${remoteSessionId}`,
            );
        })
        .catch((error) => {
            console.error(
                `[WebRTC] Failed to start audio playback for ${remoteSessionId}:`,
                error,
            );
        });
}

// Initiate connection as caller
async function initiateConnection(remoteSessionId: string) {
    if (!appStore.sessionId) {
        console.error("[WebRTC] No local session ID");
        return;
    }

    if (peers.value.has(remoteSessionId)) {
        console.log(`[WebRTC] Already connected to ${remoteSessionId}`);
        return;
    }

    console.log(`[WebRTC] Initiating connection to ${remoteSessionId}`);
    const signalingId = [appStore.sessionId, remoteSessionId].sort().join("-");

    try {
        const pc = createPeerConnection(remoteSessionId);
        const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false,
        });
        await pc.setLocalDescription(offer);
        await createOffer(signalingId, offer);

        const { answer, error } = waitForAnswer(signalingId);

        watch(answer, async (ans) => {
            if (ans && pc.signalingState === "have-local-offer") {
                console.log(`[WebRTC] Received answer from ${remoteSessionId}`);
                await pc.setRemoteDescription(new RTCSessionDescription(ans));

                setTimeout(() => {
                    deleteEntity(signalingId);
                }, 5000);
            }
        });

        watch(error, (err) => {
            if (err) {
                console.error(
                    `[WebRTC] Error waiting for answer from ${remoteSessionId}:`,
                    err,
                );
            }
        });
    } catch (error) {
        console.error(
            `[WebRTC] Failed to initiate connection to ${remoteSessionId}:`,
            error,
        );
    }
}

// Handle incoming connection as callee
async function handleIncomingConnection(remoteSessionId: string) {
    if (!appStore.sessionId) {
        console.error("[WebRTC] No local session ID");
        return;
    }

    if (peers.value.has(remoteSessionId)) {
        console.log(
            `[WebRTC] Already handling connection from ${remoteSessionId}`,
        );
        return;
    }

    console.log(
        `[WebRTC] Handling incoming connection from ${remoteSessionId}`,
    );
    const signalingId = [appStore.sessionId, remoteSessionId].sort().join("-");

    try {
        const { offer, error } = waitForOffer(signalingId);

        watch(offer, async (off) => {
            if (off && !peers.value.has(remoteSessionId)) {
                console.log(`[WebRTC] Received offer from ${remoteSessionId}`);

                const pc = createPeerConnection(remoteSessionId);
                await pc.setRemoteDescription(new RTCSessionDescription(off));

                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                await createAnswer(signalingId, answer);

                setTimeout(() => {
                    deleteEntity(signalingId);
                }, 5000);
            }
        });

        watch(error, (err) => {
            if (err) {
                console.error(
                    `[WebRTC] Error waiting for offer from ${remoteSessionId}:`,
                    err,
                );
            }
        });
    } catch (error) {
        console.error(
            `[WebRTC] Failed to handle connection from ${remoteSessionId}:`,
            error,
        );
    }
}

// Connect to a peer
async function connectToPeer(remoteSessionId: string) {
    if (!appStore.sessionId) {
        console.error("[WebRTC] No local session ID");
        return;
    }

    if (!localStream.value) {
        console.log(
            "[WebRTC] Initializing local stream before connecting to peer",
        );
        try {
            await initializeLocalStream();
        } catch (error) {
            console.error("[WebRTC] Failed to initialize local stream:", error);
            return;
        }
    }

    if (!localStream.value || localStream.value.getAudioTracks().length === 0) {
        console.error("[WebRTC] No audio tracks in local stream!");
        return;
    }

    console.log(`[WebRTC] Connecting to peer ${remoteSessionId}`);

    // Determine who initiates based on session ID comparison
    if (appStore.sessionId < remoteSessionId) {
        await initiateConnection(remoteSessionId);
    } else {
        await handleIncomingConnection(remoteSessionId);
    }
}

// Disconnect from a peer
function disconnectFromPeer(remoteSessionId: string) {
    const peer = peers.value.get(remoteSessionId);
    if (peer) {
        peer.pc.close();
        peers.value.delete(remoteSessionId);

        const audioElement = audioElements.value.get(remoteSessionId);
        if (audioElement) {
            audioElement.pause();
            audioElement.srcObject = null;
            audioElement.remove();
            audioElements.value.delete(remoteSessionId);
        }

        console.log(`[WebRTC] Disconnected from ${remoteSessionId}`);
    }
}

// Get current microphone device info
async function updateMicrophoneInfo() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(
            (device) => device.kind === "audioinput",
        );

        if (audioTracks.value.length > 0) {
            const trackSettings = audioTracks.value[0].getSettings();
            if (trackSettings.deviceId) {
                currentMicDevice.value =
                    audioInputs.find(
                        (device) => device.deviceId === trackSettings.deviceId,
                    ) || null;
            }
        }
    } catch (error) {
        console.error("Failed to enumerate devices:", error);
    }
}

// Get outgoing audio tracks for a peer
function getOutgoingAudioTracks(peer: WebRTCPeerConnection) {
    const senders = peer.pc.getSenders();
    return senders.filter(
        (sender: RTCRtpSender) => sender.track && sender.track.kind === "audio",
    );
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

// Helper functions for audio element status
function getAudioElement(peerId: string): HTMLAudioElement | undefined {
    return audioElements.value.get(peerId);
}

function getAudioPlaybackStatus(peerId: string): string {
    const audioElement = audioElements.value.get(peerId);
    if (!audioElement) return "No Audio Element";
    if (audioElement.paused) return "Paused";
    if (audioElement.readyState < 3) return "Loading";
    if (audioElement.error) return "Error";
    return "Playing";
}

function getAudioPlaybackColor(peerId: string): string {
    const status = getAudioPlaybackStatus(peerId);
    switch (status) {
        case "Playing":
            return "success";
        case "Paused":
            return "warning";
        case "Loading":
            return "info";
        case "Error":
            return "error";
        default:
            return "grey";
    }
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
    await updateMicrophoneInfo();
    await new Promise((resolve) => setTimeout(resolve, 500));
    isRefreshing.value = false;
}

// Get connection statistics
async function getConnectionStats(peerId: string) {
    const peer = peers.value.get(peerId);
    if (!peer) return;

    loadingStats.value[peerId] = true;

    try {
        const stats = await peer.pc.getStats();
        const statsData: Record<string, string | number> = {};

        for (const report of stats.values()) {
            if (report.type === "inbound-rtp" && report.mediaType === "audio") {
                statsData["Audio Bytes Received"] = report.bytesReceived || 0;
                statsData["Audio Packets Received"] =
                    report.packetsReceived || 0;
                statsData["Audio Packets Lost"] = report.packetsLost || 0;
                statsData["Audio Jitter"] = report.jitter
                    ? `${(report.jitter * 1000).toFixed(2)}ms`
                    : "N/A";
            } else if (
                report.type === "outbound-rtp" &&
                report.mediaType === "audio"
            ) {
                statsData["Audio Bytes Sent"] = report.bytesSent || 0;
                statsData["Audio Packets Sent"] = report.packetsSent || 0;
            } else if (
                report.type === "candidate-pair" &&
                report.state === "succeeded"
            ) {
                statsData["Round Trip Time"] = report.currentRoundTripTime
                    ? `${(report.currentRoundTripTime * 1000).toFixed(2)}ms`
                    : "N/A";
            }
        }

        connectionStats.value[peerId] = statsData;
    } catch (error) {
        console.error("Failed to get connection stats:", error);
    } finally {
        loadingStats.value[peerId] = false;
    }
}

// Test manual connection
async function testConnection() {
    if (!testSessionId.value) return;

    connecting.value = true;
    try {
        await connectToPeer(testSessionId.value);
        testSessionId.value = "";
    } catch (error) {
        console.error("Failed to connect:", error);
    } finally {
        connecting.value = false;
    }
}

// Toggle microphone test
async function toggleMicrophoneTest() {
    if (isMicTesting.value) {
        stopMicrophoneTest();
    } else {
        await startMicrophoneTest();
    }
}

// Start microphone test
async function startMicrophoneTest() {
    try {
        micError.value = null;

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });

        micTestStream = stream;

        audioContext = new AudioContext();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;

        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        micTestInterval = setInterval(() => {
            if (!analyser) return;

            analyser.getByteFrequencyData(dataArray);

            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            micLevel.value = (average / 255) * 100;
        }, 100);

        isMicTesting.value = true;
        console.log("[Mic Test] Started successfully");
    } catch (error) {
        console.error("[Mic Test] Failed to start:", error);
        micError.value =
            error instanceof Error
                ? error.message
                : "Failed to access microphone";
        stopMicrophoneTest();
    }
}

// Stop microphone test
function stopMicrophoneTest() {
    if (micTestInterval) {
        clearInterval(micTestInterval);
        micTestInterval = null;
    }

    if (microphone) {
        microphone.disconnect();
        microphone = null;
    }

    if (analyser) {
        analyser.disconnect();
        analyser = null;
    }

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    if (micTestStream) {
        for (const track of micTestStream.getTracks()) {
            track.stop();
        }
        micTestStream = null;
    }

    isMicTesting.value = false;
    micLevel.value = null;
    console.log("[Mic Test] Stopped");
}

// Debug peer connection
function debugPeer(peerId: string) {
    const peer = peers.value.get(peerId);
    if (!peer) {
        console.log(`[WebRTC Debug] No peer found with ID: ${peerId}`);
        return;
    }

    const senders = peer.pc.getSenders();
    const receivers = peer.pc.getReceivers();

    const debugInfo = {
        sessionId: peerId,
        connectionState: peer.pc.connectionState,
        iceConnectionState: peer.pc.iceConnectionState,
        signalingState: peer.pc.signalingState,
        localStream: {
            exists: !!peer.localStream,
            audioTracks:
                peer.localStream?.getAudioTracks().map((t) => ({
                    id: t.id,
                    label: t.label,
                    enabled: t.enabled,
                    readyState: t.readyState,
                })) || [],
        },
        remoteStream: {
            exists: !!peer.remoteStream,
            audioTracks:
                peer.remoteStream?.getAudioTracks().map((t) => ({
                    id: t.id,
                    label: t.label,
                    enabled: t.enabled,
                    readyState: t.readyState,
                })) || [],
        },
        senders: senders.map((s) => ({
            track: s.track
                ? {
                      kind: s.track.kind,
                      id: s.track.id,
                      enabled: s.track.enabled,
                      readyState: s.track.readyState,
                  }
                : null,
        })),
        receivers: receivers.map((r) => ({
            track: r.track
                ? {
                      kind: r.track.kind,
                      id: r.track.id,
                      enabled: r.track.enabled,
                      readyState: r.track.readyState,
                  }
                : null,
        })),
    };

    console.log(`[WebRTC Debug] Peer ${peerId}:`, debugInfo);
}

// Cleanup all connections
function cleanup() {
    // Close all peer connections
    for (const [sessionId, peer] of peers.value) {
        peer.pc.close();
    }
    peers.value.clear();

    // Clean up all audio elements
    for (const [sessionId, audioElement] of audioElements.value) {
        audioElement.pause();
        audioElement.srcObject = null;
        audioElement.remove();
    }
    audioElements.value.clear();

    // Stop local stream
    if (localStream.value) {
        for (const track of localStream.value.getTracks()) {
            track.stop();
        }
        localStream.value = null;
    }

    // Cleanup signaling entities
    for (const cleanup of cleanupFunctions) {
        cleanup();
    }
    cleanupFunctions.length = 0;

    // Clean up any remaining signaling entities
    const entitiesToDelete = Array.from(activeSignalingEntities);
    activeSignalingEntities.clear();
    Promise.all(entitiesToDelete.map((entityId) => deleteEntity(entityId)));
}

// Watch for changes in otherAvatarsMetadata to connect/disconnect
watch(
    () => appStore.otherAvatarsMetadata,
    (newMetadata, oldMetadata) => {
        // Connect to new avatars
        for (const sessionId in newMetadata) {
            if (!oldMetadata || !(sessionId in oldMetadata)) {
                console.log(`[WebRTC] New avatar detected: ${sessionId}`);
                connectToPeer(sessionId);
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

// Watch for changes in peers to clean up stats
watch(
    peers,
    () => {
        for (const peerId in connectionStats.value) {
            if (!peers.value.has(peerId)) {
                delete connectionStats.value[peerId];
                delete loadingStats.value[peerId];
            }
        }
    },
    { deep: true },
);

// Watch for local stream changes
watch(localStream, async () => {
    await updateMicrophoneInfo();
});

// Initial setup
onMounted(async () => {
    // Initialize local stream on mount
    try {
        await initializeLocalStream();
    } catch (error) {
        console.error("[WebRTC] Failed to initialize on mount:", error);
    }

    // Connect to existing avatars
    for (const sessionId in appStore.otherAvatarsMetadata) {
        connectToPeer(sessionId);
    }
});

// Cleanup on unmount
onUnmounted(() => {
    stopMicrophoneTest();
    cleanup();
});

// Expose connection count for parent components
const connectionCount = computed(() => peers.value.size);

defineExpose({
    connectionCount,
});
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