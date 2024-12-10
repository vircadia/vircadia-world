import postgres from "postgres";
import { log } from "../../../sdk/vircadia-world-sdk-ts/module/general/log.ts";

export class PostgresClient {
    private static instance: PostgresClient | null = null;
    private static debugMode = false;
    private sql: postgres.Sql | null = null;
    private config!: {
        host: string;
        port: number;
        database: string;
        user: string;
        password: string;
        extensions: string[];
    };

    private constructor() {}

    public static getInstance(debug = false): PostgresClient {
        if (!PostgresClient.instance) {
            PostgresClient.instance = new PostgresClient();
        }
        PostgresClient.debugMode = debug;
        return PostgresClient.instance;
    }

    public async initialize(config: {
        host: string;
        port: number;
        database: string;
        user: string;
        password: string;
        extensions: string[];
    }): Promise<void> {
        this.config = config;

        log({
            message: "Initializing PostgreSQL connection...",
            type: "info",
            debug: PostgresClient.debugMode,
        });

        try {
            await this.initializeClient();
            await this.waitForHealthyConnection();
        } catch (error) {
            log({
                message: `PostgreSQL initialization failed: ${error.message}`,
                type: "error",
                debug: PostgresClient.debugMode,
            });
            throw error;
        }
    }

    private async initializeClient(): Promise<void> {
        this.sql = postgres({
            host: this.config.host,
            port: this.config.port,
            database: this.config.database,
            username: this.config.user,
            password: this.config.password,
            onnotice: () => {}, // Suppress notice messages
        });
    }

    private async waitForHealthyConnection(): Promise<void> {
        let attempts = 0;
        const maxAttempts = 30; // 30 seconds timeout

        while (attempts < maxAttempts) {
            try {
                if (!this.sql) throw new Error("SQL client is not initialized");
                await this.sql`SELECT 1`;
                log({
                    message: "PostgreSQL connection is healthy",
                    type: "success",
                    debug: PostgresClient.debugMode,
                });
                return;
            } catch (error) {
                attempts++;
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }

        throw new Error("PostgreSQL connection failed to become healthy");
    }

    public getClient(): postgres.Sql {
        if (!this.sql) {
            throw new Error(
                "PostgreSQL client not initialized. Call initialize() first.",
            );
        }
        return this.sql;
    }

    public async disconnect(): Promise<void> {
        if (this.sql) {
            await this.sql.end();
            this.sql = null;
        }

        log({
            message: "PostgreSQL connection closed",
            type: "info",
            debug: PostgresClient.debugMode,
        });
    }

    public async hasSystemPermission(): Promise<boolean> {
        try {
            if (!this.sql) {
                throw new Error(
                    "PostgreSQL client not initialized. Call initialize() first.",
                );
            }

            const [result] = await this.sql<[{ is_admin_agent: boolean }]>`
                SELECT is_admin_agent() as is_admin_agent
            `;

            return result.is_admin_agent;
        } catch (error) {
            log({
                message: `Failed to check system permissions: ${error.message}`,
                type: "error",
                debug: PostgresClient.debugMode,
            });
            return false;
        }
    }

    public async getSystemPermissionsRequirements(): Promise<any> {
        try {
            if (!this.sql) {
                throw new Error(
                    "PostgreSQL client not initialized. Call initialize() first.",
                );
            }

            const [result] = await this.sql<
                [{ get_system_permissions_requirements: any }]
            >`
                SELECT get_system_permissions_requirements() as get_system_permissions_requirements
            `;

            return result.get_system_permissions_requirements;
        } catch (error) {
            log({
                message: `Failed to get system permissions requirements: ${error.message}`,
                type: "error",
                debug: PostgresClient.debugMode,
            });
            return null;
        }
    }
}
