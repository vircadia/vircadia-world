import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type postgres from "postgres";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import { createSqlClient, up } from "../container/docker/docker_cli";
import {
    createTestAccounts,
    cleanupTestAccounts,
    createTestResources,
    cleanupTestResources,
    type TestAccount,
    type TestResources,
} from "./test_helpers";

describe("Database Tests", () => {
    let sql: postgres.Sql;
    let admin: TestAccount;
    let agent: TestAccount;
    let testResources: TestResources;

    // Setup before all tests
    beforeAll(async () => {
        try {
            // Initialize database connection
            sql = createSqlClient(true);

            // Create test accounts
            const accounts = await createTestAccounts(sql);
            admin = accounts.admin;
            agent = accounts.agent;

            // Create test resources
            testResources = await createTestResources(sql);
        } catch (error) {
            log({
                message: "Failed to setup test environment.",
                type: "error",
                error,
            });
            throw error;
        }
    });

    afterAll(async () => {
        try {
            // Clean up test resources
            await cleanupTestResources(sql, testResources);

            // Clean up test accounts
            await cleanupTestAccounts(sql);

            // Close database connection
            await sql.end();
        } catch (error) {
            log({
                message: "Failed to cleanup test environment.",
                type: "error",
                error,
            });
            throw error;
        }
    });

    test("should receive direct PostgreSQL notifications for entity changes", async () => {
        const listenerSql = createSqlClient(true);

        try {
            // Start subscribing to notifications on the admin's session channel
            await listenerSql.subscribe(admin.sessionId, (notification) => {
                if (!notification) return;
                const payload = JSON.parse(notification.toString());
                expect(payload.type).toBe("entity");
                expect(payload.operation).toBe("UPDATE");
                expect(payload.id).toBe(testResources.entityId);
                expect(payload.sync_group).toBe("NORMAL");
                expect(payload.timestamp).toBeDefined();
            });

            // Set up a promise to wait for the notification
            const notificationPromise = new Promise<void>((resolve) => {
                listenerSql.subscribe(admin.sessionId, () => {
                    resolve();
                });
            });

            // Update the entity directly through SQL to trigger the notification
            await sql`
                UPDATE entity.entities 
                SET general__name = ${"Direct Update Test"}
                WHERE general__uuid = ${testResources.entityId}
            `;

            // Wait for the notification with a timeout
            await Promise.race([
                notificationPromise,
                new Promise((_, reject) =>
                    setTimeout(
                        () => reject(new Error("Notification timeout")),
                        5000,
                    ),
                ),
            ]);

            // Verify the update happened
            const [updatedEntity] = await sql`
                SELECT general__name 
                FROM entity.entities 
                WHERE general__uuid = ${testResources.entityId}
            `;
            expect(updatedEntity.general__name).toBe("Direct Update Test");
        } finally {
            // Clean up listener connection
            await listenerSql.end();
        }
    });

    test("should receive notifications for script changes", async () => {
        const listenerSql = createSqlClient(true);

        try {
            // Start subscribing to notifications on the admin's session channel
            await listenerSql.subscribe(admin.sessionId, (notification) => {
                if (!notification) return;
                const payload = JSON.parse(notification.toString());
                expect(payload.type).toBe("script");
                expect(payload.operation).toBe("UPDATE");
                expect(payload.id).toBe(testResources.scriptId);
                expect(payload.sync_group).toBe("NORMAL");
                expect(payload.timestamp).toBeDefined();
            });

            // Set up a promise to wait for the notification
            const notificationPromise = new Promise<void>((resolve) => {
                listenerSql.listen(admin.sessionId, () => {
                    resolve();
                });
            });

            // Update the script directly through SQL
            await sql`
                UPDATE entity.entity_scripts 
                SET compiled__web__node__script = ${"console.log('updated test script')"}
                WHERE general__script_id = ${testResources.scriptId}
            `;

            // Wait for the notification with a timeout
            await Promise.race([
                notificationPromise,
                new Promise((_, reject) =>
                    setTimeout(
                        () => reject(new Error("Notification timeout")),
                        5000,
                    ),
                ),
            ]);

            // Verify the update happened
            const [updatedScript] = await sql`
                SELECT compiled__web__node__script 
                FROM entity.entity_scripts 
                WHERE general__script_id = ${testResources.scriptId}
            `;
            expect(updatedScript.compiled__web__node__script).toBe(
                "console.log('updated test script')",
            );
        } finally {
            // Clean up listener connection
            await listenerSql.end();
        }
    });
});
