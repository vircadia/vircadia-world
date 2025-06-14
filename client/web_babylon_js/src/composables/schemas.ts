import { z } from "zod";

export interface BabylonModelDefinition {
    fileName: string;
    entityName?: string;
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

// Zod schemas for avatar metadata
export const CameraSchema = z.object({
    alpha: z.coerce.number(),
    beta: z.coerce.number(),
    radius: z.coerce.number(),
});

export const AvatarMetadataSchema = z.object({
    type: z.literal("avatar"),
    sessionId: z.coerce.string().nullable(),
    position: Vector3Schema,
    rotation: QuaternionSchema,
    cameraOrientation: CameraSchema,
    jointTransformsLocal: z.record(
        z.object({
            position: Vector3Schema,
            rotation: QuaternionSchema,
            scale: Vector3Schema,
        }),
    ),
    modelFileName: z.coerce.string(),
});

export type AvatarMetadata = z.infer<typeof AvatarMetadataSchema>;

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

export const WebRTCEntitySchema = z.object({
    general__entity_name: z.string().optional(),
    meta__data: WebRTCMetadataSchema.optional(),
});

export type WebRTCEntity = z.infer<typeof WebRTCEntitySchema>;

// New schema for individual WebRTC message entities
export const WebRTCMessageEntitySchema = z.object({
    general__entity_name: z.string(),
    meta__data: z.object({
        type: z.enum(["offer", "answer", "ice-candidate", "session-end"]),
        payload: z.any(), // SDP string, ICE candidate object, etc.
        fromSession: z.string(),
        toSession: z.string(),
        timestamp: z.number(),
        processed: z.boolean().default(false),
    }),
});

export type WebRTCMessageEntity = z.infer<typeof WebRTCMessageEntitySchema>;

// Spatial audio interface
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

// Helper functions for message entity naming
export const createMessageEntityName = (
    fromSession: string,
    toSession: string,
    type: string,
    timestamp: number,
) => {
    // Add a random component to ensure uniqueness
    const randomId = Math.random().toString(36).substring(2, 8);
    return `webrtc-msg-${fromSession}-${toSession}-${type}-${timestamp}-${randomId}`;
};

export const getIncomingMessagePattern = (mySession: string) => {
    return `webrtc-msg-%-${mySession}-%`;
};
