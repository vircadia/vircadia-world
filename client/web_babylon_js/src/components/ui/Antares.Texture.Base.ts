import {
    Color3,
    PBRMaterial,
    type Scene,
} from "@babylonjs/core";

export type Color3Like =
    | Color3
    | string
    | { r: number; g: number; b: number }
    | [number, number, number];

export type BaseMaterialOptions = {
    color?: Color3Like; // The color of the material
};

// Helper to resolve colors
export function resolveColor(input?: Color3Like, fallback?: Color3): Color3 {
    if (!input) return fallback ? fallback.clone() : new Color3(0.5, 0.5, 0.5);
    if (input instanceof Color3) return input.clone();
    if (typeof input === "string")
        return Color3.FromHexString(
            input.startsWith("#") ? input : `#${input}`,
        );
    if (Array.isArray(input)) return new Color3(input[0], input[1], input[2]);
    const { r, g, b } = input;
    return new Color3(r, g, b);
}

export function createBaseMaterial(
    scene: Scene,
    options: BaseMaterialOptions = {},
): PBRMaterial {
    const pbr = new PBRMaterial(`base-material-${Date.now()}`, scene);

    // Default to grey if no color specified
    const baseColor = resolveColor(options.color, new Color3(0.5, 0.5, 0.5));

    // Simple plain color material
    pbr.albedoColor = baseColor;
    pbr.alpha = 0.7; // Mildly transparent
    pbr.metallic = 0;
    pbr.roughness = 0.5;

    return pbr;
}

