import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { serverConfiguration } from "../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";
import { existsSync } from "node:fs";
import { config as dotenvConfig } from "dotenv";

const BooleanStringSchema = z
    .union([
        z.boolean(),
        z.string().transform((val) => val === "1" || val.toLowerCase() === "true"),
    ])
    .default(false);

const NullableStringSchema = z.string().nullable().default(null);

// 1. Parse Seed Env File first to allow loading overrides
const VRCA_CLI_SEED_ENV_FILE = NullableStringSchema.parse(
    process.env.VRCA_CLI_SEED_ENV_FILE,
);

// 2. Load .env overrides if accepted
if (VRCA_CLI_SEED_ENV_FILE && existsSync(VRCA_CLI_SEED_ENV_FILE)) {
    dotenvConfig({
        path: VRCA_CLI_SEED_ENV_FILE,
        override: true,
    });
}
// 3. Helper to refresh process.env access after potential dotenv load
const getEnv = (key: string) => process.env[key];

// 4. Sequentially parse settings
const VRCA_CLI_DEBUG = BooleanStringSchema.parse(getEnv("VRCA_CLI_DEBUG"));

const VRCA_CLI_SUPPRESS = BooleanStringSchema.parse(getEnv("VRCA_CLI_SUPPRESS"));

const VRCA_CLI_SERVICE_POSTGRES_HOST = z
    .string()
    .default(
        serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_HOST_CONTAINER_BIND_EXTERNAL,
    )
    .parse(getEnv("VRCA_CLI_SERVICE_POSTGRES_HOST"));

const VRCA_CLI_SERVICE_POSTGRES_PORT = z.coerce
    .number()
    .default(
        serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL,
    )
    .parse(getEnv("VRCA_CLI_SERVICE_POSTGRES_PORT"));

const VRCA_CLI_SERVICE_POSTGRES_DATABASE = z
    .string()
    .default(serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_DATABASE)
    .parse(getEnv("VRCA_CLI_SERVICE_POSTGRES_DATABASE"));

const VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME = z
    .string()
    .default(
        serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME,
    )
    .parse(getEnv("VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME"));

const VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD = z
    .string()
    .default(
        serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
    )
    .parse(getEnv("VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD"));

const VRCA_CLI_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME = z
    .string()
    .default(
        serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME,
    )
    .parse(getEnv("VRCA_CLI_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME"));

const VRCA_CLI_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD = z
    .string()
    .default(
        serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD,
    )
    .parse(getEnv("VRCA_CLI_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD"));

const defaultBackupFile = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "./database/backup/backup.sql",
);

const VRCA_CLI_SERVICE_POSTGRES_BACKUP_FILE = z
    .string()
    .default(defaultBackupFile)
    .parse(getEnv("VRCA_CLI_SERVICE_POSTGRES_BACKUP_FILE"));

const VRCA_CLI_SERVICE_POSTGRES_RESTORE_FILE = z
    .string()
    .default(defaultBackupFile)
    .parse(getEnv("VRCA_CLI_SERVICE_POSTGRES_RESTORE_FILE"));

const VRCA_CLI_SERVICE_POSTGRES_SEED_USER_SQL_DIR = NullableStringSchema.parse(
    getEnv("VRCA_CLI_SERVICE_POSTGRES_SEED_USER_SQL_DIR"),
);

const VRCA_CLI_SERVICE_POSTGRES_SEED_USER_ASSET_DIR = NullableStringSchema.parse(
    getEnv("VRCA_CLI_SERVICE_POSTGRES_SEED_USER_ASSET_DIR"),
);

const VRCA_CLI_SERVICE_POSTGRES_SYNC_ASSET_DIR = NullableStringSchema.parse(
    getEnv("VRCA_CLI_SERVICE_POSTGRES_SYNC_ASSET_DIR"),
);

const VRCA_CLI_SERVICE_POSTGRES_RESET_USER_DIR = NullableStringSchema.parse(
    getEnv("VRCA_CLI_SERVICE_POSTGRES_RESET_USER_DIR"),
);

// 5. Compose configuration object
const cliConfiguration = {
    VRCA_CLI_DEBUG,
    VRCA_CLI_SUPPRESS,
    VRCA_CLI_SERVICE_POSTGRES_HOST,
    VRCA_CLI_SERVICE_POSTGRES_PORT,
    VRCA_CLI_SERVICE_POSTGRES_DATABASE,
    VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
    VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
    VRCA_CLI_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME,
    VRCA_CLI_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD,
    VRCA_CLI_SERVICE_POSTGRES_BACKUP_FILE,
    VRCA_CLI_SERVICE_POSTGRES_RESTORE_FILE,
    VRCA_CLI_SERVICE_POSTGRES_SEED_USER_SQL_DIR,
    VRCA_CLI_SERVICE_POSTGRES_SEED_USER_ASSET_DIR,
    VRCA_CLI_SERVICE_POSTGRES_SYNC_ASSET_DIR,
    VRCA_CLI_SERVICE_POSTGRES_RESET_USER_DIR,
    VRCA_CLI_SEED_ENV_FILE,
};

export { cliConfiguration };
