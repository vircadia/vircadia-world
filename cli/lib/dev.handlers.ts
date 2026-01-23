import { Logger, runShellCommand } from "./utils";
import { EnvManager } from "./common.modules";
import { ContainerActionHandler } from "./action.handlers";
import { resolveServices } from "./service.registry";
import { DependencyActionHandler } from "./dep.handlers";

export class DevActionHandler {
    static async handle(options: any) {
        Logger.info("Starting development environment...");

        // If --local flag is passed, we orchestrate the local dev environment
        if (options.local) {
            await this.startLocalDev(options);
        } else {
            // Default behavior if we just want to run 'dev' on something? 
            // Currently 'bun cli dev' implies the full stack dev mode (client + caddy config)
            // But maybe we should default to that behavior anyway if no args?
            // For now, let's assume 'dev' without args is just starting client dev without special caddy config? 
            // Or should it be the same? 
            // The original package.json had "dev": "bun run cli client dev", which didn't have --local.
            // "dev:local": "bun run cli client dev --local".
            // So if we run "bun cli dev", we probably want to support the same behavior.
            
            // Let's just run the client dev default for now if no --local, 
            // effectively aliasing `bun cli client dev`.
            const clientService = resolveServices(["client"]);
            if (clientService.length > 0) {
                 await DependencyActionHandler.handle("dev", clientService, options);
            }
        }
    }

    private static async startLocalDev(options: any) {
        // Orthogonal to specific service 'dev' command, this orchestrates the environment.
        // 1. Configure Caddy for local TLS
        // 2. Start Client with local config
        
        Logger.info("Configuring environment for local development...");

        // Capture original state
        const originalTlsMode = await EnvManager.getVariable("VRCA_SERVER_SERVICE_CADDY_TLS_MODE", "cli");
        
        const cleanup = async () => {
            Logger.info("\nReverting Caddy TLS mode...");
            if (originalTlsMode !== undefined) {
                    await EnvManager.setVariable("VRCA_SERVER_SERVICE_CADDY_TLS_MODE", originalTlsMode, "cli");
            } else {
                    await EnvManager.unsetVariable("VRCA_SERVER_SERVICE_CADDY_TLS_MODE", "cli");
            }
            // We don't necessarily need to rebuild caddy on exit, just reset the var.
            // Next time it starts or rebuilds it will pick it up. 
            // But to be clean we might want to? 
            // For speed, let's skip rebuild on exit for now, strictly revert the config.
        };

        // Set Caddy to local/internal TLS mode in .env
        await EnvManager.setVariable("VRCA_SERVER_SERVICE_CADDY_TLS_MODE", "tls internal", "cli");
        
        // Rebuild Caddy to apply changes
        Logger.info("Rebuilding Caddy for local development...");
        const caddyService = resolveServices(["caddy"]);
        if (caddyService.length > 0) {
                await ContainerActionHandler.handle("rebuild", caddyService, options);
        }

        // Now start the client dev
        // We need to inject the client specific env vars for local too. 
        // We can pass `local: true` to the dependency handler or handle it here?
        // The DependencyHandler.dev uses options.local to inject vars. 
        // Let's reuse that logic by calling DependencyActionHandler.
        
        const clientService = resolveServices(["client"]);
        
        // We need to handle the signal here to ensure cleanup happens because DependencyActionHandler
        // will capture the signal but we also need to run OUR cleanup.
        // Actually DependencyActionHandler.dev also processes signal. 
        // If we call it, it will block until it finishes.
        
        // To make sure OUR cleanup runs, we should hook the process events BEFORE calling the client dev,
        // or wrap the call in a try/finally block assuming the inner call propagates exit or returns on signal?
        // runShellCommand usually throws or returns on exit.
        
        // Let's attach our cleanup to SIGINT/SIGTERM as well, but we need to coordinate with the inner one.
        // A simple way is to rely on the finally block of THIS function if we await the inner one.
        
        const sigHandler = async () => {
             // If we receive SIGINT, we largely expect the child process to handle it and exit,
             // which causes the await below to finish. 
             // But if we need to force it:
        };
        
        process.on("SIGINT", sigHandler);

        try {
            // We pass the options through. DependencyActionHandler will see 'local' and set client env vars.
            await DependencyActionHandler.handle("dev", clientService, options);
        } catch (e) {
            // ignore
        } finally {
            process.off("SIGINT", sigHandler);
            await cleanup();
        }
    }
}
