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
import { GridMaterial } from "@babylonjs/materials/grid";
import { VircadiaConfig_Client } from "../../../../../sdk/vircadia-world-sdk-ts/config/vircadia.config";
import { log } from "../../../../../sdk/vircadia-world-sdk-ts/module/general/log";
import { Communication } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";

class WorldConnection {
    private ws: WebSocket | null = null;
    private lastHeartbeatResponse: number = Date.now();
    private connectionAttempts = 0;
    private readonly MAX_RECONNECT_ATTEMPTS = 3;
    private heartbeatInterval: number | null = null;
    private clientConfig:
        | Communication.WebSocket.ConfigResponseMessage["config"]
        | null = null;

    constructor(
        private readonly token: string,
        private readonly serverUrl: string,
        private readonly debugMode: boolean,
        private readonly onMessage?: (
            message: Communication.WebSocket.Message,
        ) => void,
    ) {}

    connect() {
        this.connectionAttempts++;

        // Create URL with token as query parameter, using the same path as server
        const wsUrl = new URL(
            `${VircadiaConfig_Client.defaultWorldServerUriUsingSsl ? "wss" : "ws"}://${this.serverUrl}${Communication.WS_PATH}`,
        );
        wsUrl.searchParams.set("token", this.token);

        try {
            this.ws = new WebSocket(wsUrl.toString());

            // Add error handling before the connection is established
            this.ws.onerror = (error) => {
                log({
                    message: "WebSocket error during connection",
                    debug: this.debugMode,
                    type: "error",
                    error,
                });
            };

            this.ws.addEventListener("open", () => {
                log({
                    message: "WebSocket connection opened",
                    debug: this.debugMode,
                    type: "debug",
                });

                // Request client configuration
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    const configRequest =
                        Communication.WebSocket.createMessage<Communication.WebSocket.ConfigRequestMessage>(
                            {
                                type: Communication.WebSocket.MessageType
                                    .CONFIG_REQUEST,
                            },
                        );
                    this.ws.send(JSON.stringify(configRequest));
                }
            });

            this.ws.addEventListener("message", (event) => {
                try {
                    const message = JSON.parse(
                        event.data,
                    ) as Communication.WebSocket.Message;
                    this.handleMessage(message);
                    if (this.onMessage) {
                        this.onMessage(message);
                    }
                } catch (error) {
                    log({
                        message: "Failed to parse WebSocket message",
                        debug: this.debugMode,
                        type: "error",
                        error,
                    });
                }
            });

            this.ws.addEventListener("close", (event) => {
                log({
                    message: "WebSocket connection closed",
                    debug: this.debugMode,
                    type: "debug",
                    data: {
                        code: event.code,
                        reason: event.reason,
                        wasClean: event.wasClean,
                    },
                });
                this.cleanup();

                // Attempt reconnection if under max attempts and not a clean close
                if (
                    this.connectionAttempts < this.MAX_RECONNECT_ATTEMPTS &&
                    !event.wasClean
                ) {
                    setTimeout(
                        () => this.connect(),
                        1000 * this.connectionAttempts,
                    );
                }
            });
        } catch (error) {
            log({
                message: "Failed to create WebSocket connection",
                debug: this.debugMode,
                type: "error",
                error,
            });
        }
    }

    private handleMessage(message: Communication.WebSocket.Message) {
        switch (message.type) {
            case Communication.WebSocket.MessageType
                .CONNECTION_ESTABLISHED_RESPONSE:
                log({
                    message: `Connected with agent ID: ${(message as Communication.WebSocket.ConnectionEstablishedMessage).agentId}`,
                    debug: this.debugMode,
                    type: "debug",
                });
                break;

            case Communication.WebSocket.MessageType.CONFIG_RESPONSE:
                this.clientConfig = (
                    message as Communication.WebSocket.ConfigResponseMessage
                ).config;
                this.startHeartbeat();
                break;

            case Communication.WebSocket.MessageType.HEARTBEAT_ACK:
                this.lastHeartbeatResponse = Date.now();
                break;

            case Communication.WebSocket.MessageType.ERROR_RESPONSE:
                log({
                    message: `Server error: ${(message as Communication.WebSocket.ErrorMessage).message}`,
                    debug: this.debugMode,
                    type: "error",
                });
                break;
        }
    }

    private startHeartbeat() {
        if (!this.clientConfig) {
            log({
                message:
                    "Cannot start heartbeat: client configuration not received",
                debug: this.debugMode,
                type: "error",
            });
            return;
        }

        this.heartbeatInterval = window.setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                const heartbeatMsg =
                    Communication.WebSocket.createMessage<Communication.WebSocket.HeartbeatMessage>(
                        {
                            type: Communication.WebSocket.MessageType
                                .HEARTBEAT_REQUEST,
                        },
                    );
                this.ws.send(JSON.stringify(heartbeatMsg));
            }
        }, this.clientConfig.heartbeat.interval);
    }

    sendMessage(message: Communication.WebSocket.Message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
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

    // Add new method for entity queries
    async queryEntity(entityId: string): Promise<any> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return null;

        const queryMsg = Communication.WebSocket.createMessage({
            type: Communication.WebSocket.MessageType.QUERY,
            requestId: `query-${Date.now()}`,
            query: "SELECT * FROM entity.entities WHERE general__entity_id = $1",
            parameters: [entityId],
        });

        this.ws.send(JSON.stringify(queryMsg));
    }

    // Add subscription method
    subscribeToChannel(channel: string) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const subMsg = Communication.WebSocket.createMessage({
            type: Communication.WebSocket.MessageType.SUBSCRIBE,
            channel: channel,
        });

        this.ws.send(JSON.stringify(subMsg));
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

    const handleWorldMessage = (message: Communication.WebSocket.Message) => {
        if (!scene) return;

        switch (message.type) {
            case Communication.WebSocket.MessageType
                .CONNECTION_ESTABLISHED_RESPONSE: {
                const connMsg =
                    message as Communication.WebSocket.ConnectionEstablishedMessage;
                // Subscribe to updates using the agent ID
                worldConnection?.subscribeToChannel(connMsg.agentId);
                break;
            }

            case Communication.WebSocket.MessageType.CHANGE_ENTITY_RESPONSE: {
                const notifMsg =
                    message as Communication.WebSocket.NotificationEntityUpdateMessage;
                // Handle entity updates
                console.log("Entity update:", {
                    entityId: notifMsg.entityId,
                    changes: notifMsg.changes,
                });
                break;
            }

            case Communication.WebSocket.MessageType
                .CHANGE_ENTITY_SCRIPT_RESPONSE: {
                const scriptMsg =
                    message as Communication.WebSocket.NotificationEntityScriptUpdateMessage;
                // Handle entity script updates
                console.log("Entity script update:", {
                    entityId: scriptMsg.entityId,
                    scriptChanges: scriptMsg.scriptChanges,
                });
                break;
            }
        }
    };

    const initializeConnection = async () => {
        // Get token from local storage or prompt
        const storedToken = localStorage.getItem("sessionToken");
        const token =
            storedToken ||
            window.prompt("Please enter your session token:") ||
            "";

        if (!token) {
            console.error("No token provided");
            return;
        }

        // Store token if it was entered manually
        if (!storedToken) {
            localStorage.setItem("sessionToken", token);
        }

        // Validate token first using REST API
        const validationResponse = await fetch(
            `http://${VircadiaConfig_Client.defaultWorldServerUri}${Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.path}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            },
        );

        const validationData =
            (await validationResponse.json()) as Communication.REST.SessionValidationResponse;

        if (
            !validationData.success ||
            !(
                validationData as Communication.REST.SessionValidationSuccessResponse
            ).data.isValid
        ) {
            console.error("Invalid token");
            localStorage.removeItem("sessionToken");
            return;
        }

        // Initialize WebSocket connection
        worldConnection = new WorldConnection(
            token,
            VircadiaConfig_Client.defaultWorldServerUri,
            VircadiaConfig_Client.debug,
            handleWorldMessage,
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
