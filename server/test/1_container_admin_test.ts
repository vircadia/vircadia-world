import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
    generateDbSystemToken,
    invalidateDbSystemTokens,
    generateDbConnectionString,
    migrate,
    wipeDatabase,
    seed,
    up,
    isHealthy,
} from "../container/docker/docker_cli";
import { VircadiaConfig } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config";
import { PostgresClient } from "../database/postgres/postgres_client";

describe("System Admin Tests", () => {
    beforeAll(async () => {
        if (!(await isHealthy()).isHealthy) {
            await up();

            const healthyAfterUp = await isHealthy();
            if (!healthyAfterUp.isHealthy) {
                throw new Error("Failed to start services");
            }
        }
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

    test("Database roles and permissions are properly set", async () => {
        const sql = await PostgresClient.getInstance().getSuperClient();

        // Check for essential roles
        const [roles] = await sql`
            SELECT r.rolname
            FROM pg_roles r
            WHERE r.rolname = ${VircadiaConfig.SERVER.POSTGRES.USER}
        `;
        expect(roles).toBeDefined();

        // Check role has proper permissions
        const [permissions] = await sql`
            SELECT has_database_privilege(
                ${VircadiaConfig.SERVER.POSTGRES.USER}, 
                ${VircadiaConfig.SERVER.POSTGRES.DATABASE}, 
                'CREATE'
            ) as has_permission
        `;
        expect(permissions.has_permission).toBe(true);
    });
});
