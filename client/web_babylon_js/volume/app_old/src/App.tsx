import {
    createSignal,
    onMount,
    onCleanup,
    createEffect,
    Show,
    For,
} from "solid-js";
import { VircadiaConfig_BROWSER_CLIENT } from "../../../../../sdk/vircadia-world-sdk-ts/config/vircadia.browser.client.config";
import { VircadiaProvider, useVircadia } from "../solid/hook/useVircadia";
import {
    VircadiaAsset,
    type VircadiaAssetData,
} from "../solid/component/VircadiaAsset";
import { Communication } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import {
    MeshBuilder,
    StandardMaterial,
    ArcRotateCamera,
    HemisphericLight,
    Vector3,
    Color3,
    WebGPUEngine,
    Scene,
} from "@babylonjs/core";
import "@babylonjs/loaders";

const SERVER_URL =
    VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI_USING_SSL
        ? `https://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`
        : `http://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`;

// Configure server settings
const vircadiaConfig = {
    serverUrl: SERVER_URL,
    authToken:
        VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN,
    authProvider:
        VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER,
    debug: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG,
    suppress: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_SUPPRESS,
    reconnectAttempts: 5,
    reconnectDelay: 5000,
};

// Simple BabylonRenderer component
function BabylonRenderer(props) {
    const [isEngineReady, setIsEngineReady] = createSignal(false);
    const [errorMessage, setErrorMessage] = createSignal(null);

    let engine: WebGPUEngine | null = null;
    let scene: Scene | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let resizeHandler: () => void;

    const initEngine = async () => {
        try {
            if (!canvas) return;

            // Create WebGL engine with fallback
            engine = new WebGPUEngine(canvas, {
                // stencil: true,
            });
            await engine.initAsync();

            // Create a new scene
            scene = new Scene(engine);

            // Setup basic camera and lighting
            const camera = new ArcRotateCamera(
                "camera",
                -Math.PI / 2,
                Math.PI / 2.5,
                10,
                new Vector3(0, 0, 0),
                scene,
            );
            camera.attachControl(canvas, true);

            const light = new HemisphericLight(
                "light",
                new Vector3(0, 1, 0),
                scene,
            );
            light.intensity = 0.7;

            // Create a simple cube for demonstration
            const box = MeshBuilder.CreateBox("box", { size: 2 }, scene);
            const material = new StandardMaterial("boxMat", scene);
            material.diffuseColor = new Color3(0.4, 0.6, 0.8);
            box.material = material;

            // Handle resizing
            resizeHandler = () => {
                if (engine) {
                    engine.resize();
                }
            };

            // Add the event listener to the window
            window.addEventListener("resize", resizeHandler);

            // Start the render loop
            engine.runRenderLoop(() => {
                if (scene) {
                    scene.render();
                }
            });

            setIsEngineReady(true);
        } catch (err) {
            console.error("Failed to initialize Babylon engine:", err);
            setErrorMessage(
                err instanceof Error
                    ? err.message
                    : "Failed to initialize Babylon engine",
            );
        }
    };

    onMount(() => {
        const getCanvas = document.getElementById("babylon-canvas");
        if (getCanvas) {
            canvas = getCanvas as HTMLCanvasElement;
            initEngine();
        }
    });

    onCleanup(() => {
        if (resizeHandler) {
            window.removeEventListener("resize", resizeHandler);
        }
        scene?.dispose();
        engine?.dispose();
    });

    return (
        <div
            class="babylon-container"
            style={{ width: "100%", height: props.height || "500px" }}
        >
            <Show when={errorMessage()}>
                <div class="error-overlay">Error: {errorMessage()}</div>
            </Show>

            <canvas
                id="babylon-canvas"
                style={{ width: "100%", height: "100%" }}
            />
        </div>
    );
}

// Modified MainContent component with asset loading and connection stats
function MainContent() {
    const vircadia = useVircadia();
    const [connectionState, setConnectionState] = createSignal("Not connected");
    const [showRenderer, setShowRenderer] = createSignal(false);
    const [connectionStats, setConnectionStats] = createSignal({
        pendingRequests: [],
        stats: {
            reconnectAttempts: 0,
            pendingRequestsCount: 0,
            connectionDuration: 0,
        },
    });

    // Define a single asset state object
    const [assetsState, setAssetsState] = createSignal({
        names: [],
        loading: false,
        error: null,
        dataMap: {},
        loadingStatus: {},
    });

    // Then update it with fine-grained setters
    const updateAssetData = (name, data) => {
        setAssetsState((prev) => ({
            ...prev,
            dataMap: {
                ...prev.dataMap,
                [name]: data,
            },
        }));
    };

    const fetchAssetNames = async () => {
        try {
            setAssetsState((prev) => ({ ...prev, loading: true, error: null }));

            const result = await vircadia.query<{
                general__asset_file_name: string;
            }>({
                query: `
                    SELECT general__asset_file_name
                    FROM entity.entity_assets
                    ORDER BY general__asset_file_name
                `,
                parameters: [],
            });

            if (result && Array.isArray(result)) {
                const names = result.map((row) => row.general__asset_file_name);
                setAssetsState((prev) => ({ ...prev, names }));
                console.log(`Found ${names.length} assets in the database`);
            } else {
                setAssetsState((prev) => ({ ...prev, names: [] }));
                console.log("No assets found or unexpected result format");
            }
        } catch (err) {
            console.error("Failed to fetch asset names:", err);
            setAssetsState((prev) => ({
                ...prev,
                error:
                    err instanceof Error
                        ? err.message
                        : "Failed to fetch asset names",
                names: [],
            }));
        } finally {
            setAssetsState((prev) => ({ ...prev, loading: false }));
        }
    };

    // Function to update connection stats
    const updateConnectionStats = () => {
        if (
            !vircadia.isReady ||
            vircadia.connectionStatus.status !== "connected"
        )
            return;

        try {
            const pendingRequests = vircadia.getPendingRequests?.() || [];
            const stats = vircadia.getConnectionStats?.() || {
                reconnectAttempts: 0,
                pendingRequestsCount: 0,
            };

            setConnectionStats({
                pendingRequests,
                stats,
            });
        } catch (err) {
            console.error("Failed to get connection stats:", err);
        }
    };

    // Set up regular stats updates when connected
    createEffect(() => {
        if (vircadia.connectionStatus.status === "connected") {
            const intervalId = setInterval(updateConnectionStats, 1000);
            return () => clearInterval(intervalId);
        }
    });

    onMount(async () => {
        if (vircadia.isReady) {
            const success = await vircadia.connect();
            setConnectionState(success ? "Connected" : "Connection failed");
            if (success) {
                setShowRenderer(true);
                // Fetch asset names after successful connection
                await fetchAssetNames();
                // Initial stats update
                updateConnectionStats();
            }
        }
    });

    return (
        <main>
            <h1>Vircadia 3D Viewer</h1>
            <div class="connection-status">
                <p>Vircadia status: {vircadia.connectionStatus.status}</p>
                <p>Connection state: {connectionState()}</p>
                {vircadia.error && (
                    <p class="error">Error: {vircadia.error.message}</p>
                )}

                {/* Add connection stats panel */}
                <div class="connection-stats-panel">
                    <h3>Connection Statistics</h3>
                    <div class="stats-grid">
                        <div class="stat-item">
                            <span class="stat-label">Status:</span>
                            <span
                                class={`stat-value ${vircadia.connectionStatus.status}`}
                            >
                                {vircadia.connectionStatus.status}
                            </span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Duration:</span>
                            <span class="stat-value">
                                {vircadia.connectionStatus.connectionDuration
                                    ? `${Math.floor(
                                          vircadia.connectionStatus
                                              .connectionDuration / 1000,
                                      )}s`
                                    : "N/A"}
                            </span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Reconnect Attempts:</span>
                            <span class="stat-value">
                                {connectionStats().stats.reconnectAttempts}
                            </span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Pending Requests:</span>
                            <span class="stat-value">
                                {connectionStats().stats.pendingRequestsCount}
                            </span>
                        </div>
                    </div>

                    {connectionStats().pendingRequests.length > 0 && (
                        <div class="pending-requests">
                            <h4>Pending Requests:</h4>
                            <ul>
                                <For each={connectionStats().pendingRequests}>
                                    {(request) => (
                                        <li>
                                            ID:{" "}
                                            {request.requestId.substring(0, 8)}
                                            ... (Elapsed:{" "}
                                            {Math.floor(
                                                request.elapsedMs / 1000,
                                            )}
                                            s)
                                        </li>
                                    )}
                                </For>
                            </ul>
                        </div>
                    )}
                </div>
            </div>

            <button
                type="button"
                class="show-button"
                onClick={() => setShowRenderer(!showRenderer())}
                disabled={vircadia.connectionStatus.status !== "connected"}
            >
                {showRenderer() ? "Hide 3D Viewer" : "Show 3D Viewer"}
            </button>

            {showRenderer() && <BabylonRenderer height="500px" />}

            {/* Asset list section */}
            <div class="assets-container">
                <h2>Available Assets</h2>
                <button
                    type="button"
                    class="refresh-button"
                    onClick={fetchAssetNames}
                    disabled={
                        assetsState().loading ||
                        vircadia.connectionStatus.status !== "connected"
                    }
                >
                    Refresh Assets
                </button>

                {assetsState().loading ? (
                    <p>Loading assets...</p>
                ) : assetsState().error ? (
                    <p class="error">
                        Error loading assets: {assetsState().error}
                    </p>
                ) : assetsState().names.length === 0 ? (
                    <p>No assets found in the database.</p>
                ) : (
                    <div class="assets-list">
                        <p>Found {assetsState().names.length} assets:</p>
                        <ul>
                            <For each={assetsState().names}>
                                {(name) => (
                                    <li class="asset-item">
                                        {name}
                                        {/* Use VircadiaAsset for each asset */}
                                        <VircadiaAsset fileName={name}>
                                            {({
                                                assetData,
                                                loading,
                                                error,
                                            }) => {
                                                // Move state updates to a createEffect
                                                createEffect(() => {
                                                    // Update loading status
                                                    setAssetsState((prev) => ({
                                                        ...prev,
                                                        loadingStatus: {
                                                            ...prev.loadingStatus,
                                                            [name]: {
                                                                loading,
                                                                error:
                                                                    error ||
                                                                    null,
                                                            },
                                                        },
                                                    }));

                                                    // Store asset data when loaded
                                                    if (assetData) {
                                                        updateAssetData(
                                                            name,
                                                            assetData,
                                                        );
                                                        console.log(
                                                            `Asset loaded: ${name}`,
                                                        );
                                                    }
                                                });

                                                // Just return the display component
                                                if (error) {
                                                    return (
                                                        <span class="asset-error">
                                                            ⚠️ Error:{" "}
                                                            {error.message ||
                                                                "Unknown error"}
                                                        </span>
                                                    );
                                                }

                                                return loading ? (
                                                    <span class="asset-loading">
                                                        {" "}
                                                        (loading...)
                                                    </span>
                                                ) : (
                                                    <span class="asset-loaded">
                                                        {" "}
                                                        ✓
                                                    </span>
                                                );
                                            }}
                                        </VircadiaAsset>
                                    </li>
                                )}
                            </For>
                        </ul>
                    </div>
                )}
            </div>

            {/* Debug information about loaded assets */}
            <div class="debug-info">
                <h3>Loaded Assets</h3>
                <p>
                    Total assets loaded:{" "}
                    {Object.keys(assetsState().dataMap).length} of{" "}
                    {assetsState().names.length}
                </p>
            </div>
        </main>
    );
}

// Main App component with VircadiaProvider
export default function App() {
    return (
        <VircadiaProvider config={vircadiaConfig} autoConnect={false}>
            <MainContent />
            <style>{`
                .babylon-container {
                    position: relative;
                    border-radius: 8px;
                    overflow: hidden;
                    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                    background-color: #1e1e1e;
                    margin: 20px 0;
                }
                
                .show-button, .increment, .refresh-button {
                    padding: 8px 16px;
                    background-color: #4CAF50;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    margin: 10px 0;
                }
                
                .refresh-button {
                    background-color: #2196F3;
                    margin-left: 10px;
                }
                
                .show-button:disabled, .refresh-button:disabled {
                    background-color: #cccccc;
                    cursor: not-allowed;
                }
                
                .error-overlay {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background-color: rgba(255, 0, 0, 0.2);
                    color: white;
                    padding: 20px;
                    z-index: 10;
                }
                
                .assets-container {
                    margin: 20px 0;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    padding: 15px;
                    background-color: #f5f5f5;
                }
                
                .assets-list {
                    margin-top: 10px;
                }
                
                .asset-item {
                    padding: 5px 0;
                    border-bottom: 1px solid #eee;
                }
                
                .asset-loaded {
                    color: green;
                    margin-left: 5px;
                }
                
                .asset-loading {
                    color: orange;
                    margin-left: 5px;
                }
                
                .asset-error {
                    color: red;
                    margin-left: 5px;
                }
                
                .error {
                    color: #d32f2f;
                }
                
                .debug-info {
                    margin-top: 20px;
                    padding: 10px;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    background-color: #f9f9f9;
                }
                
                .connection-stats-panel {
                    margin: 15px 0;
                    padding: 12px;
                    border-radius: 8px;
                    background-color: #f0f4f8;
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                }
                
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 10px;
                    margin-bottom: 10px;
                }
                
                .stat-item {
                    padding: 6px 10px;
                    background-color: #fff;
                    border-radius: 4px;
                    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
                }
                
                .stat-label {
                    font-weight: bold;
                    margin-right: 5px;
                    color: #555;
                }
                
                .stat-value {
                    font-family: monospace;
                }
                
                .stat-value.connected {
                    color: green;
                }
                
                .stat-value.connecting, .stat-value.reconnecting {
                    color: orange;
                }
                
                .stat-value.disconnected {
                    color: red;
                }
                
                .pending-requests {
                    background-color: #fff;
                    border-radius: 4px;
                    padding: 10px;
                    margin-top: 10px;
                    max-height: 150px;
                    overflow-y: auto;
                }
                
                .pending-requests h4 {
                    margin-top: 0;
                    margin-bottom: 8px;
                    font-size: 14px;
                    color: #555;
                }
                
                .pending-requests ul {
                    margin: 0;
                    padding-left: 20px;
                }
                
                .pending-requests li {
                    font-family: monospace;
                    font-size: 12px;
                    margin-bottom: 4px;
                }
            `}</style>
        </VircadiaProvider>
    );
}
