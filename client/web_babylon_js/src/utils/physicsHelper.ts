import type { Scene, Vector3 } from "@babylonjs/core";
import { HavokPlugin } from "@babylonjs/core";

// Use a more specific type for the Havok instance
let havokInstance: unknown = null;
let physicsPlugin: HavokPlugin | null = null;

/**
 * Lazily initializes the Havok physics engine
 * This ensures Havok is only loaded when actually needed
 */
export const initializePhysics = async (
    scene: Scene,
    gravityVector: Vector3,
): Promise<boolean> => {
    try {
        if (!havokInstance) {
            // Dynamically import Havok only when needed
            const HavokPhysics = (await import("@babylonjs/havok")).default;
            havokInstance = await HavokPhysics();
        }

        // Create the Havok plugin
        physicsPlugin = new HavokPlugin(true, havokInstance);

        // Enable physics in the scene
        const enabled = scene.enablePhysics(gravityVector, physicsPlugin);

        console.log("Physics engine initialized:", enabled);
        return enabled;
    } catch (error) {
        console.error("Error initializing physics engine:", error);
        return false;
    }
};
