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

    // Model definitions
    VRCA_CLIENT_WEB_BABYLON_JS_MODEL_DEFINITIONS: z
        .union([
            z.string().transform((val) => {
                const parsed = JSON.parse(val);
                return z
                    .array(
                        z.object({
                            fileName: z.string(),
                            entityName: z.string().optional(),
                            position: z
                                .object({
                                    x: z.number(),
                                    y: z.number(),
                                    z: z.number(),
                                })
                                .optional(),
                            rotation: z
                                .object({
                                    x: z.number(),
                                    y: z.number(),
                                    z: z.number(),
                                    w: z.number(),
                                })
                                .optional(),
                            throttleInterval: z.number().optional(),
                            ownerSessionId: z.string().nullable().optional(),
                            enablePhysics: z.boolean().optional(),
                            physicsType: z
                                .enum(["box", "convexHull", "mesh"])
                                .optional(),
                            physicsOptions: z
                                .object({
                                    mass: z.number().optional(),
                                    friction: z.number().optional(),
                                    restitution: z.number().optional(),
                                    isKinematic: z.boolean().optional(),
                                })
                                .optional(),
                        }),
                    )
                    .parse(parsed);
            }),
            z.array(
                z.object({
                    fileName: z.string(),
                    entityName: z.string().optional(),
                    position: z
                        .object({
                            x: z.number(),
                            y: z.number(),
                            z: z.number(),
                        })
                        .optional(),
                    rotation: z
                        .object({
                            x: z.number(),
                            y: z.number(),
                            z: z.number(),
                            w: z.number(),
                        })
                        .optional(),
                    throttleInterval: z.number().optional(),
                    ownerSessionId: z.string().nullable().optional(),
                    enablePhysics: z.boolean().optional(),
                    physicsType: z
                        .enum(["box", "convexHull", "mesh"])
                        .optional(),
                    physicsOptions: z
                        .object({
                            mass: z.number().optional(),
                            friction: z.number().optional(),
                            restitution: z.number().optional(),
                            isKinematic: z.boolean().optional(),
                        })
                        .optional(),
                }),
            ),
        ])
        .default([
            {
                fileName: "babylon.level.glb",
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0, w: 1 },
                throttleInterval: 10,
                enablePhysics: true,
                physicsType: "mesh",
                physicsOptions: {
                    mass: 0,
                    friction: 0.5,
                    restitution: 0.3,
                },
            },
        ]),
});

// Parse client environment variables
export const clientBrowserConfiguration = clientBrowserEnvSchema.parse(
    // Fix TypeScript error with appropriate typing
    (typeof import.meta !== "undefined"
        ? (import.meta as { env?: Record<string, unknown> }).env
        : // @ts-ignore
          undefined) ?? process.env,
);
