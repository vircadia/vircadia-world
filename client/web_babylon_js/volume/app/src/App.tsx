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
import { useVircadiaAsset } from "../solid/hook/useVircadiaAsset";
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

// Simple MainContent component
function MainContent() {
    const [count, setCount] = createSignal(0);
    const vircadia = useVircadia();
    const [connectionState, setConnectionState] = createSignal("Not connected");
    const [showRenderer, setShowRenderer] = createSignal(false);
    const [assetNames, setAssetNames] = createSignal<string[]>([]);
    const [loadingAssets, setLoadingAssets] = createSignal(false);
    const [assetError, setAssetError] = createSignal<string | null>(null);

    const fetchAssetNames = async () => {
        try {
            setLoadingAssets(true);
            setAssetError(null);

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
                setAssetNames(names);
                console.log(`Found ${names.length} assets in the database`);
            } else {
                setAssetNames([]);
                console.log("No assets found or unexpected result format");
            }
        } catch (err) {
            console.error("Failed to fetch asset names:", err);
            setAssetError(
                err instanceof Error
                    ? err.message
                    : "Failed to fetch asset names",
            );
            setAssetNames([]);
        } finally {
            setLoadingAssets(false);
        }
    };

    onMount(async () => {
        if (vircadia.isReady) {
            const success = await vircadia.connect();
            setConnectionState(success ? "Connected" : "Connection failed");
            if (success) {
                setShowRenderer(true);
                // Fetch asset names after successful connection
                await fetchAssetNames();
            }
        }
    });

    return (
        <main>
            <h1>Vircadia 3D Viewer</h1>
            <div class="connection-status">
                <p>Vircadia status: {vircadia.connectionStatus}</p>
                <p>Connection state: {connectionState()}</p>
                {vircadia.error && (
                    <p class="error">Error: {vircadia.error.message}</p>
                )}
            </div>

            <button
                type="button"
                class="show-button"
                onClick={() => setShowRenderer(!showRenderer())}
                disabled={vircadia.connectionStatus !== "connected"}
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
                        loadingAssets() ||
                        vircadia.connectionStatus !== "connected"
                    }
                >
                    Refresh Assets
                </button>

                {loadingAssets() ? (
                    <p>Loading assets...</p>
                ) : assetError() ? (
                    <p class="error">Error loading assets: {assetError()}</p>
                ) : assetNames().length === 0 ? (
                    <p>No assets found in the database.</p>
                ) : (
                    <div class="assets-list">
                        <p>Found {assetNames().length} assets:</p>
                        <ul>
                            <For each={assetNames()}>
                                {(name) => <li class="asset-item">{name}</li>}
                            </For>
                        </ul>
                    </div>
                )}
            </div>

            <button
                class="increment"
                onClick={() => setCount(count() + 1)}
                type="button"
            >
                Clicks: {count()}
            </button>
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
                
                .error {
                    color: #d32f2f;
                }
            `}</style>
        </VircadiaProvider>
    );
}
