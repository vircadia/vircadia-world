import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { serverConfiguration } from "../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";
import { existsSync } from "node:fs";
import { config as dotenvConfig } from "dotenv";

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
    VRCA_CLI_SERVICE_POSTGRES_SEED_USER_SQL_DIR: z
        .string()
        .nullable()
        .default(null),
    VRCA_CLI_SERVICE_POSTGRES_SEED_USER_ASSET_DIR: z
        .string()
        .nullable()
        .default(null),
    VRCA_CLI_SERVICE_POSTGRES_SYNC_ASSET_DIR: z
        .string()
        .nullable()
        .default(null),

    VRCA_CLI_SERVICE_POSTGRES_RESET_USER_DIR: z
        .string()
        .nullable()
        .default(null),
    VRCA_CLI_SERVICE_POSTGRES_SEED_AUTH_PROVIDER_SQL: z.string().nullable().default(null),
    VRCA_CLI_SEED_ENV_FILE: z.string().nullable().default(null),
});

const cliConfiguration = cliEnvSchema.parse(process.env);

if (cliConfiguration.VRCA_CLI_SEED_ENV_FILE && existsSync(cliConfiguration.VRCA_CLI_SEED_ENV_FILE)) {
  dotenvConfig({ path: cliConfiguration.VRCA_CLI_SEED_ENV_FILE, override: true }); // override if you want extra.env to win
  // Re-parse configuration to merge seed env file values
  Object.assign(cliConfiguration, cliEnvSchema.parse(process.env));
}

export { cliConfiguration };
