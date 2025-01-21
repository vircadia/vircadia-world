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
        "auth-jwt-session-duration": { type: "string" },
        "auth-jwt-bcrypt-rounds": { type: "string" },
        "auth-jwt-secret": { type: "string" },
        "auth-providers": { type: "string" },
        "pgweb-port": { type: "string" },
    },
    allowPositionals: true,
});

const envSchema = z.object({
    VRCA_SERVER_DEBUG: z
        .union([
            z.boolean(),
            z
                .string()
                .transform(
                    (val) => val === "1" || val.toLowerCase() === "true",
                ),
        ])
        .default(false),
    VRCA_SERVER_INTERNAL_SERVER_PORT: z.string().default("3020"),
    VRCA_SERVER_INTERNAL_SERVER_HOST: z.string().default("0.0.0.0"),
    VRCA_SERVER_DEV_MODE: z.boolean().default(false),
    VRCA_SERVER_CONTAINER_NAME: z.string().default("vircadia_world"),
    VRCA_SERVER_POSTGRES_HOST: z.string().default("localhost"),
    VRCA_SERVER_POSTGRES_PORT: z.coerce.number().default(5432),
    VRCA_SERVER_POSTGRES_DB: z.string().default("vircadia_world_db"),
    VRCA_SERVER_POSTGRES_USER: z.string().default("vircadia"),
    VRCA_SERVER_POSTGRES_PASSWORD: z.string().default("CHANGE_ME!"),
    VRCA_SERVER_POSTGRES_EXTENSIONS: z.string().default("uuid-ossp,hstore"),
    VRCA_SERVER_PGWEB_PORT: z.string().default("5437"),
    VRCA_SERVER_AUTH_JWT_SESSION_DURATION: z.string().default("24h"),
    VRCA_SERVER_AUTH_JWT_BCRYPT_ROUNDS: z.coerce.number().default(10),
    VRCA_SERVER_AUTH_JWT_SECRET: z.string().default("CHANGE_ME!"),
    VRCA_SERVER_AUTH_PROVIDERS: z.string().default(
        JSON.stringify({
            github: {
                enabled: true,
                displayName: "GitHub",
                authorizeUrl: "https://github.com/login/oauth/authorize",
                tokenUrl: "https://github.com/login/oauth/access_token",
                userInfoUrl: "https://api.github.com/user",
                clientId: "Ov23liL9aOwOiwCMqVwQ",
                clientSecret: "efed36f81b8fd815ed31f20fecaa265bc0aa5136",
                callbackUrl:
                    "http://localhost:3000/services/world-auth/auth/github/callback",
                scope: ["user:email"],
                userDataMapping: {
                    endpoint: "https://api.github.com/user",
                    additionalEndpoints: {
                        emails: "https://api.github.com/user/emails",
                    },
                    fields: {
                        providerId: '"id":\\s*(\\d+)',
                        email: '"email":\\s*"([^"]+)"',
                        username: '"login":\\s*"([^"]+)"',
                    },
                },
            },
            google: {
                enabled: false,
                displayName: "Google",
                authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
                tokenUrl: "https://oauth2.googleapis.com/token",
                userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
                scope: ["email", "profile"],
                userDataMapping: {
                    endpoint: "https://www.googleapis.com/oauth2/v2/userinfo",
                    fields: {
                        providerId: '"id":\\s*"([^"]+)"',
                        email: '"email":\\s*"([^"]+)"',
                        username: '"name":\\s*"([^"]+)"',
                    },
                },
            },
        }),
    ),
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
    },
    pgweb: {
        port: Number(args["pgweb-port"] ?? env.VRCA_SERVER_PGWEB_PORT),
    },
    auth: {
        providers: JSON.parse(env.VRCA_SERVER_AUTH_PROVIDERS),
        jwt: {
            secret: args["auth-jwt-secret"] ?? env.VRCA_SERVER_AUTH_JWT_SECRET,
            sessionDuration:
                args["auth-jwt-session-duration"] ??
                env.VRCA_SERVER_AUTH_JWT_SESSION_DURATION,
            bcryptRounds: Number(
                args["auth-jwt-bcrypt-rounds"] ??
                    env.VRCA_SERVER_AUTH_JWT_BCRYPT_ROUNDS,
            ),
        },
    },
};
