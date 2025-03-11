import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Server_CLI, Client_CLI } from "../vircadia.world.cli";
import { VircadiaConfig } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config";
import { PostgresClient } from "../../sdk/vircadia-world-sdk-ts/module/server/postgres.server.client";

describe("CLIENT Container and Database CLI Tests", () => {
    beforeAll(async () => {
        await Client_CLI.runClientDockerCommand({
            args: ["up", "-d"],
        });
        Bun.sleep(1000);
    });

    test("Client container rebuild works", async () => {
        await Client_CLI.runClientDockerCommand({
            args: ["down", "-v"],
        });
        await Client_CLI.runClientDockerCommand({
            args: ["up", "-d"],
        });
        const healthAfterUp = await Client_CLI.isHealthy();
        expect(healthAfterUp.clients.web_babylon_js.isHealthy).toBe(true);
    });

    test("Client container down and up cycle works", async () => {
        await Client_CLI.runClientDockerCommand({
            args: ["down"],
        });

        const healthAfterDown = await Client_CLI.isHealthy();
        expect(healthAfterDown.clients.web_babylon_js.isHealthy).toBe(false);

        await Client_CLI.runClientDockerCommand({
            args: ["up", "-d"],
        });
        const healthAfterUp = await Client_CLI.isHealthy();
        expect(healthAfterUp.clients.web_babylon_js.isHealthy).toBe(true);
    });
});

describe("SERVER Container and Database CLI Tests", () => {
    beforeAll(async () => {
        await Server_CLI.runServerDockerCommand({
            args: ["up", "-d"],
        });
        Bun.sleep(1000);
    });

    afterAll(async () => {
        await PostgresClient.getInstance({
            debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
        }).disconnect();
    });

    test("Docker container rebuild works", async () => {
        await Server_CLI.runServerDockerCommand({
            args: ["down", "-v"],
        });
        await Server_CLI.runServerDockerCommand({
            args: ["up", "postgres", "-d"],
        });

        const isPostgresHealthy = await Server_CLI.isPostgresHealthy(true);
        expect(isPostgresHealthy.isHealthy).toBe(true);
        // Run migrations and seed data
        const migrationsRan = await Server_CLI.migrate();
        expect(migrationsRan).toBe(true);
        await Server_CLI.seed({});

        await Server_CLI.runServerDockerCommand({
            args: ["up", "-d"],
        });

        // Verify all services are healthy
        const finalHealth = await Server_CLI.isHealthy({
            timeout: 2000,
            interval: 100,
        });
        expect(finalHealth.services.api.isHealthy).toBe(true);
        expect(finalHealth.services.pgweb.isHealthy).toBe(true);
        expect(finalHealth.services.tick.isHealthy).toBe(true);
        expect(finalHealth.services.postgres.isHealthy).toBe(true);
    }, 30000); // Longer timeout since rebuild includes multiple operations

    test("Docker container down and up cycle works", async () => {
        // Stop containers
        await Server_CLI.runServerDockerCommand({
            args: ["down"],
        });
        const healthAfterDown = await Server_CLI.isHealthy();
        expect(healthAfterDown.services.postgres.isHealthy).toBe(false);
        expect(healthAfterDown.services.pgweb.isHealthy).toBe(false);
        expect(healthAfterDown.services.api.isHealthy).toBe(false);
        expect(healthAfterDown.services.tick.isHealthy).toBe(false);

        // Start containers again
        await Server_CLI.runServerDockerCommand({
            args: ["up", "-d"],
        });
        const healthAfterUp = await Server_CLI.isHealthy({
            timeout: 2000,
            interval: 100,
        });
        expect(healthAfterUp.services.postgres.isHealthy).toBe(true);
        expect(healthAfterUp.services.pgweb.isHealthy).toBe(true);
        expect(healthAfterUp.services.api.isHealthy).toBe(true);
        expect(healthAfterUp.services.tick.isHealthy).toBe(true);
    }, 15000);

    test("System token generation and cleanup works", async () => {
        // Generate system token
        const token = await Server_CLI.generateDbSystemToken();
        expect(token).toBeDefined();
        expect(token.token).toBeDefined();
        expect(token.sessionId).toBeDefined();
        expect(token.agentId).toBeDefined();

        // Clean up expired system tokens
        const cleanupResult = await Server_CLI.invalidateDbSystemTokens();
        expect(cleanupResult).toBe(0);
    });

    test("Database connection string generation works", async () => {
        const connectionString = await Server_CLI.generateDbConnectionString();
        expect(connectionString).toBeDefined();
        expect(connectionString).toContain("postgres://");
        expect(connectionString).toContain("@");
        expect(connectionString).toContain(":");
        expect(connectionString).toContain("/");
    });

    test("Superuser SQL connection works", async () => {
        const superUserSql = await PostgresClient.getInstance({
            debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
        }).getSuperClient({
            postgres: {
                host: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    VircadiaConfig.CLI
                        .VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    VircadiaConfig.CLI
                        .VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        superUserSql.begin(async (tx) => {
            const [result] = await tx`SELECT current_database()`;
            expect(result.current_database).toBeDefined();

            // Verify superuser status
            const [isSuperUser] = await tx`SELECT auth.is_system_agent()`;
            expect(isSuperUser.is_system_agent).toBe(true);

            // Verify proxy agent status
            const [isProxyAgent] = await tx`SELECT auth.is_proxy_agent()`;
            expect(isProxyAgent.is_proxy_agent).toBe(false);
        });
    });

    test("Proxy user SQL connection works", async () => {
        const proxyUserSql = await PostgresClient.getInstance({
            debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
        }).getProxyClient({
            postgres: {
                host: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    VircadiaConfig.CLI
                        .VRCA_CLI_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME,
                password:
                    VircadiaConfig.CLI
                        .VRCA_CLI_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD,
            },
        });

        await proxyUserSql.begin(async (tx) => {
            const [result] = await tx`SELECT current_database()`;
            expect(result.current_database).toBeDefined();

            // First verify we can call function through proxy user
            const [isSystemAgent] = await tx`
                SELECT auth.is_system_agent() as is_system_agent
            `;
            expect(isSystemAgent.is_system_agent).toBe(false);

            // Verify proxy agent status
            const [isProxyAgent] = await tx`SELECT auth.is_proxy_agent()`;
            expect(isProxyAgent.is_proxy_agent).toBe(true);
        });
    });

    test("Database reset, migration, and seeding works", async () => {
        // Test reset
        await Server_CLI.wipeDatabase();
        const healthAfterReset = await Server_CLI.isHealthy();
        expect(healthAfterReset.services.postgres.isHealthy).toBe(true);

        // Verify database is accessible after reset
        const sql = await PostgresClient.getInstance({
            debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
        }).getSuperClient({
            postgres: {
                host: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    VircadiaConfig.CLI
                        .VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    VircadiaConfig.CLI
                        .VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });
        const [result] = await sql`SELECT current_database()`;
        expect(result.current_database).toBeDefined();

        // Run migrations and seed
        const migrationsRan = await Server_CLI.migrate();
        expect(migrationsRan).toBe(true);
        await Server_CLI.seed({});
        // Check if config table has essential auth settings
        const [authConfig] = await sql<
            [{ auth_config__heartbeat_interval_ms: number }]
        >`
            SELECT auth_config__heartbeat_interval_ms FROM config.auth_config
        `;
        expect(authConfig).toBeDefined();
        expect(authConfig.auth_config__heartbeat_interval_ms).toBeDefined();

        // Verify database is still healthy after all operations
        const finalHealth = await Server_CLI.isHealthy();
        expect(finalHealth.services.postgres.isHealthy).toBe(true);
        expect(finalHealth.services.pgweb.isHealthy).toBe(true);
    });

    test("Database extensions are properly installed", async () => {
        const sql = await PostgresClient.getInstance({
            debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
        }).getSuperClient({
            postgres: {
                host: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    VircadiaConfig.CLI
                        .VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    VircadiaConfig.CLI
                        .VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        // Get list of installed extensions
        const extensions = await sql`
            SELECT extname FROM pg_extension
        `;

        // Verify required extensions are installed
        const requiredExtensions =
            VircadiaConfig.SERVER.VRCA_SERVER_SERVICE_POSTGRES_EXTENSIONS;
        for (const ext of requiredExtensions) {
            expect(extensions.some((e) => e.extname === ext)).toBe(true);
        }
    });
});
