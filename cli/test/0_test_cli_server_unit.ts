import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { VircadiaConfig_CLI } from "../vircadia.cli.config";
import { PostgresClient } from "../../sdk/vircadia-world-sdk-ts/src/client/module/bun/vircadia.client.bun.postgres";
import { VircadiaConfig_SERVER } from "../../sdk/vircadia-world-sdk-ts/src/server/config/vircadia.server.config";
import { Service } from "../../sdk/vircadia-world-sdk-ts/src/schema/vircadia.schema.general";
import { runCliCommand } from "./helper/helpers";
import { existsSync, statSync, unlinkSync } from "node:fs";

describe("Container ops tests", () => {
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

    describe("Build tests", () => {
        test("Docker container rebuild works", async () => {
            await runCliCommand("server:rebuild-all");
        }, 120000);

        test("Docker container down and up cycle works", async () => {
            await runCliCommand("server:run-command", "down");

            await runCliCommand(
                "server:run-command",
                "up",
                Service.E_Service.POSTGRES,
                "-d",
            );

            await runCliCommand(
                "server:run-command",
                "up",
                Service.E_Service.PGWEB,
                "-d",
            );

            await runCliCommand(
                "server:run-command",
                "up",
                Service.E_Service.WORLD_API_MANAGER,
                "-d",
            );

            await runCliCommand(
                "server:run-command",
                "up",
                Service.E_Service.WORLD_TICK_MANAGER,
                "-d",
            );
        }, 120000);
    });

    describe("Database CLI tests", () => {
        test("System token generation and cleanup works", async () => {
            const { stdout: tokenResult } = await runCliCommand(
                "server:postgres:system-token",
                "true",
            );
            expect(tokenResult).toBeDefined();
            expect(tokenResult.length).toBeGreaterThan(0);

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
                    database:
                        VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
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
                    database:
                        VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
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

            const { exitCode: migrateExitCode } = await runCliCommand(
                "server:postgres:migrate",
            );
            expect(migrateExitCode).toBe(0);

            await runCliCommand("server:postgres:seed:sql");
            await runCliCommand("server:postgres:seed:assets");

            await runCliCommand(
                "server:run-command",
                "up",
                Service.E_Service.PGWEB,
                "-d",
            );

            await runCliCommand(
                "server:run-command",
                "up",
                Service.E_Service.WORLD_API_MANAGER,
                "-d",
            );

            await runCliCommand(
                "server:run-command",
                "up",
                Service.E_Service.WORLD_TICK_MANAGER,
                "-d",
            );
        }, 120000);

        test("Database extensions are properly installed", async () => {
            const sql = await PostgresClient.getInstance({
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            }).getSuperClient({
                postgres: {
                    host: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                    port: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                    database:
                        VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
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

        test("Database backup command writes backup file", async () => {
            const backupPath =
                VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_BACKUP_FILE;
            if (existsSync(backupPath)) {
                unlinkSync(backupPath);
            }
            const { exitCode, stdout } = await runCliCommand(
                "server:postgres:backup",
            );
            expect(exitCode).toBe(0);
            expect(existsSync(backupPath)).toBe(true);
            const size = statSync(backupPath).size;
            expect(size).toBeGreaterThan(0);
        }, 15000);

        test("Database restore command runs successfully", async () => {
            const { exitCode, stdout } = await runCliCommand(
                "server:postgres:restore",
            );
            expect(exitCode).toBe(0);
        }, 15000);

        test("Database backup and restore round-trip preserves data", async () => {
            // Connect as superuser
            const sql = await PostgresClient.getInstance({
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            }).getSuperClient({
                postgres: {
                    host: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                    port: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                    database:
                        VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                    username:
                        VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                    password:
                        VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
                },
            });
            // Count rows before backup
            const [{ count: initialCount }] =
                await sql`SELECT COUNT(*)::int AS count FROM config.seeds`;
            // Backup
            const { exitCode: bkCode } = await runCliCommand(
                "server:postgres:backup",
            );
            expect(bkCode).toBe(0);
            // Truncate data
            await sql`TRUNCATE config.seeds`;
            const [{ count: truncatedCount }] =
                await sql`SELECT COUNT(*)::int AS count FROM config.seeds`;
            expect(truncatedCount).toBe(0);
            // Restore
            const { exitCode: rsCode } = await runCliCommand(
                "server:postgres:restore",
            );
            expect(rsCode).toBe(0);
            // Verify data restored
            const [{ count: restoredCount }] =
                await sql`SELECT COUNT(*)::int AS count FROM config.seeds`;
            expect(restoredCount).toBe(initialCount);
        }, 30000);
    });
});
