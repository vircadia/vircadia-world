import { useState, useEffect } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
import { OrbitControls, Stats } from "@react-three/drei";
import { VircadiaProvider } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/react/VircadiaProvider";
import { VircadiaConfig_BROWSER_CLIENT } from "../../../../../sdk/vircadia-world-sdk-ts/config/vircadia.browser.client.config";
import { Communication } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { useVircadiaQuery } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/react/hook/useVircadiaQuery";
import { useVircadiaConnection } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/react/hook/useVircadiaConnection";
import VircadiaConnectionStatus from "./components/VircadiaConnectionStatus";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { Suspense } from "react";
import "./App.css";

// Server connection constants
const SERVER_URL =
    VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEFAULT_WORLD_API_URI_USING_SSL
        ? `https://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`
        : `http://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`;

// Configure server settings
const vircadiaConfig = {
    serverUrl: SERVER_URL,
    authToken:
        VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG_SESSION_TOKEN,
    authProvider:
        VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG_SESSION_TOKEN_PROVIDER,
    debug: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG,
    suppress: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_SUPPRESS,
    reconnectAttempts: 5,
    reconnectDelay: 5000,
};

// Helper component to load and display instanced meshes for a list of URLs
const LoadedInstancedMeshes = ({ urls }: { urls: string[] }): JSX.Element => {
    // Use useLoader with a custom loader setup for DRACO
    const gltfs = useLoader(GLTFLoader, urls, (loader) => {
        // Set up DRACO loader
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath("/lib/draco/");
        (loader as GLTFLoader).setDRACOLoader(dracoLoader);
    });

    return (
        <>
            {gltfs.map((gltf, index) => {
                const originalMesh = gltf.scene.children[0] as THREE.Mesh;
                if (!originalMesh || !originalMesh.isMesh) {
                    console.warn(
                        `Asset at URL ${urls[index]} does not contain a valid mesh at index 0.`,
                    );
                    return null;
                }
                const geometry = originalMesh.geometry;
                const material = originalMesh.material;

                const instancedMesh = new THREE.InstancedMesh(
                    geometry,
                    material,
                    100,
                );

                const matrix = new THREE.Matrix4();
                for (let i = 0; i < 100; i++) {
                    matrix.setPosition(
                        Math.random() * 20 - 10,
                        Math.random() * 20 - 10,
                        Math.random() * 20 - 10,
                    );
                    instancedMesh.setMatrixAt(i, matrix);
                }
                instancedMesh.instanceMatrix.needsUpdate = true;

                return (
                    <primitive
                        key={`${urls[index]}-${index}`}
                        object={instancedMesh}
                    />
                );
            })}
        </>
    );
};

// Refactored component for instanced meshes using useLoader
const InstancedMeshes = () => {
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
                    asset__data__base64: string;
                    asset__mime_type: string;
                }>({
                    query: "SELECT general__asset_file_name, asset__data__bytea, asset__mime_type FROM entity.entity_assets WHERE asset__data__bytea IS NOT NULL",
                });

                const dataList = result.map((item) => ({
                    name: item.general__asset_file_name,
                    bytea: item.asset__data__bytea,
                    type: item.asset__mime_type,
                }));
                setAssetDataList(dataList);
            } catch (error) {
                console.error("Failed to fetch asset data:", error);
            }
        };

        fetchAssetData();
    }, [executeQuery, connectionStatus]);

    // Convert bytea to Blob URL
    const assetUrls = assetDataList.map((data) => {
        let mime = "model/gltf-binary";
        if (data.type && data.type.toLowerCase() === "gltf") {
            mime = "model/gltf+json";
        }
        // Handle { type: 'Buffer', data: [...] }
        let byteArray: number[] = [];
        if (
            data.bytea &&
            typeof data.bytea === "object" &&
            Array.isArray(data.bytea.data)
        ) {
            byteArray = data.bytea.data;
        } else if (Array.isArray(data.bytea)) {
            byteArray = data.bytea;
        } else {
            console.warn(
                "Unknown bytea format for asset",
                data.name,
                data.bytea,
            );
        }
        const uint8 = new Uint8Array(byteArray);
        const blob = new Blob([uint8], { type: mime });
        return URL.createObjectURL(blob);
    });

    return (
        <Suspense fallback={null}>
            {assetUrls.length > 0 && <LoadedInstancedMeshes urls={assetUrls} />}
        </Suspense>
    );
};

// Updated SimpleScene component
const SimpleScene = () => {
    return (
        <>
            <ambientLight intensity={0.5} />
            <directionalLight position={[10, 10, 5]} intensity={1} />
            <InstancedMeshes />
            <gridHelper args={[10, 10]} />
            <axesHelper args={[5]} />
            <OrbitControls />
            <Stats />
        </>
    );
};

// Add CSS for full viewport
const styles = {
    container: {
        width: "100vw",
        height: "100vh",
        position: "fixed" as const,
        top: 0,
        left: 0,
    },
};

function AppWithVircadia() {
    const [autoConnect, setAutoConnect] = useState(true);

    useEffect(() => {
        const handleResize = () => {
            window.dispatchEvent(new Event("resize"));
        };

        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    return (
        <VircadiaProvider config={vircadiaConfig} autoConnect={autoConnect}>
            <div style={styles.container}>
                <Canvas shadows camera={{ position: [3, 3, 3], fov: 50 }}>
                    <SimpleScene />
                </Canvas>

                <VircadiaConnectionStatus />

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

export default AppWithVircadia;
