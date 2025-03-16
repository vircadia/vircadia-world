import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Server_CLI, Client_CLI } from "../vircadia.world.cli";
import { VircadiaConfig_CLI } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.cli.config";
import { PostgresClient } from "../../sdk/vircadia-world-sdk-ts/module/server/postgres.server.client";
import { VircadiaConfig_SERVER } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.server.config";

// describe("CLIENT Container and Database CLI Tests", () => {
//     beforeAll(async () => {
//         await Client_CLI.runClientDockerCommand({
//             args: ["up", "-d"],
//         });
//         Bun.sleep(1000);
//     });

//     test("Client container rebuild works", async () => {
//         await Client_CLI.runClientDockerCommand({
//             args: ["down", "-v"],
//         });
//         await Client_CLI.runClientDockerCommand({
//             args: ["up", "-d"],
//         });
//         const healthAfterUp = await Client_CLI.isWebBabylonJsHealthy({
//             timeout: 2000,
//             interval: 100,
//         });
//         expect(healthAfterUp.isHealthy).toBe(true);
//     });

//     test("Client container down and up cycle works", async () => {
//         await Client_CLI.runClientDockerCommand({
//             args: ["down"],
//         });

//         const healthAfterDown = await Client_CLI.isWebBabylonJsHealthy({
//             timeout: 2000,
//             interval: 100,
//         });
//         expect(healthAfterDown.isHealthy).toBe(false);

//         await Client_CLI.runClientDockerCommand({
//             args: ["up", "-d"],
//         });
//         const healthAfterUp = await Client_CLI.isWebBabylonJsHealthy({
//             timeout: 2000,
//             interval: 100,
//         });
//         expect(healthAfterUp.isHealthy).toBe(true);
//     });
// });

describe("SERVER Container and Database CLI Tests", () => {
    beforeAll(async () => {
        await Server_CLI.runServerDockerCommand({
            args: ["up", "-d"],
        });
        Bun.sleep(1000);
    });

    afterAll(async () => {
        await PostgresClient.getInstance({
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
        }).disconnect();
    });

    test("Docker container rebuild works", async () => {
        await PostgresClient.getInstance({
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
        }).disconnect();

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
        const finalPostgresHealth = await Server_CLI.isPostgresHealthy(true);
        expect(finalPostgresHealth.isHealthy).toBe(true);
        const finalPgwebHealth = await Server_CLI.isPgwebHealthy(true);
        expect(finalPgwebHealth.isHealthy).toBe(true);
        const finalApiHealth = await Server_CLI.isApiHealthy(true);
        expect(finalApiHealth.isHealthy).toBe(true);
        const finalTickHealth = await Server_CLI.isTickHealthy(true);
        expect(finalTickHealth.isHealthy).toBe(true);
    }, 60000); // Longer timeout since rebuild includes multiple operations

    test("Docker container down and up cycle works", async () => {
        // Stop containers
        await Server_CLI.runServerDockerCommand({
            args: ["down"],
        });
        const postgresHealthAfterDown =
            await Server_CLI.isPostgresHealthy(true);
        expect(postgresHealthAfterDown.isHealthy).toBe(false);
        const pgwebHealthAfterDown = await Server_CLI.isPgwebHealthy(true);
        expect(pgwebHealthAfterDown.isHealthy).toBe(false);
        const apiHealthAfterDown = await Server_CLI.isApiHealthy(true);
        expect(apiHealthAfterDown.isHealthy).toBe(false);
        const tickHealthAfterDown = await Server_CLI.isTickHealthy(true);
        expect(tickHealthAfterDown.isHealthy).toBe(false);

        // Start containers again
        await Server_CLI.runServerDockerCommand({
            args: ["up", "-d"],
        });

        const postgresHealthAfterUp = await Server_CLI.isPostgresHealthy(true);
        expect(postgresHealthAfterUp.isHealthy).toBe(true);
        const pgwebHealthAfterUp = await Server_CLI.isPgwebHealthy(true);
        expect(pgwebHealthAfterUp.isHealthy).toBe(true);
        const apiHealthAfterUp = await Server_CLI.isApiHealthy(true);
        expect(apiHealthAfterUp.isHealthy).toBe(true);
        const tickHealthAfterUp = await Server_CLI.isTickHealthy(true);
        expect(tickHealthAfterUp.isHealthy).toBe(true);
    }, 60000);

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
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
        }).getSuperClient({
            postgres: {
                host: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
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
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
        }).getProxyClient({
            postgres: {
                host: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME,
                password:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD,
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
        // Turn off services
        await Server_CLI.runServerDockerCommand({
            args: ["down", "pgweb", "api", "tick"],
        });

        // Test wipe
        await Server_CLI.wipeDatabase();
        const healthAfterReset = await Server_CLI.isPostgresHealthy(true);
        expect(healthAfterReset.isHealthy).toBe(true);

        // Run migrations and seed
        const migrationsRan = await Server_CLI.migrate();
        expect(migrationsRan).toBe(true);

        await Server_CLI.seed({});

        // Verify database is still healthy after all operations
        const finalPostgresHealth = await Server_CLI.isPostgresHealthy(true);
        expect(finalPostgresHealth.isHealthy).toBe(true);

        // Turn on services
        await Server_CLI.runServerDockerCommand({
            args: ["up", "pgweb", "api", "tick", "-d"],
        });

        const finalPgwebHealth = await Server_CLI.isPgwebHealthy(true);
        expect(finalPgwebHealth.isHealthy).toBe(true);
        const finalApiHealth = await Server_CLI.isApiHealthy(true);
        expect(finalApiHealth.isHealthy).toBe(true);
        const finalTickHealth = await Server_CLI.isTickHealthy(true);
        expect(finalTickHealth.isHealthy).toBe(true);
    }, 15000);

    test("Database extensions are properly installed", async () => {
        const sql = await PostgresClient.getInstance({
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
        }).getSuperClient({
            postgres: {
                host: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        // Get list of installed extensions
        const extensions = await sql`
            SELECT extname FROM pg_extension
        `;

        // Verify required extensions are installed
        const requiredExtensions =
            VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_POSTGRES_EXTENSIONS;
        for (const ext of requiredExtensions) {
            expect(extensions.some((e) => e.extname === ext)).toBe(true);
        }
    });
});
