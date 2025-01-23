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
import * as GUI from "@babylonjs/gui";
import { Communication } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";

class WorldConnection {
    private ws: WebSocket | null = null;
    private heartbeatInterval: number | null = null;
    private token: string;
    private serverUrl: string;
    private clientConfig: Communication.ConfigResponseMessage["config"] | null =
        null;

    constructor(token: string, serverUrl: string) {
        this.token = token;
        this.serverUrl = serverUrl;
    }

    connect() {
        const wsUrl = `ws://${this.serverUrl}/services/world/ws`;
        this.ws = new WebSocket(wsUrl, [`bearer.${this.token}`]);

        this.ws.addEventListener("open", () => {
            if (this.ws) {
                // Request client configuration immediately after connection
                const configRequest = Communication.createMessage({
                    type: Communication.MessageType.CONFIG_REQUEST,
                });
                this.ws.send(JSON.stringify(configRequest));

                log({
                    message: `Connected to world server at ${wsUrl}`,
                    type: "success",
                });
            }
        });

        this.ws.addEventListener("message", (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessage(message);
            } catch (error) {
                console.error("Failed to parse WebSocket message:", error);
            }
        });

        this.ws.addEventListener("close", () => {
            this.cleanup();
        });

        this.ws.addEventListener("error", (error) => {
            console.error("WebSocket error:", error);
            this.cleanup();
        });
    }

    private startHeartbeat() {
        if (!this.clientConfig) {
            console.error(
                "Cannot start heartbeat: client configuration not received yet.",
            );
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
                console.log("Connected with agent ID:", message.agentId);
                break;
            case Communication.MessageType.CONFIG_RESPONSE:
                this.clientConfig = message.config;
                console.log(
                    "Received client configuration:",
                    this.clientConfig,
                );
                // Start heartbeat only after receiving configuration
                this.startHeartbeat();
                break;
            case Communication.MessageType.HEARTBEAT_ACK:
                // Heartbeat acknowledged
                break;
            case Communication.MessageType.ERROR:
                console.error("Server error:", message.message);
                break;
            default:
                console.log("Received message:", message);
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

        // Initialize connection with the default world server URL
        worldConnection = new WorldConnection(
            token,
            VircadiaConfig_Client.defaultWorldServerUri,
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
function log(arg0: { message: string; type: string }) {
    throw new Error("Function not implemented.");
}
