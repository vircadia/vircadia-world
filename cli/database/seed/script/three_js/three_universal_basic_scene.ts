import type { Entity } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import type { VircadiaThreeScript } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/vircadia.three.core";
import {
    AmbientLight,
    DirectionalLight,
    Color,
    CubeTextureLoader,
    type Texture,
} from "three";
import { log } from "../../../../../sdk/vircadia-world-sdk-ts/module/general/log";

// Define lighting configuration interface
interface LightingConfig {
    useAmbient?: boolean;
    useDirectional?: boolean;
    useHDRI?: boolean;
    hdriUrls?: string[];
    ambientIntensity?: number;
    ambientColor?: {
        r?: number;
        g?: number;
        b?: number;
    };
    directionalDirection?: {
        x: number;
        y: number;
        z: number;
    };
    directionalIntensity?: number;
    directionalColor?: {
        r?: number;
        g?: number;
        b?: number;
    };
    enableShadows?: boolean;
    shadowNear?: number;
    shadowFar?: number;
    environmentIntensity?: number;
}

interface SceneEntityMetaData {
    lighting_config?: LightingConfig;
    [key: string]: unknown;
}

function vircadiaScriptMain(
    context: VircadiaThreeScript.I_Context,
): VircadiaThreeScript.ScriptReturn {
    // Store references to created lights for cleanup
    let ambientLight: AmbientLight | null = null;
    let directionalLight: DirectionalLight | null = null;
    let environmentMap: Texture | null = null;

    return {
        hooks: {
            onScriptInitialize: async (
                entity: Entity.I_Entity,
            ): Promise<void> => {
                if (context.Vircadia.Debug) {
                    console.log(
                        "Scene lighting script initialized for entity:",
                        entity.general__entity_id,
                    );
                }

                try {
                    const scene = context.Three.Scene;
                    // We assume the renderer is accessible through some context
                    // This would need to be adjusted based on how renderer is actually accessed

                    // Get configuration from metadata
                    const metaData = entity.meta__data as SceneEntityMetaData;
                    const config = metaData?.lighting_config || {};

                    // Default configuration
                    const useAmbient = config.useAmbient !== false;
                    const useDirectional = config.useDirectional !== false;
                    const useHDRI = config.useHDRI !== false;
                    const hdriUrls = config.hdriUrls || [
                        "px.jpg",
                        "nx.jpg",
                        "py.jpg",
                        "ny.jpg",
                        "pz.jpg",
                        "nz.jpg",
                    ];

                    // Setup lights
                    if (useAmbient) {
                        // Create an ambient light (good for general ambient lighting)
                        const color = config.ambientColor || {};
                        const ambientColor = new Color(
                            color.r !== undefined ? color.r : 1.0,
                            color.g !== undefined ? color.g : 1.0,
                            color.b !== undefined ? color.b : 1.0,
                        );

                        ambientLight = new AmbientLight(
                            ambientColor,
                            config.ambientIntensity || 0.7,
                        );
                        scene.add(ambientLight);
                    }

                    if (useDirectional) {
                        // Create a directional light (good for shadows)
                        const direction = config.directionalDirection || {
                            x: 0.5,
                            y: -1,
                            z: 1,
                        };

                        const color = config.directionalColor || {};
                        const directionalColor = new Color(
                            color.r !== undefined ? color.r : 1.0,
                            color.g !== undefined ? color.g : 1.0,
                            color.b !== undefined ? color.b : 1.0,
                        );

                        directionalLight = new DirectionalLight(
                            directionalColor,
                            config.directionalIntensity || 0.5,
                        );

                        directionalLight.position.set(
                            direction.x,
                            direction.y,
                            direction.z,
                        );
                        scene.add(directionalLight);

                        // Enable shadows if configured
                        if (config.enableShadows) {
                            directionalLight.castShadow = true;

                            if (directionalLight.shadow) {
                                directionalLight.shadow.camera.near =
                                    config.shadowNear || 0.5;
                                directionalLight.shadow.camera.far =
                                    config.shadowFar || 500;
                            }
                        }
                    }

                    // Setup HDRI environment if enabled
                    if (useHDRI) {
                        try {
                            const cubeTextureLoader = new CubeTextureLoader();
                            const texture = cubeTextureLoader.load(hdriUrls);

                            scene.background = texture;

                            // Create environment map for reflections
                            // For now, we'll simplify HDRI setup since renderer access is unclear
                            scene.environment = texture;
                            environmentMap = texture;

                            if (config.environmentIntensity) {
                                // In Three.js we would need to adjust material properties
                                // or use a custom shader to control environment intensity
                            }
                        } catch (error) {
                            log({
                                message: "Error setting up HDRI environment:",
                                data: {
                                    entityId: entity.general__entity_id,
                                    error,
                                },
                                type: "error",
                                debug: context.Vircadia.Debug,
                                suppress: context.Vircadia.Suppress,
                            });
                        }
                    }

                    log({
                        message: "Scene lighting set up successfully",
                        data: {
                            entityId: entity.general__entity_id,
                            ambient: useAmbient,
                            directional: useDirectional,
                            hdri: useHDRI,
                        },
                        debug: context.Vircadia.Debug,
                        suppress: context.Vircadia.Suppress,
                    });
                } catch (error) {
                    log({
                        message: "Error setting up scene lighting:",
                        data: {
                            entityId: entity.general__entity_id,
                            error,
                        },
                        type: "error",
                        debug: context.Vircadia.Debug,
                        suppress: context.Vircadia.Suppress,
                    });
                }
            },

            onEntityUpdate: (updatedEntity: Entity.I_Entity): void => {
                // Handle updates to lighting configuration if needed
                if (context.Vircadia.Debug) {
                    console.log(
                        "Lighting entity updated:",
                        updatedEntity.general__entity_id,
                    );
                }
                // Could implement dynamic light updates based on entity properties
            },

            onScriptTeardown: (): void => {
                if (context.Vircadia.Debug) {
                    console.log("Scene lighting script being torn down");
                }

                // Clean up resources
                const scene = context.Three.Scene;

                if (ambientLight) {
                    scene.remove(ambientLight);
                    ambientLight.dispose();
                    ambientLight = null;
                }

                if (directionalLight) {
                    scene.remove(directionalLight);
                    directionalLight.dispose();
                    directionalLight = null;
                }

                if (environmentMap) {
                    environmentMap.dispose();
                    environmentMap = null;
                }
            },
        },
    };
}

// Make the function available in the global scope
// @ts-ignore - Adding to global scope for script system
globalThis.vircadiaScriptMain = vircadiaScriptMain;
