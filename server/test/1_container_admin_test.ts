import { describe, expect, test } from "bun:test";
import {
    generateDbSystemToken,
    createSqlClient,
    generateDbConnectionString,
    migrate,
    softResetDatabase,
    seed,
} from "../container/docker/docker_cli";
import { VircadiaConfig_Server } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config";

describe("System Admin Tests", () => {
    test("System token generation and cleanup works", async () => {
        // Generate system token
        const token = await generateDbSystemToken();
        expect(token).toBeDefined();
        expect(token.token).toBeDefined();
        expect(token.sessionId).toBeDefined();
        expect(token.agentId).toBeDefined();

        // Clean up expired system tokens
        const sql = createSqlClient(true);
        const [result] = await sql`SELECT auth.cleanup_system_tokens()`;
        expect(result.cleanup_system_tokens).toBeDefined();
        await sql.end();
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
        await migrate({ silent: true });
        // If we reach here without errors, migrations worked
        expect(true).toBe(true);
    });

    test("Soft reset database works", async () => {
        await softResetDatabase(true);
        // Verify database is accessible after reset
        const sql = createSqlClient(true);
        const [result] = await sql`SELECT current_database()`;
        expect(result.current_database).toBeDefined();
        await sql.end();
    });

    test("Database seeding works", async () => {
        // Run seeds
        await seed({ silent: true });

        // Verify some expected seed data exists
        const sql = createSqlClient(true);
        // Check if config table has essential auth settings
        const [authSecret] = await sql`
            SELECT general__value FROM config.config 
            WHERE general__key = 'auth__secret_jwt'
        `;
        expect(authSecret.general__value).toBeDefined();
        await sql.end();
    });

    test("System agent exists and has correct permissions", async () => {
        const sql = createSqlClient(true);

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

        await sql.end();
    });

    test("Database extensions are properly installed", async () => {
        const sql = createSqlClient(true);

        // Get list of installed extensions
        const extensions = await sql`
            SELECT extname FROM pg_extension
        `;

        // Verify required extensions are installed
        const requiredExtensions = VircadiaConfig_Server.postgres.extensions;
        for (const ext of requiredExtensions) {
            expect(extensions.some((e) => e.extname === ext)).toBe(true);
        }

        await sql.end();
    });

    test("Database schemas are properly created", async () => {
        const sql = createSqlClient(true);

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

        await sql.end();
    });

    test("Database tables are properly created", async () => {
        const sql = createSqlClient(true);

        // Check for essential tables in each schema
        const tableChecks = [
            { schema: "auth", table: "agent_profiles" },
            { schema: "auth", table: "agent_sessions" },
            { schema: "config", table: "config" },
            { schema: "config", table: "migrations" },
            { schema: "config", table: "seeds" },
            { schema: "entity", table: "entities" },
        ];

        for (const check of tableChecks) {
            const [exists] = await sql`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = ${check.schema}
                    AND table_name = ${check.table}
                ) as exists
            `;
            expect(exists.exists).toBe(true);
        }

        await sql.end();
    });

    test("Database roles and permissions are properly set", async () => {
        const sql = createSqlClient(true);

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

        await sql.end();
    });

    test("Database cleanup functions are working", async () => {
        const sql = createSqlClient(true);

        // Clean up old sessions
        const [sessionCleanup] = await sql`SELECT auth.cleanup_old_sessions()`;
        expect(sessionCleanup.cleanup_old_sessions).toBeDefined();

        // Clean up system tokens
        const [systemCleanup] = await sql`SELECT auth.cleanup_system_tokens()`;
        expect(systemCleanup.cleanup_system_tokens).toBeDefined();

        await sql.end();
    });
});
