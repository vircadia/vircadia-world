import {
    type BaseTexture,
    Color3,
    FresnelParameters,
    type Scene,
    StandardMaterial,
    type Texture,
} from "@babylonjs/core";

export type Color3Like =
    | Color3
    | string
    | { r: number; g: number; b: number }
    | [number, number, number];

export type HolographicMaterialVariant =
    | "default"
    | "track"
    | "thumb"
    | "fill"
    | "plate" // For button backplates
    | "glass"; // For transparent overlays

type HolographicMaterialPreset = {
    alpha: number;
    emissiveStrength: number;
    diffuseStrength: number;
    specularStrength: number;
    specularPower: number;
    environmentIntensity: number;
    fresnelPower: number;
    fresnelBias: number;
};

const HOLOGRAPHIC_VARIANT_PRESETS: Record<
    HolographicMaterialVariant,
    HolographicMaterialPreset
> = {
    default: {
        alpha: 0.85,
        emissiveStrength: 0.35,
        diffuseStrength: 1,
        specularStrength: 1,
        specularPower: 96,
        environmentIntensity: 1,
        fresnelPower: 2.5,
        fresnelBias: 0.12,
    },
    track: {
        alpha: 0.52,
        emissiveStrength: 0.25,
        diffuseStrength: 0.45,
        specularStrength: 0.8,
        specularPower: 84,
        environmentIntensity: 1.2,
        fresnelPower: 3.4,
        fresnelBias: 0.08,
    },
    thumb: {
        alpha: 0.97,
        emissiveStrength: 0.65,
        diffuseStrength: 0.95,
        specularStrength: 1.25,
        specularPower: 196,
        environmentIntensity: 1.35,
        fresnelPower: 4.2,
        fresnelBias: 0.1,
    },
    fill: {
        alpha: 0.9,
        emissiveStrength: 0.78,
        diffuseStrength: 0.8,
        specularStrength: 1.1,
        specularPower: 128,
        environmentIntensity: 1.4,
        fresnelPower: 3.8,
        fresnelBias: 0.12,
    },
    plate: {
        alpha: 0.65,
        emissiveStrength: 0.2,
        diffuseStrength: 0.6,
        specularStrength: 0.9,
        specularPower: 64,
        environmentIntensity: 1.1,
        fresnelPower: 3.0,
        fresnelBias: 0.15,
    },
    glass: {
        alpha: 0.15,
        emissiveStrength: 0.05,
        diffuseStrength: 0.1,
        specularStrength: 1.5,
        specularPower: 256,
        environmentIntensity: 1.8,
        fresnelPower: 5.0,
        fresnelBias: 0.02,
    },
};

export type HolographicMaterialOptions = {
    color?: Color3Like;
    accentColor?: Color3Like;
    alpha?: number;
    fresnelPower?: number;
    fresnelBias?: number;
    environmentIntensity?: number;
    texture?: Texture;
    variant?: HolographicMaterialVariant;
    emissiveStrength?: number;
    diffuseStrength?: number;
    specularStrength?: number;
    specularPower?: number;
    useRefraction?: boolean;
    refractionLevel?: number;
    refractionIndex?: number;
    reflectionLevel?: number;
    linkRefractionWithTransparency?: boolean;
    noiseTexture?: Texture;
    noiseTextureLevel?: number;
    gradientTexture?: Texture;
    gradientTextureLevel?: number;
};

export function resolveColor(
    input?: Color3Like,
    fallback?: Color3,
): Color3 | null {
    if (!input) {
        return fallback ? fallback.clone() : null;
    }
    if (input instanceof Color3) {
        return input.clone();
    }
    if (typeof input === "string") {
        const trimmed = input.trim();
        if (!trimmed) {
            return fallback ? fallback.clone() : null;
        }
        const normalized = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
        try {
            return Color3.FromHexString(normalized);
        } catch {
            return fallback ? fallback.clone() : null;
        }
    }
    if (Array.isArray(input)) {
        const [r, g, b] = input;
        return new Color3(r ?? 0, g ?? 0, b ?? 0);
    }
    const { r, g, b } = input;
    return new Color3(r, g, b);
}

function buildFresnelParameters(
    color: Color3,
    accent: Color3,
    options: Pick<HolographicMaterialOptions, "fresnelPower" | "fresnelBias">,
): FresnelParameters {
    const fresnel = new FresnelParameters();
    fresnel.leftColor = color.clone();
    fresnel.rightColor = accent.clone();
    fresnel.power = options.fresnelPower ?? 2.0;
    fresnel.bias = options.fresnelBias ?? 0.1;
    return fresnel;
}

const DEFAULT_PRIMARY_COLOR = new Color3(0.1, 0.7, 1.0);
const DEFAULT_SECONDARY_COLOR = new Color3(0.8, 0.8, 0.8);
const DEFAULT_ACCENT_COLOR = new Color3(0.2, 1.0, 0.9);

export type HolographicMaterialResult = {
    material: StandardMaterial;
};

export function createHolographicMaterial(
    scene: Scene,
    options: HolographicMaterialOptions = {},
): HolographicMaterialResult {
    const variant = options.variant ?? "default";
    const preset = HOLOGRAPHIC_VARIANT_PRESETS[variant];
    const baseColor =
        resolveColor(options.color, DEFAULT_PRIMARY_COLOR) ??
        DEFAULT_PRIMARY_COLOR.clone();
    const accentColor =
        resolveColor(options.accentColor, DEFAULT_ACCENT_COLOR) ??
        DEFAULT_ACCENT_COLOR.clone();
    const alpha = options.alpha ?? preset.alpha;
    const emissiveStrength =
        options.emissiveStrength ?? preset.emissiveStrength;
    const diffuseStrength = options.diffuseStrength ?? preset.diffuseStrength;
    const specularStrength =
        options.specularStrength ?? preset.specularStrength;
    const specularPower = options.specularPower ?? preset.specularPower;
    const environmentIntensity =
        options.environmentIntensity ?? preset.environmentIntensity;
    const fresnelPower = options.fresnelPower ?? preset.fresnelPower;
    const fresnelBias = options.fresnelBias ?? preset.fresnelBias;

    const holographicMaterial = new StandardMaterial(
        `holographic-material-${variant}-${Date.now()}`,
        scene,
    );
    const diffuseColor = baseColor.clone();
    diffuseColor.scaleInPlace(diffuseStrength);
    holographicMaterial.diffuseColor = diffuseColor;
    const specularColor = DEFAULT_SECONDARY_COLOR.clone();
    specularColor.scaleInPlace(specularStrength);
    holographicMaterial.specularColor = specularColor;
    const emissiveColor = accentColor.clone();
    emissiveColor.scaleInPlace(emissiveStrength);
    holographicMaterial.emissiveColor = emissiveColor;
    holographicMaterial.alpha = alpha;
    holographicMaterial.specularPower = specularPower;
    holographicMaterial.backFaceCulling = false;
    holographicMaterial.twoSidedLighting = true;

    if (options.texture) {
        holographicMaterial.diffuseTexture = options.texture;
        holographicMaterial.opacityTexture = options.texture;
    }

    const environmentTexture = scene.environmentTexture;
    const reflectionLevel = options.reflectionLevel ?? environmentIntensity;
    let clonedReflection: BaseTexture | null = null;
    if (environmentTexture) {
        clonedReflection = environmentTexture.clone();
    }
    holographicMaterial.reflectionTexture = clonedReflection;
    if (clonedReflection) {
        clonedReflection.level = reflectionLevel;
    }

    const useRefraction = options.useRefraction ?? true;
    if (useRefraction && environmentTexture) {
        const clonedRefraction = environmentTexture.clone();
        if (clonedRefraction) {
            clonedRefraction.level =
                options.refractionLevel ?? environmentIntensity * 0.75;
            holographicMaterial.refractionTexture = clonedRefraction;
            holographicMaterial.indexOfRefraction =
                options.refractionIndex ?? 1.46;
            holographicMaterial.linkRefractionWithTransparency =
                options.linkRefractionWithTransparency ?? true;
        }
    }

    if (options.noiseTexture) {
        const bumpTexture = options.noiseTexture;
        holographicMaterial.bumpTexture = bumpTexture;
        bumpTexture.level = options.noiseTextureLevel ?? 0.35;
    }

    if (options.gradientTexture) {
        const emissiveTexture = options.gradientTexture;
        holographicMaterial.emissiveTexture = emissiveTexture;
        emissiveTexture.level = options.gradientTextureLevel ?? 0.9;
        emissiveTexture.hasAlpha = true;
    }
    const fresnelOptions: Pick<
        HolographicMaterialOptions,
        "fresnelPower" | "fresnelBias"
    > = {
        fresnelPower,
        fresnelBias,
    };
    holographicMaterial.reflectionFresnelParameters = buildFresnelParameters(
        baseColor,
        accentColor,
        fresnelOptions,
    );
    holographicMaterial.emissiveFresnelParameters = buildFresnelParameters(
        accentColor,
        baseColor,
        fresnelOptions,
    );

    return {
        material: holographicMaterial,
    };
}
