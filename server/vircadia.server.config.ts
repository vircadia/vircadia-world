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
        "admin-ips": { type: "string" },
        "admin-api-key": { type: "string" },
        "dev-mode": { type: "boolean" },
        "postgres-host": { type: "string" },
        "postgres-port": { type: "string" },
        "postgres-db": { type: "string" },
        "postgres-user": { type: "string" },
        "postgres-password": { type: "string" },
        "postgres-container": { type: "string" },
        "postgres-extensions": { type: "string" },
    },
    allowPositionals: true,
});

const envSchema = z.object({
    VRCA_SERVER_DEBUG: z.boolean().default(false),
    VRCA_SERVER_INTERNAL_SERVER_PORT: z.string().default("3020"),
    VRCA_SERVER_INTERNAL_SERVER_HOST: z.string().default("0.0.0.0"),
    VRCA_SERVER_ADMIN_IPS: z
        .string()
        .default("127.0.0.1,::1")
        .transform((ips) => ips.split(",")),
    VRCA_SERVER_ADMIN_API_KEY: z.string().min(32).optional(),
    VRCA_SERVER_DEV_MODE: z.boolean().default(false),
    VRCA_SERVER_POSTGRES_HOST: z.string().default("localhost"),
    VRCA_SERVER_POSTGRES_PORT: z.coerce.number().default(5432),
    VRCA_SERVER_POSTGRES_DB: z.string().default("vircadia_world_db"),
    VRCA_SERVER_POSTGRES_USER: z.string().default("vircadia"),
    VRCA_SERVER_POSTGRES_PASSWORD: z.string().default("CHANGE_ME!"),
    VRCA_SERVER_POSTGRES_CONTAINER: z.string().default("vircadia_world_db"),
    VRCA_SERVER_POSTGRES_EXTENSIONS: z.string().default("uuid-ossp"),
});

const env = envSchema.parse(import.meta.env);

// Merge ENV and CLI args, with CLI args taking precedence
export const VircadiaConfig_Server = {
    debug: args["debug"] ?? env.VRCA_SERVER_DEBUG,
    serverPort: Number.parseInt(
        args["port"] ?? env.VRCA_SERVER_INTERNAL_SERVER_PORT,
    ),
    serverHost: args["host"] ?? env.VRCA_SERVER_INTERNAL_SERVER_HOST,
    adminIps: args["admin-ips"]?.split(",") ?? env.VRCA_SERVER_ADMIN_IPS,
    adminApiKey: args["admin-api-key"] ?? env.VRCA_SERVER_ADMIN_API_KEY,
    devMode: args["dev-mode"] ?? env.VRCA_SERVER_DEV_MODE,
    postgres: {
        host: args["postgres-host"] ?? env.VRCA_SERVER_POSTGRES_HOST,
        port: Number(args["postgres-port"] ?? env.VRCA_SERVER_POSTGRES_PORT),
        database: args["postgres-db"] ?? env.VRCA_SERVER_POSTGRES_DB,
        user: args["postgres-user"] ?? env.VRCA_SERVER_POSTGRES_USER,
        password:
            args["postgres-password"] ?? env.VRCA_SERVER_POSTGRES_PASSWORD,
        containerName:
            args["postgres-container"] ?? env.VRCA_SERVER_POSTGRES_CONTAINER,
        extensions: (
            args["postgres-extensions"] ?? env.VRCA_SERVER_POSTGRES_EXTENSIONS
        )
            .split(",")
            .map((ext) => ext.trim())
            .filter((ext) => ext.length > 0),
    },
};
