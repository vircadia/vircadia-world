import { ref, watch, computed, type Ref } from "vue";
import { useAppStore } from "@/stores/appStore";

export interface SpatialAudioOptions {
    refDistance?: number;
    maxDistance?: number;
    rolloffFactor?: number;
    coneInnerAngle?: number;
    coneOuterAngle?: number;
    panningModel?: PanningModelType;
    distanceModel?: DistanceModelType;
}

export interface PeerAudioNode {
    audioElement: HTMLAudioElement;
    source: MediaStreamAudioSourceNode;
    panner: PannerNode;
    gain: GainNode;
}

export function useWebRTCSpatialAudio(options: SpatialAudioOptions = {}) {
    const appStore = useAppStore();

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
        panningModel: options.panningModel ?? "HRTF",
        distanceModel: options.distanceModel ?? "inverse",
    };

    // Initialize audio context
    function initialize() {
        if (isInitialized.value) return;

        try {
            audioContext.value = new AudioContext();
            isInitialized.value = true;

            console.log("[SpatialAudio] Audio context initialized");

            // Set initial listener position
            updateListenerPosition();

            // Resume audio context if suspended (due to browser autoplay policies)
            if (audioContext.value.state === "suspended") {
                console.log(
                    "[SpatialAudio] Audio context suspended, attempting to resume...",
                );
                audioContext.value
                    .resume()
                    .then(() => {
                        console.log(
                            "[SpatialAudio] Audio context resumed successfully",
                        );
                    })
                    .catch((error) => {
                        console.error(
                            "[SpatialAudio] Failed to resume audio context:",
                            error,
                        );
                    });
            }
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

        // Convert spherical coordinates to cartesian (forward direction)
        const x = Math.sin(alpha) * Math.sin(beta);
        const y = -Math.cos(beta);
        const z = Math.cos(alpha) * Math.sin(beta);

        return { x, y, z };
    }

    // Update listener (my avatar) position and orientation
    function updateListenerPosition() {
        if (!audioContext.value || !appStore.myAvatarMetadata) return;

        const listener = audioContext.value.listener;
        const pos = appStore.myAvatarMetadata.position;
        const cam = appStore.myAvatarMetadata.cameraOrientation;

        try {
            // Set position
            if (listener.positionX) {
                // Modern Web Audio API
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
                // Fallback for older browsers
                listener.setPosition(pos.x, pos.y, pos.z);
            }

            // Calculate forward and up vectors from camera orientation
            const forward = calculateForwardVector(cam);
            const up = { x: 0, y: 1, z: 0 }; // Y-up coordinate system

            if (listener.forwardX) {
                // Modern Web Audio API
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
                // Fallback for older browsers
                listener.setOrientation(
                    forward.x,
                    forward.y,
                    forward.z,
                    up.x,
                    up.y,
                    up.z,
                );
            }

            console.log(
                `[SpatialAudio] Updated listener position: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}) forward: (${forward.x.toFixed(2)}, ${forward.y.toFixed(2)}, ${forward.z.toFixed(2)})`,
            );
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

        console.log(
            `[SpatialAudio] Creating spatial audio node for peer: ${peerId.substring(0, 8)}...`,
        );

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
            });

            console.log(
                `[SpatialAudio] Created spatial audio node for peer: ${peerId.substring(0, 8)}...`,
            );

            return audio;
        } catch (error) {
            console.error(
                `[SpatialAudio] Failed to create audio node for peer ${peerId}:`,
                error,
            );
            throw error;
        }
    }

    // Update peer audio position based on their avatar metadata
    function updatePeerPosition(peerId: string) {
        const nodeInfo = peerAudioNodes.value.get(peerId);
        if (!nodeInfo || !audioContext.value) return;

        const peerMetadata = appStore.getOtherAvatarMetadata(peerId);
        if (!peerMetadata) {
            console.warn(
                `[SpatialAudio] No metadata found for peer: ${peerId.substring(0, 8)}...`,
            );
            return;
        }

        const pos = peerMetadata.position;
        const panner = nodeInfo.panner;

        try {
            if (panner.positionX) {
                // Modern Web Audio API
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
                // Fallback for older browsers
                panner.setPosition(pos.x, pos.y, pos.z);
            }

            // Calculate distance for debugging
            if (appStore.myAvatarMetadata) {
                const myPos = appStore.myAvatarMetadata.position;
                const distance = Math.sqrt(
                    (pos.x - myPos.x) ** 2 +
                        (pos.y - myPos.y) ** 2 +
                        (pos.z - myPos.z) ** 2,
                );

                console.log(
                    `[SpatialAudio] Updated peer ${peerId.substring(0, 8)}... position: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}) distance: ${distance.toFixed(2)}`,
                );
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
            console.log(
                `[SpatialAudio] Set volume for peer ${peerId.substring(0, 8)}...: ${volume}%`,
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

        console.log(
            `[SpatialAudio] Removing audio node for peer: ${peerId.substring(0, 8)}...`,
        );

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

            console.log(
                `[SpatialAudio] Cleaned up audio node for peer: ${peerId.substring(0, 8)}...`,
            );
        } catch (error) {
            console.error(
                `[SpatialAudio] Error cleaning up audio node for peer ${peerId}:`,
                error,
            );
        }
    }

    // Cleanup all resources
    function cleanup() {
        console.log("[SpatialAudio] Cleaning up spatial audio resources");

        // Remove all peer audio nodes
        for (const peerId of peerAudioNodes.value.keys()) {
            removePeerAudio(peerId);
        }

        // Close audio context
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
                console.log(
                    "[SpatialAudio] Audio context resumed after user interaction",
                );
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

    // Watch for my avatar position changes
    watch(
        () => appStore.myAvatarMetadata,
        () => {
            updateListenerPosition();
        },
        { deep: true },
    );

    // Watch for other avatar position changes
    watch(
        () => appStore.otherAvatarsMetadata,
        () => {
            updateAllPeerPositions();
        },
        { deep: true },
    );

    // Computed property to get the number of active spatial audio peers
    const activePeerCount = computed(() => peerAudioNodes.value.size);

    // Computed property to check if spatial audio is ready
    const isReady = computed(() => isInitialized.value && !!audioContext.value);

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
    };
}
