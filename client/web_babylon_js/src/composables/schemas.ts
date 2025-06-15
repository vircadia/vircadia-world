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

// Schema with defaults for safer avatar metadata handling
export const AvatarMetadataWithDefaultsSchema = z.object({
    type: z.literal("avatar").default("avatar"),
    sessionId: z.coerce.string().nullable().default(null),
    position: Vector3Schema.default({ x: 0, y: 0, z: -5 }),
    rotation: QuaternionSchema.default({ x: 0, y: 0, z: 0, w: 1 }),
    cameraOrientation: CameraSchema.default({
        alpha: -Math.PI / 2,
        beta: Math.PI / 3,
        radius: 5,
    }),
    jointTransformsLocal: z
        .record(
            z.object({
                position: Vector3Schema,
                rotation: QuaternionSchema,
                scale: Vector3Schema,
            }),
        )
        .default({}),
    modelFileName: z.coerce.string().default("babylon.avatar.glb"),
});

export type AvatarMetadataWithDefaults = z.infer<
    typeof AvatarMetadataWithDefaultsSchema
>;

// Helper function to safely convert Map or object to validated AvatarMetadata
export function parseAvatarMetadata(
    data: Map<string, unknown> | Record<string, unknown> | unknown,
): AvatarMetadataWithDefaults {
    // Convert Map to object if needed
    const obj =
        data instanceof Map
            ? Object.fromEntries(data)
            : typeof data === "object" && data !== null
              ? data
              : {};

    // Parse with defaults
    return AvatarMetadataWithDefaultsSchema.parse(obj);
}

// Helper to validate partial updates
export function validateAvatarMetadataUpdate(
    update: Partial<AvatarMetadata>,
): Partial<AvatarMetadata> {
    // Create a partial schema that validates only provided fields
    const partialSchema = AvatarMetadataSchema.partial();
    return partialSchema.parse(update);
}

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
