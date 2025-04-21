import { useEffect, useRef, useState } from "react";
import "./App.css";
import {
    Engine,
    Scene,
    ArcRotateCamera,
    HemisphericLight,
    Vector3,
    MeshBuilder,
    Color4,
    ImportMeshAsync,
} from "@babylonjs/core";
import "@babylonjs/loaders";
import { VircadiaProvider } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/react/VircadiaProvider";
import { VircadiaConfig_BROWSER_CLIENT } from "../../../../../sdk/vircadia-world-sdk-ts/config/vircadia.browser.client.config";
import { Communication } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { useVircadiaQuery } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/react/hook/useVircadiaQuery";
import { useVircadiaConnection } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/react/hook/useVircadiaConnection";

// Server connection constants
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

function BabylonScene({
    assetDataList,
}: { assetDataList: { name: string; bytea: number[]; type: string }[] }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<Engine | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const engine = new Engine(canvas, true, {
            preserveDrawingBuffer: true,
            stencil: true,
        });
        engineRef.current = engine;
        const scene = new Scene(engine);
        scene.clearColor = new Color4(0.1, 0.1, 0.1, 1);

        // Camera
        const camera = new ArcRotateCamera(
            "camera",
            Math.PI / 2,
            Math.PI / 3,
            10,
            new Vector3(0, 1, 0),
            scene,
        );
        camera.attachControl(canvas, true);

        // Light
        new HemisphericLight("light", new Vector3(0, 1, 0), scene);

        // Ground
        MeshBuilder.CreateGround("ground", { width: 20, height: 20 }, scene);

        // Load assets from Vircadia
        for (const data of assetDataList) {
            let mime = "model/gltf-binary";
            if (data.type && data.type.toLowerCase() === "gltf") {
                mime = "model/gltf+json";
            }
            let byteArray: number[] = [];
            if (
                data.bytea &&
                typeof data.bytea === "object" &&
                "data" in data.bytea &&
                Array.isArray((data.bytea as any).data)
            ) {
                byteArray = (data.bytea as any).data;
            } else if (Array.isArray(data.bytea)) {
                byteArray = data.bytea;
            }
            const uint8 = new Uint8Array(byteArray);
            const blob = new Blob([uint8], { type: mime });
            const url = URL.createObjectURL(blob);

            ImportMeshAsync(url, scene, {
                pluginExtension: ".glb",
            });
        }

        engine.runRenderLoop(() => {
            scene.render();
        });

        const handleResize = () => {
            engine.resize();
        };
        window.addEventListener("resize", handleResize);

        return () => {
            window.removeEventListener("resize", handleResize);
            engine.stopRenderLoop();
            scene.dispose();
            engine.dispose();
        };
    }, [assetDataList]);

    return (
        <canvas
            ref={canvasRef}
            style={{ width: "100vw", height: "100vh", display: "block" }}
        />
    );
}

function VircadiaBabylonApp() {
    const [assetDataList, setAssetDataList] = useState<
        { name: string; bytea: number[]; type: string }[]
    >([]);
    const executeQuery = useVircadiaQuery();
    const { connectionStatus } = useVircadiaConnection();

    useEffect(() => {
        if (connectionStatus !== "connected") return;

        const fetchAssetData = async () => {
            try {
                const result = await executeQuery<{
                    general__asset_file_name: string;
                    asset__data__bytea: number[];
                    asset__type: string;
                }>({
                    query: "SELECT general__asset_file_name, asset__data__bytea, asset__type FROM entity.entity_assets WHERE asset__data__bytea IS NOT NULL",
                });

                const dataList = result.map((item) => ({
                    name: item.general__asset_file_name,
                    bytea: item.asset__data__bytea,
                    type: item.asset__type,
                }));
                setAssetDataList(dataList);
            } catch (error) {
                console.error("Failed to fetch asset data:", error);
            }
        };

        fetchAssetData();
    }, [executeQuery, connectionStatus]);

    return <BabylonScene assetDataList={assetDataList} />;
}

function App() {
    const [autoConnect, setAutoConnect] = useState(true);

    return (
        <VircadiaProvider config={vircadiaConfig} autoConnect={autoConnect}>
            <div
                style={{
                    width: "100vw",
                    height: "100vh",
                    position: "fixed",
                    top: 0,
                    left: 0,
                }}
            >
                <VircadiaBabylonApp />
                <div
                    style={{
                        position: "absolute",
                        bottom: "10px",
                        left: "10px",
                        padding: "10px",
                        backgroundColor: "rgba(0,0,0,0.7)",
                        color: "white",
                        borderRadius: "5px",
                    }}
                >
                    <label>
                        <input
                            type="checkbox"
                            checked={autoConnect}
                            onChange={(e) => setAutoConnect(e.target.checked)}
                        />
                        {" Auto-connect on startup"}
                    </label>
                </div>
            </div>
        </VircadiaProvider>
    );
}

export default App;
