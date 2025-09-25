<template>
  <v-expansion-panel :value="peerId">
    <v-expansion-panel-title>
      <v-row no-gutters align="center">
        <v-col cols="auto">
          <v-avatar size="32" :color="avatarColor">
            <span class="text-caption">{{ avatarInitials }}</span>
          </v-avatar>
        </v-col>
        <v-col class="ml-3">
          <div class="text-subtitle-2">{{ displayName }}</div>
          <div class="text-caption text-grey">{{ shortSessionId }}</div>
        </v-col>
        <v-spacer />
        <v-col cols="auto" class="d-flex align-center">
          <!-- Connection Status -->
          <v-chip
            size="small"
            :color="connectionStateColor"
            variant="flat"
            class="mr-1"
          >
            {{ connectionStateLabel }}
          </v-chip>

          <!-- Audio Status Indicators -->
          <v-tooltip text="Audio being sent">
            <template v-slot:activator="{ props }">
              <v-icon
                v-bind="props"
                size="small"
                :color="isSendingAudio ? 'success' : 'grey'"
                class="ml-1"
              >
                {{ isSendingAudio ? 'mdi-microphone' : 'mdi-microphone-off' }}
              </v-icon>
            </template>
          </v-tooltip>

          <v-tooltip :text="`Audio being received (Level: ${receivingAudioLevel.toFixed(1)}%)`">
            <template v-slot:activator="{ props }">
              <v-icon
                v-bind="props"
                size="small"
                :color="isReceivingAudio ? 'success' : 'grey'"
                class="ml-1"
              >
                {{ isReceivingAudio ? 'mdi-volume-high' : 'mdi-volume-off' }}
              </v-icon>
            </template>
          </v-tooltip>

          <!-- Audio Level Indicator -->
          <v-tooltip text="Audio level indicator">
            <template v-slot:activator="{ props }">
              <v-progress-circular
                v-bind="props"
                size="20"
                width="3"
                :value="receivingAudioLevel"
                :color="audioLevelColor"
                class="ml-1"
              >
                <v-icon size="10" :color="audioLevelColor">
                  {{ receivingAudioLevel > 50 ? 'mdi-volume-high' : receivingAudioLevel > 25 ? 'mdi-volume-medium' : 'mdi-volume-low' }}
                </v-icon>
              </v-progress-circular>
            </template>
          </v-tooltip>

          <!-- Connection Quality Indicator -->
          <v-tooltip :text="connectionQualityText">
            <template v-slot:activator="{ props }">
              <v-icon
                v-bind="props"
                size="small"
                :color="connectionQualityColor"
                class="ml-1"
              >
                {{ connectionQualityIcon }}
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
            <v-chip size="x-small" :color="iceStateColor">
              {{ peer.pc.iceConnectionState }}
            </v-chip>
          </v-list-item-title>
        </v-list-item>
        
        <v-list-item>
          <v-list-item-title class="text-caption">
            Signaling State:
            <v-chip size="x-small" :color="signalingStateColor">
              {{ peer.pc.signalingState }}
            </v-chip>
          </v-list-item-title>
        </v-list-item>
        
        <!-- Audio Controls -->
        <v-list-item v-if="peer.remoteStream">
          <v-list-item-title class="d-flex align-center">
            <span class="text-caption mr-2">Volume:</span>
            <v-slider
              v-model="localVolume"
              class="flex-grow-1"
              density="compact"
              hide-details
              min="0"
              max="100"
              step="1"
              thumb-label
              @update:model-value="updateVolume"
            >
              <template v-slot:prepend>
                <v-icon size="small">mdi-volume-low</v-icon>
              </template>
              <template v-slot:append>
                <v-icon size="small">mdi-volume-high</v-icon>
              </template>
            </v-slider>
            <span class="ml-2 text-caption">{{ localVolume }}%</span>
          </v-list-item-title>
        </v-list-item>
        
        <!-- 3D Position Info (if available) -->
        <v-list-item v-if="positionData">
          <v-list-item-title class="text-caption">
            Position: ({{ positionData.x.toFixed(1) }}, {{ positionData.y.toFixed(1) }}, {{ positionData.z.toFixed(1) }})
            <span v-if="distance !== null" class="ml-2">
              Distance: {{ distance.toFixed(1) }}m
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
            Created: {{ connectionAge }}s ago
          </v-list-item-title>
        </v-list-item>

        <!-- Audio State Summary -->
        <v-list-item>
          <v-list-item-title class="text-caption">
            <strong>Audio Status:</strong>
            <v-chip
              size="x-small"
              :color="isSendingAudio ? 'success' : 'error'"
              variant="flat"
              class="ml-1"
            >
              Send: {{ isSendingAudio ? '✓' : '✗' }}
            </v-chip>
            <v-chip
              size="x-small"
              :color="isReceivingAudio ? 'success' : 'error'"
              variant="flat"
              class="ml-1"
            >
              Receive: {{ isReceivingAudio ? '✓' : '✗' }}
            </v-chip>
            <v-chip
              size="x-small"
              :color="(isSendingAudio && isReceivingAudio) ? 'success' : 'warning'"
              variant="flat"
              class="ml-1"
            >
              {{ (isSendingAudio && isReceivingAudio) ? 'Bidirectional' : 'One-way' }}
            </v-chip>
          </v-list-item-title>
        </v-list-item>

        <!-- Audio Level Information -->
        <v-list-item>
          <v-list-item-title class="text-caption">
            <strong>Audio Levels:</strong>
            <div class="d-flex align-center ml-2 mt-1">
              <span class="text-caption mr-2">Receiving:</span>
              <v-progress-linear
                :value="receivingAudioLevel"
                :color="audioLevelColor"
                height="8"
                rounded
                style="min-width: 100px"
                class="mr-2"
              />
              <span class="text-caption">{{ receivingAudioLevel.toFixed(1) }}%</span>
            </div>
            <div class="d-flex align-center ml-2 mt-1" v-if="audioAnalyserData">
              <span class="text-caption mr-2">RMS:</span>
              <v-progress-linear
                :value="audioAnalyserData.rmsLevel"
                :color="audioAnalyserData.rmsLevel > 50 ? 'success' : 'warning'"
                height="6"
                rounded
                style="min-width: 100px"
                class="mr-2"
              />
              <span class="text-caption">{{ audioAnalyserData.rmsLevel.toFixed(1) }}%</span>
            </div>
          </v-list-item-title>
        </v-list-item>

        <!-- Detailed Track Information -->
        <v-list-item>
          <v-list-item-title class="text-caption">
            <strong>Local Senders:</strong>
            <div v-for="sender in peer.pc.getSenders()" :key="sender.track?.id || 'no-track'" class="ml-2">
              <v-chip size="x-small" :color="sender.track?.enabled ? 'success' : 'error'" variant="flat">
                {{ sender.track?.kind || 'unknown' }}: {{ sender.track?.readyState || 'no-track' }}
                {{ sender.track?.enabled ? '' : '(disabled)' }}
              </v-chip>
            </div>
          </v-list-item-title>
        </v-list-item>

        <v-list-item>
          <v-list-item-title class="text-caption">
            <strong>Remote Receivers:</strong>
            <div v-for="receiver in peer.pc.getReceivers()" :key="receiver.track?.id || 'no-track'" class="ml-2">
              <v-chip size="x-small" :color="receiver.track?.readyState === 'live' ? 'success' : 'error'" variant="flat">
                {{ receiver.track?.kind || 'unknown' }}: {{ receiver.track?.readyState || 'no-track' }}
              </v-chip>
            </div>
          </v-list-item-title>
        </v-list-item>

        <v-list-item v-if="peer.pc.getTransceivers().length > 0">
          <v-list-item-title class="text-caption">
            <strong>Transceivers:</strong>
            <div v-for="(transceiver, index) in peer.pc.getTransceivers()" :key="index" class="ml-2">
              <v-chip size="x-small" :color="transceiver.direction === 'sendrecv' ? 'success' : 'warning'" variant="flat">
                {{ index + 1 }}: {{ transceiver.mid || 'no-mid' }}
                ({{ transceiver.direction }})
                {{ transceiver.currentDirection ? `→ ${transceiver.currentDirection}` : '' }}
              </v-chip>
              <span class="text-caption ml-1">
                {{ transceiver.sender?.track?.kind || 'no-sender' }} ↔ {{ transceiver.receiver?.track?.kind || 'no-receiver' }}
              </span>
            </div>
          </v-list-item-title>
        </v-list-item>

        <v-list-item>
          <v-list-item-title class="text-caption">
            ICE Candidates Sent: {{ sentIceCandidates }}
          </v-list-item-title>
        </v-list-item>
        
        <!-- Debug Actions -->
        <v-list-item>
          <v-btn
            size="small"
            variant="outlined"
            @click="$emit('disconnect')"
            :loading="isDisconnecting"
          >
            Disconnect
          </v-btn>
          <v-btn
            size="small"
            variant="outlined"
            class="ml-2"
            @click="$emit('debug')"
          >
            Debug
          </v-btn>
        </v-list-item>
      </v-list>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import type { PeerInfo, AvatarBaseData, AvatarPositionData } from '@schemas';

interface Props {
  peerId: string;
  peer: PeerInfo;
  avatarData?: AvatarBaseData;
  positionData?: AvatarPositionData;
  myPosition?: AvatarPositionData | null;
  volume?: number;
  // Spatial audio node management
  spatialAudioNode?: HTMLAudioElement;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  disconnect: [];
  debug: [];
  volumeChange: [volume: number];
  spatialNodeCreated: [node: HTMLAudioElement];
  spatialNodeRemoved: [];
}>();

// Local state
const localVolume = ref(props.volume ?? 100);
const isDisconnecting = ref(false);
const connectionCreatedTime = ref(Date.now());
const sentIceCandidates = ref(0);
const receivingAudioLevel = ref(0);
const currentTime = ref(Date.now());
const audioAnalyserData = ref<{
  rmsLevel: number;
  peakLevel: number;
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
} | null>(null);
const audioAnalysisInterval = ref<ReturnType<typeof setInterval> | null>(null);

// Computed properties
const displayName = computed(() => {
  // AvatarBaseData doesn't have displayName in the schema
  // Use session ID as fallback
  return props.peerId.split('@')[0] || 'Unknown User';
});

const avatarInitials = computed(() => {
  const name = displayName.value;
  return name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase();
});

const avatarColor = computed(() => {
  if (props.peer.pc.connectionState !== 'connected') {
    return 'grey'; // Disconnected peers are grey
  }

  const iceState = props.peer.pc.iceConnectionState;
  if (iceState === 'connected' || iceState === 'completed') {
    if (isReceivingAudio.value && isSendingAudio.value) {
      return 'success'; // Bidirectional audio = green
    } else if (isReceivingAudio.value || isSendingAudio.value) {
      return 'warning'; // One-way audio = orange/yellow
    } else {
      return 'error'; // Connected but no audio = red
    }
  } else if (iceState === 'checking') {
    return 'info'; // ICE checking = blue
  } else {
    return 'error'; // Failed/closed = red
  }
});

const shortSessionId = computed(() => 
  props.peerId.substring(0, 8) + '...'
);

const connectionStateLabel = computed(() => {
  const state = props.peer.pc.connectionState;
  switch (state) {
    case 'connected': return 'Connected';
    case 'connecting': return 'Connecting';
    case 'disconnected': return 'Disconnected';
    case 'failed': return 'Failed';
    case 'closed': return 'Closed';
    default: return state;
  }
});

const connectionStateColor = computed(() => {
  const state = props.peer.pc.connectionState;
  switch (state) {
    case 'connected': return 'success';
    case 'connecting': return 'warning';
    case 'disconnected': return 'error';
    case 'failed': return 'error';
    default: return 'grey';
  }
});

const iceStateColor = computed(() => {
  const state = props.peer.pc.iceConnectionState;
  switch (state) {
    case 'connected':
    case 'completed':
      return 'success';
    case 'checking':
      return 'warning';
    case 'disconnected':
    case 'failed':
      return 'error';
    default:
      return 'grey';
  }
});

const signalingStateColor = computed(() => {
  const state = props.peer.pc.signalingState;
  switch (state) {
    case 'stable':
      return 'success';
    case 'have-local-offer':
    case 'have-remote-offer':
    case 'have-local-pranswer':
    case 'have-remote-pranswer':
      return 'warning';
    case 'closed':
      return 'error';
    default:
      return 'grey';
  }
});

const distance = computed(() => {
  if (!props.positionData || !props.myPosition) return null;

  const dx = props.positionData.x - props.myPosition.x;
  const dy = props.positionData.y - props.myPosition.y;
  const dz = props.positionData.z - props.myPosition.z;

  return Math.sqrt(dx * dx + dy * dy + dz * dz);
});

const connectionAge = computed(() => {
  return Math.floor((currentTime.value - connectionCreatedTime.value) / 1000);
});

// Audio state computed properties
const isSendingAudio = computed(() => {
  const senders = props.peer.pc.getSenders();
  return senders.some(sender =>
    sender.track?.kind === 'audio' &&
    sender.track.readyState === 'live' &&
    sender.track.enabled
  );
});

const isReceivingAudio = computed(() => {
  const receivers = props.peer.pc.getReceivers();
  return receivers.some(receiver =>
    receiver.track?.kind === 'audio' &&
    receiver.track.readyState === 'live'
  );
});

const connectionQualityColor = computed(() => {
  if (props.peer.pc.connectionState !== 'connected') return 'grey';

  const iceState = props.peer.pc.iceConnectionState;
  if (iceState === 'connected' || iceState === 'completed') {
    return isReceivingAudio.value && isSendingAudio.value ? 'success' :
           isReceivingAudio.value || isSendingAudio.value ? 'warning' : 'error';
  }
  return iceState === 'checking' ? 'warning' : 'error';
});

const connectionQualityIcon = computed(() => {
  if (props.peer.pc.connectionState !== 'connected') return 'mdi-wifi-off';

  const iceState = props.peer.pc.iceConnectionState;
  if (iceState === 'connected' || iceState === 'completed') {
    if (isReceivingAudio.value && isSendingAudio.value) return 'mdi-wifi-strength-4';
    if (isReceivingAudio.value || isSendingAudio.value) return 'mdi-wifi-strength-2';
    return 'mdi-wifi-strength-1';
  }
  return iceState === 'checking' ? 'mdi-wifi-strength-outline' : 'mdi-wifi-off';
});

const connectionQualityText = computed(() => {
  if (props.peer.pc.connectionState !== 'connected') {
    return `Disconnected: ${props.peer.pc.connectionState}`;
  }

  const iceState = props.peer.pc.iceConnectionState;
  const audioStatus = [];

  if (isSendingAudio.value) audioStatus.push('sending audio');
  if (isReceivingAudio.value) audioStatus.push('receiving audio');

  const audioText = audioStatus.length > 0 ? ` (${audioStatus.join(', ')})` : ' (no audio)';

  return `ICE: ${iceState}${audioText}`;
});

const audioLevelColor = computed(() => {
  if (receivingAudioLevel.value < 10) return 'grey';
  if (receivingAudioLevel.value < 25) return 'success';
  if (receivingAudioLevel.value < 50) return 'warning';
  return 'error';
});

// Methods
function updateVolume(value: number) {
  localVolume.value = value;
  emit('volumeChange', value);
}

// Setup audio analysis for received audio
function setupAudioAnalysis(stream: MediaStream) {
  try {
    // Create audio context if not available
    const audioContext = new AudioContext();

    // Create analyser node
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    // Create source from stream
    const source = audioContext.createMediaStreamSource(stream);

    // Connect source to analyser
    source.connect(analyser);

    // Store analyser data
    audioAnalyserData.value = {
      analyser,
      source,
      rmsLevel: 0,
      peakLevel: 0
    };

    // Start analysis loop
    startAudioAnalysis();

    console.log(`[WebRTC Audio Debug] Started audio analysis for peer ${props.peerId}`);
  } catch (err) {
    console.error(`[WebRTC Audio Debug] Failed to setup audio analysis:`, err);
  }
}

// Start audio level analysis loop
function startAudioAnalysis() {
  if (audioAnalysisInterval.value) {
    clearInterval(audioAnalysisInterval.value);
  }

  audioAnalysisInterval.value = setInterval(() => {
    if (!audioAnalyserData.value) return;

    const { analyser } = audioAnalyserData.value;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    analyser.getByteFrequencyData(dataArray);

    // Calculate RMS (Root Mean Square) for overall volume
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += (dataArray[i] / 255) ** 2;
    }
    const rms = Math.sqrt(sum / bufferLength);
    const rmsLevel = Math.min(rms * 100 * 2, 100); // Scale and clamp to 0-100

    // Calculate peak level
    const peakLevel = Math.min((Math.max(...dataArray) / 255) * 100, 100);

    // Update reactive values
    receivingAudioLevel.value = rmsLevel;
    audioAnalyserData.value.rmsLevel = rmsLevel;
    audioAnalyserData.value.peakLevel = peakLevel;

    // Update audio state if we detect audio
    if (rmsLevel > 5 && !isReceivingAudio.value) {
      // Audio detected, might need to trigger re-render
      console.log(`[WebRTC Audio Debug] Audio detected: ${rmsLevel.toFixed(1)}% RMS`);
    }

  }, 100); // Update every 100ms
}

// Stop audio analysis
function stopAudioAnalysis() {
  if (audioAnalysisInterval.value) {
    clearInterval(audioAnalysisInterval.value);
    audioAnalysisInterval.value = null;
  }

  if (audioAnalyserData.value) {
    audioAnalyserData.value.source.disconnect();
    audioAnalyserData.value.analyser.disconnect();
    audioAnalyserData.value = null;
  }

  receivingAudioLevel.value = 0;
  console.log(`[WebRTC Audio Debug] Stopped audio analysis for peer ${props.peerId}`);
}

function setupDebugTracking() {
  // Track ICE candidates being sent
  const originalOnIceCandidate = props.peer.pc.onicecandidate;
  props.peer.pc.onicecandidate = (event) => {
    if (event.candidate) {
      sentIceCandidates.value++;
    }
    // Call original handler if it exists
    if (originalOnIceCandidate) {
      originalOnIceCandidate.call(props.peer.pc, event);
    }
  };

  // Track connection state changes with timestamps
  const originalOnConnectionStateChange = props.peer.pc.onconnectionstatechange;
  props.peer.pc.onconnectionstatechange = (event) => {
    console.log(`[WebRTC Debug] Peer ${props.peerId} state changed to: ${props.peer.pc.connectionState} (age: ${connectionAge.value}s)`);

    // Call original handler if it exists
    if (originalOnConnectionStateChange) {
      originalOnConnectionStateChange.call(props.peer.pc, event);
    }
  };

  // Track ICE connection state changes
  const originalOnIceConnectionStateChange = props.peer.pc.oniceconnectionstatechange;
  props.peer.pc.oniceconnectionstatechange = (event) => {
    console.log(`[WebRTC Debug] Peer ${props.peerId} ICE state changed to: ${props.peer.pc.iceConnectionState} (age: ${connectionAge.value}s)`);

    // Call original handler if it exists
    if (originalOnIceConnectionStateChange) {
      originalOnIceConnectionStateChange.call(props.peer.pc, event);
    }
  };
}

// Watch for external volume changes
watch(() => props.volume, (newVolume) => {
  if (newVolume !== undefined) {
    localVolume.value = newVolume;
  }
});

// Handle spatial audio node when remote stream is available
watch(() => props.peer.remoteStream, (stream, oldStream) => {
  // Stop analysis on old stream
  if (oldStream) {
    stopAudioAnalysis();
  }

  // Start analysis on new stream
  if (stream) {
    setupAudioAnalysis(stream);

    if (!props.spatialAudioNode) {
      // Parent component should handle spatial audio node creation
      // We just notify that we need one
      emit('spatialNodeCreated', new Audio());
    }
  }
});

// Timer for updating current time
let timeUpdateInterval: ReturnType<typeof setInterval> | null = null;

// Setup debug tracking
onMounted(() => {
  setupDebugTracking();
  
  // Update current time every second for reactive connection age
  timeUpdateInterval = setInterval(() => {
    currentTime.value = Date.now();
  }, 1000);
});

// Cleanup
onUnmounted(() => {
  // Stop audio analysis
  stopAudioAnalysis();
  
  // Clear time update interval
  if (timeUpdateInterval) {
    clearInterval(timeUpdateInterval);
  }

  if (props.spatialAudioNode) {
    emit('spatialNodeRemoved');
  }
});
</script>
