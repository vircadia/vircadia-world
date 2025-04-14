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

// First, let's add a declaration for the global window.networkStats property
declare global {
    interface Window {
        networkStats: ReturnType<typeof useNetworkStats> | null;
    }
}

// Constants for benchmark
const BENCHMARK_PREFIX = "benchmark_";
const ENTITY_CREATE_COUNT = 200; // Default number of entities to create
const AUTO_UPDATE_INTERVAL = 100; // Update entities every 100ms
const POLL_INTERVAL = 500; // Poll for changes every 500ms

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
        Map<
            string,
            {
                position: THREE.Vector3;
                color: THREE.Color;
                velocity: THREE.Vector3;
            }
        >
    >(new Map());
    const [isCreating, setIsCreating] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [isPolling, setIsPolling] = useState(false);
    const [cleaned, setCleaned] = useState(false);
    const entitiesRef = useRef(entities);
    const autoUpdateIntervalRef = useRef<number | null>(null);
    const pollIntervalRef = useRef<number | null>(null);
    const lastPollTimeRef = useRef<Date | null>(null);

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
            // Delete any existing benchmark entities
            await vircadiaCore.Utilities.Connection.query({
                query: "DELETE FROM entity.entities WHERE general__entity_name LIKE $1",
                parameters: [`${BENCHMARK_PREFIX}%`],
            });

            setCleaned(true);
            setEntities(new Map());
            console.log("Cleaned up existing benchmark entities");
        } catch (error) {
            console.error("Error cleaning up benchmark entities:", error);
        }
    };

    // Create entities on the server
    const createEntities = async (count: number = ENTITY_CREATE_COUNT) => {
        if (!vircadiaCore || isCreating) return;

        setIsCreating(true);
        console.log(`Creating ${count} entities...`);

        try {
            // Delete any existing benchmark entities first
            await cleanExistingEntities();

            // Create new entities
            const newEntities = new Map();
            const entityParams = [];

            // Calculate grid dimensions based on count
            const gridSize = Math.ceil(Math.sqrt(count));
            const spacing = 1.0; // Space between entities

            // Prepare all entities
            for (let i = 0; i < count; i++) {
                // Calculate grid position
                const row = Math.floor(i / gridSize);
                const col = i % gridSize;

                const position = new THREE.Vector3(
                    (col - gridSize / 2) * spacing,
                    0, // Keep all at same y level for a flat grid
                    (row - gridSize / 2) * spacing,
                );

                const color = new THREE.Color(
                    Math.random(),
                    Math.random(),
                    Math.random(),
                );

                // Add random velocity for movement
                const velocity = new THREE.Vector3(
                    (Math.random() - 0.5) * 0.02,
                    0,
                    (Math.random() - 0.5) * 0.02,
                );

                // Create entity metadata
                const entityData = {
                    transform_position_x: { value: position.x },
                    transform_position_y: { value: position.y },
                    transform_position_z: { value: position.z },
                    rendering_color_r: { value: color.r },
                    rendering_color_g: { value: color.g },
                    rendering_color_b: { value: color.b },
                    benchmark: { value: true },
                };

                entityParams.push(
                    `${BENCHMARK_PREFIX}${i}`,
                    JSON.stringify(entityData),
                );
            }

            // Build a single SQL query to insert all entities
            const placeholders = Array(count)
                .fill(0)
                .map((_, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2}::jsonb)`)
                .join(", ");

            const query = `
                INSERT INTO entity.entities (
                    general__entity_name,
                    meta__data
                ) VALUES ${placeholders}
                RETURNING general__entity_id, meta__data
            `;

            // Execute the batch insert
            const response = await vircadiaCore.Utilities.Connection.query<
                Array<{ general__entity_id: string; meta__data: any }>
            >({
                query,
                parameters: entityParams,
            });

            // Process created entities
            if (response.result && response.result.length > 0) {
                response.result.forEach((entity, idx) => {
                    const entityId = entity.general__entity_id;
                    const data = entity.meta__data;

                    if (data) {
                        const position = new THREE.Vector3(
                            data.transform_position_x?.value || 0,
                            data.transform_position_y?.value || 0,
                            data.transform_position_z?.value || 0,
                        );

                        const color = new THREE.Color(
                            data.rendering_color_r?.value || 0,
                            data.rendering_color_g?.value || 0,
                            data.rendering_color_b?.value || 0,
                        );

                        // Add random velocity for movement
                        const velocity = new THREE.Vector3(
                            (Math.random() - 0.5) * 0.02,
                            0,
                            (Math.random() - 0.5) * 0.02,
                        );

                        newEntities.set(entityId, {
                            position,
                            color,
                            velocity,
                        });
                    }
                });
            }

            setEntities(newEntities);
            console.log(`Created ${newEntities.size} entities`);

            // Start auto-updating and polling
            startAutoUpdate();
            startPolling();
        } catch (error) {
            console.error("Error creating entities:", error);
        } finally {
            setIsCreating(false);
        }
    };

    // Start automatically moving entities
    const startAutoUpdate = () => {
        if (autoUpdateIntervalRef.current) {
            window.clearInterval(autoUpdateIntervalRef.current);
        }

        autoUpdateIntervalRef.current = window.setInterval(() => {
            updateEntityPositions();
        }, AUTO_UPDATE_INTERVAL);

        console.log("Started automatic entity movement");
    };

    // Stop automatic updates
    const stopAutoUpdate = () => {
        if (autoUpdateIntervalRef.current) {
            window.clearInterval(autoUpdateIntervalRef.current);
            autoUpdateIntervalRef.current = null;
            console.log("Stopped automatic entity movement");
        }
    };

    // Update entity positions with their velocity
    const updateEntityPositions = async () => {
        if (!vircadiaCore || entitiesRef.current.size === 0) return;

        try {
            // Create a copy of the current entities map
            const updatedEntities = new Map(entitiesRef.current);
            const entitiesToUpdate = [];

            // Update 10% of entities every update interval
            const entityIds = Array.from(updatedEntities.keys());
            const updateCount = Math.max(1, Math.floor(entityIds.length * 0.1));
            const selectedIds = entityIds
                .sort(() => 0.5 - Math.random())
                .slice(0, updateCount);

            // Update positions based on velocity
            for (const id of selectedIds) {
                const entity = updatedEntities.get(id);
                if (entity) {
                    // Update position with velocity
                    entity.position.add(entity.velocity);

                    // Occasionally change velocity
                    if (Math.random() < 0.1) {
                        entity.velocity.set(
                            (Math.random() - 0.5) * 0.02,
                            0,
                            (Math.random() - 0.5) * 0.02,
                        );
                    }

                    // Add to list of entities to update on server
                    entitiesToUpdate.push({
                        id,
                        x: entity.position.x,
                        y: entity.position.y,
                        z: entity.position.z,
                    });
                }
            }

            // Update local state first for immediate visual feedback
            setEntities(updatedEntities);

            // Send updates to server if we have entities to update
            if (entitiesToUpdate.length > 0) {
                // Build SQL for updating all entities at once
                const updateStatements = entitiesToUpdate
                    .map(
                        (entity) => `
                    UPDATE entity.entities 
                    SET meta__data = jsonb_set(
                        jsonb_set(
                            jsonb_set(
                                meta__data,
                                '{transform_position_x}', 
                                '{"value": ${entity.x}}'::jsonb
                            ),
                            '{transform_position_y}', 
                            '{"value": ${entity.y}}'::jsonb
                        ),
                        '{transform_position_z}', 
                        '{"value": ${entity.z}}'::jsonb
                    )
                    WHERE general__entity_id = '${entity.id}'
                `,
                    )
                    .join(";");

                // Execute the batch update
                await vircadiaCore.Utilities.Connection.query({
                    query: updateStatements,
                });

                // Record updates for stats
                if (window.networkStats) {
                    window.networkStats.recordPushedUpdate(
                        entitiesToUpdate.length,
                    );
                }
            }
        } catch (error) {
            console.error("Error updating entity positions:", error);
        }
    };

    // Poll for entity updates from server
    const pollForUpdates = useCallback(async () => {
        if (!vircadiaCore || !vircadiaCore.Utilities.Connection.isConnected())
            return;

        try {
            const currentTime = new Date();

            // Get all current entity IDs from the server
            const idsResponse = await vircadiaCore.Utilities.Connection.query<
                Array<{ general__entity_id: string }>
            >({
                query: `
                    SELECT general__entity_id
                    FROM entity.entities
                    WHERE general__entity_name LIKE $1
                `,
                parameters: [`${BENCHMARK_PREFIX}%`],
            });

            // Create a Set of current server entity IDs for efficient lookup
            const serverEntityIds = new Set(
                idsResponse.result?.map((item) => item.general__entity_id) ||
                    [],
            );

            // Only fetch entities that have been updated since last poll
            const timeCondition = lastPollTimeRef.current
                ? "AND general__updated_at > $2"
                : "";

            const timeParams = lastPollTimeRef.current
                ? [lastPollTimeRef.current.toISOString()]
                : [];

            // Get updated entities from server
            const response = await vircadiaCore.Utilities.Connection.query<
                Array<{
                    general__entity_id: string;
                    meta__data: any;
                }>
            >({
                query: `
                    SELECT general__entity_id, meta__data 
                    FROM entity.entities 
                    WHERE general__entity_name LIKE $1
                    ${timeCondition}
                `,
                parameters: [`${BENCHMARK_PREFIX}%`, ...timeParams],
            });

            // Process updates if we have any
            if (response.result && response.result.length > 0) {
                // Update local entities map based on server data
                const updatedEntities = new Map(entitiesRef.current);
                let updatedCount = 0;

                for (const entity of response.result) {
                    const data = entity.meta__data;
                    const entityId = entity.general__entity_id;

                    // Get current entity if it exists
                    const currentEntity = updatedEntities.get(entityId);

                    if (data && currentEntity) {
                        // Update position if present in data
                        if (
                            data.transform_position_x?.value !== undefined &&
                            data.transform_position_y?.value !== undefined &&
                            data.transform_position_z?.value !== undefined
                        ) {
                            currentEntity.position.set(
                                data.transform_position_x.value,
                                data.transform_position_y.value,
                                data.transform_position_z.value,
                            );
                            updatedCount++;
                        }

                        // Update color if present in data
                        if (
                            data.rendering_color_r?.value !== undefined &&
                            data.rendering_color_g?.value !== undefined &&
                            data.rendering_color_b?.value !== undefined
                        ) {
                            currentEntity.color.setRGB(
                                data.rendering_color_r.value,
                                data.rendering_color_g.value,
                                data.rendering_color_b.value,
                            );
                        }
                    }
                }

                // Update state with modified map if we had changes
                if (updatedCount > 0) {
                    setEntities(new Map(updatedEntities));
                    console.log(`Updated ${updatedCount} entities from server`);

                    // Record the number of entities we downloaded
                    if (window.networkStats) {
                        window.networkStats.recordDownloadedUpdate(
                            updatedCount,
                        );
                    }
                }
            }

            // Update last poll time for next poll
            lastPollTimeRef.current = currentTime;
        } catch (error) {
            console.error("Error polling for entity updates:", error);
        }
    }, [vircadiaCore]);

    // Start polling for updates from server
    const startPolling = useCallback(() => {
        if (pollIntervalRef.current) {
            window.clearInterval(pollIntervalRef.current);
        }

        pollIntervalRef.current = window.setInterval(() => {
            pollForUpdates();
        }, POLL_INTERVAL);

        setIsPolling(true);
        console.log(
            `Started polling for entity updates every ${POLL_INTERVAL}ms`,
        );
    }, [pollForUpdates]);

    // Stop polling
    const stopPolling = useCallback(() => {
        if (pollIntervalRef.current) {
            window.clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
            setIsPolling(false);
            console.log("Stopped polling for entity updates");
        }
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopAutoUpdate();
            stopPolling();
        };
    }, [stopPolling]);

    return {
        entities,
        createEntities,
        isCreating,
        isUpdating,
        isPolling,
        cleanExistingEntities,
        startPolling,
        stopPolling,
        startAutoUpdate,
        stopAutoUpdate,
    };
}

// Entity visualization
function Entities({
    entities,
}: {
    entities: Map<
        string,
        {
            position: THREE.Vector3;
            color: THREE.Color;
            velocity?: THREE.Vector3;
        }
    >;
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
                    <boxGeometry args={[0.2, 0.2, 0.2]} />
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
    const [isRunning, setIsRunning] = useState(false);
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
        networkStatsRef.current.updateEntityCount(entityManager.entities.size);
    }, [entityManager.entities.size]);

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

    // Start benchmark
    const startBenchmark = async () => {
        if (!isConnected || isRunning) return;

        setIsRunning(true);

        // Create entities with auto-movement
        await entityManager.createEntities(ENTITY_CREATE_COUNT);
    };

    // Stop benchmark
    const stopBenchmark = () => {
        if (!isRunning) return;

        // Stop all automatic processes
        entityManager.stopAutoUpdate();
        entityManager.stopPolling();
        setIsRunning(false);
    };

    // Disconnect and clean up
    const handleDisconnect = () => {
        if (!vircadiaCore) return;

        // Stop benchmark if running
        stopBenchmark();

        // Disconnect from server
        vircadiaCore.Utilities.Connection.disconnect();
        setIsConnected(false);
        networkStats.resetStats();
        console.log("Disconnected from Vircadia server");
    };

    // Make networkStats accessible globally
    useEffect(() => {
        window.networkStats = networkStats;
        return () => {
            window.networkStats = null;
        };
    }, [networkStats]);

    return (
        <div className="benchmark-container">
            <div className="control-panel">
                <div className="benchmark-controls">
                    <h3>Vircadia Entity Roundtrip Demo</h3>
                    <p className="description">
                        This demo shows real-time entity movement with server
                        synchronization. Entities are continuously updated
                        locally and synced with the server.
                    </p>

                    <div className="connection-controls">
                        <button
                            type="button"
                            onClick={() => connectToServer(vircadiaCore!)}
                            disabled={isConnected || !vircadiaCore}
                        >
                            Connect to Server
                        </button>
                        <button
                            type="button"
                            onClick={handleDisconnect}
                            disabled={!isConnected || !vircadiaCore}
                        >
                            Disconnect
                        </button>
                    </div>

                    <div className="benchmark-main-controls">
                        <button
                            type="button"
                            className={isRunning ? "running" : ""}
                            onClick={isRunning ? stopBenchmark : startBenchmark}
                            disabled={!isConnected || entityManager.isCreating}
                        >
                            {!isConnected
                                ? "Connect to Start"
                                : isRunning
                                  ? "Stop Demo"
                                  : entityManager.isCreating
                                    ? "Creating Entities..."
                                    : "Start Demo"}
                        </button>

                        <div className="entity-count">
                            <span>Entities: {entityManager.entities.size}</span>
                        </div>
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
