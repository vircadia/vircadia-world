import { z } from "zod";
import { VircadiaConfig_SERVER_CONSTS } from "../sdk/vircadia-world-sdk-ts/src/server/config/vircadia.server.consts";

// Server environment schema
const serverEnvSchema = z.object({
    VRCA_SERVER_CONTAINER_NAME: z.string().default("vircadia_world_server"),
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
    VRCA_SERVER_SUPPRESS: z
        .union([
            z.boolean(),
            z
                .string()
                .transform(
                    (val) => val === "1" || val.toLowerCase() === "true",
                ),
        ])
        .default(false),

    // API manager
    VRCA_SERVER_SERVICE_WORLD_API_MANAGER_CONTAINER_NAME: z
        .string()
        .default("vircadia_world_api_manager"),
    VRCA_SERVER_SERVICE_WORLD_API_MANAGER_HOST_CONTAINER_BIND_INTERNAL: z
        .string()
        .default("0.0.0.0"),
    VRCA_SERVER_SERVICE_WORLD_API_MANAGER_PORT_CONTAINER_BIND_INTERNAL: z.coerce
        .number()
        .default(3020),
    VRCA_SERVER_SERVICE_WORLD_API_MANAGER_HOST_CONTAINER_BIND_EXTERNAL: z
        .string()
        .default("0.0.0.0"),
    VRCA_SERVER_SERVICE_WORLD_API_MANAGER_PORT_CONTAINER_BIND_EXTERNAL: z.coerce
        .number()
        .default(3020),
    VRCA_SERVER_SERVICE_WORLD_API_MANAGER_HOST_PUBLIC_AVAILABLE_AT: z
        .string()
        .default("127.0.0.1"),
    VRCA_SERVER_SERVICE_WORLD_API_MANAGER_PORT_PUBLIC_AVAILABLE_AT: z.coerce
        .number()
        .default(3020),

    // Tick manager
    VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_CONTAINER_NAME: z
        .string()
        .default("vircadia_world_tick_manager"),
    VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_HOST_CONTAINER_BIND_INTERNAL: z
        .string()
        .default("0.0.0.0"),
    VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_PORT_CONTAINER_BIND_INTERNAL:
        z.coerce.number().default(3021),
    VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_HOST_CONTAINER_BIND_EXTERNAL: z
        .string()
        .default("0.0.0.0"),
    VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_PORT_CONTAINER_BIND_EXTERNAL:
        z.coerce.number().default(3021),

    // Postgres
    VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME: z
        .string()
        .default("vircadia_world_postgres"),
    VRCA_SERVER_SERVICE_POSTGRES_HOST_CONTAINER_BIND_EXTERNAL: z
        .string()
        .default("127.0.0.1"),
    VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL: z.coerce
        .number()
        .default(5432),
    VRCA_SERVER_SERVICE_POSTGRES_DATABASE: z
        .string()
        .default("vircadia_world_db"),
    VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME: z
        .string()
        .default(VircadiaConfig_SERVER_CONSTS.DB_SUPER_USER_USERNAME),
    VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD: z
        .string()
        .default("CHANGE_ME!"),
    VRCA_SERVER_SERVICE_POSTGRES_SQL_ENV_PREFIX: z
        .string()
        .default("VRCA_SERVER"),
    VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME: z
        .string()
        .default(VircadiaConfig_SERVER_CONSTS.DB_AGENT_PROXY_USER_USERNAME),
    VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD: z
        .string()
        .default("CHANGE_ME!"),
    VRCA_SERVER_SERVICE_POSTGRES_EXTENSIONS: z
        .string()
        .transform((val) =>
            val
                .split(",")
                .map((ext) => ext.trim())
                .filter((ext) => ext.length > 0),
        )
        .default("uuid-ossp,hstore,pgcrypto"),

    // PGWEB
    VRCA_SERVER_SERVICE_PGWEB_CONTAINER_NAME: z
        .string()
        .default("vircadia_world_pgweb"),
    VRCA_SERVER_SERVICE_PGWEB_HOST_CONTAINER_BIND_EXTERNAL: z
        .string()
        .default("127.0.0.1"),
    VRCA_SERVER_SERVICE_PGWEB_PORT_CONTAINER_BIND_EXTERNAL: z.coerce
        .number()
        .default(5437),
});

export const VircadiaConfig_SERVER = serverEnvSchema.parse(process.env);
