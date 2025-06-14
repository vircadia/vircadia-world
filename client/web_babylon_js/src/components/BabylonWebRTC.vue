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
          <v-list-item-title>
            Base Session: {{ baseSessionId || 'Not connected' }}
          </v-list-item-title>
        </v-list-item>
        <v-list-item>
          <v-list-item-title>
            Instance ID: {{ instanceId }}
          </v-list-item-title>
        </v-list-item>
        <v-list-item>
          <v-list-item-title>
            Full Session: {{ fullSessionId || 'Not ready' }}
          </v-list-item-title>
        </v-list-item>
        <v-list-item>
          <v-list-item-title>
            Status: 
            <v-chip 
              color="success"
              size="small"
              variant="flat"
            >
              Ready
            </v-chip>
          </v-list-item-title>
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
                  :color="getConnectionColor(peer.pc.connectionState)"
                  class="mr-2"
                >
                  {{ peer.pc.connectionState }}
                </v-chip>
                <v-chip 
                  size="small" 
                  :color="getIceColor(peer.pc.iceConnectionState)"
                >
                  {{ peer.pc.iceConnectionState }}
                </v-chip>
              </div>
            </v-expansion-panel-title>
            
            <v-expansion-panel-text>
              <!-- Connection Info -->
              <div class="mb-3">
                <strong>Connection Status:</strong>
                <div class="ml-4 mt-1">
                  <div class="text-caption">
                    Signaling State: {{ peer.pc.signalingState }}
                    <br>
                    Local Tracks: {{ localStream?.getTracks().length || 0 }}
                    <br>
                    Remote Tracks: {{ peer.remoteStream?.getTracks().length || 0 }}
                    <br>
                    ICE Gathering: {{ peer.pc.iceGatheringState }}
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
              
              <!-- Perfect Negotiation Debug Info -->
              <div class="mb-3">
                <strong>Perfect Negotiation:</strong>
                <div class="ml-4 mt-1">
                  <div class="text-caption">
                    Politeness: {{ peer.isPolite ? 'Polite' : 'Impolite' }}
                    <br>
                    Last Message Check: {{ new Date(peer.lastMessageCheck).toLocaleTimeString() }}
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

      <!-- Database State Debug -->
      <v-list dense>
        <v-list-subheader class="d-flex align-center">
          Message Entities
          <v-btn 
            icon 
            size="x-small" 
            variant="text"
            @click="refreshDatabaseState"
            :loading="isRefreshingDatabase"
            class="ml-2"
          >
            <v-icon size="small">mdi-refresh</v-icon>
          </v-btn>
        </v-list-subheader>
        
        <v-expansion-panels v-if="messageEntities.length > 0" variant="accordion" density="compact">
          <v-expansion-panel v-for="entity in messageEntities" :key="entity.entityName">
            <v-expansion-panel-title>
              <div class="d-flex align-center" style="width: 100%">
                <span class="text-caption">{{ entity.entityName.substring(0, 30) }}...</span>
                <v-spacer />
                <v-chip size="x-small" :color="entity.processed ? 'success' : 'warning'">
                  {{ entity.processed ? 'Processed' : 'Pending' }}
                </v-chip>
              </div>
            </v-expansion-panel-title>
            
            <v-expansion-panel-text>
              <div class="text-caption">
                <div><strong>Type:</strong> {{ entity.type }}</div>
                <div><strong>From:</strong> {{ entity.fromSession.substring(0, 8) }}...</div>
                <div><strong>To:</strong> {{ entity.toSession.substring(0, 8) }}...</div>
                <div><strong>Timestamp:</strong> {{ new Date(entity.timestamp).toLocaleString() }}</div>
                <div><strong>Processed:</strong> {{ entity.processed ? 'Yes' : 'No' }}</div>
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
        
        <v-list-item v-if="messageEntities.length === 0">
          <v-list-item-title class="text-caption text-grey">No message entities found</v-list-item-title>
        </v-list-item>
      </v-list>

      <v-divider class="my-2" />

      <!-- Peer Discovery Debug -->
      <v-list dense>
        <v-list-subheader>Peer Discovery (Automatic)</v-list-subheader>
        <v-list-item>
          <v-list-item-title class="text-caption">
            Discovered Peers: {{ discoveredPeers.size }}
          </v-list-item-title>
        </v-list-item>
        <v-list-item v-for="peerId in Array.from(discoveredPeers)" :key="peerId">
          <v-list-item-title class="text-caption ml-4">
            {{ peerId.substring(0, 8) }}... 
            <v-chip 
              size="x-small" 
              :color="peers.has(peerId) ? 'success' : 'warning'"
            >
              {{ peers.has(peerId) ? 'Connected' : 'Discovered' }}
            </v-chip>
          </v-list-item-title>
        </v-list-item>
        
        <v-list-item v-if="discoveredPeers.size === 0">
          <v-list-item-title class="text-caption text-grey ml-4">No peers discovered</v-list-item-title>
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
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
declare global {
    interface Window {
        webrtcSessionIdLogged?: boolean;
    }
}
import { computed, ref, watch, onUnmounted, onMounted, inject } from "vue";
import { useAppStore } from "@/stores/appStore";
import { useVircadiaInstance } from "@vircadia/world-sdk/browser/vue";
import {
    WebRTCMessageEntitySchema,
    createMessageEntityName,
    getIncomingMessagePattern,
    PeerDiscoveryEntitySchema,
} from "@/composables/schemas";
import type {
    WebRTCMessageEntity,
    PeerDiscoveryEntity,
} from "@/composables/schemas";

// Helper to generate a random string for instance-specific identifiers
function generateRandomString(length: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Enhanced peer info interface with simplified state
interface PeerInfo {
    pc: RTCPeerConnection;
    remoteStream: MediaStream | null;
    isPolite: boolean;
    lastMessageCheck: number;
    lastProcessedTimestamp: number;
    cleanup: (() => void) | null;
}

// Message payload types
interface OfferAnswerPayload {
    sdp: string;
}

interface IceCandidatePayload {
    candidate: string | null;
    sdpMLineIndex: number | null;
    sdpMid: string | null;
}

interface SessionEndPayload {
    [key: string]: never;
}

type MessagePayload =
    | OfferAnswerPayload
    | IceCandidatePayload
    | SessionEndPayload;

interface ProcessedMessage {
    type: "offer" | "answer" | "ice-candidate" | "session-end";
    payload: MessagePayload;
    fromSession: string;
    toSession: string;
    timestamp: number;
    processed: boolean;
}

// Initialize stores and services
const appStore = useAppStore();
const vircadiaWorld = inject(useVircadiaInstance());

if (!vircadiaWorld) {
    throw new Error("Vircadia instance not found");
}

// Generate a unique instance ID for this component instance to allow multiple tabs
const instanceId = generateRandomString(6);

// Component state
const peers = ref<Map<string, PeerInfo>>(new Map());
const localStream = ref<MediaStream | null>(null);
const isRefreshing = ref(false);
const audioElements = ref<Map<string, HTMLAudioElement>>(new Map());
const isMuted = ref(false);
const micVolume = ref(100);
const peerVolumes = ref<Map<string, number>>(new Map());
const discoveredPeers = ref<Set<string>>(new Set());

// Database debugging state
interface MessageEntityInfo {
    entityName: string;
    type: string;
    fromSession: string;
    toSession: string;
    timestamp: number;
    processed: boolean;
}

const messageEntities = ref<MessageEntityInfo[]>([]);
const isRefreshingDatabase = ref(false);

// Audio processing nodes
const audioContext = ref<AudioContext | null>(null);
const gainNode = ref<GainNode | null>(null);
const source = ref<MediaStreamAudioSourceNode | null>(null);
const destination = ref<MediaStreamAudioDestinationNode | null>(null);

// Computed properties for session management
const baseSessionId = computed(() => appStore.sessionId);
const fullSessionId = computed(() => {
    const base = baseSessionId.value;
    if (!base) return null;
    return `${base}-${instanceId}`;
});

// Legacy alias for backward compatibility
const sessionId = computed(() => fullSessionId.value);

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

// PEER DISCOVERY FUNCTIONS

// Announce our presence to other peers
const announcePeerPresence = async () => {
    if (!fullSessionId.value || !vircadiaWorld) return;

    const entityName = `webrtc-peer-${fullSessionId.value}`;
    const discoveryData: PeerDiscoveryEntity = {
        sessionId: fullSessionId.value,
        timestamp: Date.now(),
        status: "online",
    };

    try {
        // Use UPSERT to update existing or create new
        await vircadiaWorld.client.Utilities.Connection.query({
            query: `
                INSERT INTO entity.entities (general__entity_name, meta__data, general__expiry__delete_since_updated_at_ms) 
                VALUES ($1, $2, $3)
                ON CONFLICT (general__entity_name) 
                DO UPDATE SET meta__data = $2, general__expiry__delete_since_updated_at_ms = $3
            `,
            parameters: [entityName, discoveryData, 30000], // Delete after 30 seconds of inactivity
        });
    } catch (error) {
        console.error("[WebRTC] Failed to announce presence:", error);
    }
};

// Discover other peers
const discoverPeers = async (): Promise<string[]> => {
    if (!vircadiaWorld || !fullSessionId.value) return [];

    try {
        const cutoffTime = Date.now() - 30000; // 30 seconds ago

        const result = await vircadiaWorld.client.Utilities.Connection.query({
            query: `
                SELECT meta__data FROM entity.entities 
                WHERE general__entity_name LIKE 'webrtc-peer-%'
                AND meta__data->>'status' = 'online'
                AND CAST(meta__data->>'timestamp' AS BIGINT) > $1
            `,
            parameters: [cutoffTime],
        });

        const activePeers: string[] = [];

        if (Array.isArray(result.result)) {
            for (const entity of result.result) {
                const discoveryData = PeerDiscoveryEntitySchema.safeParse(
                    entity.meta__data,
                );

                if (
                    discoveryData.success &&
                    discoveryData.data.sessionId !== fullSessionId.value
                ) {
                    activePeers.push(discoveryData.data.sessionId);
                }
            }
        }

        return activePeers;
    } catch (error) {
        console.error("[WebRTC] Failed to discover peers:", error);
        return [];
    }
};

// Clean up peer discovery entries when leaving
const announcePeerDeparture = async () => {
    if (!fullSessionId.value || !vircadiaWorld) return;

    const entityName = `webrtc-peer-${fullSessionId.value}`;

    try {
        await vircadiaWorld.client.Utilities.Connection.query({
            query: "DELETE FROM entity.entities WHERE general__entity_name = $1",
            parameters: [entityName],
        });
    } catch (error) {
        console.error("[WebRTC] Failed to announce departure:", error);
    }
};

// CORE MESSAGE FUNCTIONS

// Send a message by creating an individual entity
const sendMessage = async (
    toSession: string,
    type: "offer" | "answer" | "ice-candidate" | "session-end",
    payload: Record<string, unknown>,
) => {
    if (!fullSessionId.value || !vircadiaWorld) return;

    const timestamp = Date.now();
    const entityName = createMessageEntityName(
        fullSessionId.value,
        toSession,
        type,
        timestamp,
    );

    try {
        await vircadiaWorld.client.Utilities.Connection.query({
            query: `INSERT INTO entity.entities 
                    (general__entity_name, meta__data, general__expiry__delete_since_created_at_ms) 
                    VALUES ($1, $2, $3)`,
            parameters: [
                entityName,
                {
                    type,
                    payload,
                    fromSession: fullSessionId.value,
                    toSession,
                    timestamp,
                    processed: false,
                },
                300000, // Delete after 5 minutes (300000ms)
            ],
        });

        console.log(
            `[WebRTC] Sent ${type} message to ${toSession.substring(0, 8)}... at ${timestamp}`,
        );
    } catch (error) {
        console.error(`[WebRTC] Failed to send ${type} message:`, error);
        throw error;
    }
};

// Receive messages for a specific peer, filtering by their last processed timestamp
const receiveMessagesForPeer = async (
    remoteSessionId: string,
): Promise<WebRTCMessageEntity[]> => {
    const currentSessionId = fullSessionId.value;
    if (!currentSessionId || !vircadiaWorld) return [];

    const peerInfo = peers.value.get(remoteSessionId);
    const lastProcessed = peerInfo?.lastProcessedTimestamp || 0;

    try {
        const result = await vircadiaWorld.client.Utilities.Connection.query({
            query: `
                SELECT * FROM entity.entities 
                WHERE general__entity_name LIKE $1 
                AND meta__data->>'fromSession' = $2
                AND meta__data->>'processed' = 'false'
                AND CAST(meta__data->>'timestamp' AS BIGINT) > $3
                ORDER BY meta__data->>'timestamp' ASC
            `,
            parameters: [
                getIncomingMessagePattern(currentSessionId),
                remoteSessionId,
                Math.max(lastProcessed, Date.now() - 60000),
            ],
        });

        if (Array.isArray(result.result)) {
            return result.result.map((entity) =>
                WebRTCMessageEntitySchema.parse(entity),
            );
        }
        return [];
    } catch (error) {
        console.error("[WebRTC] Failed to receive messages for peer:", error);
        return [];
    }
};

// Mark a message as processed
const markMessageProcessed = async (entityName: string) => {
    if (!vircadiaWorld) return;

    try {
        await vircadiaWorld.client.Utilities.Connection.query({
            query: "UPDATE entity.entities SET meta__data = meta__data || $1 WHERE general__entity_name = $2",
            parameters: [{ processed: true }, entityName],
        });
    } catch (error) {
        console.error("[WebRTC] Failed to mark message as processed:", error);
    }
};

// TYPE-SAFE MESSAGE SENDERS

const sendOffer = async (toSession: string, sdp: string) => {
    await sendMessage(toSession, "offer", { sdp });
};

const sendAnswer = async (toSession: string, sdp: string) => {
    await sendMessage(toSession, "answer", { sdp });
};

const sendIceCandidate = async (
    toSession: string,
    candidate: RTCIceCandidate | null,
) => {
    await sendMessage(toSession, "ice-candidate", {
        candidate: candidate ? JSON.stringify(candidate) : null,
        sdpMLineIndex: candidate?.sdpMLineIndex || null,
        sdpMid: candidate?.sdpMid || null,
    });
};

const sendSessionEnd = async (toSession: string) => {
    await sendMessage(toSession, "session-end", {});
};

// MESSAGE PROCESSING LOGIC

const processMessage = async (
    fromSession: string,
    message: ProcessedMessage,
    pc: RTCPeerConnection,
) => {
    const peerInfo = peers.value.get(fromSession);
    if (!peerInfo) return;

    const now = Date.now();
    const delay = now - message.timestamp;
    console.log(
        `[WebRTC] Processing ${message.type} from ${fromSession.substring(0, 8)}... (delay: ${delay}ms, pc state: ${pc.signalingState})`,
    );

    switch (message.type) {
        case "offer":
        case "answer":
            await handleOfferAnswer(fromSession, message, pc, peerInfo);
            break;

        case "ice-candidate":
            await handleIceCandidate(message, pc, peerInfo);
            break;

        case "session-end":
            console.log(
                `[WebRTC] Received session end from ${fromSession.substring(0, 8)}...`,
            );
            pc.close();
            disconnectFromPeer(fromSession);
            break;
    }
};

const handleOfferAnswer = async (
    fromSession: string,
    message: ProcessedMessage,
    pc: RTCPeerConnection,
    peerInfo: PeerInfo,
) => {
    if (message.type !== "offer" && message.type !== "answer") return;

    const payload = message.payload as OfferAnswerPayload;
    const description = {
        type: message.type as RTCSdpType,
        sdp: payload.sdp,
    };

    try {
        if (message.type === "offer") {
            // Handle offer collision - proper perfect negotiation
            const offerCollision = pc.signalingState !== "stable";

            if (offerCollision && !peerInfo.isPolite) {
                // Impolite peer ignores offer collision
                console.log(
                    `[WebRTC] Impolite peer ignoring offer collision (state: ${pc.signalingState})`,
                );
                return;
            }

            if (offerCollision && peerInfo.isPolite) {
                // Polite peer rolls back its offer
                console.log(
                    `[WebRTC] Polite peer rolling back offer collision (state: ${pc.signalingState})`,
                );
                try {
                    await pc.setLocalDescription({ type: "rollback" });
                    console.log("[WebRTC] Rollback completed successfully");
                } catch (rollbackError) {
                    console.error("[WebRTC] Rollback failed:", rollbackError);
                    // Continue anyway, might still work
                }
            }

            await pc.setRemoteDescription(description);
            await pc.setLocalDescription();

            if (pc.localDescription?.sdp) {
                await sendAnswer(fromSession, pc.localDescription.sdp);
            }
        } else {
            // Handle answer
            if (pc.signalingState === "have-local-offer") {
                await pc.setRemoteDescription(description);
            } else {
                console.log(
                    `[WebRTC] Ignoring answer in wrong state: ${pc.signalingState}`,
                );
            }
        }
    } catch (error) {
        console.error(`[WebRTC] Failed to process ${description.type}:`, error);
    }
};

const handleIceCandidate = async (
    message: ProcessedMessage,
    pc: RTCPeerConnection,
    peerInfo: PeerInfo,
) => {
    if (message.type !== "ice-candidate") return;

    const payload = message.payload as IceCandidatePayload;
    if (payload.candidate) {
        try {
            const candidate = new RTCIceCandidate(
                JSON.parse(payload.candidate),
            );
            await pc.addIceCandidate(candidate);
            console.log("[WebRTC] ICE candidate added successfully");
        } catch (error) {
            // Ignore ICE candidate errors - they're often harmless
            console.log(
                "[WebRTC] ICE candidate ignored:",
                error instanceof Error ? error.message : String(error),
            );
        }
    }
};

// SIMPLIFIED PERFECT NEGOTIATION

const setupSimplifiedNegotiation = (
    remoteSessionId: string,
    pc: RTCPeerConnection,
) => {
    const peerInfo = peers.value.get(remoteSessionId);
    if (!peerInfo) return { cleanup: () => {} };

    // Perfect negotiation with proper state management
    let makingOffer = false;

    pc.onnegotiationneeded = async () => {
        try {
            // Prevent re-entrant calls during negotiation
            if (makingOffer) {
                console.log(
                    `[WebRTC] Skipping negotiation (makingOffer: ${makingOffer}, state: ${pc.signalingState})`,
                );
                return;
            }

            makingOffer = true;
            console.log(
                `[WebRTC] Starting negotiation for ${remoteSessionId.substring(0, 8)}... (${peerInfo.isPolite ? "polite" : "impolite"})`,
            );

            // Add deterministic delay based on session ID to reduce collision probability
            // Impolite peer gets slightly longer delay to let polite peer go first
            const baseDelay = peerInfo.isPolite ? 10 : 50;
            const sessionHash =
                fullSessionId.value?.split("").reduce((hash, char) => {
                    return (
                        ((hash << 5) - hash + char.charCodeAt(0)) & 0xffffffff
                    );
                }, 0) || 0;
            const delay = baseDelay + (Math.abs(sessionHash) % 50);

            await new Promise((resolve) => setTimeout(resolve, delay));

            await pc.setLocalDescription();
            if (pc.localDescription?.sdp) {
                await sendOffer(remoteSessionId, pc.localDescription.sdp);
            }
        } catch (error) {
            console.error("[WebRTC] Failed to create offer:", error);
        } finally {
            makingOffer = false;
        }
    };

    // Handle ICE candidates
    pc.onicecandidate = async ({ candidate }) => {
        if (candidate) {
            await sendIceCandidate(remoteSessionId, candidate);
        }
    };

    // Process incoming messages for this peer
    const processMessages = async () => {
        const messages = await receiveMessagesForPeer(remoteSessionId);
        if (messages.length === 0) return;

        console.log(
            `[WebRTC] Processing ${messages.length} messages for ${remoteSessionId.substring(0, 8)}...`,
        );

        for (const messageEntity of messages) {
            const message = messageEntity.meta__data;
            try {
                peerInfo.lastProcessedTimestamp = Math.max(
                    peerInfo.lastProcessedTimestamp,
                    message.timestamp,
                );

                await processMessage(
                    remoteSessionId,
                    message as ProcessedMessage,
                    pc,
                );
                await markMessageProcessed(messageEntity.general__entity_name);
                peerInfo.lastMessageCheck = Date.now();
            } catch (error) {
                console.error("[WebRTC] Failed to process message:", error);
            }
        }
    };

    // Check for messages every 200ms
    const messageInterval = setInterval(processMessages, 200);

    return {
        cleanup: () => {
            pc.onnegotiationneeded = null;
            pc.onicecandidate = null;
            clearInterval(messageInterval);
        },
    };
};

// PEER MANAGEMENT WITH AUTOMATIC DISCOVERY

// Manage peer connections based on discovered peers
const manageConnections = async () => {
    try {
        const activePeers = await discoverPeers();
        const currentPeers = new Set(peers.value.keys());
        const newPeers = new Set(activePeers);

        // Connect to new peers
        for (const peerId of newPeers) {
            if (!currentPeers.has(peerId)) {
                console.log(
                    `[WebRTC] Connecting to newly discovered peer: ${peerId.substring(0, 8)}...`,
                );
                await connectToPeer(peerId);
            }
        }

        // Disconnect from peers that are no longer active
        for (const peerId of currentPeers) {
            if (!newPeers.has(peerId)) {
                console.log(
                    `[WebRTC] Peer ${peerId.substring(0, 8)}... no longer active, disconnecting`,
                );
                disconnectFromPeer(peerId);
            }
        }

        // Update discovered peers for UI
        discoveredPeers.value = newPeers;
    } catch (error) {
        console.error("[WebRTC] Failed to manage connections:", error);
    }
};

// Initialize local media stream
async function initializeLocalStream() {
    if (localStream.value) {
        return;
    }

    try {
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

        console.log(
            "[WebRTC] Local stream initialized with",
            localStream.value.getAudioTracks().length,
            "audio tracks",
        );
    } catch (error) {
        console.error("Failed to get user media:", error);
        throw error;
    }
}

// PEER CONNECTION MANAGEMENT

async function connectToPeer(remoteSessionId: string) {
    const currentSessionId = fullSessionId.value;
    if (!currentSessionId || peers.value.has(remoteSessionId)) {
        return;
    }

    if (!localStream.value) {
        await initializeLocalStream();
    }

    console.log(
        `[WebRTC] Connecting to peer: ${remoteSessionId.substring(0, 8)}...`,
    );

    // Create peer connection
    const pc = new RTCPeerConnection(rtcConfig);

    // Add local tracks
    if (localStream.value) {
        for (const track of localStream.value.getTracks()) {
            pc.addTrack(track, localStream.value);
        }
    }

    // Create enhanced peer info
    const peerInfo: PeerInfo = {
        pc,
        remoteStream: null,
        isPolite: currentSessionId < remoteSessionId,
        lastMessageCheck: Date.now(),
        lastProcessedTimestamp: Date.now(),
        cleanup: null,
    };

    peers.value.set(remoteSessionId, peerInfo);

    // Set up event handlers
    pc.ontrack = (event) => {
        if (event.streams[0]) {
            peerInfo.remoteStream = event.streams[0];
            setupAudioPlayback(remoteSessionId, event.streams[0]);
            console.log(
                `[WebRTC] Received remote stream from ${remoteSessionId.substring(0, 8)}...`,
            );
        }
    };

    pc.onconnectionstatechange = () => {
        console.log(
            `[WebRTC] Connection state changed to ${pc.connectionState} for ${remoteSessionId.substring(0, 8)}...`,
        );
        if (
            pc.connectionState === "failed" ||
            pc.connectionState === "closed"
        ) {
            disconnectFromPeer(remoteSessionId);
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log(
            `[WebRTC] ICE connection state changed to ${pc.iceConnectionState} for ${remoteSessionId.substring(0, 8)}...`,
        );
    };

    // Set up perfect negotiation
    const { cleanup } = setupSimplifiedNegotiation(remoteSessionId, pc);
    peerInfo.cleanup = cleanup;

    console.log(
        `[WebRTC] Peer connection setup complete for ${remoteSessionId.substring(0, 8)}... (${peerInfo.isPolite ? "polite" : "impolite"})`,
    );
}

function disconnectFromPeer(remoteSessionId: string) {
    const peerInfo = peers.value.get(remoteSessionId);

    console.log(
        `[WebRTC] Disconnecting from peer: ${remoteSessionId.substring(0, 8)}...`,
    );

    if (peerInfo) {
        if (peerInfo.cleanup) {
            peerInfo.cleanup();
        }
        peerInfo.pc.close();
        peers.value.delete(remoteSessionId);
    }

    // Send session end
    sendSessionEnd(remoteSessionId).catch((err) => {
        console.error("Failed to send session end:", err);
    });

    // Clean up audio
    const audioElement = audioElements.value.get(remoteSessionId);
    if (audioElement) {
        audioElement.pause();
        audioElement.srcObject = null;
        audioElement.remove();
        audioElements.value.delete(remoteSessionId);
    }

    // Clean up volume setting
    peerVolumes.value.delete(remoteSessionId);
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
        console.warn("Audio autoplay blocked:", error);
    });
}

// UI HELPER FUNCTIONS

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

function debugPeer(peerId: string) {
    const peer = peers.value.get(peerId);
    if (!peer) return;

    console.log(`[WebRTC Debug] Peer ${peerId}:`, {
        connectionState: peer.pc.connectionState,
        iceConnectionState: peer.pc.iceConnectionState,
        iceGatheringState: peer.pc.iceGatheringState,
        signalingState: peer.pc.signalingState,
        isPolite: peer.isPolite,
        hasRemoteStream: !!peer.remoteStream,
        lastMessageCheck: new Date(peer.lastMessageCheck),
    });

    // Get WebRTC stats
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

// AUDIO CONTROLS

function toggleMute() {
    isMuted.value = !isMuted.value;

    if (localStream.value) {
        const audioTracks = localStream.value.getAudioTracks();
        for (const track of audioTracks) {
            track.enabled = !isMuted.value;
        }
    }
}

function updateMicVolume(value: number) {
    micVolume.value = value;

    if (gainNode.value) {
        gainNode.value.gain.value = value / 100;
    }
}

function getPeerVolume(peerId: string): number {
    return peerVolumes.value.get(peerId) || 100;
}

function setPeerVolume(peerId: string, volume: number) {
    peerVolumes.value.set(peerId, volume);

    const audioElement = audioElements.value.get(peerId);
    if (audioElement) {
        audioElement.volume = volume / 100;
    }
}

// DATABASE DEBUG FUNCTIONS

async function refreshDatabaseState() {
    isRefreshingDatabase.value = true;

    try {
        if (!vircadiaWorld) {
            console.error(
                "[WebRTC Database Debug] Vircadia world instance not available",
            );
            return;
        }

        const result = await vircadiaWorld.client.Utilities.Connection.query({
            query: "SELECT * FROM entity.entities WHERE general__entity_name LIKE 'webrtc-msg-%' ORDER BY meta__data->>'timestamp' DESC LIMIT 20",
            parameters: [],
        });

        messageEntities.value = [];

        if (Array.isArray(result.result)) {
            for (const entity of result.result) {
                try {
                    const parsed = WebRTCMessageEntitySchema.parse(entity);
                    messageEntities.value.push({
                        entityName: parsed.general__entity_name,
                        type: parsed.meta__data.type,
                        fromSession: parsed.meta__data.fromSession,
                        toSession: parsed.meta__data.toSession,
                        timestamp: parsed.meta__data.timestamp,
                        processed: parsed.meta__data.processed,
                    });
                } catch (err) {
                    console.error("Failed to parse message entity:", err);
                }
            }
        }

        console.log(
            `[WebRTC Database Debug] Found ${messageEntities.value.length} message entities`,
        );
    } catch (error) {
        console.error(
            "[WebRTC Database Debug] Failed to refresh database state:",
            error,
        );
    } finally {
        isRefreshingDatabase.value = false;
    }
}

// MAIN FUNCTIONS

async function initializeStream() {
    try {
        await initializeLocalStream();
    } catch (error) {
        console.error("Failed to initialize stream:", error);
    }
}

async function refreshConnections() {
    isRefreshing.value = true;

    console.log("[WebRTC] Refreshing connections...");

    // Disconnect from all peers
    const currentPeers = Array.from(peers.value.keys());
    for (const peerId of currentPeers) {
        disconnectFromPeer(peerId);
    }

    // Wait a bit before reconnecting
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Discover and connect to peers
    await manageConnections();

    isRefreshing.value = false;
}

// LIFECYCLE MANAGEMENT

// Debug logging for session changes
watch(
    fullSessionId,
    (newId, oldId) => {
        if (newId !== oldId) {
            console.log(`[WebRTC] Session ID changed: ${oldId} -> ${newId}`);
        }
    },
    { immediate: true },
);

// Track intervals for cleanup
const intervals: number[] = [];

onMounted(async () => {
    console.log(
        `[WebRTC] Component mounted with session: ${fullSessionId.value}`,
    );

    // Start periodic tasks immediately since component only renders when session is ready
    console.log("[WebRTC] Setting up periodic tasks");
    intervals.push(setInterval(announcePeerPresence, 10000)); // Announce every 10 seconds
    intervals.push(setInterval(manageConnections, 5000)); // Check for peers every 5 seconds
    intervals.push(setInterval(refreshDatabaseState, 5000)); // Database debug every 5 seconds

    // Initialize component immediately
    try {
        await initializeLocalStream();
        await announcePeerPresence();
        await manageConnections();
        console.log("[WebRTC] Component initialized successfully");
    } catch (error) {
        console.error("[WebRTC] Failed to initialize:", error);
    }
});

onUnmounted(async () => {
    console.log("[WebRTC] Component unmounting");

    // Clear all intervals
    for (const interval of intervals) {
        clearInterval(interval);
    }

    // Announce departure
    await announcePeerDeparture();

    // Close all peer connections
    for (const [sessionId] of peers.value) {
        disconnectFromPeer(sessionId);
    }

    // Clean up local stream
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