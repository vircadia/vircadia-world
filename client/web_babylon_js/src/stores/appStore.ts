import { defineStore } from "pinia";
import type {
    BabylonModelDefinition,
    BabylonAnimationDefinition,
    PeerAudioState,
} from "../composables/schemas";
import type { AvatarMetadata } from "../composables/schemas";
import {
    AvatarMetadataSchema,
    AvatarMetadataWithDefaultsSchema,
} from "../composables/schemas";

export const useAppStore = defineStore("app", {
    state: () => ({
        // global loading indicator
        loading: false as boolean,
        // global error message
        error: null as string | null,
        // model definitions for environments
        modelDefinitions: [
            {
                fileName: "babylon.level.glb",
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0, w: 1 },
                throttleInterval: 10,
                enablePhysics: true,
                physicsType: "mesh",
                physicsOptions: {
                    mass: 0,
                    friction: 0.5,
                    restitution: 0.3,
                },
            },
        ] as BabylonModelDefinition[],
        // HDR environment list
        hdrList: ["babylon.level.hdr.1k.hdr"] as string[],
        // IDs for session, agent, and instance
        sessionId: null as string | null,
        agentId: null as string | null,
        instanceId: null as string | null,
        // My avatar metadata
        myAvatarMetadata: null as AvatarMetadata | null,
        // Other avatars metadata map (keyed by sessionId)
        otherAvatarsMetadata: {} as Record<string, AvatarMetadata>,
        // avatar configuration
        avatarDefinition: {
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
                    fileName:
                        "babylon.avatar.animation.f.crouch_strafe_left.glb",
                },
                {
                    fileName:
                        "babylon.avatar.animation.f.crouch_strafe_right.glb",
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
                    fileName:
                        "babylon.avatar.animation.f.walk_strafe_right.glb",
                },
            ] as BabylonAnimationDefinition[],
        },
        // Performance mode configuration
        performanceMode: "low" as "normal" | "low",
        targetFPS: 30, // Target FPS for low performance mode

        // Polling intervals configuration (in milliseconds)
        pollingIntervals: {
            // Avatar discovery interval - how often to check for new avatars
            avatarDiscovery: 2000,
            // Other avatar data polling - how often to fetch other avatars' position/state
            // Using incremental updates (only fetches joints updated since last poll)
            otherAvatarData: 500,
            // WebRTC signaling polling - how often to check for offers/answers
            webRTCSignaling: 1500,
            // WebRTC stale threshold - time before considering signaling data stale
            webRTCStaleThreshold: 20000,
            // Spatial audio update interval - how often to update 3D audio positions
            spatialAudioUpdate: 100,
            // Debug overlay refresh rate
            debugOverlayRefresh: 100,
            // Avatar data transmission intervals (position, rotation, camera)
            avatarData: 100,
            // Avatar joint data transmission interval (skeleton bones) - less frequent
            avatarJointData: 1000,
        },
        // Spatial audio state
        spatialAudioEnabled: false,
        peerAudioStates: {} as Record<string, PeerAudioState>,
    }),
    getters: {
        // whether an error is set
        hasError: (state): boolean => state.error !== null,
        // get full session ID (sessionId + instanceId)
        fullSessionId: (state): string | null => {
            if (!state.sessionId || !state.instanceId) return null;
            return `${state.sessionId}-${state.instanceId}`;
        },
        // get other avatar metadata by sessionId
        getOtherAvatarMetadata: (state) => (sessionId: string) => {
            return state.otherAvatarsMetadata[sessionId] || null;
        },
        // get active audio connections count
        activeAudioConnectionsCount: (state): number => {
            return Object.values(state.peerAudioStates).filter(
                (peer) => peer.isReceiving || peer.isSending,
            ).length;
        },
        // get peer audio state
        getPeerAudioState:
            (state) =>
            (sessionId: string): PeerAudioState | null => {
                return state.peerAudioStates[sessionId] || null;
            },
        // get all active peer audio states
        activePeerAudioStates: (state): PeerAudioState[] => {
            return Object.values(state.peerAudioStates).filter(
                (peer) => peer.isReceiving || peer.isSending,
            );
        },
    },
    actions: {
        // set the loading flag
        setLoading(value: boolean) {
            this.loading = value;
        },
        // set a global error message
        setError(message: string | null) {
            this.error = message;
        },
        // clear the error
        clearError() {
            this.error = null;
        },
        // set the session ID
        setSessionId(id: string | null) {
            this.sessionId = id;
        },
        // set the agent ID
        setAgentId(id: string | null) {
            this.agentId = id;
        },
        // set the instance ID
        setInstanceId(id: string | null) {
            this.instanceId = id;
        },
        // set my avatar metadata
        setMyAvatarMetadata(
            metadata: AvatarMetadata | Map<string, unknown> | unknown,
        ) {
            if (metadata === null) {
                this.myAvatarMetadata = null;
            } else {
                try {
                    // Use the safe parser to validate and fill in defaults
                    this.myAvatarMetadata =
                        AvatarMetadataWithDefaultsSchema.parse(metadata);
                } catch (error) {
                    console.error("Invalid avatar metadata:", error);
                    // Keep existing metadata if validation fails
                }
            }
        },
        // update my avatar metadata partially
        updateMyAvatarMetadata(partialMetadata: Partial<AvatarMetadata>) {
            if (!this.myAvatarMetadata) {
                // If no metadata exists, create new with defaults
                this.setMyAvatarMetadata(partialMetadata);
            } else {
                try {
                    // Validate the partial update
                    const validatedUpdate =
                        AvatarMetadataSchema.partial().parse(partialMetadata);
                    // Merge with existing metadata
                    const merged = {
                        ...this.myAvatarMetadata,
                        ...validatedUpdate,
                    };
                    // Re-validate the complete object
                    this.myAvatarMetadata =
                        AvatarMetadataWithDefaultsSchema.parse(merged);
                } catch (error) {
                    console.error("Invalid avatar metadata update:", error);
                    // Keep existing metadata if validation fails
                }
            }
        },
        // set other avatar metadata
        setOtherAvatarMetadata(
            sessionId: string,
            metadata: AvatarMetadata | Map<string, unknown> | unknown,
        ) {
            try {
                // Use the safe parser to validate and fill in defaults
                this.otherAvatarsMetadata[sessionId] =
                    AvatarMetadataWithDefaultsSchema.parse(metadata);
            } catch (error) {
                console.error(
                    `Invalid avatar metadata for session ${sessionId}:`,
                    error,
                );
                // Don't set invalid metadata
            }
        },
        // remove other avatar metadata
        removeOtherAvatarMetadata(sessionId: string) {
            delete this.otherAvatarsMetadata[sessionId];
        },
        // clear all other avatars metadata
        clearOtherAvatarsMetadata() {
            this.otherAvatarsMetadata = {};
        },
        // set performance mode
        setPerformanceMode(mode: "normal" | "low") {
            this.performanceMode = mode;
        },
        // toggle performance mode
        togglePerformanceMode() {
            this.performanceMode =
                this.performanceMode === "normal" ? "low" : "normal";
        },
        // set target FPS
        setTargetFPS(fps: number) {
            this.targetFPS = fps;
        },
        // set polling interval
        setPollingInterval(
            key: keyof typeof this.pollingIntervals,
            value: number,
        ) {
            this.pollingIntervals[key] = value;
        },
        // set all polling intervals
        setPollingIntervals(intervals: Partial<typeof this.pollingIntervals>) {
            Object.assign(this.pollingIntervals, intervals);
        },
        // generate and set a new instance ID
        generateInstanceId() {
            const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
            let result = "";
            for (let i = 0; i < 6; i++) {
                result += chars.charAt(
                    Math.floor(Math.random() * chars.length),
                );
            }
            this.instanceId = result;
            return result;
        },
        // Spatial audio actions
        setSpatialAudioEnabled(enabled: boolean) {
            this.spatialAudioEnabled = enabled;
        },
        setPeerAudioState(sessionId: string, state: Partial<PeerAudioState>) {
            if (!this.peerAudioStates[sessionId]) {
                this.peerAudioStates[sessionId] = {
                    sessionId,
                    volume: 100,
                    isMuted: false,
                    isReceiving: false,
                    isSending: false,
                };
            }
            Object.assign(this.peerAudioStates[sessionId], state);
        },
        removePeerAudioState(sessionId: string) {
            delete this.peerAudioStates[sessionId];
        },
        setPeerVolume(sessionId: string, volume: number) {
            if (this.peerAudioStates[sessionId]) {
                this.peerAudioStates[sessionId].volume = volume;
            }
        },
        setPeerMuted(sessionId: string, muted: boolean) {
            if (this.peerAudioStates[sessionId]) {
                this.peerAudioStates[sessionId].isMuted = muted;
            }
        },
        clearPeerAudioStates() {
            this.peerAudioStates = {};
        },
    },
});
