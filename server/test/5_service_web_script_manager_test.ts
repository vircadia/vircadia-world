import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import type postgres from "postgres";
import { PostgresClient } from "../database/postgres/postgres_client";
import { Entity } from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { isHealthy, up } from "../container/docker/docker_cli";

describe("Service -> Web Script Manager Tests", () => {
    let sql: postgres.Sql;
    let serverProcess: Subprocess;

    // Setup before all tests
    beforeAll(async () => {
        if (!(await isHealthy()).isHealthy) {
            await up(true);

            const healthyAfterUp = await isHealthy();
            if (!healthyAfterUp.isHealthy) {
                throw new Error("Failed to start services");
            }
        }
        await PostgresClient.getInstance().connect(true);
        sql = PostgresClient.getInstance().getClient();
        serverProcess = Bun.spawn(["bun", "run", "service:run:script"], {
            cwd: process.cwd(),
            stdio: ["inherit", "inherit", "inherit"],
            killSignal: "SIGTERM",
        });
    });

    describe("World Web Script Manager", () => {
        test("service should launch and become available", async () => {
            expect(serverProcess.pid).toBeGreaterThan(0);
        });

        test("should compile scripts for all platforms", async () => {
            // Insert test script
            const result = await sql`
                WITH inserted_script AS (
                    INSERT INTO entity.entity_scripts (
                        general__name,
                        group__sync,
                        source__repo__url,
                        source__repo__entry_path
                    ) 
                    VALUES (
                        'babylon_js->entity->model',
                        'public.STATIC',
                        'https://github.com/vircadia/vircadia-world-sdk-ts',
                        'script/babylon_js/entity_model.ts'
                    )
                    RETURNING general__script_id
                )
                SELECT general__script_id FROM inserted_script
            `;

            expect(result.length).toBe(1);
            const scriptId = result[0].general__script_id;
            expect(scriptId).toBeDefined();

            // Increase polling duration to match the 60s timeout
            const maxAttempts = 55; // 55 seconds total (leaving 5s buffer for other operations)
            let attempts = 0;
            let status = {
                compiled__browser__status:
                    Entity.Script.E_CompilationStatus.PENDING,
                compiled__node__status:
                    Entity.Script.E_CompilationStatus.PENDING,
                compiled__bun__status:
                    Entity.Script.E_CompilationStatus.PENDING,
            };

            while (attempts < maxAttempts) {
                const compilationResult = await sql<
                    Pick<
                        Entity.Script.I_Script,
                        | "compiled__browser__status"
                        | "compiled__node__status"
                        | "compiled__bun__status"
                    >[]
                >`
                    SELECT 
                        compiled__browser__status as "compiled__browser__status",
                        compiled__node__status as "compiled__node__status",
                        compiled__bun__status as "compiled__bun__status"
                    FROM entity.entity_scripts 
                    WHERE general__script_id = ${scriptId}
                `;

                if (!compilationResult[0]) {
                    throw new Error("No compilation result found");
                }

                status = {
                    compiled__browser__status:
                        compilationResult[0].compiled__browser__status ??
                        Entity.Script.E_CompilationStatus.PENDING,
                    compiled__node__status:
                        compilationResult[0].compiled__node__status ??
                        Entity.Script.E_CompilationStatus.PENDING,
                    compiled__bun__status:
                        compilationResult[0].compiled__bun__status ??
                        Entity.Script.E_CompilationStatus.PENDING,
                };

                // If any platform is still compiling or pending, wait
                if (
                    Object.values(status).some(
                        (s) =>
                            s === Entity.Script.E_CompilationStatus.COMPILING ||
                            s === Entity.Script.E_CompilationStatus.PENDING,
                    )
                ) {
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    attempts++;
                    continue;
                }

                // If all platforms are either COMPILED, break
                break;
            }

            // Log detailed status for debugging
            console.log("Final compilation status:", status);

            // Check compilation status for all platforms
            expect(status.compiled__browser__status).toBe(
                Entity.Script.E_CompilationStatus.COMPILED,
            );
            expect(status.compiled__node__status).toBe(
                Entity.Script.E_CompilationStatus.COMPILED,
            );
            expect(status.compiled__bun__status).toBe(
                Entity.Script.E_CompilationStatus.COMPILED,
            );
        }, 60000);
    });

    afterAll(async () => {
        // Kill the server process and its children
        if (serverProcess.pid) {
            try {
                // First try to kill the process directly
                serverProcess.kill("SIGTERM");
                // Then try to kill the process group as fallback
                try {
                    process.kill(-serverProcess.pid, "SIGTERM");
                } catch (e) {
                    // Ignore error if process group doesn't exist
                }
            } catch (error) {
                console.error("Error killing process:", error);
            }
        }
        await PostgresClient.getInstance().disconnect();
    });
});
