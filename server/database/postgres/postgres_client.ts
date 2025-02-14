import postgres from "postgres";
import { log } from "../../../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import { VircadiaConfig_Server } from "../../../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";

export class PostgresClient {
    private static instance: PostgresClient | null = null;
    private sql: postgres.Sql | null = null;

    private constructor() {} // Empty constructor since we don't need to store config

    public static getInstance(): PostgresClient {
        if (!PostgresClient.instance) {
            PostgresClient.instance = new PostgresClient();
        }
        return PostgresClient.instance;
    }

    public async connect(): Promise<void> {
        if (this.sql) {
            return; // Already connected
        }

        log({
            message: "Initializing PostgreSQL connection...",
            type: "debug",
            suppress: VircadiaConfig_Server.suppress,
            debug: VircadiaConfig_Server.debug,
        });

        try {
            this.sql = postgres({
                host: VircadiaConfig_Server.postgres.host,
                port: VircadiaConfig_Server.postgres.port,
                database: VircadiaConfig_Server.postgres.database,
                username: VircadiaConfig_Server.postgres.user,
                password: VircadiaConfig_Server.postgres.password,
                onnotice: VircadiaConfig_Server.suppress ? () => {} : undefined,
                onclose: VircadiaConfig_Server.suppress ? () => {} : undefined,
            });

            // Test connection immediately
            await this.sql`SELECT 1`;

            log({
                message: "PostgreSQL connection established successfully",
                type: "debug",
                suppress: VircadiaConfig_Server.suppress,
                debug: VircadiaConfig_Server.debug,
            });
        } catch (error) {
            log({
                message: "PostgreSQL connection failed.",
                type: "error",
                error: error,
                suppress: VircadiaConfig_Server.suppress,
                debug: VircadiaConfig_Server.debug,
            });
            throw error;
        }
    }

    public getClient(): postgres.Sql {
        if (!this.sql) {
            throw new Error(
                "PostgreSQL client not initialized. Call connect() first.",
            );
        }
        return this.sql;
    }

    public async disconnect(): Promise<void> {
        if (this.sql) {
            await this.sql.end();
            this.sql = null;

            log({
                message: "PostgreSQL connection closed",
                type: "debug",
                suppress: VircadiaConfig_Server.suppress,
                debug: VircadiaConfig_Server.debug,
            });
        }
    }
}
