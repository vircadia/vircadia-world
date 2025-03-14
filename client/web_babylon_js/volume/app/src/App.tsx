import { type Component, onCleanup, onMount } from "solid-js";
import { Scene, WebGPUEngine } from "@babylonjs/core";
import { VircadiaBabylonCore } from "../../vircadia-world-sdk-ts/module/client/core/vircadia.babylon.core";
import { VircadiaConfig } from "../../vircadia-world-sdk-ts/config/vircadia.config";

const App: Component = () => {
    let canvasRef: HTMLCanvasElement | undefined;
    let engine: WebGPUEngine;
    let scene: Scene;
    let vircadiaClient: VircadiaBabylonCore;

    onMount(async () => {
        if (!canvasRef) return;

        // Create a WebGPU engine
        engine = new WebGPUEngine(canvasRef);
        await engine.initAsync();

        // Create scene
        scene = new Scene(engine);

        // Initialize Vircadia client
        const serverUrl = VircadiaConfig.CLIENT
            .VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_SERVER_URI_USING_SSL
            ? `https://${VircadiaConfig.CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_SERVER_URI}`
            : `http://${VircadiaConfig.CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_SERVER_URI}`;

        vircadiaClient = new VircadiaBabylonCore({
            serverUrl,
            authToken:
                VircadiaConfig.CLIENT
                    .VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN,
            authProvider: "local", // Using local auth provider
            engine,
            scene,
            debug: VircadiaConfig.CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG,
            suppress: VircadiaConfig.CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_SUPPRESS,
        });

        // Connect to Vircadia server
        try {
            const connected = await vircadiaClient.connect();
            console.log(
                "Connection status:",
                connected ? "Connected" : "Failed to connect",
            );
        } catch (error) {
            console.error("Error connecting to Vircadia server:", error);
        }

        // Start the render loop
        engine.runRenderLoop(() => {
            scene.render();
        });

        // Handle window resize
        window.addEventListener("resize", () => {
            engine.resize();
        });
    });

    onCleanup(() => {
        // Clean up resources
        if (vircadiaClient) {
            vircadiaClient.dispose();
        }

        if (engine) {
            engine.dispose();
        }

        window.removeEventListener("resize", () => {
            engine.resize();
        });
    });

    return (
        <div>
            <canvas
                ref={canvasRef}
                style={{
                    width: "100%",
                    height: "100vh",
                    display: "block",
                    "touch-action": "none",
                }}
            />
        </div>
    );
};

export default App;
