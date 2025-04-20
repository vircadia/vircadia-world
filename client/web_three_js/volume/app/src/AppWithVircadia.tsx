import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stats } from "@react-three/drei";
import { VircadiaProvider } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/react/VircadiaProvider";
import { VircadiaConfig_BROWSER_CLIENT } from "../../../../../sdk/vircadia-world-sdk-ts/config/vircadia.browser.client.config";
import { Communication } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import VircadiaConnectionStatus from "./components/VircadiaConnectionStatus";

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

// Simple Scene component
const SimpleScene = () => {
    return (
        <>
            <ambientLight intensity={0.5} />
            <directionalLight position={[10, 10, 5]} intensity={1} />
            <mesh>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color="royalblue" />
            </mesh>
            <gridHelper args={[10, 10]} />
            <axesHelper args={[5]} />
            <OrbitControls />
            <Stats />
        </>
    );
};

function AppWithVircadia() {
    const [autoConnect, setAutoConnect] = useState(true);

    return (
        <VircadiaProvider config={vircadiaConfig} autoConnect={autoConnect}>
            <div className="app">
                {/* Main 3D Canvas */}
                <Canvas shadows camera={{ position: [3, 3, 3], fov: 50 }}>
                    <SimpleScene />
                </Canvas>

                {/* UI Components */}
                <VircadiaConnectionStatus />

                {/* Auto Connect Toggle */}
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
