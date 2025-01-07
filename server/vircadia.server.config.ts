import { z } from "zod";
import { parseArgs } from "node:util";

// Add CLI argument parsing
const { positionals, values: args } = parseArgs({
    args: process.argv.slice(2),
    options: {
        debug: { type: "boolean" },
        port: { type: "string" },
        host: { type: "string" },
        "force-restart": { type: "boolean" },
        "dev-mode": { type: "boolean" },
        "container-name": { type: "string" },
        "postgres-host": { type: "string" },
        "postgres-port": { type: "string" },
        "postgres-db": { type: "string" },
        "postgres-user": { type: "string" },
        "postgres-password": { type: "string" },
        "postgres-extensions": { type: "string" },
        "postgres-jwt-secret": { type: "string" },
        "oauth-github-client-id": { type: "string" },
        "oauth-github-client-secret": { type: "string" },
        "oauth-github-callback-url": { type: "string" },
        "caddy-staging-ca": { type: "boolean" },
    },
    allowPositionals: true,
});

const envSchema = z.object({
    VRCA_SERVER_DEBUG: z.boolean().default(false),
    VRCA_SERVER_INTERNAL_SERVER_PORT: z.string().default("3020"),
    VRCA_SERVER_INTERNAL_SERVER_HOST: z.string().default("0.0.0.0"),
    VRCA_SERVER_DEV_MODE: z.boolean().default(false),
    VRCA_SERVER_CONTAINER_NAME: z.string().default("vircadia_world"),
    VRCA_SERVER_POSTGRES_HOST: z.string().default("localhost"),
    VRCA_SERVER_POSTGRES_PORT: z.coerce.number().default(5432),
    VRCA_SERVER_POSTGRES_DB: z.string().default("vircadia_world_db"),
    VRCA_SERVER_POSTGRES_USER: z.string().default("vircadia"),
    VRCA_SERVER_POSTGRES_PASSWORD: z.string().default("CHANGE_ME!"),
    VRCA_SERVER_POSTGRES_EXTENSIONS: z.string().default("uuid-ossp"),
    VRCA_SERVER_POSTGRES_JWT_SECRET: z.string().default("CHANGE_ME!"),
    VRCA_SERVER_OAUTH_GITHUB_CLIENT_ID: z
        .string()
        .default("Ov23liL9aOwOiwCMqVwQ"),
    VRCA_SERVER_OAUTH_GITHUB_CLIENT_SECRET: z
        .string()
        .default("efed36f81b8fd815ed31f20fecaa265bc0aa5136"),
    VRCA_SERVER_OAUTH_GITHUB_CALLBACK_URL: z
        .string()
        .default(
            "http://localhost:3000/services/world-auth/auth/github/callback",
        ),
    VRCA_SERVER_CADDY_STAGING_CA: z.boolean().default(false),
});

const env = envSchema.parse(import.meta.env);

// Merge ENV and CLI args, with CLI args taking precedence
export const VircadiaConfig_Server = {
    debug: args.debug ?? env.VRCA_SERVER_DEBUG,
    serverPort: Number.parseInt(
        args.port ?? env.VRCA_SERVER_INTERNAL_SERVER_PORT,
    ),
    serverHost: args.host ?? env.VRCA_SERVER_INTERNAL_SERVER_HOST,
    devMode: args["dev-mode"] ?? env.VRCA_SERVER_DEV_MODE,
    containerName: args["container-name"] ?? env.VRCA_SERVER_CONTAINER_NAME,
    postgres: {
        host: args["postgres-host"] ?? env.VRCA_SERVER_POSTGRES_HOST,
        port: Number(args["postgres-port"] ?? env.VRCA_SERVER_POSTGRES_PORT),
        database: args["postgres-db"] ?? env.VRCA_SERVER_POSTGRES_DB,
        user: args["postgres-user"] ?? env.VRCA_SERVER_POSTGRES_USER,
        password:
            args["postgres-password"] ?? env.VRCA_SERVER_POSTGRES_PASSWORD,
        extensions: (
            args["postgres-extensions"] ?? env.VRCA_SERVER_POSTGRES_EXTENSIONS
        )
            .split(",")
            .map((ext) => ext.trim())
            .filter((ext) => ext.length > 0),
        jwtSecret:
            args["postgres-jwt-secret"] ?? env.VRCA_SERVER_POSTGRES_JWT_SECRET,
    },
    oauth: {
        github: {
            clientId:
                args["oauth-github-client-id"] ??
                env.VRCA_SERVER_OAUTH_GITHUB_CLIENT_ID,
            clientSecret:
                args["oauth-github-client-secret"] ??
                env.VRCA_SERVER_OAUTH_GITHUB_CLIENT_SECRET,
            callbackUrl:
                args["oauth-github-callback-url"] ??
                env.VRCA_SERVER_OAUTH_GITHUB_CALLBACK_URL,
        },
    },
    caddy: {
        stagingCa: args["caddy-staging-ca"] ?? env.VRCA_SERVER_CADDY_STAGING_CA,
    },
};
