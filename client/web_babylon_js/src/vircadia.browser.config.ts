import { z } from "zod";

// Browser Client environment schema
const clientBrowserEnvSchema = z.object({
    // Web Babylon JS Client
    VRCA_CLIENT_WEB_BABYLON_JS_DEBUG: z
        .union([
            z.boolean(),
            z
                .string()
                .transform(
                    (val) => val === "1" || val.toLowerCase() === "true",
                ),
        ])
        .default(false),
    VRCA_CLIENT_WEB_BABYLON_JS_SUPPRESS: z
        .union([
            z.boolean(),
            z
                .string()
                .transform(
                    (val) => val === "1" || val.toLowerCase() === "true",
                ),
        ])
        .default(false),
    VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN: z.string().default(""),
    VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER: z
        .string()
        .default("system"),

    VRCA_CLIENT_WEB_BABYLON_JS_META_TITLE_BASE: z.string().default("Vircadia"),
    VRCA_CLIENT_WEB_BABYLON_JS_META_DESCRIPTION: z.string().default("..."),
    VRCA_CLIENT_WEB_BABYLON_JS_META_OG_IMAGE: z
        .string()
        .default("/brand/logo_icon.webp"),
    VRCA_CLIENT_WEB_BABYLON_JS_META_OG_TYPE: z.string().default("website"),
    VRCA_CLIENT_WEB_BABYLON_JS_META_FAVICON: z
        .string()
        .default("/brand/favicon.svg"),

    VRCA_CLIENT_WEB_BABYLON_JS_APP_URL: z
        .string()
        .url()
        .default("https://app.vircadia.com"),

    VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI: z
        .string()
        .default("localhost:3020"),
    VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI_USING_SSL: z
        .union([
            z.boolean(),
            z
                .string()
                .transform(
                    (val) => val === "1" || val.toLowerCase() === "true",
                ),
        ])
        .default(false),

    VRCA_CLIENT_WEB_BABYLON_JS_PROD_HOST: z.string().default("0.0.0.0"),
    VRCA_CLIENT_WEB_BABYLON_JS_PROD_PORT: z.coerce.number().default(3025),

    // Development Web Babylon JS Client
    VRCA_CLIENT_WEB_BABYLON_JS_DEV_HOST: z.string().default("0.0.0.0"),
    VRCA_CLIENT_WEB_BABYLON_JS_DEV_PORT: z.coerce.number().default(3066),
});

// Parse client environment variables
export const clientBrowserConfiguration = clientBrowserEnvSchema.parse(
    // Fix TypeScript error with appropriate typing
    (typeof import.meta !== "undefined"
        ? (import.meta as { env?: Record<string, unknown> }).env
        : undefined) ?? process.env,
);
