import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
    generateDbSystemToken,
    invalidateDbSystemTokens,
    generateDbConnectionString,
    migrate,
    wipeDatabase,
    seed,
    isHealthy,
} from "../container/docker/docker_cli";
import { VircadiaConfig } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config";
import { PostgresClient } from "../database/postgres/postgres_client";
import { initContainers } from "./helper/helpers";

describe("System Admin Tests", () => {
    beforeAll(async () => {
        await initContainers();
    });

    afterAll(async () => {
        await PostgresClient.getInstance().disconnect();
    });

    test("System token generation and cleanup works", async () => {
        // Generate system token
        const token = await generateDbSystemToken();
        expect(token).toBeDefined();
        expect(token.token).toBeDefined();
        expect(token.sessionId).toBeDefined();
        expect(token.agentId).toBeDefined();

        // Clean up expired system tokens
        const cleanupResult = await invalidateDbSystemTokens();
        expect(cleanupResult).toBe(0);
    });

    test("Database connection string generation works", async () => {
        const connectionString = await generateDbConnectionString();
        expect(connectionString).toBeDefined();
        expect(connectionString).toContain("postgres://");
        expect(connectionString).toContain("@");
        expect(connectionString).toContain(":");
        expect(connectionString).toContain("/");
    });

    test("Database reset, migration, and seeding works", async () => {
        // Test reset
        await wipeDatabase();
        const healthAfterReset = await isHealthy();
        expect(healthAfterReset.services.postgres.isHealthy).toBe(true);
        expect(healthAfterReset.services.pgweb.isHealthy).toBe(true);

        // Verify database is accessible after reset
        const sql = await PostgresClient.getInstance().getSuperClient();
        const [result] = await sql`SELECT current_database()`;
        expect(result.current_database).toBeDefined();

        // Run migrations and seed
        const migrationsRan = await migrate();
        expect(migrationsRan).toBe(true);
        await seed({});
        // Check if config table has essential auth settings
        const [authConfig] = await sql<
            [{ auth_config__heartbeat_interval_ms: number }]
        >`
            SELECT auth_config__heartbeat_interval_ms FROM config.auth_config
        `;
        expect(authConfig).toBeDefined();
        expect(authConfig.auth_config__heartbeat_interval_ms).toBeDefined();

        // Verify database is still healthy after all operations
        const finalHealth = await isHealthy();
        expect(finalHealth.services.postgres.isHealthy).toBe(true);
        expect(finalHealth.services.pgweb.isHealthy).toBe(true);
    });

    test("Database extensions are properly installed", async () => {
        const sql = await PostgresClient.getInstance().getSuperClient();

        // Get list of installed extensions
        const extensions = await sql`
            SELECT extname FROM pg_extension
        `;

        // Verify required extensions are installed
        const requiredExtensions = VircadiaConfig.SERVER.POSTGRES.EXTENSIONS;
        for (const ext of requiredExtensions) {
            expect(extensions.some((e) => e.extname === ext)).toBe(true);
        }
    });

    test("Database schemas are properly created", async () => {
        const sql = await PostgresClient.getInstance().getSuperClient();

        // Get list of schemas
        const schemas = await sql`
            SELECT schema_name 
            FROM information_schema.schemata
            WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
        `;

        // Verify essential schemas exist
        const requiredSchemas = ["public", "auth", "entity", "tick", "config"];
        for (const schema of requiredSchemas) {
            expect(schemas.some((s) => s.schema_name === schema)).toBe(true);
        }
    });

    test("Superuser SQL connection works", async () => {
        const superUserSql =
            await PostgresClient.getInstance().getSuperClient();

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
        const proxyUserSql =
            await PostgresClient.getInstance().getProxyClient();

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
});
