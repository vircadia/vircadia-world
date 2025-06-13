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
              <!-- Process Status -->
              <div class="mb-3">
                <strong>Process Status:</strong>
                <div class="ml-4 mt-1">
                  <div class="d-flex flex-wrap gap-1 mb-2">
                    <v-chip 
                      size="x-small" 
                      :color="getProcessStatusColor(peer.processStatus.entityStatus)"
                    >
                      Entity: {{ peer.processStatus.entityStatus }}
                    </v-chip>
                    <v-chip 
                      size="x-small" 
                      :color="getProcessStatusColor(peer.processStatus.signalingStatus)"
                    >
                      Signaling: {{ peer.processStatus.signalingStatus }}
                    </v-chip>
                    <v-chip 
                      size="x-small" 
                      :color="getProcessStatusColor(peer.processStatus.negotiationStatus)"
                    >
                      Negotiation: {{ peer.processStatus.negotiationStatus }}
                    </v-chip>
                  </div>
                  <div class="text-caption">
                    Last Activity: {{ peer.processStatus.lastActivity }}
                  </div>
                  <div v-if="peer.processStatus.errorMessage" class="text-caption error--text mt-1">
                    Error: {{ peer.processStatus.errorMessage }}
                  </div>
                </div>
              </div>
              
              <!-- Connection Info -->
              <div class="mb-3">
                <strong>Connection Status:</strong>
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
              
              <!-- Perfect Negotiation Debug Info -->
              <div class="mb-3">
                <strong>Perfect Negotiation:</strong>
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

      <!-- Database State Debug -->
      <v-list dense>
        <v-list-subheader class="d-flex align-center">
          Database State
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
        
        <v-expansion-panels v-if="databaseEntities.length > 0" variant="accordion" density="compact">
          <v-expansion-panel v-for="entity in databaseEntities" :key="entity.entityName">
            <v-expansion-panel-title>
              <div class="d-flex align-center" style="width: 100%">
                <span class="text-caption">{{ entity.entityName }}</span>
                <v-spacer />
                <v-chip size="x-small" :color="entity.hasMessages ? 'success' : 'grey'">
                  {{ entity.messageCount }} msgs
                </v-chip>
              </div>
            </v-expansion-panel-title>
            
            <v-expansion-panel-text>
              <div class="text-caption">
                <div><strong>Last Update:</strong> {{ entity.lastUpdate ? new Date(entity.lastUpdate).toLocaleString() : 'Never' }}</div>
                <div class="mt-2"><strong>Messages:</strong></div>
                <div v-if="entity.messages.length === 0" class="ml-2 text-grey">No messages</div>
                <div v-for="(msg, idx) in entity.messages" :key="idx" class="ml-2 mt-1">
                  <div class="d-flex align-center">
                    <v-chip size="x-small" :color="msg.sessionId === sessionId ? 'primary' : 'secondary'">
                      {{ msg.type }}
                    </v-chip>
                    <span class="ml-2 text-xs">{{ msg.sessionId.substring(0, 8) }}... @ {{ new Date(msg.timestamp).toLocaleTimeString() }}</span>
                  </div>
                </div>
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
        
        <v-list-item v-if="databaseEntities.length === 0">
          <v-list-item-title class="text-caption text-grey">No WebRTC entities found</v-list-item-title>
        </v-list-item>
      </v-list>

      <v-divider class="my-2" />

      <!-- Peer Discovery Debug -->
      <v-list dense>
        <v-list-subheader>Peer Discovery</v-list-subheader>
        <v-list-item>
          <v-list-item-title class="text-caption">
            Known Avatars: {{ Object.keys(appStore.otherAvatarsMetadata).length }}
          </v-list-item-title>
        </v-list-item>
        <v-list-item v-for="(metadata, avatarSessionId) in appStore.otherAvatarsMetadata" :key="avatarSessionId">
          <v-list-item-title class="text-caption ml-4">
            {{ avatarSessionId.substring(0, 8) }}... 
            <v-chip 
              size="x-small" 
              :color="peers.has(avatarSessionId) ? 'success' : 'warning'"
            >
              {{ peers.has(avatarSessionId) ? 'Connected' : 'Not Connected' }}
            </v-chip>
          </v-list-item-title>
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
import {
    computed,
    ref,
    watch,
    onUnmounted,
    onMounted,
    inject,
    reactive,
} from "vue";
import { z } from "zod";
import { useAppStore } from "@/stores/appStore";
import { useVircadiaInstance } from "@vircadia/world-sdk/browser/vue";
import { WebRTCEntitySchema } from "@/composables/schemas";
import type { SignalingMessage, WebRTCEntity } from "@/composables/schemas";

// Status tracking for debugging
interface ProcessStatus {
    entityStatus: "initializing" | "created" | "retrieved" | "error";
    signalingStatus: "idle" | "polling" | "error";
    negotiationStatus:
        | "idle"
        | "offering"
        | "answering"
        | "connecting"
        | "connected"
        | "failed";
    lastActivity: string;
    errorMessage: string | null;
}

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
    processStatus: {
        entityStatus: string;
        signalingStatus: string;
        negotiationStatus: string;
        lastActivity: string;
        errorMessage: string | null;
    };
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

// Initialize stores and services
const appStore = useAppStore();
const vircadiaWorld = inject(useVircadiaInstance());

if (!vircadiaWorld) {
    throw new Error("Vircadia instance not found");
}

// WebRTC state for each peer connection
const webrtcState = ref(
    new Map<
        string,
        {
            sessionId: string;
            remoteSessionIds: Set<string>;
            isPolite: boolean;
            state: {
                makingOffer: boolean;
                ignoreOffer: boolean;
                isSettingRemoteAnswerPending: boolean;
            };
            processStatus: ProcessStatus;
            messageQueue: SignalingMessage[];
            lastProcessedTimestamp: number;
            debugStats: {
                messagesSent: number;
                messagesReceived: number;
                lastMessageTime: number;
            };
            entityName: string;
            pollInterval: number | null;
        }
    >(),
);

// Component state
const peers = ref<Map<string, PeerInfo>>(new Map());
const localStream = ref<MediaStream | null>(null);
const isRefreshing = ref(false);
const audioElements = ref<Map<string, HTMLAudioElement>>(new Map());
const isMuted = ref(false);
const micVolume = ref(100);
const peerVolumes = ref<Map<string, number>>(new Map());

// Database debugging state
interface DatabaseEntity {
    entityName: string;
    messages: SignalingMessage[];
    messageCount: number;
    hasMessages: boolean;
    lastUpdate: number | null;
}

const databaseEntities = ref<DatabaseEntity[]>([]);
const isRefreshingDatabase = ref(false);

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

        const audioTracks = localStream.value.getAudioTracks();
    } catch (error) {
        console.error("Failed to get user media:", error);
        throw error;
    }
}

// WebRTC helper functions inlined from composable

// Update status helper
const updateStatus = (
    remoteSessionId: string,
    updates: Partial<ProcessStatus>,
) => {
    const webrtc = webrtcState.value.get(remoteSessionId);
    if (webrtc) {
        Object.assign(webrtc.processStatus, updates);
        if (updates.lastActivity) {
            webrtc.processStatus.lastActivity = `${new Date().toLocaleTimeString()}: ${updates.lastActivity}`;
        }
    }
};

// Send session end message
const sendSessionEnd = async (remoteSessionId: string) => {
    try {
        await sendMessage(remoteSessionId, {
            type: "session-end" as const,
        } as Omit<SignalingMessage, "sessionId" | "timestamp">);
        updateStatus(remoteSessionId, { lastActivity: "Session end sent" });
    } catch (err) {
        updateStatus(remoteSessionId, {
            errorMessage: "Failed to send session end message",
            lastActivity: "Session end failed",
        });
    }
};

// Send a signaling message
const sendMessage = async (
    remoteSessionId: string,
    message: Omit<SignalingMessage, "sessionId" | "timestamp">,
) => {
    const webrtc = webrtcState.value.get(remoteSessionId);
    if (!webrtc) return;

    const fullMessage: SignalingMessage = {
        ...message,
        sessionId: sessionId.value,
        timestamp: Date.now(),
    } as SignalingMessage;

    try {
        console.log(
            "[WebRTC DB Debug] Sending message to",
            webrtc.entityName,
            ":",
            fullMessage,
        );

        // Get current messages
        const retrieveResult =
            await vircadiaWorld.client.Utilities.Connection.query({
                query: "SELECT * FROM entity.entities WHERE general__entity_name = $1",
                parameters: [webrtc.entityName],
            });

        console.log(
            "[WebRTC DB Debug] Retrieved entity result:",
            retrieveResult,
        );

        let currentMessages: SignalingMessage[] = [];
        if (
            Array.isArray(retrieveResult.result) &&
            retrieveResult.result.length > 0
        ) {
            const parsedEntity = WebRTCEntitySchema.safeParse(
                retrieveResult.result[0],
            );
            if (parsedEntity.success && parsedEntity.data.meta__data) {
                currentMessages = parsedEntity.data.meta__data.messages;
                console.log(
                    "[WebRTC DB Debug] Current messages:",
                    currentMessages,
                );
            }
        } else {
            console.log("[WebRTC DB Debug] No entity found or empty result");
        }

        // Add new message and clean old ones
        const now = Date.now();
        const updatedMessages = [
            ...currentMessages.filter(
                (msg: SignalingMessage) => now - msg.timestamp < 60000,
            ),
            fullMessage,
        ];

        console.log("[WebRTC DB Debug] Updated messages:", updatedMessages);

        // Update entity
        const updateResult =
            await vircadiaWorld.client.Utilities.Connection.query({
                query: "UPDATE entity.entities SET meta__data = $1 WHERE general__entity_name = $2",
                parameters: [
                    {
                        messages: updatedMessages,
                        lastUpdate: now,
                    },
                    webrtc.entityName,
                ],
            });

        console.log("[WebRTC DB Debug] Update result:", updateResult);

        // Update debug stats and status
        webrtc.debugStats.messagesSent++;
        webrtc.debugStats.lastMessageTime = now;
        updateStatus(remoteSessionId, {
            lastActivity: `Sent ${message.type} message`,
        });
    } catch (err) {
        updateStatus(remoteSessionId, {
            errorMessage:
                err instanceof Error ? err.message : "Failed to send message",
            lastActivity: `Failed to send ${message.type} message`,
        });
        throw err;
    }
};

// Type-safe message sending functions
const sendOffer = async (remoteSessionId: string, sdp: string) => {
    await sendMessage(remoteSessionId, {
        type: "offer" as const,
        sdp,
    } as Omit<SignalingMessage, "sessionId" | "timestamp">);
};

const sendAnswer = async (remoteSessionId: string, sdp: string) => {
    await sendMessage(remoteSessionId, {
        type: "answer" as const,
        sdp,
    } as Omit<SignalingMessage, "sessionId" | "timestamp">);
};

const sendIceCandidate = async (
    remoteSessionId: string,
    candidate: RTCIceCandidate | null,
    sdpMLineIndex: number | null,
    sdpMid: string | null,
) => {
    await sendMessage(remoteSessionId, {
        type: "ice-candidate" as const,
        candidate,
        sdpMLineIndex,
        sdpMid,
    } as Omit<SignalingMessage, "sessionId" | "timestamp">);
};

// Initialize or retrieve the signaling entity
const initializeSignaling = async (remoteSessionId: string) => {
    const webrtc = webrtcState.value.get(remoteSessionId);
    if (!webrtc) return;

    updateStatus(remoteSessionId, {
        entityStatus: "initializing",
        errorMessage: null,
        lastActivity: "Initializing signaling entity...",
    });

    try {
        // Try to retrieve existing entity
        const retrieveResult =
            await vircadiaWorld.client.Utilities.Connection.query<
                WebRTCEntity[]
            >({
                query: "SELECT * FROM entity.entities WHERE general__entity_name = $1",
                parameters: [webrtc.entityName],
            });

        if (
            Array.isArray(retrieveResult.result) &&
            retrieveResult.result.length > 0
        ) {
            updateStatus(remoteSessionId, {
                entityStatus: "retrieved",
                lastActivity: `Retrieved existing entity: ${webrtc.entityName}`,
            });

            // If it exists, check for stale sessions and clean them up
            const entityData = WebRTCEntitySchema.parse(
                retrieveResult.result[0],
            );
            if (entityData.meta__data) {
                const metaData = entityData.meta__data;
                const originalCount = metaData.messages.length;
                const cleanedMessages = (metaData.messages || []).filter(
                    (msg: SignalingMessage) =>
                        Date.now() - msg.timestamp < 60000,
                );

                if (cleanedMessages.length !== originalCount) {
                    await vircadiaWorld.client.Utilities.Connection.query({
                        query: "UPDATE entity.entities SET meta__data = $1 WHERE general__entity_name = $2",
                        parameters: [
                            {
                                messages: cleanedMessages,
                                lastUpdate: Date.now(),
                            },
                            webrtc.entityName,
                        ],
                    });
                    updateStatus(remoteSessionId, {
                        lastActivity: `Cleaned ${originalCount - cleanedMessages.length} stale messages`,
                    });
                }
            }
        } else {
            throw new Error("Entity not found");
        }
    } catch (err) {
        // Entity doesn't exist, create it
        updateStatus(remoteSessionId, {
            lastActivity: "Entity not found, creating new...",
        });

        try {
            await vircadiaWorld.client.Utilities.Connection.query({
                query: "INSERT INTO entity.entities (general__entity_name, meta__data) VALUES ($1, $2)",
                parameters: [
                    webrtc.entityName,
                    {
                        messages: [],
                        lastUpdate: Date.now(),
                    },
                ],
            });
            updateStatus(remoteSessionId, {
                entityStatus: "created",
                lastActivity: `Created new entity: ${webrtc.entityName}`,
            });
        } catch (createErr) {
            // Check if error is due to entity already existing (race condition)
            if (
                createErr instanceof Error &&
                createErr.message.includes("duplicate key")
            ) {
                updateStatus(remoteSessionId, {
                    lastActivity:
                        "Entity exists (race condition), retrieving...",
                });

                try {
                    const retryResult =
                        await vircadiaWorld.client.Utilities.Connection.query({
                            query: "SELECT * FROM entity.entities WHERE general__entity_name = $1",
                            parameters: [webrtc.entityName],
                        });
                    if (
                        Array.isArray(retryResult.result) &&
                        retryResult.result.length > 0
                    ) {
                        updateStatus(remoteSessionId, {
                            entityStatus: "retrieved",
                            lastActivity: "Retrieved after race condition",
                        });
                    } else {
                        throw new Error(
                            "Failed to retrieve after create conflict",
                        );
                    }
                } catch (retrieveErr) {
                    updateStatus(remoteSessionId, {
                        entityStatus: "error",
                        errorMessage:
                            retrieveErr instanceof Error
                                ? retrieveErr.message
                                : "Failed to retrieve after create conflict",
                        lastActivity: "Failed to retrieve after race condition",
                    });
                    throw retrieveErr;
                }
            } else {
                updateStatus(remoteSessionId, {
                    entityStatus: "error",
                    errorMessage:
                        createErr instanceof Error
                            ? createErr.message
                            : "Unknown error",
                    lastActivity: "Failed to create entity",
                });
                throw createErr;
            }
        }
    }

    // Start polling for messages
    startPolling(remoteSessionId);
};

// Start polling for messages
const startPolling = (remoteSessionId: string) => {
    const webrtc = webrtcState.value.get(remoteSessionId);
    if (!webrtc || webrtc.pollInterval) return;

    updateStatus(remoteSessionId, {
        signalingStatus: "polling",
        lastActivity: "Started polling for messages",
    });

    const poll = async () => {
        try {
            const retrieveResult =
                await vircadiaWorld.client.Utilities.Connection.query({
                    query: "SELECT * FROM entity.entities WHERE general__entity_name = $1",
                    parameters: [webrtc.entityName],
                });

            if (
                Array.isArray(retrieveResult.result) &&
                retrieveResult.result.length > 0
            ) {
                const parsedEntity = WebRTCEntitySchema.safeParse(
                    retrieveResult.result[0],
                );
                if (parsedEntity.success && parsedEntity.data.meta__data) {
                    const metaData = parsedEntity.data.meta__data;
                    const messages = metaData.messages || [];

                    // Filter messages: from other sessions, newer than last processed, and not too old
                    const now = Date.now();
                    const newMessages = messages.filter(
                        (msg: SignalingMessage) =>
                            msg.sessionId !== sessionId.value &&
                            msg.timestamp > webrtc.lastProcessedTimestamp &&
                            now - msg.timestamp < 60000,
                    );

                    if (newMessages.length > 0) {
                        webrtc.messageQueue.push(...newMessages);
                        webrtc.lastProcessedTimestamp = Math.max(
                            ...newMessages.map(
                                (msg: SignalingMessage) => msg.timestamp,
                            ),
                        );

                        // Update debug stats
                        webrtc.debugStats.messagesReceived +=
                            newMessages.length;
                        webrtc.debugStats.lastMessageTime = now;

                        updateStatus(remoteSessionId, {
                            lastActivity: `Received ${newMessages.length} message(s) from ${[...new Set(newMessages.map((m: SignalingMessage) => m.sessionId.substring(0, 8)))].join(", ")}`,
                        });
                    }
                }
            }
        } catch (err) {
            updateStatus(remoteSessionId, {
                errorMessage:
                    err instanceof Error ? err.message : "Polling error",
                signalingStatus: "error",
                lastActivity: "Polling error",
            });
        }
    };

    // Initial poll
    poll();

    // Set up interval - poll more frequently for better responsiveness
    webrtc.pollInterval = setInterval(poll, 500);
};

// Perfect negotiation handlers
const setupPerfectNegotiation = (
    remoteSessionId: string,
    pc: RTCPeerConnection,
) => {
    const webrtc = webrtcState.value.get(remoteSessionId);
    if (!webrtc) return { cleanup: () => {} };

    // Handle negotiation needed
    pc.onnegotiationneeded = async () => {
        try {
            webrtc.state.makingOffer = true;
            updateStatus(remoteSessionId, {
                negotiationStatus: "offering",
                lastActivity: "Creating offer...",
            });

            await pc.setLocalDescription();
            const localDesc = pc.localDescription;
            if (localDesc?.sdp) {
                await sendOffer(remoteSessionId, localDesc.sdp);
                updateStatus(remoteSessionId, {
                    lastActivity: "Offer sent successfully",
                });
            }
        } catch (err) {
            updateStatus(remoteSessionId, {
                negotiationStatus: "failed",
                errorMessage:
                    err instanceof Error
                        ? err.message
                        : "Failed to create offer",
                lastActivity: "Failed to create offer",
            });
        } finally {
            webrtc.state.makingOffer = false;
        }
    };

    // Handle ICE candidates
    pc.onicecandidate = async ({ candidate }) => {
        if (candidate) {
            await sendIceCandidate(
                remoteSessionId,
                candidate,
                candidate.sdpMLineIndex,
                candidate.sdpMid,
            );
            updateStatus(remoteSessionId, {
                lastActivity: "ICE candidate sent",
            });
        }
    };

    // Process incoming messages
    const processMessages = async () => {
        while (webrtc.messageQueue.length > 0) {
            const message = webrtc.messageQueue.shift();
            if (!message) continue;

            // Track remote session IDs for politeness determination
            if (message.sessionId !== sessionId.value) {
                const wasPolite = webrtc.isPolite;
                webrtc.remoteSessionIds.add(message.sessionId);

                // Update politeness based on session ID comparison
                const sortedIds = [
                    sessionId.value,
                    ...Array.from(webrtc.remoteSessionIds),
                ].sort();
                webrtc.isPolite = sortedIds[0] === sessionId.value;

                // Track politeness changes
                if (wasPolite !== webrtc.isPolite) {
                    updateStatus(remoteSessionId, {
                        lastActivity: `Politeness changed: now ${webrtc.isPolite ? "polite" : "impolite"}`,
                    });
                }
            }

            try {
                if (message.type === "offer" || message.type === "answer") {
                    const description = {
                        type: message.type,
                        sdp: message.sdp,
                    };

                    // Perfect negotiation collision handling
                    const readyForOffer =
                        !webrtc.state.makingOffer &&
                        (pc.signalingState === "stable" ||
                            webrtc.state.isSettingRemoteAnswerPending);
                    const offerCollision =
                        description.type === "offer" && !readyForOffer;

                    webrtc.state.ignoreOffer =
                        !webrtc.isPolite && offerCollision;

                    if (offerCollision) {
                        console.log(
                            "[WebRTC Perfect Negotiation] Offer collision detected:",
                            {
                                isPolite: webrtc.isPolite,
                                makingOffer: webrtc.state.makingOffer,
                                signalingState: pc.signalingState,
                                readyForOffer,
                                willIgnore: webrtc.state.ignoreOffer,
                            },
                        );

                        updateStatus(remoteSessionId, {
                            lastActivity: `Offer collision - ${webrtc.isPolite ? "rolling back (polite)" : "ignoring (impolite)"}`,
                        });

                        // If we're polite, we need to rollback our offer
                        if (webrtc.isPolite && webrtc.state.makingOffer) {
                            console.log(
                                "[WebRTC Perfect Negotiation] Rolling back local offer (polite peer)",
                            );
                            webrtc.state.makingOffer = false;
                            // The signaling state will be updated after setRemoteDescription
                        }
                    }

                    if (webrtc.state.ignoreOffer) {
                        updateStatus(remoteSessionId, {
                            lastActivity:
                                "Ignoring offer (impolite peer in collision)",
                        });
                        console.log(
                            "[WebRTC Perfect Negotiation] Ignoring remote offer (impolite peer)",
                        );
                        continue;
                    }

                    updateStatus(remoteSessionId, {
                        negotiationStatus:
                            description.type === "offer"
                                ? "answering"
                                : "connecting",
                        lastActivity: `Processing ${description.type}...`,
                    });

                    webrtc.state.isSettingRemoteAnswerPending =
                        description.type === "answer";
                    await pc.setRemoteDescription(description);
                    webrtc.state.isSettingRemoteAnswerPending = false;

                    if (description.type === "offer") {
                        await pc.setLocalDescription();
                        const localDesc = pc.localDescription;
                        if (localDesc?.sdp) {
                            await sendAnswer(remoteSessionId, localDesc.sdp);
                            updateStatus(remoteSessionId, {
                                lastActivity: "Answer sent successfully",
                            });
                        }
                    }
                } else if (message.type === "ice-candidate") {
                    try {
                        const candidate = message.candidate
                            ? JSON.parse(message.candidate)
                            : null;

                        if (candidate) {
                            await pc.addIceCandidate(
                                new RTCIceCandidate(candidate),
                            );
                            updateStatus(remoteSessionId, {
                                lastActivity: "ICE candidate processed",
                            });
                        }
                    } catch (err) {
                        if (!webrtc.state.ignoreOffer) {
                            throw err;
                        }
                    }
                } else if (message.type === "session-end") {
                    // Handle remote session end - remove from tracking
                    webrtc.remoteSessionIds.delete(message.sessionId);
                    pc.close();
                    updateStatus(remoteSessionId, {
                        negotiationStatus: "idle",
                        lastActivity: `Remote session ${message.sessionId.substring(0, 8)} ended`,
                    });
                }
            } catch (err) {
                updateStatus(remoteSessionId, {
                    errorMessage:
                        err instanceof Error
                            ? err.message
                            : "Error processing message",
                    lastActivity: "Message processing failed",
                });
            }
        }
    };

    // Set up message processing interval
    const messageInterval = setInterval(processMessages, 100);

    return {
        cleanup: () => {
            pc.onnegotiationneeded = null;
            pc.onicecandidate = null;
            clearInterval(messageInterval);
        },
    };
};

// Connect to a peer using perfect negotiation
async function connectToPeer(remoteSessionId: string) {
    if (!sessionId.value) {
        return;
    }

    if (peers.value.has(remoteSessionId)) {
        return;
    }

    if (!localStream.value) {
        await initializeLocalStream();
    }

    // Create unique channel ID (both peers use same channel)
    const channelId = [sessionId.value, remoteSessionId].sort().join("-");
    const entityName = `webrtc-${channelId}`;

    // Initialize WebRTC state for this peer
    const webrtc = {
        sessionId: sessionId.value,
        remoteSessionIds: new Set<string>([remoteSessionId]),
        isPolite: sessionId.value < remoteSessionId,
        state: {
            makingOffer: false,
            ignoreOffer: false,
            isSettingRemoteAnswerPending: false,
        },
        processStatus: {
            entityStatus: "initializing" as const,
            signalingStatus: "idle" as const,
            negotiationStatus: "idle" as const,
            lastActivity: "Initializing...",
            errorMessage: null,
        },
        messageQueue: [] as SignalingMessage[],
        lastProcessedTimestamp: 0,
        debugStats: {
            messagesSent: 0,
            messagesReceived: 0,
            lastMessageTime: 0,
        },
        entityName,
        pollInterval: null,
    };

    webrtcState.value.set(remoteSessionId, webrtc);

    try {
        // Initialize signaling channel
        await initializeSignaling(remoteSessionId);

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
            processStatus: webrtc.processStatus,
            debugInfo: {
                entityName,
                sessionId: remoteSessionId,
                isPolite: webrtc.isPolite,
                lastMessageTime: Date.now(),
                messagesSent: 0,
                messagesReceived: 0,
                negotiationState: webrtc.state,
            },
        };

        peers.value.set(remoteSessionId, peerInfo);

        // Set up event handlers
        pc.oniceconnectionstatechange = () => {
            peerInfo.iceConnectionState = pc.iceConnectionState;
        };

        pc.onicegatheringstatechange = () => {
            peerInfo.iceGatheringState = pc.iceGatheringState;
        };

        pc.onconnectionstatechange = () => {
            peerInfo.connectionState = pc.connectionState;

            if (
                pc.connectionState === "failed" ||
                pc.connectionState === "closed"
            ) {
                disconnectFromPeer(remoteSessionId);
            }
        };

        pc.onsignalingstatechange = () => {
            peerInfo.signalingState = pc.signalingState;
        };

        pc.ontrack = (event) => {
            if (event.streams[0]) {
                peerInfo.remoteStream = event.streams[0];
                peerInfo.remoteTracks = event.streams[0].getTracks().length;
                setupAudioPlayback(remoteSessionId, event.streams[0]);
            }
        };

        // Set up perfect negotiation
        const { cleanup } = setupPerfectNegotiation(remoteSessionId, pc);
        peerInfo.cleanup = cleanup;

        // Update debug info periodically from webrtc stats
        const debugInterval = setInterval(() => {
            const currentWebrtc = webrtcState.value.get(remoteSessionId);
            if (currentWebrtc) {
                peerInfo.debugInfo.messagesSent =
                    currentWebrtc.debugStats.messagesSent;
                peerInfo.debugInfo.messagesReceived =
                    currentWebrtc.debugStats.messagesReceived;
                peerInfo.debugInfo.lastMessageTime =
                    currentWebrtc.debugStats.lastMessageTime;
                peerInfo.debugInfo.negotiationState = currentWebrtc.state;
            }
        }, 500);

        // Store interval cleanup
        const originalCleanup = peerInfo.cleanup;
        peerInfo.cleanup = () => {
            clearInterval(debugInterval);
            if (originalCleanup) originalCleanup();
        };
    } catch (error) {
        peers.value.delete(remoteSessionId);
        webrtcState.value.delete(remoteSessionId);
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
        // Audio play error is expected in some browsers
    });
}

// Disconnect from a peer
function disconnectFromPeer(remoteSessionId: string) {
    const peer = peers.value.get(remoteSessionId);
    const webrtc = webrtcState.value.get(remoteSessionId);

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
        sendSessionEnd(remoteSessionId);

        // Clear polling interval
        if (webrtc.pollInterval) {
            clearInterval(webrtc.pollInterval);
        }

        // Remove from webrtc state
        webrtcState.value.delete(remoteSessionId);
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

// Get process status color
function getProcessStatusColor(status: string): string {
    switch (status) {
        case "created":
        case "retrieved":
        case "polling":
        case "connected":
            return "success";
        case "offering":
        case "answering":
        case "connecting":
            return "warning";
        case "error":
        case "failed":
            return "error";
        case "initializing":
        case "idle":
            return "info";
        default:
            return "grey";
    }
}

// Debug peer connection
function debugPeer(peerId: string) {
    const peer = peers.value.get(peerId);
    const webrtc = webrtcState.value.get(peerId);
    if (!peer) return;

    console.log(`[WebRTC Debug] Peer ${peerId}:`, {
        connectionState: peer.pc.connectionState,
        iceConnectionState: peer.pc.iceConnectionState,
        iceGatheringState: peer.pc.iceGatheringState,
        signalingState: peer.pc.signalingState,
        localTracks: peer.localTracks,
        remoteTracks: peer.remoteTracks,
        hasRemoteStream: !!peer.remoteStream,
        processStatus: peer.processStatus,
        debugInfo: peer.debugInfo,
        webrtcStats: webrtc
            ? {
                  sessionId: webrtc.sessionId,
                  isPolite: webrtc.isPolite,
                  entityName: webrtc.entityName,
                  debugStats: webrtc.debugStats,
                  processStatus: webrtc.processStatus,
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

// Enhanced peer discovery - actively discover peers
async function discoverPeers() {
    // Connect to any new avatars we discover
    for (const remoteSessionId in appStore.otherAvatarsMetadata) {
        if (!peers.value.has(remoteSessionId)) {
            await connectToPeer(remoteSessionId);
        }
    }
}

// Watch for changes in other avatars
watch(
    () => appStore.otherAvatarsMetadata,
    async (newMetadata, oldMetadata) => {
        // Connect to new avatars
        for (const sessionId in newMetadata) {
            if (!oldMetadata || !(sessionId in oldMetadata)) {
                await connectToPeer(sessionId);
            }
        }

        // Disconnect from removed avatars
        if (oldMetadata) {
            for (const sessionId in oldMetadata) {
                if (!(sessionId in newMetadata)) {
                    disconnectFromPeer(sessionId);
                }
            }
        }
    },
    { deep: true },
);

// Periodic peer discovery - this helps with the bidirectional discovery issue
let discoveryInterval: number | null = null;

// Initial setup
onMounted(async () => {
    // Initialize local stream
    try {
        await initializeLocalStream();
    } catch (error) {
        console.error("[WebRTC] Failed to initialize on mount:", error);
    }

    // Refresh database state to see existing entities
    await refreshDatabaseState();

    // Connect to existing avatars
    for (const sessionId in appStore.otherAvatarsMetadata) {
        await connectToPeer(sessionId);
    }

    // Set up periodic discovery to catch missed connections
    discoveryInterval = setInterval(discoverPeers, 2000); // Check every 2 seconds

    // Set up periodic database refresh for debugging
    setInterval(refreshDatabaseState, 5000); // Refresh every 5 seconds
});

// Cleanup on unmount
onUnmounted(() => {
    // Clear discovery interval
    if (discoveryInterval) {
        clearInterval(discoveryInterval);
    }

    // Close all peer connections
    for (const [sessionId, _] of peers.value) {
        disconnectFromPeer(sessionId);
    }

    // Clean up all WebRTC state
    for (const [sessionId, webrtc] of webrtcState.value) {
        if (webrtc.pollInterval) {
            clearInterval(webrtc.pollInterval);
        }
        sendSessionEnd(sessionId);
    }
    webrtcState.value.clear();

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
    }
}

function updateMicVolume(value: number) {
    micVolume.value = value;

    if (gainNode.value) {
        gainNode.value.gain.value = value / 100;
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
    }
}

// Database debugging functions
async function refreshDatabaseState() {
    isRefreshingDatabase.value = true;

    try {
        if (!vircadiaWorld) {
            throw new Error("Vircadia world instance not available");
        }

        // Query for all WebRTC entities
        const result = await vircadiaWorld.client.Utilities.Connection.query({
            query: "SELECT * FROM entity.entities WHERE general__entity_name LIKE 'webrtc-%'",
            parameters: [],
        });

        databaseEntities.value = [];

        if (Array.isArray(result.result)) {
            for (const entity of result.result as WebRTCEntity[]) {
                const entityName = entity.general__entity_name || "unknown";
                let messages: SignalingMessage[] = [];
                let lastUpdate: number | null = null;
                const parsedEntity = WebRTCEntitySchema.safeParse(entity);

                if (parsedEntity.success && parsedEntity.data.meta__data) {
                    try {
                        const metaData = parsedEntity.data.meta__data;
                        messages = metaData.messages || [];
                        lastUpdate = metaData.lastUpdate || null;
                    } catch (err) {
                        console.error(
                            `Failed to parse meta data for ${entityName}:`,
                            err,
                        );
                    }
                }

                databaseEntities.value.push({
                    entityName,
                    messages,
                    messageCount: messages.length,
                    hasMessages: messages.length > 0,
                    lastUpdate,
                });
            }
        }

        console.log(
            "[WebRTC Database Debug] Found entities:",
            databaseEntities.value,
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