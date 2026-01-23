import { ContainerActionHandler } from "./action.handlers";
import { DependencyActionHandler } from "./dep.handlers";
import { resolveServices } from "./service.registry";
import { Logger } from "./utils";

export class InitActionHandler {
    static async handle(options: any) {
        Logger.info("Initializing Vircadia World environment...");

        const allServices = resolveServices(["all"]);
        
        // 1. Install dependencies
        Logger.info("\n--- Step 1: Installing Dependencies ---");
        await DependencyActionHandler.handle("install", allServices, options);

        // 2. Build modules
        Logger.info("\n--- Step 2: Building Modules ---");
        await DependencyActionHandler.handle("build", allServices, options);

        // 3. Start containers
        Logger.info("\n--- Step 3: Starting Containers ---");
        // We filter for "core" group implicitly by passing all services to ContainerActionHandler
        // which filters for infra/api/core categories.
        // Or we can explicitly resolve "core" or "infra" + "api".
        // The user said "launch the containers".
        // Passing 'all' services to ContainerActionHandler.handle('up') works as it filters for containers.
        await ContainerActionHandler.handle("up", allServices, options);

        Logger.success("\nInitialization completed successfully!");
    }
}
