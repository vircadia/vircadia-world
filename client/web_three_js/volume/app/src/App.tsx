import {
    type Component,
    onCleanup,
    onMount,
    createSignal,
    createEffect,
} from "solid-js";
import * as THREE from "three";
import { VircadiaThreeCore } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/vircadia.three.core";
import { VircadiaConfig_BROWSER_CLIENT } from "../../../../../sdk/vircadia-world-sdk-ts/config/vircadia.browser.client.config";
import { Communication } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { log } from "../../../../../sdk/vircadia-world-sdk-ts/module/general/log";

enum ConnectionState {
    Disconnected = "disconnected",
    Connecting = "connecting",
    Connected = "connected",
}

const App: Component = () => {
    let canvasRef: HTMLCanvasElement | undefined;
    let renderer: THREE.WebGLRenderer;
    let scene: THREE.Scene;
    let vircadiaClient: VircadiaThreeCore;
    const [connectionState, setConnectionState] = createSignal<ConnectionState>(
        ConnectionState.Disconnected,
    );

    // Define handleResize outside to make it accessible in onCleanup
    const handleResize = () => {
        if (renderer) {
            const width = window.innerWidth;
            const height = window.innerHeight;
            renderer.setSize(width, height);
        }
    };

    // Store interval reference at component level
    let connectionInterval: ReturnType<typeof setInterval> | undefined;
    let animationFrameId: number;

    onMount(async () => {
        if (!canvasRef) return;

        // Initialize Three.js
        renderer = new THREE.WebGLRenderer({
            canvas: canvasRef,
            antialias: true,
        });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);

        // Create scene
        scene = new THREE.Scene();

        // Initialize Vircadia client
        const serverUrl =
            VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEFAULT_WORLD_API_URI_USING_SSL
                ? `https://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`
                : `http://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`;

        vircadiaClient = new VircadiaThreeCore({
            serverUrl,
            authToken:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG_SESSION_TOKEN,
            authProvider:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG_SESSION_TOKEN_PROVIDER,
            scene,
            debug: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG,
            suppress:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_SUPPRESS,
        });

        // Temporarily set connection state directly until we have a Three.js core
        setConnectionState(ConnectionState.Connected);

        // Connect to Vircadia server
        try {
            log({
                message: "Three.js version initialized (Vircadia core pending)",
                type: "info",
                suppress:
                    VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_SUPPRESS,
                debug: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG,
            });

            setConnectionState(ConnectionState.Connecting);
            log({
                message: "Initializing Vircadia client",
                type: "info",
                suppress:
                    VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_SUPPRESS,
                debug: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG,
            });
            await vircadiaClient.initialize();
            log({
                message: "Vircadia client initialized",
                type: "info",
                suppress:
                    VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_SUPPRESS,
                debug: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG,
            });
            const connection = vircadiaClient.getConnectionManager();

            // Set up connection state tracker
            const checkConnectionStatus = async () => {
                const connected = connection.isClientConnected();
                setConnectionState(
                    connected
                        ? ConnectionState.Connected
                        : ConnectionState.Disconnected,
                );

                if (connected) {
                    log({
                        message:
                            "Checked connection: Connected to Vircadia server",
                        type: "info",
                        data: {
                            entitiesCount: vircadiaClient
                                .getEntityAndScriptManager()
                                .getEntities().size,
                            scriptsCount: vircadiaClient
                                .getEntityAndScriptManager()
                                .getScriptInstances().size,
                        },
                        suppress:
                            VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_SUPPRESS,
                        debug: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG,
                    });
                } else {
                    log({
                        message:
                            "Checked connection: Disconnected from Vircadia server",
                        type: "info",
                        suppress:
                            VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_SUPPRESS,
                        debug: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG,
                    });
                }
            };

            // Initial check
            checkConnectionStatus();

            // Periodically check connection status
            connectionInterval = setInterval(checkConnectionStatus, 2000);
        } catch (error) {
            log({
                message: "Error initializing Three.js",
                data: {
                    error,
                },
                type: "error",
                suppress:
                    VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_SUPPRESS,
                debug: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG,
            });
            setConnectionState(ConnectionState.Disconnected);
        }

        // Animation/render loop
        const animate = () => {
            animationFrameId = requestAnimationFrame(animate);
        };

        animate();

        // Handle window resize
        window.addEventListener("resize", handleResize);
    });

    // Create effect to respond to connection state changes
    createEffect(() => {
        console.log("Connection state changed:", connectionState());
    });

    onCleanup(() => {
        // Clean up resources
        if (connectionInterval) {
            clearInterval(connectionInterval);
        }

        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }

        /* 
        // TODO: Uncomment once we have a Three.js implementation
        if (vircadiaClient) {
            vircadiaClient.dispose();
            setConnectionState(ConnectionState.Disconnected);
        }
        */

        if (renderer) {
            renderer.dispose();
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
