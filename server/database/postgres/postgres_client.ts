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
            suppress: VircadiaConfig_Server.SUPPRESS,
            debug: VircadiaConfig_Server.DEBUG,
        });

        try {
            this.sql = postgres({
                host: VircadiaConfig_Server.POSTGRES.HOST,
                port: VircadiaConfig_Server.POSTGRES.PORT,
                database: VircadiaConfig_Server.POSTGRES.DATABASE,
                username: VircadiaConfig_Server.POSTGRES.USER,
                password: VircadiaConfig_Server.POSTGRES.PASSWORD,
                onnotice: VircadiaConfig_Server.SUPPRESS ? () => {} : undefined,
                onclose: VircadiaConfig_Server.SUPPRESS ? () => {} : undefined,
            });

            // Test connection immediately
            await this.sql`SELECT 1`;

            log({
                message: "PostgreSQL connection established successfully",
                type: "debug",
                suppress: VircadiaConfig_Server.SUPPRESS,
                debug: VircadiaConfig_Server.DEBUG,
            });
        } catch (error) {
            log({
                message: "PostgreSQL connection failed.",
                type: "error",
                error: error,
                suppress: VircadiaConfig_Server.SUPPRESS,
                debug: VircadiaConfig_Server.DEBUG,
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
                suppress: VircadiaConfig_Server.SUPPRESS,
                debug: VircadiaConfig_Server.DEBUG,
            });
        }
    }
}
