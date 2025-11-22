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


export type HolographicMaterialVariant = "fill" | "glass";

export interface HolographicMaterialOptions {
    variant?: HolographicMaterialVariant;
    color?: Color3Like;
    accentColor?: Color3Like;
    alpha?: number;
    hoverEffect?: boolean;
    reflectionLevel?: number;
}

export function createHolographicMaterial(
    scene: Scene,
    options: HolographicMaterialOptions = {},
): { material: PBRMaterial } {
    const pbr = new PBRMaterial(`holographic-material-${Date.now()}`, scene);

    const baseColor = resolveColor(options.color, new Color3(0.5, 0.5, 0.5));
    const accentColor = resolveColor(options.accentColor, new Color3(0.2, 0.8, 1.0));
    const alpha = options.alpha ?? 0.5;

    pbr.albedoColor = baseColor;
    pbr.alpha = alpha;
    pbr.metallic = 0.1;
    pbr.roughness = 0.2;
    
    // Enable transparency
    pbr.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;

    if (options.variant === "fill") {
        pbr.emissiveColor = baseColor.scale(0.2);
        pbr.emissiveIntensity = 0.5;
    } else {
        // Glass-like
        pbr.indexOfRefraction = 1.5;
        pbr.alpha = Math.min(alpha, 0.3); // Glass is usually more transparent
    }

    return { material: pbr };
}
