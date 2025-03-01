import postgres from "postgres";
import { log } from "../../../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import { VircadiaConfig } from "../../../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";

export class PostgresClient {
    private static instance: PostgresClient | null = null;
    private superSql: postgres.Sql | null = null;
    private proxySql: postgres.Sql | null = null;

    public static getInstance(): PostgresClient {
        if (!PostgresClient.instance) {
            PostgresClient.instance = new PostgresClient();
        }
        return PostgresClient.instance;
    }

    public async getSuperClient(): Promise<postgres.Sql> {
        if (!this.superSql) {
            // Create super user connection using config
            this.superSql = postgres({
                host: VircadiaConfig.SERVER.POSTGRES.HOST,
                port: VircadiaConfig.SERVER.POSTGRES.PORT,
                database: VircadiaConfig.SERVER.POSTGRES.DATABASE,
                username: VircadiaConfig.GLOBAL_CONSTS.DB_SUPER_USER,
                password: VircadiaConfig.SERVER.POSTGRES.PASSWORD,
                onnotice: VircadiaConfig.SERVER.SUPPRESS ? () => {} : undefined,
                onclose: VircadiaConfig.SERVER.SUPPRESS ? () => {} : undefined,
            });

            // Test super user connection immediately
            await this.superSql`SELECT 1`;

            log({
                message:
                    "PostgreSQL super user connection established successfully.",
                type: "debug",
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                debug: VircadiaConfig.SERVER.DEBUG,
            });
        }
        return this.superSql;
    }

    public async getProxyClient(): Promise<postgres.Sql> {
        if (!this.proxySql) {
            // Create proxy account connection
            log({
                message: "Initializing PostgreSQL proxy account connection...",
                type: "debug",
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                debug: VircadiaConfig.SERVER.DEBUG,
            });

            this.proxySql = postgres({
                host: VircadiaConfig.SERVER.POSTGRES.HOST,
                port: VircadiaConfig.SERVER.POSTGRES.PORT,
                database: VircadiaConfig.SERVER.POSTGRES.DATABASE,
                username: VircadiaConfig.GLOBAL_CONSTS.DB_AGENT_PROXY_USER,
                password: VircadiaConfig.SERVER.POSTGRES.AGENT_PROXY_PASSWORD,
                onnotice: VircadiaConfig.SERVER.SUPPRESS ? () => {} : undefined,
                onclose: VircadiaConfig.SERVER.SUPPRESS ? () => {} : undefined,
            });

            // Test proxy account connection immediately
            await this.proxySql`SELECT 1`;

            log({
                message:
                    "PostgreSQL proxy account connection established successfully.",
                type: "debug",
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                debug: VircadiaConfig.SERVER.DEBUG,
            });
        }
        return this.proxySql;
    }

    public async disconnect(): Promise<void> {
        if (this.superSql) {
            await this.superSql.end();
            this.superSql = null;
            log({
                message: "PostgreSQL super user connection closed.",
                type: "debug",
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                debug: VircadiaConfig.SERVER.DEBUG,
            });
        }

        if (this.proxySql) {
            await this.proxySql.end();
            this.proxySql = null;
            log({
                message: "PostgreSQL proxy account connection closed.",
                type: "debug",
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                debug: VircadiaConfig.SERVER.DEBUG,
            });
        }
    }
}
