import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { serverConfiguration } from "../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";

// CLI environment schema
const cliEnvSchema = z.object({
    VRCA_CLI_DEBUG: z
        .union([
            z.boolean(),
            z
                .string()
                .transform(
                    (val) => val === "1" || val.toLowerCase() === "true",
                ),
        ])
        .default(false),
    VRCA_CLI_SUPPRESS: z
        .union([
            z.boolean(),
            z
                .string()
                .transform(
                    (val) => val === "1" || val.toLowerCase() === "true",
                ),
        ])
        .default(false),
    VRCA_CLI_SERVICE_POSTGRES_HOST: z
        .string()
        .default(
            serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_HOST_CONTAINER_BIND_EXTERNAL,
        ),
    VRCA_CLI_SERVICE_POSTGRES_PORT: z.coerce
        .number()
        .default(
            serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL,
        ),
    VRCA_CLI_SERVICE_POSTGRES_DATABASE: z
        .string()
        .default(serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_DATABASE),
    VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME: z
        .string()
        .default(
            serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME,
        ),
    VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD: z
        .string()
        .default(
            serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
        ),

    VRCA_CLI_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME: z
        .string()
        .default(
            serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME,
        ),
    VRCA_CLI_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD: z
        .string()
        .default(
            serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD,
        ),

    VRCA_CLI_SERVICE_POSTGRES_BACKUP_FILE: z
        .string()
        .default(
            path.join(
                dirname(fileURLToPath(import.meta.url)),
                "./database/backup/backup.sql",
            ),
        ),
    VRCA_CLI_SERVICE_POSTGRES_RESTORE_FILE: z
        .string()
        .default(
            path.join(
                dirname(fileURLToPath(import.meta.url)),
                "./database/backup/backup.sql",
            ),
        ),
    VRCA_CLI_SERVICE_POSTGRES_MIGRATION_DIR: z
        .string()
        .default(
            path.join(
                dirname(fileURLToPath(import.meta.url)),
                "./database/migration",
            ),
        ),
    VRCA_CLI_SERVICE_POSTGRES_SEED_SYSTEM_SQL_DIR: z
        .string()
        .nullable()
        .default(
            path.join(
                dirname(fileURLToPath(import.meta.url)),
                "./database/seed/sql/",
            ),
        ),
    VRCA_CLI_SERVICE_POSTGRES_SEED_USER_SQL_DIR: z
        .string()
        .nullable()
        .default(null),
    VRCA_CLI_SERVICE_POSTGRES_SEED_SYSTEM_ASSET_DIR: z
        .string()
        .nullable()
        .default(
            path.join(
                dirname(fileURLToPath(import.meta.url)),
                "./database/seed/asset/",
            ),
        ),
    VRCA_CLI_SERVICE_POSTGRES_SEED_USER_ASSET_DIR: z
        .string()
        .nullable()
        .default(null),
    VRCA_CLI_SERVICE_POSTGRES_SYNC_ASSET_DIR: z
        .string()
        .nullable()
        .default(null),

    VRCA_CLI_SERVICE_POSTGRES_SYSTEM_RESET_DIR: z
        .string()
        .nullable()
        .default(
            path.join(
                dirname(fileURLToPath(import.meta.url)),
                "./database/reset",
            ),
        ),
    VRCA_CLI_SERVICE_POSTGRES_USER_RESET_DIR: z
        .string()
        .nullable()
        .default(null),
});
export const cliConfiguration = cliEnvSchema.parse(process.env);
