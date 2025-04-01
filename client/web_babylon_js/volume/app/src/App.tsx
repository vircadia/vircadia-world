import {
    type Component,
    onCleanup,
    onMount,
    createSignal,
    createEffect,
} from "solid-js";
import { Scene, WebGPUEngine } from "@babylonjs/core";
import { VircadiaBabylonCore } from "../../vircadia-world-sdk-ts/module/client/core/vircadia.babylon.core";
import { VircadiaConfig_BROWSER_CLIENT } from "../../vircadia-world-sdk-ts/config/vircadia.browser.client.config";

enum ConnectionState {
    Disconnected = "disconnected",
    Connecting = "connecting",
    Connected = "connected",
}

const App: Component = () => {
    let canvasRef: HTMLCanvasElement | undefined;
    let engine: WebGPUEngine;
    let scene: Scene;
    let vircadiaClient: VircadiaBabylonCore;
    const [connectionState, setConnectionState] = createSignal<ConnectionState>(
        ConnectionState.Disconnected,
    );

    // Define handleResize outside to make it accessible in onCleanup
    const handleResize = () => {
        if (engine) {
            engine.resize();
        }
    };

    onMount(async () => {
        if (!canvasRef) return;

        // Create a WebGPU engine
        engine = new WebGPUEngine(canvasRef);
        await engine.initAsync();

        // Create scene
        scene = new Scene(engine);

        // Initialize Vircadia client
        const serverUrl =
            VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI_USING_SSL
                ? `https://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}`
                : `http://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}`;

        vircadiaClient = new VircadiaBabylonCore({
            serverUrl,
            authToken:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN,
            authProvider: "local", // Using local auth provider
            scene,
            debug: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG,
            suppress:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_SUPPRESS,
        });

        // Connect to Vircadia server
        try {
            setConnectionState(ConnectionState.Connecting);
            await vircadiaClient.initialize();
            const connection = vircadiaClient.getConnectionManager();

            // Set up connection state tracker
            const checkConnectionStatus = () => {
                const connected = connection.isClientConnected();
                setConnectionState(
                    connected
                        ? ConnectionState.Connected
                        : ConnectionState.Disconnected,
                );

                if (connected) {
                    console.log("Connected to Vircadia server");
                } else {
                    console.log("Disconnected from Vircadia server");
                }
            };

            // Initial check
            checkConnectionStatus();

            // Periodically check connection status
            const connectionInterval = setInterval(checkConnectionStatus, 2000);

            // Make sure to clear the interval on cleanup
            onCleanup(() => {
                clearInterval(connectionInterval);
            });
        } catch (error) {
            console.error("Error connecting to Vircadia server:", error);
            setConnectionState(ConnectionState.Disconnected);
        }

        // Start the render loop
        engine.runRenderLoop(() => {
            scene.render();
        });

        // Handle window resize
        window.addEventListener("resize", handleResize);
    });

    // Create effect to respond to connection state changes
    createEffect(() => {
        console.log("Connection state changed:", connectionState());
    });

    onCleanup(() => {
        // Clean up resources
        if (vircadiaClient) {
            vircadiaClient.dispose();
            setConnectionState(ConnectionState.Disconnected);
        }

        if (engine) {
            engine.dispose();
        }

        window.removeEventListener("resize", handleResize);
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
            <div
                style={{
                    position: "absolute",
                    top: "10px",
                    right: "10px",
                    padding: "8px 12px",
                    "border-radius": "4px",
                    background:
                        connectionState() === ConnectionState.Connecting
                            ? "rgba(255, 165, 0, 0.7)"
                            : connectionState() === ConnectionState.Connected
                              ? "rgba(0, 128, 0, 0.7)"
                              : "rgba(255, 0, 0, 0.7)",
                    color: "white",
                    "font-size": "12px",
                    "font-weight": "bold",
                    transition: "background 0.3s ease",
                }}
            >
                {connectionState() === ConnectionState.Connecting
                    ? "Connecting..."
                    : connectionState() === ConnectionState.Connected
                      ? "Connected"
                      : "Disconnected"}
            </div>
        </div>
    );
};

export default App;
