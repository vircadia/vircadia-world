import { z } from "zod";
import { serverConfiguration } from "../../../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";

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

    VRCA_CLIENT_WEB_BABYLON_JS_AUTO_CONNECT: z
        .union([
            z.boolean(),
            z
                .string()
                .transform(
                    (val) => val === "1" || val.toLowerCase() === "true",
                ),
        ])
        .default(true),

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

    VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI: z
        .string()
        .default(serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_HOST_PUBLIC_AVAILABLE_AT + ":" + serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_PORT_PUBLIC_AVAILABLE_AT),
    VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI_USING_SSL: z
        .union([
            z.boolean(),
            z
                .string()
                .transform(
                    (val) => val === "1" || val.toLowerCase() === "true",
                ),
        ])
        .default(serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_SSL_ENABLED_PUBLIC_AVAILABLE_AT),

    VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI: z
        .string()
        .default(serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_HOST_PUBLIC_AVAILABLE_AT + ":" + serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_PORT_PUBLIC_AVAILABLE_AT),
    VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI_USING_SSL: z
        .union([
            z.boolean(),
            z
                .string()
                .transform(
                    (val) => val === "1" || val.toLowerCase() === "true",
                ),
        ])
        .default(serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_SSL_ENABLED_PUBLIC_AVAILABLE_AT),

    VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI: z
        .string()
        .default(serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_HOST_PUBLIC_AVAILABLE_AT + ":" + serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_PORT_PUBLIC_AVAILABLE_AT),
    VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI_USING_SSL: z
        .union([
            z.boolean(),
            z
                .string()
                .transform(
                    (val) => val === "1" || val.toLowerCase() === "true",
                ),
        ])
        .default(serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_SSL_ENABLED_PUBLIC_AVAILABLE_AT),

    VRCA_CLIENT_WEB_BABYLON_JS_PROD_HOST: z.string().default("0.0.0.0"),
    VRCA_CLIENT_WEB_BABYLON_JS_PROD_PORT: z.coerce.number().default(3025),

    // Development Web Babylon JS Client
    VRCA_CLIENT_WEB_BABYLON_JS_DEV_HOST: z.string().default("0.0.0.0"),
    VRCA_CLIENT_WEB_BABYLON_JS_DEV_PORT: z.coerce.number().default(3066),

    VRCA_CLIENT_WEB_BABYLON_JS_BUILD_OUTPUT_DIR: z.string().default("dist"),
});

// Parse client environment variables with runtime (localStorage) overrides
const baseEnv =
    (typeof import.meta !== "undefined"
        ? ((import.meta as { env?: Record<string, unknown> }).env ?? {})
        : // @ts-ignore
          process.env) ?? {};

// Allow overriding or disabling the debug auth token at runtime via localStorage
// Keys:
// - "VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN": string (empty string disables)
// - "VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER": string
// - "VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_DISABLED": "1" | "true" to force disable
const mergedEnv: Record<string, unknown> = { ...baseEnv };

try {
    if (typeof window !== "undefined" && window.localStorage) {
        const disabledFlag = window.localStorage.getItem(
            "VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_DISABLED",
        );
        const lsToken = window.localStorage.getItem(
            "VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN",
        );
        const lsProvider = window.localStorage.getItem(
            "VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER",
        );

        // If explicitly disabled, ensure token is empty
        const isDisabled =
            disabledFlag === "1" || disabledFlag?.toLowerCase() === "true";
        if (isDisabled) {
            mergedEnv.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN = "";
        }

        // If an override token is present in LS (including empty string), use it
        if (lsToken !== null) {
            mergedEnv.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN = lsToken;
        }
        if (lsProvider !== null) {
            mergedEnv.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER =
                lsProvider;
        }
    }
} catch {
    // Ignore storage access errors (e.g., privacy modes)
}

export const clientBrowserConfiguration =
    clientBrowserEnvSchema.parse(mergedEnv);
