import { createSignal, onMount } from "solid-js";
import { VircadiaConfig_BROWSER_CLIENT } from "../../../../../sdk/vircadia-world-sdk-ts/config/vircadia.browser.client.config";
import { VircadiaProvider, useVircadia } from "../solid/hook/useVircadia";
import { Communication } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";

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

// Main content component with Vircadia hook
function MainContent() {
    const [count, setCount] = createSignal(0);
    const vircadia = useVircadia();
    const [connectionState, setConnectionState] = createSignal("Not connected");

    onMount(async () => {
        if (vircadia.isReady) {
            const success = await vircadia.connect();
            setConnectionState(success ? "Connected" : "Connection failed");
        }
    });

    return (
        <main>
            <h1>Hello world!</h1>
            <div class="connection-status">
                <p>Vircadia status: {vircadia.connectionStatus}</p>
                <p>Connection state: {connectionState()}</p>
                {vircadia.error && (
                    <p class="error">Error: {vircadia.error.message}</p>
                )}
            </div>
            <button
                class="increment"
                onClick={() => setCount(count() + 1)}
                type="button"
            >
                Clicks: {count()}
            </button>
            <p>
                Visit{" "}
                <a href="https://start.solidjs.com" target="_blank">
                    start.solidjs.com
                </a>{" "}
                to learn how to build SolidStart apps.
            </p>
        </main>
    );
}

// Main App component with VircadiaProvider
export default function App() {
    return (
        <VircadiaProvider config={vircadiaConfig} autoConnect={false}>
            <MainContent />
        </VircadiaProvider>
    );
}
