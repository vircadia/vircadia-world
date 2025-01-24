import { type Component, onCleanup, onMount } from "solid-js";
import {
    Engine,
    Scene,
    ArcRotateCamera,
    Vector3,
    HemisphericLight,
    MeshBuilder,
    SceneLoader,
    PhysicsShapeType,
    Material,
    type Mesh,
    Quaternion,
    StandardMaterial,
    type PhysicsBody,
} from "@babylonjs/core";
import "@babylonjs/loaders";
import HavokPhysics from "@babylonjs/havok";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import { PhysicsAggregate } from "@babylonjs/core";
import { KeyboardEventTypes } from "@babylonjs/core/Events";
import { Color3 } from "@babylonjs/core";
import { GridMaterial } from "@babylonjs/materials/grid";
import { VircadiaConfig_Client } from "../../../../../sdk/vircadia-world-sdk-ts/config/vircadia.config";
import { log } from "../../../../../sdk/vircadia-world-sdk-ts/module/general/log";
import * as GUI from "@babylonjs/gui";
import { Communication } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";

class WorldConnection {
    private ws: WebSocket | null = null;
    private lastHeartbeatResponse: number = Date.now();
    private connectionAttempts: number = 0;
    private readonly MAX_RECONNECT_ATTEMPTS = 3;
    private heartbeatInterval: number | null = null;
    private clientConfig: Communication.ConfigResponseMessage["config"] | null =
        null;

    constructor(
        private readonly token: string,
        private readonly serverUrl: string,
        private readonly debugMode: boolean,
    ) {}

    connect() {
        this.connectionAttempts++;
        const wsUrl = `ws://${this.serverUrl}${Communication.WS_BASE_URL}`;
        const formattedToken = this.token.startsWith("bearer.")
            ? this.token
            : `bearer.${this.token}`;

        log({
            message: "Initiating WebSocket connection",
            debug: this.debugMode,
            type: "debug",
            data: {
                attempt: this.connectionAttempts,
                url: wsUrl,
                timestamp: new Date().toISOString(),
            },
        });

        try {
            this.ws = new WebSocket(wsUrl, formattedToken);

            // Connection state monitoring
            const stateCheckInterval = setInterval(() => {
                if (this.ws) {
                    log({
                        message: "WebSocket state check",
                        debug: this.debugMode,
                        type: "debug",
                        data: {
                            readyState: this.ws.readyState,
                            bufferedAmount: this.ws.bufferedAmount,
                            timeSinceLastHeartbeat:
                                Date.now() - this.lastHeartbeatResponse,
                        },
                    });
                }
            }, 1000);

            // Connection timeout
            const connectionTimeout = setTimeout(() => {
                if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
                    clearInterval(stateCheckInterval);
                    log({
                        message: "Connection attempt timed out",
                        debug: this.debugMode,
                        type: "error",
                        data: {
                            attempt: this.connectionAttempts,
                            finalState: this.ws.readyState,
                        },
                    });
                    this.ws.close();

                    // Attempt reconnect if under max attempts
                    if (this.connectionAttempts < this.MAX_RECONNECT_ATTEMPTS) {
                        setTimeout(
                            () => this.connect(),
                            1000 * this.connectionAttempts,
                        );
                    }
                }
            }, 5000);

            this.ws.addEventListener("open", () => {
                clearTimeout(connectionTimeout);
                log({
                    message: "WebSocket open event triggered",
                    debug: this.debugMode,
                    type: "debug",
                });
                if (this.ws) {
                    // Request client configuration immediately after connection
                    const configRequest = Communication.createMessage({
                        type: Communication.MessageType.CONFIG_REQUEST,
                    });
                    this.ws.send(JSON.stringify(configRequest));
                    log({
                        message: "Sent config request",
                        debug: this.debugMode,
                        type: "debug",
                    });
                }
            });

            this.ws.addEventListener("message", (event) => {
                log({
                    message: `Received WebSocket message: ${event.data}`,
                    debug: this.debugMode,
                    type: "debug",
                });
                try {
                    const message = JSON.parse(event.data);
                    this.handleMessage(message);
                } catch (error) {
                    log({
                        message: `Failed to parse WebSocket message: ${error}`,
                        debug: this.debugMode,
                        type: "error",
                    });
                }
            });

            this.ws.addEventListener("close", (event) => {
                clearInterval(stateCheckInterval);
                log({
                    message: "WebSocket closed",
                    debug: this.debugMode,
                    type: "debug",
                    data: {
                        code: event.code,
                        reason: event.reason,
                        wasClean: event.wasClean,
                        timestamp: new Date().toISOString(),
                        timeSinceLastHeartbeat:
                            Date.now() - this.lastHeartbeatResponse,
                    },
                });
                this.cleanup();
            });

            this.ws.addEventListener("error", (error) => {
                clearTimeout(connectionTimeout);
                log({
                    message: `WebSocket error details - 
                        readyState: ${this.ws?.readyState}
                        bufferedAmount: ${this.ws?.bufferedAmount}
                        protocol: ${this.ws?.protocol}
                        url: ${this.ws?.url}`,
                    debug: this.debugMode,
                    type: "error",
                    error: error,
                });
            });
        } catch (error) {
            log({
                message: "WebSocket creation failed",
                debug: this.debugMode,
                type: "error",
                error: error,
            });
        }
    }

    private startHeartbeat() {
        if (!this.clientConfig) {
            log({
                message:
                    "Cannot start heartbeat: client configuration not received yet.",
                debug: this.debugMode,
                type: "error",
            });
            return;
        }

        this.heartbeatInterval = window.setInterval(() => {
            if (this.ws) {
                const heartbeatMsg = Communication.createMessage({
                    type: Communication.MessageType.HEARTBEAT,
                });
                this.ws.send(JSON.stringify(heartbeatMsg));
            }
        }, this.clientConfig.heartbeat.interval);
    }

    private handleMessage(message: Communication.Message) {
        switch (message.type) {
            case Communication.MessageType.CONNECTION_ESTABLISHED:
                log({
                    message: `Connected with agent ID: ${message.agentId}`,
                    debug: this.debugMode,
                    type: "debug",
                });
                break;
            case Communication.MessageType.CONFIG_RESPONSE:
                this.clientConfig = message.config;
                log({
                    message: `Received client configuration: ${this.clientConfig}`,
                    debug: this.debugMode,
                    type: "debug",
                });
                // Start heartbeat only after receiving configuration
                this.startHeartbeat();
                break;
            case Communication.MessageType.HEARTBEAT_ACK:
                this.lastHeartbeatResponse = Date.now();
                break;
            case Communication.MessageType.ERROR:
                log({
                    message: `Server error: ${message.message}`,
                    debug: this.debugMode,
                    type: "error",
                });
                break;
            default:
                log({
                    message: `Received message: ${message}`,
                    debug: this.debugMode,
                    type: "debug",
                });
        }
    }

    cleanup() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

const WorldScene: Component = () => {
    let canvas: HTMLCanvasElement | undefined;
    let engine: Engine | undefined;
    let scene: Scene | undefined;
    let havokPlugin: HavokPlugin | undefined;
    let worldConnection: WorldConnection | undefined;

    const initializeScene = async () => {
        if (!canvas) return;

        // Create engine and scene
        engine = new Engine(canvas, true);
        scene = new Scene(engine);

        // Basic camera setup
        const camera = new ArcRotateCamera(
            "camera",
            0,
            Math.PI / 3,
            10,
            Vector3.Zero(),
            scene,
        );
        camera.attachControl(canvas, true);

        // Basic lighting
        const light = new HemisphericLight(
            "light",
            new Vector3(0, 1, 0),
            scene,
        );

        // Add a simple ground
        const ground = MeshBuilder.CreateGround(
            "ground",
            { width: 10, height: 10 },
            scene,
        );
        const groundMaterial = new GridMaterial("groundMaterial", scene);
        ground.material = groundMaterial;

        // Start the render loop
        engine.runRenderLoop(() => {
            scene?.render();
        });

        // Handle window resize
        window.addEventListener("resize", () => {
            engine?.resize();
        });
    };

    const initializeConnection = async () => {
        // Temporary: Get token from prompt
        const token = window.prompt("Please enter your session token:") || "";
        if (!token) {
            console.error("No token provided");
            return;
        }

        worldConnection = new WorldConnection(
            token,
            VircadiaConfig_Client.defaultWorldServerUri,
            VircadiaConfig_Client.debug,
        );
        worldConnection.connect();
    };

    onMount(async () => {
        await initializeScene();
        await initializeConnection();
    });

    onCleanup(() => {
        worldConnection?.cleanup();
        engine?.dispose();
    });

    return <canvas ref={canvas} style={{ width: "100%", height: "100%" }} />;
};

export default WorldScene;
