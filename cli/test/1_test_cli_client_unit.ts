import { describe, expect, test, beforeAll } from "bun:test";
import { VircadiaConfig_BROWSER_CLIENT } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.browser.client.config";
import { runCliCommand } from "./helper/helpers";

describe("CLIENT Container and Database CLI Tests", () => {
    beforeAll(async () => {
        await runCliCommand("client:run-command", "up", "-d");
        Bun.sleep(1000);
    });

    test("Client container rebuild works", async () => {
        await runCliCommand("client:rebuild-all");
    });

    test("Client container down and up cycle works", async () => {
        await runCliCommand("client:run-command", "down");
        await runCliCommand(
            "client:run-command",
            "up",
            VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_CONTAINER_NAME,
            "-d",
        );
    });
});
