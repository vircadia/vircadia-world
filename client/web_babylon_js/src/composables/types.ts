export interface BabylonModelDefinition {
    fileName: string;
    entityName?: string;
    position?: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number; w: number };
    throttleInterval?: number;
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
    /** Whether the animation should loop */
    loop?: boolean;
    /** Optional list of animation group names to load from the GLB */
    groupNames?: string[];
}
