import { type Engine, NullEngine, Scene } from "@babylonjs/core";
import { VircadiaConfig_Client } from "../../../sdk/vircadia-world-sdk-ts/config/vircadia.client.config";
import { log } from "../../../sdk/vircadia-world-sdk-ts/module/general/log";

let scene: Scene | null = null;
let authToken: string | null = null;

async function createHeadlessEngine(): Promise<Engine> {
    return new NullEngine();
}

async function connect(url: string, sessionToken?: string): Promise<void> {
    try {
        // Verify session is valid using the auth service
        const response = await fetch(`${url}/services/world-auth/validate`, {
            headers: sessionToken
                ? {
                      Authorization: `Bearer ${sessionToken}`,
                  }
                : {},
        });

        if (!response.ok) throw new Error("Invalid session");

        const { valid, agentId } = await response.json();
        if (!valid) throw new Error("Invalid session");

        authToken = sessionToken || null;

        log({
            message: `World connected successfully [${url}]`,
            type: "info",
        });
    } catch (error) {
        log({
            message: `Failed to connect to world [${url}]: ${error}`,
            type: "error",
        });
        await destroy();
        throw error;
    }
}

async function login(email: string, password: string): Promise<void> {
    try {
        const response = await fetch(
            `${VircadiaConfig_Client.defaultWorldServerUrl}/services/world-auth/login`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ email, password }),
            },
        );

        if (!response.ok) throw new Error("Login failed");

        const { token } = await response.json();
        authToken = token;

        log({
            message: "Login successful",
            type: "info",
        });
    } catch (error) {
        log({
            message: `Login failed: ${error}`,
            type: "error",
        });
        throw error;
    }
}

async function destroy() {
    try {
        if (authToken) {
            // Logout from the auth service
            await fetch(
                `${VircadiaConfig_Client.defaultWorldServerUrl}/services/world-auth/logout`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${authToken}`,
                    },
                },
            );
            authToken = null;
        }

        scene?.dispose();
        scene = null;

        log({
            message: "World destroyed successfully",
            type: "info",
        });
    } catch (error) {
        log({
            message: `Error destroying world: ${error}`,
            type: "error",
        });
        throw error;
    }
}

async function initializeClientCore() {
    try {
        const engine = await createHeadlessEngine();
        scene = new Scene(engine);

        await connect(VircadiaConfig_Client.defaultWorldServerUrl);

        // Optional login if credentials are provided
        if (
            VircadiaConfig_Client.defaultWorldAccountUsername &&
            VircadiaConfig_Client.defaultWorldAccountPassword
        ) {
            await login(
                VircadiaConfig_Client.defaultWorldAccountUsername,
                VircadiaConfig_Client.defaultWorldAccountPassword,
            );
        }

        log({
            message: "Client core initialized successfully",
            type: "info",
        });
    } catch (error) {
        log({
            message: `Failed to initialize client core: ${error}`,
            type: "error",
        });
        throw error;
    }
}

// Initialize and start services
async function startServices() {
    try {
        await initializeClientCore();

        log({
            message: "All services started successfully",
            type: "info",
        });
    } catch (error) {
        log({
            message: `Failed to start services: ${
                error instanceof Error ? error.message : JSON.stringify(error)
            }`,
            type: "error",
        });
    }
}

startServices();
