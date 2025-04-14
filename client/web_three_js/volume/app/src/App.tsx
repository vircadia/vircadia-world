import { useState, useEffect, useRef, useCallback } from "react";
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
const POLL_RATE_MS = 500;

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
    // Adding reasonable default reconnection settings
    reconnectAttempts: 5,
    reconnectDelay: 5000,
};

// Network statistics hook
function useNetworkStats() {
    const [stats, setStats] = useState({
        entityCount: 0,
        updatesPushed: 0,
        updatesDownloaded: 0,
        pushRate: 0,
        downloadRate: 0,
        averagePushRate: 0,
        averageDownloadRate: 0,
    });

    const statsRef = useRef({
        updatesPushed: 0,
        updatesDownloaded: 0,
        lastPushCount: 0,
        lastDownloadCount: 0,
        totalPushRate: 0,
        totalDownloadRate: 0,
        pushRateUpdateCount: 0,
        downloadRateUpdateCount: 0,
    });

    // Update rates every second
    useEffect(() => {
        const rateInterval = setInterval(() => {
            const newPushRate =
                statsRef.current.updatesPushed - statsRef.current.lastPushCount;
            const newDownloadRate =
                statsRef.current.updatesDownloaded -
                statsRef.current.lastDownloadCount;

            statsRef.current.lastPushCount = statsRef.current.updatesPushed;
            statsRef.current.lastDownloadCount =
                statsRef.current.updatesDownloaded;

            // Only update totals and counts when there's actual activity
            if (newPushRate > 0) {
                statsRef.current.totalPushRate += newPushRate;
                statsRef.current.pushRateUpdateCount++;
            }

            if (newDownloadRate > 0) {
                statsRef.current.totalDownloadRate += newDownloadRate;
                statsRef.current.downloadRateUpdateCount++;
            }

            // Calculate averages
            const avgPushRate =
                statsRef.current.pushRateUpdateCount > 0
                    ? statsRef.current.totalPushRate /
                      statsRef.current.pushRateUpdateCount
                    : 0;
            const avgDownloadRate =
                statsRef.current.downloadRateUpdateCount > 0
                    ? statsRef.current.totalDownloadRate /
                      statsRef.current.downloadRateUpdateCount
                    : 0;

            setStats((prev) => ({
                ...prev,
                updatesPushed: statsRef.current.updatesPushed,
                updatesDownloaded: statsRef.current.updatesDownloaded,
                pushRate: newPushRate,
                downloadRate: newDownloadRate,
                averagePushRate: avgPushRate,
                averageDownloadRate: avgDownloadRate,
            }));
        }, 1000);

        return () => {
            clearInterval(rateInterval);
        };
    }, []);

    // Update entity count
    const updateEntityCount = (count: number) => {
        setStats((prev) => ({
            ...prev,
            entityCount: count,
        }));
    };

    // Record pushed update - fix linter error by removing type annotation
    const recordPushedUpdate = (count = 1) => {
        statsRef.current.updatesPushed += count;
    };

    // Record downloaded update - fix linter error by removing type annotation
    const recordDownloadedUpdate = (count = 1) => {
        statsRef.current.updatesDownloaded += count;
    };

    // Reset stats
    const resetStats = () => {
        statsRef.current = {
            updatesPushed: 0,
            updatesDownloaded: 0,
            lastPushCount: 0,
            lastDownloadCount: 0,
            totalPushRate: 0,
            totalDownloadRate: 0,
            pushRateUpdateCount: 0,
            downloadRateUpdateCount: 0,
        };

        setStats({
            entityCount: 0,
            updatesPushed: 0,
            updatesDownloaded: 0,
            pushRate: 0,
            downloadRate: 0,
            averagePushRate: 0,
            averageDownloadRate: 0,
        });
    };

    return {
        stats,
        updateEntityCount,
        recordPushedUpdate,
        recordDownloadedUpdate,
        resetStats,
    };
}

// Stats Display Component
function StatsDisplay({
    stats,
}: {
    stats: {
        entityCount: number;
        updatesPushed: number;
        updatesDownloaded: number;
        pushRate: number;
        downloadRate: number;
        averagePushRate: number;
        averageDownloadRate: number;
    };
}) {
    return (
        <div className="stats-panel">
            <h4>Real-time Statistics</h4>
            <div className="stats-content">
                <div className="stat-item">
                    <span className="stat-label">Entity Count:</span>
                    <span className="stat-value">{stats.entityCount}</span>
                </div>
                <div className="stat-item">
                    <span className="stat-label">Updates Pushed:</span>
                    <span className="stat-value">{stats.updatesPushed}</span>
                </div>
                <div className="stat-item">
                    <span className="stat-label">Updates Downloaded:</span>
                    <span className="stat-value">
                        {stats.updatesDownloaded}
                    </span>
                </div>
                <div className="stat-item">
                    <span className="stat-label">Push Rate:</span>
                    <span className="stat-value">{stats.pushRate}/s</span>
                </div>
                <div className="stat-item">
                    <span className="stat-label">Download Rate:</span>
                    <span className="stat-value">{stats.downloadRate}/s</span>
                </div>
                <div className="stat-item">
                    <span className="stat-label">Avg Push Rate:</span>
                    <span className="stat-value">
                        {stats.averagePushRate.toFixed(2)}/s
                    </span>
                </div>
                <div className="stat-item">
                    <span className="stat-label">Avg Download Rate:</span>
                    <span className="stat-value">
                        {stats.averageDownloadRate.toFixed(2)}/s
                    </span>
                </div>
            </div>
        </div>
    );
}

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
        Map<string, { position: THREE.Vector3; color: THREE.Color }>
    >(new Map());
    const [isCreating, setIsCreating] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [entityCount, setEntityCount] = useState(0);
    const [cleaned, setCleaned] = useState(false);
    const [isPolling, setIsPolling] = useState(false);
    const pollingIntervalRef = useRef<number | null>(null);
    const entitiesRef = useRef(entities);

    // Keep the ref updated with the latest entities
    useEffect(() => {
        entitiesRef.current = entities;
    }, [entities]);

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

                // Delete all entities in a single query instead of one by one
                await vircadiaCore.Utilities.Connection.query({
                    query: "DELETE FROM entity.entities WHERE general__entity_name LIKE $1",
                    parameters: [`${BENCHMARK_PREFIX}%`],
                });
            }
            setCleaned(true);
            setEntities(new Map());
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
            const newEntities = new Map();

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
                    newEntities.set(entityId, { position, color });
                }

                // Update progress every 100 entities
                if (i % 100 === 0) {
                    setEntityCount(i);
                }
            }

            setEntities(newEntities);
            setEntityCount(newEntities.size);
            console.log(`Created ${newEntities.size} entities`);

            // Start polling for updates
            startPolling();
        } catch (error) {
            console.error("Error creating entities:", error);
        } finally {
            setIsCreating(false);
        }
    };

    // Update random entities on the server
    const updateRandomEntities = async (percentage: number) => {
        if (!vircadiaCore || isUpdating || entities.size === 0) return;

        setIsUpdating(true);

        try {
            const entityIds = Array.from(entities.keys());
            const updateCount = Math.floor(
                entityIds.length * (percentage / 100),
            );

            console.log(`Updating ${updateCount} entities (${percentage}%)...`);

            // Randomly select entities to update
            const shuffled = [...entityIds].sort(() => 0.5 - Math.random());
            const selectedIds = shuffled.slice(0, updateCount);

            // Process in smaller batches to avoid overwhelming the server
            const batchSize = 50;
            for (let i = 0; i < selectedIds.length; i += batchSize) {
                const batch = selectedIds.slice(i, i + batchSize);

                // Process each entity in the batch
                await Promise.all(
                    batch.map(async (entityId) => {
                        const newColor = new THREE.Color(
                            Math.random(),
                            Math.random(),
                            Math.random(),
                        );

                        await vircadiaCore.Utilities.Connection.query({
                            query: `
                        UPDATE entity.entities
                        SET meta__data = jsonb_set(
                            jsonb_set(
                                jsonb_set(
                                    meta__data, 
                                    '{rendering_color_r, value}', 
                                    to_jsonb($1::float)
                                ),
                                '{rendering_color_g, value}', 
                                to_jsonb($2::float)
                            ),
                            '{rendering_color_b, value}', 
                            to_jsonb($3::float)
                        )
                        WHERE general__entity_id = $4
                        `,
                            parameters: [
                                newColor.r,
                                newColor.g,
                                newColor.b,
                                entityId,
                            ],
                        });

                        // Update the local map immediately
                        const entity = entities.get(entityId);
                        if (entity) {
                            const updatedEntity = {
                                ...entity,
                                color: newColor,
                            };
                            entities.set(entityId, updatedEntity);
                        }
                    }),
                );

                // Small delay between batches to prevent server overload
                await new Promise((resolve) => setTimeout(resolve, 10));
            }

            // Update state with modified map
            setEntities(new Map(entities));
            console.log(`Updated ${updateCount} entities with new colors`);
        } catch (error) {
            console.error("Error updating entities:", error);
        } finally {
            setIsUpdating(false);
        }
    };

    // Poll for entity updates
    const pollForUpdates = useCallback(async () => {
        if (!vircadiaCore || !vircadiaCore.Utilities.Connection.isConnected())
            return;

        try {
            // Get all benchmark entities in a single query
            const response = await vircadiaCore.Utilities.Connection.query<
                Array<{
                    general__entity_id: string;
                    meta__data: {
                        transform_position_x?: { value: number };
                        transform_position_y?: { value: number };
                        transform_position_z?: { value: number };
                        rendering_color_r?: { value: number };
                        rendering_color_g?: { value: number };
                        rendering_color_b?: { value: number };
                    };
                }>
            >({
                query: `
                    SELECT general__entity_id, meta__data 
                    FROM entity.entities 
                    WHERE general__entity_name LIKE $1
                `,
                parameters: [`${BENCHMARK_PREFIX}%`],
            });

            if (response.result && response.result.length > 0) {
                const updatedEntities = new Map(entitiesRef.current);

                // Update entities from server data
                for (const entity of response.result) {
                    const data = entity.meta__data;

                    // Only process if we have the necessary data
                    if (
                        data &&
                        data.transform_position_x?.value !== undefined &&
                        data.transform_position_y?.value !== undefined &&
                        data.transform_position_z?.value !== undefined &&
                        data.rendering_color_r?.value !== undefined &&
                        data.rendering_color_g?.value !== undefined &&
                        data.rendering_color_b?.value !== undefined
                    ) {
                        const position = new THREE.Vector3(
                            data.transform_position_x.value,
                            data.transform_position_y.value,
                            data.transform_position_z.value,
                        );

                        const color = new THREE.Color(
                            data.rendering_color_r.value,
                            data.rendering_color_g.value,
                            data.rendering_color_b.value,
                        );

                        updatedEntities.set(entity.general__entity_id, {
                            position,
                            color,
                        });
                    }
                }

                if (updatedEntities.size !== entitiesRef.current.size) {
                    setEntityCount(updatedEntities.size);
                }

                setEntities(updatedEntities);
            }
        } catch (error) {
            console.error("Error polling for entity updates:", error);
        }
    }, [vircadiaCore]);

    // Start polling for entity updates
    const startPolling = useCallback(() => {
        if (isPolling) return;

        setIsPolling(true);
        const interval = window.setInterval(pollForUpdates, POLL_RATE_MS); // Poll every 500ms
        pollingIntervalRef.current = interval;

        console.log("Started polling for entity updates");
    }, [isPolling, pollForUpdates]);

    // Stop polling for entity updates
    const stopPolling = useCallback(() => {
        if (pollingIntervalRef.current) {
            window.clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
            setIsPolling(false);
            console.log("Stopped polling for entity updates");
        }
    }, []);

    // Start polling automatically when connected
    useEffect(() => {
        if (
            vircadiaCore?.Utilities.Connection.isConnected() &&
            !isPolling &&
            entities.size > 0
        ) {
            startPolling();
        }
    }, [vircadiaCore, entities.size, isPolling, startPolling]);

    // Cleanup when component unmounts
    useEffect(() => {
        const cleanup = () => {
            if (pollingIntervalRef.current) {
                window.clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
            }
        };

        return cleanup;
    }, []);

    return {
        entities,
        createEntities,
        updateRandomEntities,
        isCreating,
        isUpdating,
        entityCount,
        cleanExistingEntities,
        startPolling,
        stopPolling,
        isPolling,
    };
}

// Entity visualization
function Entities({
    entities,
}: {
    entities: Map<string, { position: THREE.Vector3; color: THREE.Color }>;
}) {
    // Render the 3D entities as meshes
    return (
        <>
            {Array.from(entities.entries()).map(([id, data]) => (
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

    // Use hooks without circular dependencies
    const networkStats = useNetworkStats();
    const networkStatsRef = useRef(networkStats);
    const entityManager = useEntityManager(vircadiaCore);

    // Keep the ref updated with the latest networkStats
    useEffect(() => {
        networkStatsRef.current = networkStats;
    }, [networkStats]);

    // Update entity count in stats when entity count changes
    useEffect(() => {
        networkStatsRef.current.updateEntityCount(entityManager.entityCount);
    }, [entityManager.entityCount]);

    // Start/stop polling based on connection status
    useEffect(() => {
        if (isConnected) {
            if (entityManager.entityCount > 0 && !entityManager.isPolling) {
                entityManager.startPolling();
            }
        } else {
            entityManager.stopPolling();
        }
    }, [
        isConnected,
        entityManager.entityCount,
        entityManager.isPolling,
        entityManager,
    ]);

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
                !core.Utilities.Connection.isConnecting() &&
                !core.Utilities.Connection.isReconnecting()
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

    // Handle connection to server - now uses VircadiaThreeCore's ConnectionManager
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
        entityManager.stopPolling();
        setIsConnected(false);
        networkStats.resetStats();
        console.log("Disconnected from Vircadia server");
    };

    // Record stats for updates
    const handleCreateEntities = async (count: number) => {
        await entityManager.createEntities(count);
        networkStats.recordPushedUpdate(count);
    };

    const handleUpdateEntities = async (percentage: number) => {
        const updateCount = Math.floor(
            entityManager.entities.size * (percentage / 100),
        );
        await entityManager.updateRandomEntities(percentage);
        networkStats.recordPushedUpdate(updateCount);
    };

    return (
        <div className="benchmark-container">
            <div className="control-panel">
                <div className="benchmark-controls">
                    <h3>Vircadia Entity Benchmark</h3>

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
                            onClick={() => handleCreateEntities(1000)}
                            disabled={!isConnected || entityManager.isCreating}
                        >
                            {entityManager.isCreating
                                ? `Creating... (${entityManager.entityCount})`
                                : "Create 1000 Entities"}
                        </button>

                        <button
                            type="button"
                            onClick={() => handleUpdateEntities(10)}
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
                            onClick={() => handleUpdateEntities(50)}
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

                    {isConnected && <StatsDisplay stats={networkStats.stats} />}
                </div>
            </div>

            <div className="canvas-container">
                <Canvas>
                    <Scene />
                    <Entities entities={entityManager.entities} />
                </Canvas>
                {vircadiaCore && (
                    <ConnectionStatus vircadiaCore={vircadiaCore} />
                )}
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
