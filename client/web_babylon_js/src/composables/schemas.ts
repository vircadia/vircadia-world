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
    jointTransforms: z.record(
        z.object({
            position: Vector3Schema,
            rotation: QuaternionSchema,
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
});

export type ModelMetadata = z.infer<typeof ModelMetadataSchema>;
