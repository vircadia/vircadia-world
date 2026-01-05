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

// Interfaces for Debugging
export interface ListenerDebugInfo {
    position: { x: number; y: number; z: number };
    forward: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
    state: string;
}

export interface PeerSpatialDebugInfo {
    position: { x: number; y: number; z: number };
    panningModel: PanningModelType;
    distanceModel: DistanceModelType;
    refDistance: number;
    maxDistance: number;
    rolloffFactor: number;
    coneInnerAngle: number;
    coneOuterAngle: number;
    distance: number;
}

// Helper types for reactive sources
export interface SpatialAudioSources {
    myPosition?: Ref<{ x: number; y: number; z: number } | null>;
    myCameraOrientation?: Ref<{ alpha: number; beta: number; radius: number } | null>;
    otherPositions?: Ref<Record<string, { x: number; y: number; z: number }>>;
}

export function useWebRTCSpatialAudio(
    options: SpatialAudioOptions = {},
    sources?: SpatialAudioSources
) {
    const appStore = useAppStore();

    // Audio context and nodes
    const audioContext = ref<AudioContext | null>(null);
    const peerAudioNodes = ref(new Map<string, PeerAudioNode>());
    const isInitialized = ref(false);

    // Debug Refs
    const listenerDebug = ref<ListenerDebugInfo | null>(null);
    const peerSpatialDebug = ref(new Map<string, PeerSpatialDebugInfo>());

    // Default spatial audio settings
    // Updated defaults: refDistance 5 for better falloff, HRTF for better spatialization
    const settings = {
        refDistance: options.refDistance ?? 5,
        maxDistance: options.maxDistance ?? 100,
        rolloffFactor: options.rolloffFactor ?? 1,
        coneInnerAngle: options.coneInnerAngle ?? 360,
        coneOuterAngle: options.coneOuterAngle ?? 360,
        panningModel: (options.panningModel ?? "HRTF") as PanningModelType,
        distanceModel: (options.distanceModel ?? "inverse") as DistanceModelType,
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

            // Monitor audio context state changes
            audioContext.value.onstatechange = () => {
                console.log(
                    "[SpatialAudio] Audio context state changed to:",
                    audioContext.value?.state,
                );
                // Update debug state if exists
                if (listenerDebug.value) {
                    listenerDebug.value.state = audioContext.value?.state || "unknown";
                }
            };

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
        if (!audioContext.value) return;

        // Use provided sources or fallback to appStore (legacy support)
        const pos = sources?.myPosition?.value ?? appStore.myAvatarMetadata?.position;
        const cam = sources?.myCameraOrientation?.value ?? appStore.myAvatarMetadata?.cameraOrientation;

        if (!pos || !cam) return;

        // Polyfill for types
        type ListenerLike = AudioListener & {
            positionX?: AudioParam;
            positionY?: AudioParam;
            positionZ?: AudioParam;
            forwardX?: AudioParam;
            forwardY?: AudioParam;
            forwardZ?: AudioParam;
            upX?: AudioParam;
            upY?: AudioParam;
            upZ?: AudioParam;
            setPosition?: (x: number, y: number, z: number) => void;
            setOrientation?: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void;
        };

        const listener = audioContext.value.listener as ListenerLike;

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
                listener.setPosition?.(pos.x, pos.y, pos.z);
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
                listener.setOrientation?.(
                    forward.x,
                    forward.y,
                    forward.z,
                    up.x,
                    up.y,
                    up.z,
                );
            }

            // Update debug info
            listenerDebug.value = {
                position: { ...pos },
                forward: { ...forward },
                up: { ...up },
                state: audioContext.value.state
            };

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

        // Validate stream
        const audioTracks = remoteStream.getAudioTracks();
        if (audioTracks.length === 0) {
            console.warn(
                `[SpatialAudio] No audio tracks in remote stream for peer ${peerId.substring(0, 8)}...`,
            );
        }

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

        let pos: { x: number, y: number, z: number } | undefined;

        if (sources?.otherPositions?.value) {
            pos = sources.otherPositions.value[peerId];
        } else {
            // Fallback to appStore (legacy)
            const peerMetadata = appStore.getOtherAvatarMetadata(peerId);
            pos = peerMetadata?.position;
        }

        if (!pos) {
             // Only warn occasionally or if verbose to reduce noise
            return;
        }

        const panner = nodeInfo.panner;

        type PannerLike = PannerNode & {
             positionX?: AudioParam;
             positionY?: AudioParam;
             positionZ?: AudioParam;
             setPosition?: (x: number, y: number, z: number) => void;
        };
        const pannerTyped = panner as PannerLike;

        try {
            if (pannerTyped.positionX) {
                // Modern Web Audio API
                pannerTyped.positionX.setValueAtTime(
                    pos.x,
                    audioContext.value.currentTime,
                );
                pannerTyped.positionY.setValueAtTime(
                    pos.y,
                    audioContext.value.currentTime,
                );
                pannerTyped.positionZ.setValueAtTime(
                    pos.z,
                    audioContext.value.currentTime,
                );
            } else {
                // Fallback for older browsers
                pannerTyped.setPosition?.(pos.x, pos.y, pos.z);
            }

             // Calculate distance for debugging
             let myPos: { x: number, y: number, z: number } | undefined;
             if (listenerDebug.value?.position) {
                 myPos = listenerDebug.value.position;
             } else if (appStore.myAvatarMetadata) {
                 myPos = appStore.myAvatarMetadata.position;
             }

             if (myPos) {
                 const distance = Math.sqrt(
                     (pos.x - myPos.x) ** 2 +
                     (pos.y - myPos.y) ** 2 +
                     (pos.z - myPos.z) ** 2,
                 );

                 // Update debug info
                 peerSpatialDebug.value.set(peerId, {
                     position: { ...pos },
                     panningModel: panner.panningModel,
                     distanceModel: panner.distanceModel,
                     refDistance: panner.refDistance,
                     maxDistance: panner.maxDistance,
                     rolloffFactor: panner.rolloffFactor,
                     coneInnerAngle: panner.coneInnerAngle,
                     coneOuterAngle: panner.coneOuterAngle,
                     distance
                 });
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
            peerSpatialDebug.value.delete(peerId);

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
        listenerDebug.value = null;
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

    // WATCHERS

    // Watch for my avatar position changes (Legacy & Source)
    if (sources?.myPosition) {
        watch(
            sources.myPosition,
            () => { updateListenerPosition(); },
            { deep: true }
        );
    } else {
        // Legacy watcher on appStore
        watch(
            () => appStore.myAvatarMetadata,
            () => { updateListenerPosition(); },
            { deep: true },
        );
    }

    if (sources?.myCameraOrientation) {
         watch(
            sources.myCameraOrientation,
            () => { updateListenerPosition(); },
            { deep: true }
        );
    }

    // Watch for other avatar position changes (Legacy & Source)
    if (sources?.otherPositions) {
        watch(
            sources.otherPositions,
            () => { updateAllPeerPositions(); },
            { deep: true }
        );
    } else {
        watch(
            () => appStore.otherAvatarsMetadata,
            () => { updateAllPeerPositions(); },
            { deep: true },
        );
    }

    // Computed property to get the number of active spatial audio peers
    const activePeerCount = computed(() => peerAudioNodes.value.size);

    // Computed property to check if spatial audio is ready
    const isReady = computed(() => isInitialized.value && !!audioContext.value);

    // Expose context and nodes for analysis (compatible with component)
    function getAudioContext() {
        return audioContext.value;
    }
    function getPeerNode(peerId: string) {
        return peerAudioNodes.value.get(peerId);
    }

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

        // Debug & Analysis
        getAudioContext,
        getPeerNode,
        listenerDebug,
        peerSpatialDebug,
        getPeerSpatialDebug: (peerId: string) => peerSpatialDebug.value.get(peerId),
    };
}
