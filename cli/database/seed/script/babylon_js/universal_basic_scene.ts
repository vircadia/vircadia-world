import type { Entity } from "../../../../vircadia-world-sdk-ts/schema/schema.general";
import type { Babylon } from "../../../../vircadia-world-sdk-ts/schema/schema.babylon.script";
import {
    HemisphericLight,
    DirectionalLight,
    Vector3,
    Color3,
    CubeTexture,
} from "@babylonjs/core";
import { log } from "../../../../vircadia-world-sdk-ts/module/general/log";

// Define lighting configuration interface
interface LightingConfig {
    useHemispheric?: boolean;
    useDirectional?: boolean;
    useHDRI?: boolean;
    hdriUrl?: string;
    hemisphericIntensity?: number;
    groundColor?: {
        r?: number;
        g?: number;
        b?: number;
    };
    diffuseColor?: {
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
    directionalDiffuse?: {
        r?: number;
        g?: number;
        b?: number;
    };
    enableShadows?: boolean;
    shadowMinZ?: number;
    shadowMaxZ?: number;
    skyboxSize?: number;
    skyboxRotationY?: number;
    environmentIntensity?: number;
}

interface SceneEntityMetaData {
    lighting_config?: LightingConfig;
    [key: string]: unknown;
}

// Use the new vircadiaScriptMain function name
function vircadiaScriptMain(context: Babylon.I_Context): Babylon.ScriptReturn {
    // Store references to created lights for cleanup
    let hemisphericLight: HemisphericLight | null = null;
    let directionalLight: DirectionalLight | null = null;
    let environmentTexture: CubeTexture | null = null;

    return {
        hooks: {
            onScriptInitialize: async (
                entity: Entity.I_Entity,
                assets: Entity.Asset.I_Asset[],
            ): Promise<void> => {
                if (context.Vircadia.Debug) {
                    console.log(
                        "Scene lighting script initialized for entity:",
                        entity.general__entity_id,
                    );
                }

                try {
                    const scene = context.Babylon.Scene;

                    // Get configuration from metadata
                    const metaData = entity.meta__data as SceneEntityMetaData;
                    const config = metaData?.lighting_config || {};

                    // Default configuration
                    const useHemispheric = config.useHemispheric !== false;
                    const useDirectional = config.useDirectional !== false;
                    const useHDRI = config.useHDRI !== false;
                    const hdriUrl =
                        config.hdriUrl ||
                        "https://assets.babylonjs.com/environments/environmentSpecular.env";

                    // Setup lights
                    if (useHemispheric) {
                        // Create a hemispheric light (good for general ambient lighting)
                        hemisphericLight = new HemisphericLight(
                            "hemisphericLight",
                            new Vector3(0, 1, 0),
                            scene,
                        );
                        hemisphericLight.intensity =
                            config.hemisphericIntensity || 0.7;

                        // Set light colors if provided
                        if (config.groundColor) {
                            const gc = config.groundColor;
                            hemisphericLight.groundColor = new Color3(
                                gc.r || 0.2,
                                gc.g || 0.2,
                                gc.b || 0.2,
                            );
                        }

                        if (config.diffuseColor) {
                            const dc = config.diffuseColor;
                            hemisphericLight.diffuse = new Color3(
                                dc.r || 1.0,
                                dc.g || 1.0,
                                dc.b || 1.0,
                            );
                        }
                    }

                    if (useDirectional) {
                        // Create a directional light (good for shadows)
                        const direction = config.directionalDirection || {
                            x: 0.5,
                            y: -1,
                            z: 1,
                        };
                        directionalLight = new DirectionalLight(
                            "directionalLight",
                            new Vector3(direction.x, direction.y, direction.z),
                            scene,
                        );
                        directionalLight.intensity =
                            config.directionalIntensity || 0.5;

                        if (config.directionalDiffuse) {
                            const dd = config.directionalDiffuse;
                            directionalLight.diffuse = new Color3(
                                dd.r || 1.0,
                                dd.g || 1.0,
                                dd.b || 1.0,
                            );
                        }

                        // Enable shadows if configured
                        if (config.enableShadows) {
                            directionalLight.shadowEnabled = true;
                            directionalLight.shadowMinZ =
                                config.shadowMinZ || 1;
                            directionalLight.shadowMaxZ =
                                config.shadowMaxZ || 100;
                        }
                    }

                    // Setup HDRI environment if enabled
                    if (useHDRI) {
                        try {
                            environmentTexture =
                                CubeTexture.CreateFromPrefilteredData(
                                    hdriUrl,
                                    scene,
                                );
                            scene.environmentTexture = environmentTexture;
                            scene.createDefaultSkybox(
                                environmentTexture,
                                true,
                                config.skyboxSize || 1000,
                                config.skyboxRotationY || 0,
                            );

                            if (config.environmentIntensity) {
                                scene.environmentIntensity =
                                    config.environmentIntensity;
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
                            hemispheric: useHemispheric,
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
                if (hemisphericLight) {
                    hemisphericLight.dispose();
                    hemisphericLight = null;
                }

                if (directionalLight) {
                    directionalLight.dispose();
                    directionalLight = null;
                }

                if (environmentTexture) {
                    environmentTexture.dispose();
                    environmentTexture = null;
                }
            },
        },
    };
}

// Make the function available in the global scope
// @ts-ignore - Adding to global scope for script system
globalThis.vircadiaScriptMain = vircadiaScriptMain;
