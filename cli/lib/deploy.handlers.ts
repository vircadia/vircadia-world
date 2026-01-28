import React from 'react';
import { render } from 'ink';
import { Deploy } from '../ui/Deploy';
import { Logger } from './utils';
import { EnvManager } from './common.modules';
import { ContainerActionHandler } from './action.handlers';
import { resolveServices } from './service.registry';
import { ConfigActionHandler } from './config.handlers';

export class DeployActionHandler {
    static async handle(options: any) {
        // 1. Check if flags are present for non-interactive mode
        if (options.local || options.prod) {
            await this.handleNonInteractive(options);
            return;
        }

        // 2. Interactive mode using Ink
        // We need a promise to wait for the UI to complete
        await new Promise<void>((resolve, reject) => {
            const { unmount } = render(
                React.createElement(Deploy, {
                    onConfigComplete: async (config) => {
                        try {
                            await this.applyConfigAndDeploy(config);
                            // Give some time for the success message
                            // The component handles exit() but we resolve here? 
                            // Ink's render returns an instance, but it doesn't await the app finish.
                            // However, we pass an async callback which does the heavy lifting.
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    }
                })
            );
             // Note: in a real CLI app we usually wait for 'waitUntilExit' if available or just let the component handle process.exit
             // But here we want to return control to the caller if needed.
             // Ink 3+ 'render' returns { waitUntilExit }
        });
    }

    private static async handleNonInteractive(options: any) {
        if (options.local) {
            Logger.info("Deploying in Local Development mode...");
            // Use existing logic from config handler to set env
            // We can actually reuse ConfigActionHandler logic if we expose it or just call setVariable directly
            // Leveraging ConfigActionHandler.handleTls logic would be best to DRY.
            // But ConfigActionHandler expects args array.
            
            // Let's set manually for precision
            await EnvManager.setVariable("VRCA_SERVER_SERVICE_CADDY_DOMAIN", "http://localhost", "cli");
            await EnvManager.unsetVariable("VRCA_SERVER_SERVICE_CADDY_TLS_MODE", "cli");
        } else if (options.prod) {
            Logger.info("Deploying in Production mode...");
            // For prod flag without interactive, we might need a domain.
            // Check if domain provided?
            if (options.domain) {
                 await EnvManager.setVariable("VRCA_SERVER_SERVICE_CADDY_DOMAIN", options.domain, "cli");
                 await EnvManager.setVariable("VRCA_SERVER_SERVICE_CADDY_TLS_MODE", "auto", "cli");
            } else {
                // Check if already set
                const currentDomain = await EnvManager.getVariable("VRCA_SERVER_SERVICE_CADDY_DOMAIN", "cli");
                if (currentDomain && !currentDomain.startsWith("http")) {
                    // Assume it's valid
                    Logger.info(`Using existing domain: ${currentDomain}`);
                     await EnvManager.setVariable("VRCA_SERVER_SERVICE_CADDY_TLS_MODE", "auto", "cli");
                } else {
                    Logger.error("Domain required for production deploy. Use --domain <example.com> or interactive mode.");
                    return;
                }
            }
        }
        
        await this.startContainers();
    }

    private static async applyConfigAndDeploy(config: { env: 'local' | 'prod' | null, domain: string, tlsMode: string }) {
        if (config.env === 'local') {
             await EnvManager.setVariable("VRCA_SERVER_SERVICE_CADDY_DOMAIN", config.domain, "cli");
             await EnvManager.unsetVariable("VRCA_SERVER_SERVICE_CADDY_TLS_MODE", "cli");
        } else {
             await EnvManager.setVariable("VRCA_SERVER_SERVICE_CADDY_DOMAIN", config.domain, "cli");
             if (config.tlsMode) {
                 await EnvManager.setVariable("VRCA_SERVER_SERVICE_CADDY_TLS_MODE", config.tlsMode, "cli");
             } else {
                 await EnvManager.unsetVariable("VRCA_SERVER_SERVICE_CADDY_TLS_MODE", "cli");
             }
        }
        
        await this.startContainers();
    }

    private static async startContainers() {
        // Start core services
        // Typically 'core' group
        const services = resolveServices(["core"]);
        // We probably want to up them.
        await ContainerActionHandler.handle("up", services, { d: true });
    }
}
