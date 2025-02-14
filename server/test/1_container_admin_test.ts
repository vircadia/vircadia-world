import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
    generateDbSystemToken,
    generateDbConnectionString,
    migrate,
    softResetDatabase,
    seed,
    up,
    isHealthy,
} from "../container/docker/docker_cli";
import { VircadiaConfig_Server } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config";
import type { Config } from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
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
        await PostgresClient.getInstance().connect();
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
        const sql = PostgresClient.getInstance().getClient();
        const [result] = await sql`SELECT auth.cleanup_system_tokens()`;
        expect(result.cleanup_system_tokens).toBeDefined();
    });

    test("Database connection string generation works", async () => {
        const connectionString = await generateDbConnectionString();
        expect(connectionString).toBeDefined();
        expect(connectionString).toContain("postgres://");
        expect(connectionString).toContain("@");
        expect(connectionString).toContain(":");
        expect(connectionString).toContain("/");
    });

    test("Database migrations can be reapplied", async () => {
        await migrate({});
        // If we reach here without errors, migrations worked
        expect(true).toBe(true);
    });

    test("Soft reset database works", async () => {
        await softResetDatabase();
        // Verify database is accessible after reset
        const sql = PostgresClient.getInstance().getClient();
        const [result] = await sql`SELECT current_database()`;
        expect(result.current_database).toBeDefined();
    });

    test("Database seeding works", async () => {
        // Run seeds
        await seed({});

        // Verify some expected seed data exists
        const sql = PostgresClient.getInstance().getClient();
        // Check if config table has essential auth settings
        const [authConfig] = await sql<[Config.I_Config<"auth">]>`
            SELECT general__value FROM config.config 
            WHERE general__key = 'auth'
        `;
        expect(authConfig).toBeDefined();
        expect(authConfig.general__value.jwt_secret).toBeDefined();
    });

    test("System agent exists and has correct permissions", async () => {
        const sql = PostgresClient.getInstance().getClient();

        // Get system agent ID
        const [systemId] = await sql`SELECT auth.get_system_agent_id()`;
        expect(systemId.get_system_agent_id).toBeDefined();

        // Verify system agent exists and is admin
        const [agentCheck] = await sql`
            SELECT 
                auth__is_admin,
                auth.is_system_agent(general__agent_profile_id) as is_system
            FROM auth.agent_profiles
            WHERE general__agent_profile_id = ${systemId.get_system_agent_id}
        `;

        expect(agentCheck.auth__is_admin).toBe(true);
        expect(agentCheck.is_system).toBe(true);
    });

    test("Database extensions are properly installed", async () => {
        const sql = PostgresClient.getInstance().getClient();

        // Get list of installed extensions
        const extensions = await sql`
            SELECT extname FROM pg_extension
        `;

        // Verify required extensions are installed
        const requiredExtensions = VircadiaConfig_Server.postgres.extensions;
        for (const ext of requiredExtensions) {
            expect(extensions.some((e) => e.extname === ext)).toBe(true);
        }
    });

    test("Database schemas are properly created", async () => {
        const sql = PostgresClient.getInstance().getClient();

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
        const sql = PostgresClient.getInstance().getClient();

        // Check for essential roles
        const [roles] = await sql`
            SELECT r.rolname
            FROM pg_roles r
            WHERE r.rolname = ${VircadiaConfig_Server.postgres.user}
        `;
        expect(roles).toBeDefined();

        // Check role has proper permissions
        const [permissions] = await sql`
            SELECT has_database_privilege(
                ${VircadiaConfig_Server.postgres.user}, 
                ${VircadiaConfig_Server.postgres.database}, 
                'CREATE'
            ) as has_permission
        `;
        expect(permissions.has_permission).toBe(true);
    });

    test("Database cleanup functions are working", async () => {
        const sql = PostgresClient.getInstance().getClient();

        // Clean up old sessions
        const [sessionCleanup] = await sql`SELECT auth.cleanup_old_sessions()`;
        expect(sessionCleanup.cleanup_old_sessions).toBeDefined();

        // Clean up system tokens
        const [systemCleanup] = await sql`SELECT auth.cleanup_system_tokens()`;
        expect(systemCleanup.cleanup_system_tokens).toBeDefined();
    });
});
