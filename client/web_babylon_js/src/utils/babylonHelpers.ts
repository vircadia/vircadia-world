import type { Scene } from "@babylonjs/core";

/**
 * Dynamically loads and shows the Babylon.js inspector
 * This ensures the inspector is only loaded in development mode
 */
export const loadInspector = async (scene: Scene): Promise<void> => {
    if (import.meta.env.DEV) {
        // Only import the inspector in development mode
        await import("@babylonjs/inspector");
        scene.debugLayer.show({
            embedMode: true,
        });
        return;
    }
    console.warn("Inspector is only available in development mode");
};

/**
 * Hides the Babylon.js inspector
 */
export const hideInspector = (scene: Scene): void => {
    scene.debugLayer.hide();
};
