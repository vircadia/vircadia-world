import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { VircadiaConfig_CLI } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.cli.config";
import { PostgresClient } from "../../sdk/vircadia-world-sdk-ts/module/server/postgres.server.client";
import { VircadiaConfig_SERVER } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.server.config";
import { Service } from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";

// Helper function to run CLI commands
async function runCliCommand(
    script: string,
    ...args: string[]
): Promise<{ exitCode: number; stdout: string }> {
    const proc = Bun.spawn(["bun", "run", script, ...args], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
        console.error(`Error running command ${script}:`, stderr);
    }

    return { exitCode, stdout };
}

// Helper to check health and parse result
async function checkHealth(
    healthScript: string,
    timeout = 20000,
    interval = 1000,
): Promise<{ isHealthy: boolean }> {
    const args = [];
    if (timeout) args.push(`--timeout=${timeout}`);
    if (interval) args.push(`--interval=${interval}`);

    const { stdout } = await runCliCommand(healthScript, ...args);
    return { isHealthy: stdout.includes("is healthy: true") };
}

describe("SERVER Container and Database CLI Tests", () => {
    beforeAll(async () => {
        await runCliCommand("server:run-command", "up", "-d");
        Bun.sleep(1000);
    });

    afterAll(async () => {
        await PostgresClient.getInstance({
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
        }).disconnect();
    });

    test("Docker container rebuild works", async () => {
        await runCliCommand("server:rebuild-all");
    }, 120000);

    test("Docker container down and up cycle works", async () => {
        await runCliCommand("server:run-command", "down");

        const postgresHealthAfterDown = await checkHealth(
            "server:postgres:health",
        );
        expect(postgresHealthAfterDown.isHealthy).toBe(false);

        const pgwebHealthAfterDown = await checkHealth("server:pgweb:health");
        expect(pgwebHealthAfterDown.isHealthy).toBe(false);

        const apiHealthAfterDown = await checkHealth(
            "server:world-api-manager:health",
        );
        expect(apiHealthAfterDown.isHealthy).toBe(false);

        const tickHealthAfterDown = await checkHealth(
            "server:world-tick-manager:health",
        );
        expect(tickHealthAfterDown.isHealthy).toBe(false);

        await runCliCommand(
            "server:run-command",
            "up",
            Service.E_Service.POSTGRES,
            "-d",
        );

        const postgresHealthAfterUp = await checkHealth(
            "server:postgres:health",
            20000,
            1000,
        );
        expect(postgresHealthAfterUp.isHealthy).toBe(true);

        await runCliCommand(
            "server:run-command",
            "up",
            Service.E_Service.PGWEB,
            "-d",
        );

        const pgwebHealthAfterUp = await checkHealth(
            "server:pgweb:health",
            15000,
            1000,
        );
        expect(pgwebHealthAfterUp.isHealthy).toBe(true);

        await runCliCommand(
            "server:run-command",
            "up",
            Service.E_Service.WORLD_API_MANAGER,
            "-d",
        );

        const apiHealthAfterUp = await checkHealth(
            "server:world-api-manager:health",
            30000,
            2000,
        );
        expect(apiHealthAfterUp.isHealthy).toBe(true);

        await runCliCommand(
            "server:run-command",
            "up",
            Service.E_Service.WORLD_TICK_MANAGER,
            "-d",
        );

        const tickHealthAfterUp = await checkHealth(
            "server:world-tick-manager:health",
            30000,
            2000,
        );
        expect(tickHealthAfterUp.isHealthy).toBe(true);
    }, 120000);

    test("System token generation and cleanup works", async () => {
        const { stdout: tokenResult } = await runCliCommand(
            "server:postgres:system-token",
            "true",
        );
        expect(tokenResult).toBeDefined();
        expect(tokenResult.length).toBeGreaterThan(0);

        // For token validation we need to parse the token JSON from stdout
        const tokenData = JSON.parse(tokenResult);
        expect(tokenData.token).toBeDefined();
        expect(tokenData.sessionId).toBeDefined();
        expect(tokenData.agentId).toBeDefined();

        const { stdout: cleanupResult } = await runCliCommand(
            "server:postgres:system-token:invalidate-all",
        );
        expect(cleanupResult.includes("0")).toBe(true);
    });

    test("Database connection string generation works", async () => {
        const { stdout: connectionString } = await runCliCommand(
            "server:postgres:connection-string",
        );
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
        await runCliCommand(
            "server:run-command",
            "down",
            Service.E_Service.PGWEB,
            Service.E_Service.WORLD_API_MANAGER,
            Service.E_Service.WORLD_TICK_MANAGER,
        );

        await runCliCommand("server:postgres:wipe");
        const healthAfterReset = await checkHealth("server:postgres:health");
        expect(healthAfterReset.isHealthy).toBe(true);

        const { exitCode: migrateExitCode } = await runCliCommand(
            "server:postgres:migrate",
        );
        expect(migrateExitCode).toBe(0);

        await runCliCommand("server:postgres:seed:sql");
        await runCliCommand("server:postgres:seed:assets");

        const finalPostgresHealth = await checkHealth("server:postgres:health");
        expect(finalPostgresHealth.isHealthy).toBe(true);

        await runCliCommand(
            "server:run-command",
            "up",
            Service.E_Service.PGWEB,
            "-d",
        );

        const finalPgwebHealth = await checkHealth(
            "server:pgweb:health",
            15000,
            1000,
        );
        expect(finalPgwebHealth.isHealthy).toBe(true);

        await runCliCommand(
            "server:run-command",
            "up",
            Service.E_Service.WORLD_API_MANAGER,
            "-d",
        );

        const finalApiHealth = await checkHealth(
            "server:world-api-manager:health",
            30000,
            2000,
        );
        expect(finalApiHealth.isHealthy).toBe(true);

        await runCliCommand(
            "server:run-command",
            "up",
            Service.E_Service.WORLD_TICK_MANAGER,
            "-d",
        );

        const finalTickHealth = await checkHealth(
            "server:world-tick-manager:health",
            30000,
            2000,
        );
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
