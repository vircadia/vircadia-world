import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useStorage, StorageSerializers } from "@vueuse/core";
import type {
    BabylonAnimationDefinition,
    PeerAudioState,
} from "../composables/schemas";
import type { AvatarMetadata } from "../composables/schemas";
import {
    AvatarMetadataSchema,
    AvatarMetadataWithDefaultsSchema,
} from "../composables/schemas";
// Auth/session is handled outside of the app store

export const useAppStore = defineStore("app", () => {
    // global loading indicator
    const loading = ref(false);
    // global error message
    const error = ref<string | null>(null);
    // HDR environment list
    const hdrList = ref<string[]>(["babylon.level.hdr.1k.hdr"]);
    // IDs for session, agent, and instance
    const instanceId = ref<string | null>(null);
    // My avatar metadata
    const myAvatarMetadata = ref<AvatarMetadata | null>(null);
    // avatar configuration
    const avatarDefinition = ref({
        initialAvatarPosition: { x: 0, y: 0, z: -5 },
        initialAvatarRotation: { x: 0, y: 0, z: 0, w: 1 },
        initialAvatarCameraOrientation: {
            alpha: -Math.PI / 2,
            beta: Math.PI / 3,
            radius: 5,
        },
        modelFileName: "babylon.avatar.glb",
        meshPivotPoint: "bottom" as "bottom" | "center",
        throttleInterval: 500,
        capsuleHeight: 1.8,
        capsuleRadius: 0.3,
        slopeLimit: 45,
        jumpSpeed: 5,
        debugBoundingBox: false,
        debugSkeleton: true,
        debugAxes: false,
        walkSpeed: 1.47,
        turnSpeed: Math.PI,
        blendDuration: 0.15, // seconds for animation blend transition
        gravity: -9.8, // gravity acceleration (units per second squared)
        animations: [
            {
                fileName: "babylon.avatar.animation.f.idle.1.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.idle.2.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.idle.3.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.idle.4.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.idle.5.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.idle.6.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.idle.7.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.idle.8.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.idle.9.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.idle.10.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.walk.1.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.walk.2.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.crouch_strafe_left.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.crouch_strafe_right.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.crouch_walk_back.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.crouch_walk.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.falling_idle.1.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.falling_idle.2.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.jog_back.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.jog.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.jump_small.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.jump.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.run_back.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.run_strafe_left.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.run_strafe_right.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.run.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.strafe_left.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.strafe_right.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.talking.1.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.talking.2.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.talking.3.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.talking.4.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.talking.5.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.talking.6.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.walk_back.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.walk_jump.1.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.walk_jump.2.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.walk_strafe_left.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.walk_strafe_right.glb",
            },
        ] as BabylonAnimationDefinition[],
    });
    // Performance mode is now handled exclusively by BabylonCanvas

    // Polling intervals configuration (in milliseconds)
    const pollingIntervals = ref({
        // Avatar discovery interval - how often to check for new avatars
        avatarDiscovery: 2000,
        // Other avatar data polling - how often to fetch other avatars' position/state
        otherAvatarData: 1000,
        // Other avatar joint data polling - how often to fetch other avatars' skeleton joints
        // Using incremental updates (only fetches joints updated since last poll)
        otherAvatarJointData: 2500,
        // WebRTC signaling polling - how often to check for offers/answers
        webRTCSignaling: 1500,
        // WebRTC stale threshold - time before considering signaling data stale
        webRTCStaleThreshold: 20000,
        // Spatial audio update interval - how often to update 3D audio positions
        spatialAudioUpdate: 100,
        // Debug overlay refresh rate
        debugOverlayRefresh: 100,
        // Avatar data transmission intervals (position, rotation, camera)
        avatarData: 1000,
        // Avatar joint data transmission interval (skeleton bones) - less frequent
        avatarJointData: 2500,
    });
    // Spatial audio state
    const spatialAudioEnabled = ref(false);
    const peerAudioStates = ref<Record<string, PeerAudioState>>({});

    // Auth/session moved out of appStore

    // whether an error is set
    const hasError = computed((): boolean => error.value !== null);
    // auth provider/session derived state removed
    // Other avatars metadata moved out of the store; managed by components
    // get active audio connections count
    const activeAudioConnectionsCount = computed((): number => {
        return Object.values(peerAudioStates.value).filter(
            (peer) => peer.isReceiving || peer.isSending,
        ).length;
    });
    // get peer audio state
    const getPeerAudioState = computed(
        () =>
            (sessionId: string): PeerAudioState | null => {
                return peerAudioStates.value[sessionId] || null;
            },
    );
    // get all active peer audio states
    const activePeerAudioStates = computed((): PeerAudioState[] => {
        return Object.values(peerAudioStates.value).filter(
            (peer) => peer.isReceiving || peer.isSending,
        );
    });

    // No isAuthenticated in appStore

    // set the loading flag
    function setLoading(value: boolean) {
        loading.value = value;
    }
    // set a global error message
    function setError(message: string | null) {
        error.value = message;
    }
    // clear the error
    function clearError() {
        error.value = null;
    }
    // set the instance ID
    function setInstanceId(id: string | null) {
        instanceId.value = id;
    }
    // set my avatar metadata
    function setMyAvatarMetadata(
        metadata: AvatarMetadata | Map<string, unknown> | unknown,
    ) {
        if (metadata === null) {
            myAvatarMetadata.value = null;
        } else {
            try {
                // Use the safe parser to validate and fill in defaults
                myAvatarMetadata.value =
                    AvatarMetadataWithDefaultsSchema.parse(metadata);
            } catch (error) {
                console.error("Invalid avatar metadata:", error);
                // Keep existing metadata if validation fails
            }
        }
    }
    // update my avatar metadata partially
    function updateMyAvatarMetadata(partialMetadata: Partial<AvatarMetadata>) {
        if (!myAvatarMetadata.value) {
            // If no metadata exists, create new with defaults
            setMyAvatarMetadata(partialMetadata);
        } else {
            try {
                // Validate the partial update
                const validatedUpdate =
                    AvatarMetadataSchema.partial().parse(partialMetadata);
                // Merge with existing metadata
                const merged = {
                    ...myAvatarMetadata.value,
                    ...validatedUpdate,
                };
                // Re-validate the complete object
                myAvatarMetadata.value =
                    AvatarMetadataWithDefaultsSchema.parse(merged);
            } catch (error) {
                console.error("Invalid avatar metadata update:", error);
                // Keep existing metadata if validation fails
            }
        }
    }
    // Other avatars metadata helpers removed
    // Performance controls removed from store
    // set polling interval
    function setPollingInterval(
        key: keyof typeof pollingIntervals.value,
        value: number,
    ) {
        pollingIntervals.value[key] = value;
    }
    // set all polling intervals
    function setPollingIntervals(
        intervals: Partial<typeof pollingIntervals.value>,
    ) {
        Object.assign(pollingIntervals.value, intervals);
    }
    // generate and set a new instance ID
    function generateInstanceId() {
        const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        let result = "";
        for (let i = 0; i < 6; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        instanceId.value = result;
        return result;
    }
    // Spatial audio actions
    function setSpatialAudioEnabled(enabled: boolean) {
        spatialAudioEnabled.value = enabled;
    }
    function setPeerAudioState(
        sessionId: string,
        state: Partial<PeerAudioState>,
    ) {
        if (!peerAudioStates.value[sessionId]) {
            peerAudioStates.value[sessionId] = {
                sessionId,
                volume: 100,
                isMuted: false,
                isReceiving: false,
                isSending: false,
            };
        }
        Object.assign(peerAudioStates.value[sessionId], state);
    }
    function removePeerAudioState(sessionId: string) {
        delete peerAudioStates.value[sessionId];
    }
    function setPeerVolume(sessionId: string, volume: number) {
        if (peerAudioStates.value[sessionId]) {
            peerAudioStates.value[sessionId].volume = volume;
        }
    }
    function setPeerMuted(sessionId: string, muted: boolean) {
        if (peerAudioStates.value[sessionId]) {
            peerAudioStates.value[sessionId].isMuted = muted;
        }
    }
    function clearPeerAudioStates() {
        peerAudioStates.value = {};
    }

    // Helper to construct API URL
    // Auth flows removed from appStore

    return {
        loading,
        error,
        hdrList,
        instanceId,
        myAvatarMetadata,
        avatarDefinition,
        pollingIntervals,
        spatialAudioEnabled,
        peerAudioStates,
        hasError,
        getCurrentAuthProvider,
        fullSessionId,
        activeAudioConnectionsCount,
        getPeerAudioState,
        activePeerAudioStates,
        setLoading,
        setError,
        clearError,
        setInstanceId,
        setMyAvatarMetadata,
        updateMyAvatarMetadata,
        // other avatar metadata actions removed

        setPollingInterval,
        setPollingIntervals,
        generateInstanceId,
        setSpatialAudioEnabled,
        setPeerAudioState,
        removePeerAudioState,
        setPeerVolume,
        setPeerMuted,
        clearPeerAudioStates,
    };
});
