import type { AnimationGroup } from "@babylonjs/core";
import { z } from "zod";

// Shared LLM directive outputs
export enum LlmDirective {
    NoReply = "<no-reply/>",
    StoppedTalking = "<stopped-talking/>",
    SetTimeMorning = "<set-time-morning/>",
    SetTimeNoon = "<set-time-noon/>",
    SetTimeAfternoon = "<set-time-afternoon/>",
    SetTimeDusk = "<set-time-dusk/>",
    SetTimeNight = "<set-time-night/>",
    SetTimeDawn = "<set-time-dawn/>",
}

// Babylon.js environment interfaces
export interface HemisphericLightOptions {
    enabled?: boolean;
    direction?: [number, number, number];
    intensity?: number;
}

export interface DirectionalLightOptions {
    enabled?: boolean;
    direction?: [number, number, number];
    position?: [number, number, number];
    intensity?: number;
}

export interface GroundOptions {
    enabled?: boolean;
    width?: number;
    height?: number;
    position?: [number, number, number];
    diffuseColor?: [number, number, number];
    specularColor?: [number, number, number];
    mass?: number;
    friction?: number;
    restitution?: number;
}

// Local definitions moved from composables/schemas.ts to centralize schemas
export interface BabylonModelDefinition {
    entityName: string;
    fileName: string;
    entityType: "Model";
    position?: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number; w: number };
    throttleInterval?: number;
    ownerSessionId?: string | null;
    enablePhysics?: boolean;
    physicsType?: "box" | "convexHull" | "mesh";
    physicsOptions?: {
        mass?: number;
        friction?: number;
        restitution?: number;
        isKinematic?: boolean;
    };
}

export interface BabylonAnimationDefinition {
    /** Filename of the animation file (e.g. 'walk.glb') */
    fileName: string;
    ignoreHipTranslation?: boolean;
    /** If true, strip scale keys from mapping (forces scale to 1,1,1) */
    ignoreScale?: boolean;
    /** Direct URL to the animation file (if loaded from client bundle) */
    fileUrl?: string;
}

export type AnimationState = "idle" | "loading" | "ready" | "error";

export interface AnimationInfo {
    state: AnimationState;
    error?: string;
    group?: AnimationGroup;
}

export const Vector3Schema = z.object({
    x: z.coerce.number(),
    y: z.coerce.number(),
    z: z.coerce.number(),
});

export const QuaternionSchema = z.object({
    x: z.coerce.number(),
    y: z.coerce.number(),
    z: z.coerce.number(),
    w: z.coerce.number(),
});

// Schema for individual avatar joint metadata
export const AvatarJointMetadataSchema = z.object({
    // Some legacy writers omit this; default it for robustness
    type: z.literal("avatarJoint").optional().default("avatarJoint"),
    sessionId: z.coerce.string(),
    jointName: z.coerce.string(),
    position: Vector3Schema,
    rotation: QuaternionSchema,
    scale: Vector3Schema,
});

export type AvatarJointMetadata = z.infer<typeof AvatarJointMetadataSchema>;

// Zod schemas for avatar metadata
export const CameraSchema = z.object({
    alpha: z.coerce.number(),
    beta: z.coerce.number(),
    radius: z.coerce.number(),
});

// Base avatar data schema (without position/rotation)
export const AvatarBaseDataSchema = z.object({
    type: z.literal("avatar"),
    sessionId: z.coerce.string().nullable(),
    cameraOrientation: CameraSchema,
    modelFileName: z.coerce.string(),
});

export type AvatarBaseData = z.infer<typeof AvatarBaseDataSchema>;

// Position data schema
export const AvatarPositionDataSchema = Vector3Schema;

export type AvatarPositionData = z.infer<typeof AvatarPositionDataSchema>;

// Rotation data schema
export const AvatarRotationDataSchema = QuaternionSchema;

export type AvatarRotationData = z.infer<typeof AvatarRotationDataSchema>;

// Avatar debug interfaces
export interface DebugData {
    timestamp: string;
    sessionId: string;
    skeleton: {
        boneCount: number;
    };
    bones: Record<
        string,
        {
            p: string[];
            r: string;
        }
    >;
}

export interface DebugWindow extends Window {
    debugSkeletonLoop?: boolean;
    debugBoneNames?: boolean;
    debugOtherAvatar?: boolean;
}

// Note: Combined avatar metadata schemas removed.

export const ModelMetadataSchema = z.object({
    type: z.literal("Model"),
    modelFileName: z.coerce.string(),
    position: Vector3Schema,
    rotation: QuaternionSchema,
    ownerSessionId: z.coerce.string().nullable().default(null),
});

export type ModelMetadata = z.infer<typeof ModelMetadataSchema>;

// Zod schemas for WebRTC signaling
export const SignalingMessageSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("offer"),
        sdp: z.string(),
        sessionId: z.string(),
        timestamp: z.number(),
    }),
    z.object({
        type: z.literal("answer"),
        sdp: z.string(),
        sessionId: z.string(),
        timestamp: z.number(),
    }),
    z.object({
        type: z.literal("ice-candidate"),
        candidate: z.string().nullable(),
        sdpMLineIndex: z.number().nullable(),
        sdpMid: z.string().nullable(),
        sessionId: z.string(),
        timestamp: z.number(),
    }),
    z.object({
        type: z.literal("session-end"),
        sessionId: z.string(),
        timestamp: z.number(),
    }),
]);

export type SignalingMessage = z.infer<typeof SignalingMessageSchema>;

export const WebRTCMetadataSchema = z.object({
    messages: z.array(SignalingMessageSchema).optional().default([]),
    lastUpdate: z.number().optional(),
});

export type WebRTCMetadata = z.infer<typeof WebRTCMetadataSchema>;

// Simplified WebRTC message schema - messages are stored as metadata entries
export const WebRTCMessageSchema = z.object({
    type: z.enum(["offer", "answer", "ice-candidate", "session-end"]),
    payload: z.any(), // SDP string, ICE candidate object, etc.
    fromSession: z.string(),
    toSession: z.string(),
    timestamp: z.number(),
    processed: z.boolean().default(false),
});

export type WebRTCMessage = z.infer<typeof WebRTCMessageSchema>;

// Schema for WebRTC session entity that holds messages as metadata
export const WebRTCSessionEntitySchema = z.object({
    sessionPair: z.string(), // Format: "session1-session2" (sorted alphabetically)
    lastActivity: z.number(),
    status: z.enum(["active", "inactive"]),
});

export type WebRTCSessionEntity = z.infer<typeof WebRTCSessionEntitySchema>;

// WebRTC interfaces
export interface PeerInfo {
    pc: RTCPeerConnection;
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    dataChannel: RTCDataChannel | null;
    polite: boolean;
    makingOffer: boolean;
    ignoreOffer: boolean;
    isSettingRemoteAnswerPending: boolean;
}

export interface OfferAnswerPayload {
    sdp: string;
}

export interface IceCandidatePayload {
    candidate: string | null;
    sdpMLineIndex: number | null;
    sdpMid: string | null;
}

export interface SessionEndPayload {
    [key: string]: never;
}

export type MessagePayload =
    | OfferAnswerPayload
    | IceCandidatePayload
    | SessionEndPayload;

export interface ProcessedMessage {
    type: "offer" | "answer" | "ice-candidate" | "session-end";
    payload: MessagePayload;
    fromSession: string;
    toSession: string;
    timestamp: number;
    processed: boolean;
}

export interface WebRTCMessageWithKey extends WebRTCMessage {
    metadataKey: string;
}

export interface MessageEntityInfo {
    entityName: string;
    type: string;
    fromSession: string;
    toSession: string;
    timestamp: number;
    processed: boolean;
}

// Spatial audio interfaces
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

export interface PeerAudioState {
    sessionId: string;
    volume: number;
    isMuted: boolean;
    isReceiving: boolean;
    isSending: boolean;
}

// Schema for peer discovery entities used for heartbeating
export const PeerDiscoveryEntitySchema = z.object({
    sessionId: z.string(), // Unique per-tab session ID
    timestamp: z.number(),
    status: z.enum(["online", "offline"]),
});

export type PeerDiscoveryEntity = z.infer<typeof PeerDiscoveryEntitySchema>;

// Chat schemas
export const ChatMessageSchema = z.object({
    id: z.string(),
    text: z.string(),
    timestamp: z.number(),
    originalMessage: z.string().optional(),
    editedMessage: z.string().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatEntityMetadataSchema = z.object({
    messages: z.array(ChatMessageSchema).default([]),
});

export type ChatEntityMetadata = z.infer<typeof ChatEntityMetadataSchema>;

// Helper functions for WebRTC entity naming
export const createWebRTCSessionEntityName = (
    session1: string,
    session2: string,
) => {
    // Sort sessions alphabetically to ensure consistent naming
    const sortedSessions = [session1, session2].sort();
    return `webrtc-session-${sortedSessions[0]}-${sortedSessions[1]}`;
};

export const createWebRTCMessageKey = (
    type: string,
    timestamp: number,
    fromSession: string,
) => {
    // Create a unique metadata key for each message
    const randomId = Math.random().toString(36).substring(2, 8);
    return `msg-${type}-${timestamp}-${fromSession.substring(0, 8)}-${randomId}`;
};

export const getWebRTCSessionPattern = (mySession: string) => {
    // Pattern to find all WebRTC session entities involving my session
    return `webrtc-session-%${mySession}%`;
};

// Generic safe parser that accepts unknown or JSON strings
export function safeParseWith<T>(
    schema: z.ZodType<T>,
    value: unknown,
): T | null {
    let v: unknown = value;
    if (typeof v === "string") {
        try {
            v = JSON.parse(v);
        } catch {
            // keep as string; schema may coerce
        }
    }
    const parsed = schema.safeParse(v);
    return parsed.success ? parsed.data : null;
}

// Specific convenience parsers for common types
export const parseVector3 = (v: unknown) => safeParseWith(Vector3Schema, v);
export const parseQuaternion = (v: unknown) =>
    safeParseWith(QuaternionSchema, v);
export const parseAvatarBaseData = (v: unknown) =>
    safeParseWith(AvatarBaseDataSchema, v);
export const parseAvatarPosition = (v: unknown) =>
    safeParseWith(AvatarPositionDataSchema, v);
export const parseAvatarRotation = (v: unknown) =>
    safeParseWith(AvatarRotationDataSchema, v);
export const parseAvatarJoint = (v: unknown) =>
    safeParseWith(AvatarJointMetadataSchema, v);
export const parseModelMetadata = (v: unknown) =>
    safeParseWith(ModelMetadataSchema, v);
export const parseCamera = (v: unknown) => safeParseWith(CameraSchema, v);

// Avatar reflect frame schema (hot path WS message)
export const AvatarJointsSchema = z.record(
    z.string(),
    z
        .object({
            position: Vector3Schema,
            rotation: QuaternionSchema,
            // Some senders may omit scale; default to unit scale
            scale: Vector3Schema.optional().default({ x: 1, y: 1, z: 1 }),
        })
        .loose(),
);

export const AvatarFrameMessageSchema = z
    .object({
        type: z.literal("avatar_frame"),
        entityName: z.string(),
        ts: z.number(),
        sessionId: z.string().optional(),
        modelFileName: z.string().optional(),
        position: Vector3Schema.optional(),
        rotation: QuaternionSchema.optional(),
        scale: Vector3Schema.optional(),
        cameraOrientation: CameraSchema.optional(),
        joints: AvatarJointsSchema.optional().default({}),
        chat_messages: z.array(ChatMessageSchema).optional(),
    })
    .loose();

export type AvatarFrameMessage = z.infer<typeof AvatarFrameMessageSchema>;

export const parseAvatarFrameMessage = (v: unknown) =>
    safeParseWith(AvatarFrameMessageSchema, v);
