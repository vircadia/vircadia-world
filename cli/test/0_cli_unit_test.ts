import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Server_CLI, Client_CLI } from "../vircadia.world.cli";
import { VircadiaConfig_CLI } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.cli.config";
import { PostgresClient } from "../../sdk/vircadia-world-sdk-ts/module/server/postgres.server.client";
import { VircadiaConfig_SERVER } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.server.config";
import { Service } from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";

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
            args: ["up", Service.E_Service.POSTGRES, "-d"],
        });

        const isPostgresHealthy = await Server_CLI.isPostgresHealthy({
            timeout: 20000,
            interval: 1000,
        });
        expect(isPostgresHealthy.isHealthy).toBe(true);

        const migrationsRan = await Server_CLI.migrate();
        expect(migrationsRan).toBe(true);
        await Server_CLI.seed({});

        await Server_CLI.runServerDockerCommand({
            args: ["up", Service.E_Service.PGWEB, "-d"],
        });

        const pgwebHealth = await Server_CLI.isPgwebHealthy({
            timeout: 20000,
            interval: 1000,
        });
        expect(pgwebHealth.isHealthy).toBe(true);

        await Server_CLI.runServerDockerCommand({
            args: ["up", Service.E_Service.WORLD_API_MANAGER, "--build", "-d"],
        });

        const apiHealth = await Server_CLI.isWorldApiManagerHealthy({
            timeout: 30000,
            interval: 2000,
        });
        expect(apiHealth.isHealthy).toBe(true);

        await Server_CLI.runServerDockerCommand({
            args: ["up", Service.E_Service.WORLD_TICK_MANAGER, "--build", "-d"],
        });

        const finalPostgresHealth = await Server_CLI.isPostgresHealthy({
            timeout: 10000,
            interval: 1000,
        });
        expect(finalPostgresHealth.isHealthy).toBe(true);

        const finalPgwebHealth = await Server_CLI.isPgwebHealthy({
            timeout: 10000,
            interval: 1000,
        });
        expect(finalPgwebHealth.isHealthy).toBe(true);

        const finalApiHealth = await Server_CLI.isWorldApiManagerHealthy({
            timeout: 20000,
            interval: 2000,
        });
        expect(finalApiHealth.isHealthy).toBe(true);

        const finalTickHealth = await Server_CLI.isWorldTickManagerHealthy({
            timeout: 20000,
            interval: 2000,
        });
        expect(finalTickHealth.isHealthy).toBe(true);
    }, 120000);

    test("Docker container down and up cycle works", async () => {
        await Server_CLI.runServerDockerCommand({
            args: ["down"],
        });
        const postgresHealthAfterDown =
            await Server_CLI.isPostgresHealthy(true);
        expect(postgresHealthAfterDown.isHealthy).toBe(false);
        const pgwebHealthAfterDown = await Server_CLI.isPgwebHealthy(true);
        expect(pgwebHealthAfterDown.isHealthy).toBe(false);
        const apiHealthAfterDown =
            await Server_CLI.isWorldApiManagerHealthy(true);
        expect(apiHealthAfterDown.isHealthy).toBe(false);
        const tickHealthAfterDown =
            await Server_CLI.isWorldTickManagerHealthy(true);
        expect(tickHealthAfterDown.isHealthy).toBe(false);

        await Server_CLI.runServerDockerCommand({
            args: ["up", Service.E_Service.POSTGRES, "-d"],
        });

        const postgresHealthAfterUp = await Server_CLI.isPostgresHealthy({
            timeout: 20000,
            interval: 1000,
        });
        expect(postgresHealthAfterUp.isHealthy).toBe(true);

        await Server_CLI.runServerDockerCommand({
            args: ["up", Service.E_Service.PGWEB, "-d"],
        });

        const pgwebHealthAfterUp = await Server_CLI.isPgwebHealthy({
            timeout: 15000,
            interval: 1000,
        });
        expect(pgwebHealthAfterUp.isHealthy).toBe(true);

        await Server_CLI.runServerDockerCommand({
            args: [
                "up",
                Service.E_Service.WORLD_API_MANAGER,
                Service.E_Service.WORLD_TICK_MANAGER,
                "-d",
            ],
        });

        const apiHealthAfterUp = await Server_CLI.isWorldApiManagerHealthy({
            timeout: 30000,
            interval: 2000,
        });
        expect(apiHealthAfterUp.isHealthy).toBe(true);

        const tickHealthAfterUp = await Server_CLI.isWorldTickManagerHealthy({
            timeout: 30000,
            interval: 2000,
        });
        expect(tickHealthAfterUp.isHealthy).toBe(true);
    }, 120000);

    test("System token generation and cleanup works", async () => {
        const token = await Server_CLI.generateDbSystemToken();
        expect(token).toBeDefined();
        expect(token.token).toBeDefined();
        expect(token.sessionId).toBeDefined();
        expect(token.agentId).toBeDefined();

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

            const [isSuperUser] = await tx`SELECT auth.is_system_agent()`;
            expect(isSuperUser.is_system_agent).toBe(true);

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

            const [isSystemAgent] = await tx`
                SELECT auth.is_system_agent() as is_system_agent
            `;
            expect(isSystemAgent.is_system_agent).toBe(false);

            const [isProxyAgent] = await tx`SELECT auth.is_proxy_agent()`;
            expect(isProxyAgent.is_proxy_agent).toBe(true);
        });
    });

    test("Database reset, migration, and seeding works", async () => {
        await Server_CLI.runServerDockerCommand({
            args: [
                "down",
                Service.E_Service.PGWEB,
                Service.E_Service.WORLD_API_MANAGER,
                Service.E_Service.WORLD_TICK_MANAGER,
            ],
        });

        await Server_CLI.wipeDatabase();
        const healthAfterReset = await Server_CLI.isPostgresHealthy(true);
        expect(healthAfterReset.isHealthy).toBe(true);

        const migrationsRan = await Server_CLI.migrate();
        expect(migrationsRan).toBe(true);

        await Server_CLI.seed({});

        const finalPostgresHealth = await Server_CLI.isPostgresHealthy(true);
        expect(finalPostgresHealth.isHealthy).toBe(true);

        await Server_CLI.runServerDockerCommand({
            args: ["up", Service.E_Service.PGWEB, "-d"],
        });

        const finalPgwebHealth = await Server_CLI.isPgwebHealthy({
            timeout: 15000,
            interval: 1000,
        });
        expect(finalPgwebHealth.isHealthy).toBe(true);

        await Server_CLI.runServerDockerCommand({
            args: ["up", Service.E_Service.WORLD_API_MANAGER, "-d"],
        });

        const finalApiHealth = await Server_CLI.isWorldApiManagerHealthy({
            timeout: 30000,
            interval: 2000,
        });
        expect(finalApiHealth.isHealthy).toBe(true);

        await Server_CLI.runServerDockerCommand({
            args: ["up", Service.E_Service.WORLD_TICK_MANAGER, "-d"],
        });

        const finalTickHealth = await Server_CLI.isWorldTickManagerHealthy({
            timeout: 30000,
            interval: 2000,
        });
        expect(finalTickHealth.isHealthy).toBe(true);
    }, 120000);

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

        const extensions = await sql`
            SELECT extname FROM pg_extension
        `;

        const requiredExtensions =
            VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_POSTGRES_EXTENSIONS;
        for (const ext of requiredExtensions) {
            expect(extensions.some((e) => e.extname === ext)).toBe(true);
        }
    });
});
