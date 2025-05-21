<template>
  <div class="webrtc-test">
    <v-text-field v-model="sessionId" placeholder="Session ID" />
    <v-btn @click="startCaller" :disabled="started">Start as Caller</v-btn>
    <v-btn @click="startCallee" :disabled="started">Start as Callee</v-btn>
    <div v-if="localStream">
      <h4>Local Audio</h4>
      <audio ref="localAudioRef" autoplay></audio>
    </div>
    <div v-if="remoteStream">
      <h4>Remote Audio</h4>
      <audio ref="remoteAudioRef" autoplay></audio>
    </div>
    <v-card-text>
      <v-list dense>
        <v-list-item><v-list-item-title>Session ID: {{ sessionId }}</v-list-item-title></v-list-item>
        <v-list-item><v-list-item-title>Started: {{ started }}</v-list-item-title></v-list-item>
        <v-list-item><v-list-item-title>Local Tracks: {{ localStream?.getTracks().length ?? 0 }}</v-list-item-title></v-list-item>
        <v-list-item><v-list-item-title>Remote Tracks: {{ remoteStream?.getTracks().length ?? 0 }}</v-list-item-title></v-list-item>
        <v-list-item v-if="micLabel"><v-list-item-title>Microphone: {{ micLabel }}</v-list-item-title></v-list-item>
        <v-list-item v-if="offerRetrieving"><v-list-item-title>Waiting for offer...</v-list-item-title></v-list-item>
        <v-list-item v-if="offer"><v-list-item-title>Received Offer SDP: {{ offer.sdp }}</v-list-item-title></v-list-item>
        <v-list-item v-if="offerError"><v-list-item-title>Offer Error: {{ offerError.message }}</v-list-item-title></v-list-item>
        <v-list-item v-if="answerRetrieving"><v-list-item-title>Waiting for answer...</v-list-item-title></v-list-item>
        <v-list-item v-if="answer"><v-list-item-title>Received Answer SDP: {{ answer.sdp }}</v-list-item-title></v-list-item>
        <v-list-item v-if="answerError"><v-list-item-title>Answer Error: {{ answerError.message }}</v-list-item-title></v-list-item>
      </v-list>
    </v-card-text>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, type Ref, nextTick } from "vue";
import { useWebRTC } from "../../../../sdk/vircadia-world-sdk-ts/browser/src/vue/composable/useWebRTC";

const sessionId = ref<string>("");
const rtc = useWebRTC({});
const pc = new RTCPeerConnection();

// Debug state
const micLabel = ref<string | null>(null);
let offer: Ref<{ type: "offer"; sdp: string } | null> = ref(null);
let offerRetrieving: Ref<boolean> = ref(false);
let offerError: Ref<Error | null> = ref(null);
let answer: Ref<{ type: "answer"; sdp: string } | null> = ref(null);
let answerRetrieving: Ref<boolean> = ref(false);
let answerError: Ref<Error | null> = ref(null);

const localStream = ref<MediaStream | null>(null);
const remoteStream = ref<MediaStream | null>(null);
const started = ref(false);

const localAudioRef = ref<HTMLAudioElement | null>(null);
const remoteAudioRef = ref<HTMLAudioElement | null>(null);

// Add debug listeners for connection and ICE events
pc.onicecandidate = (event) =>
    console.log("[WebRTCTest] ICE candidate:", event);
pc.oniceconnectionstatechange = () =>
    console.log("[WebRTCTest] ICE connection state:", pc.iceConnectionState);
pc.onconnectionstatechange = () =>
    console.log("[WebRTCTest] Connection state:", pc.connectionState);

const startCaller = async () => {
    if (!sessionId.value) {
        console.error("Session ID is required");
        return;
    }
    started.value = true;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log("[WebRTCTest] Acquired local stream:", stream);
    localStream.value = stream;
    // Enumerate microphone device
    const devices = await navigator.mediaDevices.enumerateDevices();
    const track = stream.getAudioTracks()[0];
    const settings = track.getSettings();
    const deviceInfo = devices.find((d) => d.deviceId === settings.deviceId);
    micLabel.value = deviceInfo?.label || settings.deviceId || null;
    for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
    }
    // Create and send an offer over signaling
    const offerDesc = await pc.createOffer();
    await pc.setLocalDescription(offerDesc);
    await rtc.createOffer(sessionId.value, offerDesc);
    pc.ontrack = (event) => {
        if (!remoteStream.value) {
            remoteStream.value = new MediaStream();
        }
        for (const t of event.streams[0].getTracks()) {
            remoteStream.value?.addTrack(t);
        }
    };
    ({
        answer,
        retrieving: answerRetrieving,
        error: answerError,
    } = rtc.waitForAnswer(sessionId.value));
    watch(answer, async (ans) => {
        if (ans && pc.remoteDescription == null) {
            const desc = new RTCSessionDescription(ans);
            await pc.setRemoteDescription(desc);
        }
    });
};

const startCallee = async () => {
    if (!sessionId.value) {
        console.error("Session ID is required");
        return;
    }
    started.value = true;
    pc.ontrack = (event) => {
        if (!remoteStream.value) {
            remoteStream.value = new MediaStream();
        }
        for (const t of event.streams[0].getTracks()) {
            remoteStream.value?.addTrack(t);
        }
    };
    ({
        offer,
        retrieving: offerRetrieving,
        error: offerError,
    } = rtc.waitForOffer(sessionId.value));
    watch(offer, async (off) => {
        if (off && pc.remoteDescription == null) {
            const desc = new RTCSessionDescription(off);
            await pc.setRemoteDescription(desc);
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
            });
            localStream.value = stream;
            // Enumerate microphone device
            const devices = await navigator.mediaDevices.enumerateDevices();
            const track = stream.getAudioTracks()[0];
            const settings = track.getSettings();
            const deviceInfo = devices.find(
                (d) => d.deviceId === settings.deviceId,
            );
            micLabel.value = deviceInfo?.label || settings.deviceId || null;
            for (const track of stream.getTracks()) {
                pc.addTrack(track, stream);
            }
            const answerDesc = await pc.createAnswer();
            await pc.setLocalDescription(answerDesc);
            await rtc.createAnswer(sessionId.value, answerDesc);
        }
    });
};

watch(
    localStream,
    async (stream) => {
        await nextTick();
        console.log(
            "[WebRTCTest] localStream watch:",
            stream,
            localAudioRef.value,
        );
        if (stream && localAudioRef.value) {
            localAudioRef.value.srcObject = stream;
            localAudioRef.value.oncanplay = () =>
                console.log("[WebRTCTest] localAudioRef canplay");
            localAudioRef.value.onplay = () =>
                console.log("[WebRTCTest] localAudioRef playing");
            localAudioRef.value.onerror = (e) =>
                console.error("[WebRTCTest] localAudioRef error", e);
            localAudioRef.value
                .play()
                .catch((e) =>
                    console.error("[WebRTCTest] localAudioRef play error", e),
                );
        }
    },
    { flush: "post" },
);

watch(
    remoteStream,
    async (stream) => {
        await nextTick();
        if (stream && remoteAudioRef.value) {
            remoteAudioRef.value.srcObject = stream;
            try {
                await remoteAudioRef.value.play();
            } catch (e) {
                console.error("[WebRTCTest] remoteAudioRef play error", e);
            }
        }
    },
    { flush: "post" },
);
</script>

<style scoped>
.webrtc-test {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.webrtc-test input {
  padding: 4px;
}
</style>
