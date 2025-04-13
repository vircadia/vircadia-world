import { describe, expect, test, beforeAll } from "bun:test";
import { Client_CLI } from "../vircadia.world.cli";
import { VircadiaConfig_BROWSER_CLIENT } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.browser.client.config";

describe("CLIENT Container and Database CLI Tests", () => {
    beforeAll(async () => {
        await Client_CLI.runClientDockerCommand({
            args: ["up", "-d"],
        });
        Bun.sleep(1000);
    });

    test("Client container rebuild works", async () => {
        await Client_CLI.runClientDockerCommand({
            args: ["down", "-v"],
        });
        await Client_CLI.runClientDockerCommand({
            args: [
                "up",
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_CONTAINER_NAME,
                "-d",
            ],
        });
        const prodHealthAfterUp = await Client_CLI.isWebBabylonJsHealthy({
            wait: {
                interval: 100,
                timeout: 10000,
            },
        });
        expect(prodHealthAfterUp.isHealthy).toBe(true);
    }, 30000);

    test("Client container down and up cycle works", async () => {
        await Client_CLI.runClientDockerCommand({
            args: ["down"],
        });
        const prodHealthAfterDown = await Client_CLI.isWebBabylonJsHealthy({
            wait: {
                interval: 100,
                timeout: 10000,
            },
        });
        expect(prodHealthAfterDown.isHealthy).toBe(false);
        await Client_CLI.runClientDockerCommand({
            args: [
                "up",
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_CONTAINER_NAME,
                "-d",
            ],
        });
        const prodHealthAfterUp = await Client_CLI.isWebBabylonJsHealthy({
            wait: {
                interval: 100,
                timeout: 10000,
            },
        });
        expect(prodHealthAfterUp.isHealthy).toBe(true);
    }, 20000);
});
