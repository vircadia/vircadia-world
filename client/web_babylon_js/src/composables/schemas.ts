import { z } from "zod";

export interface BabylonModelDefinition {
    fileName: string;
    entityName?: string;
    position?: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number; w: number };
    throttleInterval?: number;
    syncMode?: "push" | "pull";
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
    x: z.number(),
    y: z.number(),
    z: z.number(),
});

export const QuaternionSchema = z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
    w: z.number(),
});

// Zod schemas for avatar metadata
export const CameraSchema = z.object({
    alpha: z.number(),
    beta: z.number(),
    radius: z.number(),
});

export const AvatarMetadataSchema = z.object({
    type: z.literal("avatar"),
    sessionId: z.string().nullable(),
    position: Vector3Schema,
    rotation: QuaternionSchema,
    cameraOrientation: CameraSchema,
    jointTransforms: z.record(
        z.object({
            position: Vector3Schema,
            rotation: QuaternionSchema,
        }),
    ),
    modelURL: z.string().optional(),
});

export type AvatarMetadata = z.infer<typeof AvatarMetadataSchema>;
