import postgres from "postgres";
import { log } from "../../../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import { VircadiaConfig } from "../../../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";

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

    public async connect(silent?: boolean): Promise<void> {
        if (this.sql) {
            return; // Already connected
        }

        log({
            message: "Initializing PostgreSQL connection...",
            type: "info",
            debug: VircadiaConfig.server.debug,
        });

        try {
            this.sql = postgres({
                host: VircadiaConfig.server.postgres.host,
                port: VircadiaConfig.server.postgres.port,
                database: VircadiaConfig.server.postgres.database,
                username: VircadiaConfig.server.postgres.user,
                password: VircadiaConfig.server.postgres.password,
                onnotice: silent ? () => {} : undefined,
                onclose: silent ? () => {} : undefined,
            });

            // Test connection immediately
            await this.sql`SELECT 1`;

            log({
                message: "PostgreSQL connection established successfully",
                type: "success",
                debug: VircadiaConfig.server.debug,
            });
        } catch (error) {
            log({
                message: `PostgreSQL connection failed: ${error.message}`,
                type: "error",
                error: error,
                debug: VircadiaConfig.server.debug,
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
                type: "info",
                debug: VircadiaConfig.server.debug,
            });
        }
    }
}
