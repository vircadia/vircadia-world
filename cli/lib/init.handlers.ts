import { ContainerActionHandler } from "./action.handlers";
import { DependencyActionHandler } from "./dep.handlers";
import { resolveServices } from "./service.registry";
import { Logger } from "./utils";
import { Server_CLI } from "./common.modules";

export class InitActionHandler {
    static async handle(options: any) {
        Logger.info("Initializing Vircadia World environment...");

        const allServices = resolveServices(["all"]);
        const postgresService = resolveServices(["postgres"]);
        const coreServicesWithoutPostgres = resolveServices(["core"]).filter(
            s => s.name !== "postgres"
        );
        
        // 1. Install dependencies
        Logger.info("\n--- Step 1: Installing Dependencies ---");
        await DependencyActionHandler.handle("install", allServices, options);

        // 2. Build modules
        Logger.info("\n--- Step 2: Building Modules ---");
        await DependencyActionHandler.handle("build", allServices, options);

        // 3. Start postgres only (using basic health check - just pg_isready)
        Logger.info("\n--- Step 3: Starting PostgreSQL ---");
        await Server_CLI.runServerDockerCommand({ 
            args: ["up", "-d", "vircadia_world_postgres"] 
        });
        
        // 4. Wait for postgres to be ready (basic connectivity, not full healthcheck)
        Logger.info("\n--- Step 4: Waiting for PostgreSQL to be ready ---");
        await this.waitForPostgresReady();

        // 5. Run database migrations
        Logger.info("\n--- Step 5: Running Database Migrations ---");
        await Server_CLI.migrate();

        // 6. Run database seeds (SQL and assets)  
        Logger.info("\n--- Step 6: Seeding Database ---");
        await Server_CLI.seedSql();
        // Asset seeding
        await Server_CLI.seedAssets({});

        // 7. Mark database as ready (sets setup_timestamp so healthcheck passes)
        Logger.info("\n--- Step 7: Marking Database as Ready ---");
        await Server_CLI.markDatabaseAsReady();

        // 8. Start remaining containers (they will now see postgres as healthy)
        Logger.info("\n--- Step 8: Starting Remaining Services ---");
        await ContainerActionHandler.handle("up", coreServicesWithoutPostgres, options);

        Logger.success("\nInitialization completed successfully!");
    }

    /**
     * Wait for postgres to accept connections (basic pg_isready check)
     * This is separate from the full healthcheck which requires the database to be set up
     */
    private static async waitForPostgresReady(
        maxRetries: number = 30,
        intervalMs: number = 2000
    ): Promise<void> {
        for (let i = 0; i < maxRetries; i++) {
            try {
                // Use docker exec to run pg_isready inside the container
                const result = await Server_CLI.runServerDockerCommand({
                    args: [
                        "exec", 
                        "vircadia_world_postgres", 
                        "pg_isready", 
                        "-U", 
                        "postgres"
                    ],
                    throwOnNonZeroExec: true
                });
                Logger.success("PostgreSQL is ready!");
                return;
            } catch (error) {
                Logger.debug(`Waiting for PostgreSQL... (${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, intervalMs));
            }
        }
        throw new Error("PostgreSQL failed to become ready within timeout");
    }
}
