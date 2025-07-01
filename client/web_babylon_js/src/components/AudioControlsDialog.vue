<template>
  <v-card>
    <v-card-title class="d-flex align-center">
      <v-icon class="mr-2">mdi-headphones</v-icon>
      Audio Controls
      <v-spacer />
      <v-chip 
        :color="appStore.spatialAudioEnabled ? 'success' : 'grey'" 
        size="small"
        variant="flat"
      >
        {{ appStore.spatialAudioEnabled ? 'Spatial Audio Active' : 'Audio Inactive' }}
      </v-chip>
    </v-card-title>
    
    <v-card-text>
      <!-- Local Microphone Controls -->
      <v-list-subheader>
        <v-icon size="small" class="mr-1">mdi-microphone</v-icon>
        My Microphone
      </v-list-subheader>
      
      <v-list-item>
        <template v-slot:prepend>
          <v-btn
            :icon="localMicMuted ? 'mdi-microphone-off' : 'mdi-microphone'"
            :color="localMicMuted ? 'error' : 'success'"
            size="small"
            variant="flat"
            @click="toggleLocalMic"
          />
        </template>
        
        <v-list-item-title>
          <v-slider
            v-model="localMicVolume"
            :disabled="localMicMuted"
            density="compact"
            hide-details
            min="0"
            max="100"
            step="1"
            thumb-label
            @update:model-value="updateLocalMicVolume"
          >
            <template v-slot:prepend>
              <v-icon size="small">mdi-volume-low</v-icon>
            </template>
            <template v-slot:append>
              <v-icon size="small">mdi-volume-high</v-icon>
            </template>
          </v-slider>
        </v-list-item-title>
        
        <template v-slot:append>
          <span class="text-caption">{{ localMicVolume }}%</span>
        </template>
      </v-list-item>
      
      <v-divider class="my-2" />
      
      <!-- Active Audio Connections -->
      <v-list-subheader>
        <v-icon size="small" class="mr-1">mdi-account-voice</v-icon>
        Active Connections ({{ activePeerAudioStates.length }})
      </v-list-subheader>
      
      <v-list-item v-if="activePeerAudioStates.length === 0">
        <v-list-item-title class="text-caption text-grey">
          No active audio connections
        </v-list-item-title>
      </v-list-item>
      
      <v-list-item 
        v-for="peer in activePeerAudioStates" 
        :key="peer.sessionId"
        class="mb-2"
      >
        <template v-slot:prepend>
          <div class="d-flex flex-column align-center mr-2">
            <!-- Mute/Unmute Button -->
            <v-btn
              :icon="peer.isMuted ? 'mdi-volume-off' : 'mdi-volume-high'"
              :color="peer.isMuted ? 'error' : 'success'"
              size="small"
              variant="flat"
              @click="togglePeerMute(peer.sessionId)"
              class="mb-1"
            />
            
            <!-- Direction Indicators -->
            <div class="d-flex">
              <v-icon 
                v-if="peer.isSending" 
                size="x-small" 
                color="primary"
                title="Sending audio"
              >
                mdi-arrow-up
              </v-icon>
              <v-icon 
                v-if="peer.isReceiving" 
                size="x-small" 
                color="success"
                title="Receiving audio"
              >
                mdi-arrow-down
              </v-icon>
            </div>
          </div>
        </template>
        
        <v-list-item-title>
          <div class="text-caption mb-1">
            {{ peer.sessionId.substring(0, 8) }}...
            <v-chip 
              size="x-small" 
              class="ml-2"
              :color="peer.isReceiving && peer.isSending ? 'success' : 'warning'"
            >
              {{ getConnectionType(peer) }}
            </v-chip>
          </div>
          
          <v-slider
            :model-value="peer.volume"
            :disabled="peer.isMuted || !peer.isReceiving"
            density="compact"
            hide-details
            min="0"
            max="100"
            step="1"
            thumb-label
            @update:model-value="(value) => updatePeerVolume(peer.sessionId, value)"
          >
            <template v-slot:prepend>
              <v-icon size="small">mdi-volume-low</v-icon>
            </template>
            <template v-slot:append>
              <v-icon size="small">mdi-volume-high</v-icon>
            </template>
          </v-slider>
        </v-list-item-title>
        
        <template v-slot:append>
          <span class="text-caption">{{ peer.volume }}%</span>
        </template>
      </v-list-item>
      
      <v-divider class="my-2" />
      
      <!-- Audio Settings -->
      <v-list-subheader>
        <v-icon size="small" class="mr-1">mdi-cog</v-icon>
        Audio Settings
      </v-list-subheader>
      
      <v-list-item>
        <v-list-item-title class="text-caption">
          <v-switch
            v-model="spatialAudioEnabled"
            label="3D Spatial Audio"
            density="compact"
            hide-details
            @update:model-value="toggleSpatialAudio"
          />
        </v-list-item-title>
      </v-list-item>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, inject } from "vue";
import { useAppStore } from "@/stores/appStore";
import type { PeerAudioState } from "@/composables/schemas";

// Props
interface Props {
    webrtcRef?: InstanceType<typeof import("./BabylonWebRTC.vue").default>; // Reference to BabylonWebRTC component
}

const props = defineProps<Props>();

// Store
const appStore = useAppStore();

// Local state - sync with WebRTC component if available
const localMicVolume = ref(props.webrtcRef?.micVolume || 100);
const localMicMuted = ref(props.webrtcRef?.isMuted || false);
const spatialAudioEnabled = computed({
    get: () => appStore.spatialAudioEnabled,
    set: (value) => appStore.setSpatialAudioEnabled(value),
});

// Computed
const activePeerAudioStates = computed(() => appStore.activePeerAudioStates);

// Methods
function toggleLocalMic() {
    localMicMuted.value = !localMicMuted.value;

    // Call the WebRTC component's toggleMute method if available
    if (props.webrtcRef?.toggleMute) {
        props.webrtcRef.toggleMute();
    }
}

function updateLocalMicVolume(value: number) {
    localMicVolume.value = value;

    // Call the WebRTC component's updateMicVolume method if available
    if (props.webrtcRef?.updateMicVolume) {
        props.webrtcRef.updateMicVolume(value);
    }
}

function togglePeerMute(sessionId: string) {
    const peer = appStore.getPeerAudioState(sessionId);
    if (!peer) return;

    const newMutedState = !peer.isMuted;
    appStore.setPeerMuted(sessionId, newMutedState);

    // Update actual volume through WebRTC component
    if (props.webrtcRef?.setPeerVolume) {
        props.webrtcRef.setPeerVolume(
            sessionId,
            newMutedState ? 0 : peer.volume,
        );
    }
}

function updatePeerVolume(sessionId: string, value: number) {
    appStore.setPeerVolume(sessionId, value);

    // Update actual volume through WebRTC component if not muted
    const peer = appStore.getPeerAudioState(sessionId);
    if (peer && !peer.isMuted && props.webrtcRef?.setPeerVolume) {
        props.webrtcRef.setPeerVolume(sessionId, value);
    }
}

function getConnectionType(peer: PeerAudioState): string {
    if (peer.isReceiving && peer.isSending) {
        return "Two-way";
    }
    if (peer.isReceiving) {
        return "Receiving";
    }
    if (peer.isSending) {
        return "Sending";
    }
    return "Inactive";
}

function toggleSpatialAudio(value: boolean) {
    appStore.setSpatialAudioEnabled(value);
    // Note: Actual spatial audio toggle would need to be implemented in WebRTC component
    console.log(`Spatial audio ${value ? "enabled" : "disabled"}`);
}
</script>

<style scoped>
.v-list-item {
  padding-left: 8px;
  padding-right: 8px;
}
</style> 