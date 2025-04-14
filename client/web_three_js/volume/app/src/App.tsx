import { useState, useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stats } from "@react-three/drei";
import { VircadiaThreeCore } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/vircadia.three.core";
import { VircadiaConfig_BROWSER_CLIENT } from "../../../../../sdk/vircadia-world-sdk-ts/config/vircadia.browser.client.config";
import {
    Communication,
    type Entity,
} from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import * as THREE from "three";
import "./App.css";

// Connection config for VircadiaThreeCore
const BENCHMARK_PREFIX = "benchmark_";
const SERVER_URL =
    VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEFAULT_WORLD_API_URI_USING_SSL
        ? `https://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`
        : `http://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`;

const SERVER_CONFIG = {
    serverUrl: SERVER_URL,
    authToken:
        VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG_SESSION_TOKEN,
    authProvider:
        VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG_SESSION_TOKEN_PROVIDER,
    scene: new THREE.Scene(),
    debug: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG,
    suppress: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_SUPPRESS,
};

// Connection status component
function ConnectionStatus({
    vircadiaCore,
}: { vircadiaCore: VircadiaThreeCore | null }) {
    const [status, setStatus] = useState("Disconnected");
    const statusCheckRef = useRef<number | null>(null);

    useEffect(() => {
        if (!vircadiaCore) {
            setStatus("Disconnected");
            return;
        }

        // Check connection status every second
        statusCheckRef.current = window.setInterval(() => {
            if (vircadiaCore.Utilities.Connection.isConnected()) {
                setStatus("Connected");
            } else if (vircadiaCore.Utilities.Connection.isConnecting()) {
                setStatus("Connecting...");
            } else if (vircadiaCore.Utilities.Connection.isReconnecting()) {
                setStatus("Reconnecting...");
            } else {
                setStatus("Disconnected");
            }
        }, 1000);

        return () => {
            if (statusCheckRef.current) {
                window.clearInterval(statusCheckRef.current);
            }
        };
    }, [vircadiaCore]);

    // Style based on connection status
    const getStatusColor = () => {
        switch (status) {
            case "Connected":
                return "green";
            case "Connecting...":
            case "Reconnecting...":
                return "orange";
            default:
                return "red";
        }
    };

    return (
        <div
            style={{
                position: "absolute",
                top: "10px",
                right: "10px",
                padding: "5px 10px",
                borderRadius: "5px",
                backgroundColor: "rgba(0, 0, 0, 0.7)",
                color: "white",
                fontWeight: "bold",
                display: "flex",
                alignItems: "center",
                gap: "5px",
                zIndex: 1000,
            }}
        >
            <span
                style={{
                    display: "inline-block",
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    backgroundColor: getStatusColor(),
                }}
            />
            <span>{status}</span>
        </div>
    );
}

// Entity Manager for creating and updating entities
function useEntityManager(vircadiaCore: VircadiaThreeCore | null) {
    const [entities, setEntities] = useState<
        Record<string, { position: THREE.Vector3; color: THREE.Color }>
    >({});
    const [isCreating, setIsCreating] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [entityCount, setEntityCount] = useState(0);
    const [cleaned, setCleaned] = useState(false);

    // Clean existing benchmark entities
    const cleanExistingEntities = async () => {
        if (
            !vircadiaCore ||
            !vircadiaCore.Utilities.Connection.isConnected() ||
            cleaned
        )
            return;

        console.log("Cleaning up existing benchmark entities...");
        try {
            // Find existing benchmark entities
            const existingResponse =
                await vircadiaCore.Utilities.Connection.query<
                    Array<Pick<Entity.I_Entity, "general__entity_id">>
                >({
                    query: "SELECT general__entity_id FROM entity.entities WHERE general__entity_name LIKE $1",
                    parameters: [`${BENCHMARK_PREFIX}%`],
                });

            // Delete them if they exist
            if (existingResponse.result && existingResponse.result.length > 0) {
                console.log(
                    `Deleting ${existingResponse.result.length} existing benchmark entities`,
                );
                for (const entity of existingResponse.result) {
                    await vircadiaCore.Utilities.Connection.query({
                        query: "DELETE FROM entity.entities WHERE general__entity_id = $1",
                        parameters: [entity.general__entity_id],
                    });
                }
            }
            setCleaned(true);
            setEntities({});
            setEntityCount(0);
        } catch (error) {
            console.error("Error cleaning up benchmark entities:", error);
        }
    };

    // Create entities on the server
    const createEntities = async (count: number) => {
        if (!vircadiaCore || isCreating) return;

        setIsCreating(true);
        console.log(`Creating ${count} entities...`);

        try {
            // Delete any existing benchmark entities first
            await cleanExistingEntities();

            // Create new entities
            const newEntities: Record<
                string,
                { position: THREE.Vector3; color: THREE.Color }
            > = {};

            for (let i = 0; i < count; i++) {
                const position = new THREE.Vector3(
                    (Math.random() - 0.5) * 10,
                    (Math.random() - 0.5) * 10,
                    (Math.random() - 0.5) * 10,
                );

                const color = new THREE.Color(
                    Math.random(),
                    Math.random(),
                    Math.random(),
                );

                const response = await vircadiaCore.Utilities.Connection.query<
                    Array<Pick<Entity.I_Entity, "general__entity_id">>
                >({
                    query: `
                        INSERT INTO entity.entities (
                        general__entity_name,
                        meta__data
                        ) VALUES ($1, $2)
                        RETURNING general__entity_id
                    `,
                    parameters: [
                        `${BENCHMARK_PREFIX}${i}`,
                        {
                            transform_position_x: { value: position.x },
                            transform_position_y: { value: position.y },
                            transform_position_z: { value: position.z },
                            rendering_color_r: { value: color.r },
                            rendering_color_g: { value: color.g },
                            rendering_color_b: { value: color.b },
                            benchmark: { value: true },
                        },
                    ],
                });

                if (response.result && response.result.length > 0) {
                    const entityId = response.result[0].general__entity_id;
                    newEntities[entityId] = { position, color };
                }

                // Update progress every 100 entities
                if (i % 100 === 0) {
                    setEntityCount(i);
                }
            }

            setEntities(newEntities);
            setEntityCount(count);
            console.log(`Created ${Object.keys(newEntities).length} entities`);
        } catch (error) {
            console.error("Error creating entities:", error);
        } finally {
            setIsCreating(false);
        }
    };

    // Update random entities on the server
    const updateRandomEntities = async (percentage: number) => {
        if (!vircadiaCore || isUpdating || Object.keys(entities).length === 0)
            return;

        setIsUpdating(true);

        try {
            const entityIds = Object.keys(entities);
            const updateCount = Math.floor(
                entityIds.length * (percentage / 100),
            );

            console.log(`Updating ${updateCount} entities (${percentage}%)...`);

            // Randomly select entities to update
            const shuffled = [...entityIds].sort(() => 0.5 - Math.random());
            const selectedIds = shuffled.slice(0, updateCount);

            // Update each selected entity with new color
            for (const entityId of selectedIds) {
                const newColor = new THREE.Color(
                    Math.random(),
                    Math.random(),
                    Math.random(),
                );

                await vircadiaCore.Utilities.Connection.query({
                    query: `
            UPDATE entity.entities
            SET 
              rendering__color_r = $1,
              rendering__color_g = $2,
              rendering__color_b = $3
            WHERE general__entity_id = $4
          `,
                    parameters: [newColor.r, newColor.g, newColor.b, entityId],
                });
            }

            console.log(`Updated ${updateCount} entities with new colors`);
        } catch (error) {
            console.error("Error updating entities:", error);
        } finally {
            setIsUpdating(false);
        }
    };

    return {
        entities,
        setEntities,
        createEntities,
        updateRandomEntities,
        isCreating,
        isUpdating,
        entityCount,
        cleanExistingEntities,
    };
}

// Entity visualization
function Entities({
    vircadiaCore,
}: { vircadiaCore: VircadiaThreeCore | null }) {
    // Create a dummy entity collection for demonstration
    // In a real implementation, this would load entities from vircadiaCore
    const entities: Record<
        string,
        { position: THREE.Vector3; color: THREE.Color }
    > = {};

    // Log connection status for debugging
    useEffect(() => {
        if (vircadiaCore) {
            console.log(
                "Entities component initialized with VircadiaThreeCore instance",
            );
        }
    }, [vircadiaCore]);

    // Only render the 3D entities as meshes
    return (
        <>
            {Object.entries(entities).map(([id, data]) => (
                <mesh
                    key={id}
                    position={[
                        data.position.x,
                        data.position.y,
                        data.position.z,
                    ]}
                >
                    <boxGeometry args={[0.5, 0.5, 0.5]} />
                    <meshStandardMaterial color={data.color} />
                </mesh>
            ))}
        </>
    );
}

// Entity Controls Component for UI buttons (outside of Canvas)
function EntityControls({
    vircadiaCore,
}: {
    vircadiaCore: VircadiaThreeCore | null;
}) {
    const [isPolling, setIsPolling] = useState(false);
    const [entityCount, setEntityCount] = useState(0);
    const pollingIntervalRef = useRef<number | null>(null);

    // Start polling for entity updates
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const startPolling = (): void => {
        if (isPolling || !vircadiaCore) return;

        setIsPolling(true);
        console.log("Starting to poll for entity updates...");

        // In a real implementation, this would update entities
        // This is just for the UI state
        pollingIntervalRef.current = window.setInterval(async () => {
            try {
                if (!vircadiaCore.Utilities.Connection.isConnected()) {
                    return;
                }

                const response = await vircadiaCore.Utilities.Connection.query<
                    Array<Pick<Entity.I_Entity, "general__entity_id">>
                >({
                    query: `
                        SELECT general__entity_id 
                        FROM entity.entities 
                        WHERE general__entity_name LIKE $1
                    `,
                    parameters: [`${BENCHMARK_PREFIX}%`],
                });

                if (response.result) {
                    setEntityCount(response.result.length);
                }
            } catch (error) {
                console.error("Error checking entity count:", error);
            }
        }, 1000);
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const stopPolling = (): void => {
        if (!isPolling) return;

        if (pollingIntervalRef.current) {
            window.clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }

        setIsPolling(false);
        console.log("Stopped polling for entity updates");
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (pollingIntervalRef.current) {
                window.clearInterval(pollingIntervalRef.current);
            }
        };
    }, []);

    return (
        <div
            className="controls"
            style={{
                position: "absolute",
                bottom: "20px",
                left: "20px",
                zIndex: 100,
                display: "flex",
                gap: "10px",
            }}
        >
            <button
                type="button"
                onClick={startPolling}
                disabled={
                    isPolling ||
                    !vircadiaCore?.Utilities.Connection.isConnected()
                }
            >
                {isPolling ? "Polling..." : "Start Polling"}
            </button>
            <button type="button" onClick={stopPolling} disabled={!isPolling}>
                Stop Polling
            </button>
            <div>Entities: {entityCount}</div>
        </div>
    );
}

// Scene setup
function Scene() {
    return (
        <>
            <ambientLight intensity={0.5} />
            <pointLight position={[10, 10, 10]} />
            <OrbitControls />
            <axesHelper args={[5]} />
            <gridHelper args={[20, 20]} />
            <Stats />
        </>
    );
}

// Main Benchmark Component
function Benchmark() {
    const [vircadiaCore, setVircadiaCore] = useState<VircadiaThreeCore | null>(
        null,
    );
    const [isConnected, setIsConnected] = useState(false);
    const connectionCheckIntervalRef = useRef<number | null>(null);
    const entityManager = useEntityManager(vircadiaCore);

    // Initialize VircadiaThreeCore and connect on load
    useEffect(() => {
        const core = new VircadiaThreeCore(SERVER_CONFIG);
        setVircadiaCore(core);

        // Attempt to connect immediately
        connectToServer(core);

        // Set up connection check interval
        connectionCheckIntervalRef.current = window.setInterval(() => {
            if (
                core &&
                !core.Utilities.Connection.isConnected() &&
                !core.Utilities.Connection.isConnecting()
            ) {
                console.log("Connection lost, attempting to reconnect...");
                connectToServer(core);
            }
        }, 5000); // Check every 5 seconds

        // Cleanup on unmount
        return () => {
            if (connectionCheckIntervalRef.current) {
                window.clearInterval(connectionCheckIntervalRef.current);
            }
            if (core) {
                core.dispose();
            }
        };
    }, []);

    // Clean up existing benchmark entities when connection is established
    useEffect(() => {
        if (isConnected && vircadiaCore) {
            entityManager.cleanExistingEntities();
        }
    }, [isConnected, vircadiaCore, entityManager]);

    // Handle connection to server
    const connectToServer = async (core: VircadiaThreeCore) => {
        try {
            const success = await core.Utilities.Connection.connect();
            if (success) {
                setIsConnected(true);
                console.log("Connected to Vircadia server");
            } else {
                setIsConnected(false);
                console.error("Failed to connect to Vircadia server");
            }
        } catch (error) {
            setIsConnected(false);
            console.error("Failed to connect to Vircadia server:", error);
        }
    };

    // Manual connect button handler
    const handleConnect = async () => {
        if (!vircadiaCore) return;
        await connectToServer(vircadiaCore);
    };

    // Manual disconnect button handler
    const handleDisconnect = () => {
        if (!vircadiaCore) return;
        vircadiaCore.Utilities.Connection.disconnect();
        setIsConnected(false);
        console.log("Disconnected from Vircadia server");
    };

    return (
        <div className="benchmark-container">
            <div className="benchmark-controls">
                <h2>Vircadia Entity Benchmark</h2>

                <div className="connection-controls">
                    <button
                        type="button"
                        onClick={handleConnect}
                        disabled={isConnected || !vircadiaCore}
                    >
                        Connect
                    </button>
                    <button
                        type="button"
                        onClick={handleDisconnect}
                        disabled={!isConnected || !vircadiaCore}
                    >
                        Disconnect
                    </button>
                </div>

                <div className="entity-controls">
                    <button
                        type="button"
                        onClick={() => entityManager.createEntities(1000)}
                        disabled={!isConnected || entityManager.isCreating}
                    >
                        {entityManager.isCreating
                            ? `Creating... (${entityManager.entityCount})`
                            : "Create 1000 Entities"}
                    </button>

                    <button
                        type="button"
                        onClick={() => entityManager.updateRandomEntities(10)}
                        disabled={
                            !isConnected ||
                            entityManager.isUpdating ||
                            entityManager.entityCount === 0
                        }
                    >
                        {entityManager.isUpdating
                            ? "Updating..."
                            : "Update 10% of Entities"}
                    </button>

                    <button
                        type="button"
                        onClick={() => entityManager.updateRandomEntities(50)}
                        disabled={
                            !isConnected ||
                            entityManager.isUpdating ||
                            entityManager.entityCount === 0
                        }
                    >
                        {entityManager.isUpdating
                            ? "Updating..."
                            : "Update 50% of Entities"}
                    </button>
                </div>
            </div>

            <div className="canvas-container">
                <Canvas>
                    <Scene />
                    {vircadiaCore && <Entities vircadiaCore={vircadiaCore} />}
                </Canvas>
                {vircadiaCore && (
                    <ConnectionStatus vircadiaCore={vircadiaCore} />
                )}
                {vircadiaCore && <EntityControls vircadiaCore={vircadiaCore} />}
            </div>
        </div>
    );
}

function App() {
    return (
        <div className="app">
            <Benchmark />
        </div>
    );
}

export default App;
