import {
    createContext,
    createSignal,
    createEffect,
    onCleanup,
    useContext,
    type JSX,
} from "solid-js";
import type {
    VircadiaClientCore,
    VircadiaClientCoreConfig,
} from "../../../../../../sdk/vircadia-world-sdk-ts/module/client/core/vircadia.client.core";
import { VircadiaClientCore as VircadiaClientCoreImpl } from "../../../../../../sdk/vircadia-world-sdk-ts/module/client/core/vircadia.client.core";

// Define types for our context
type ConnectionStatus =
    | "connected"
    | "connecting"
    | "reconnecting"
    | "disconnected";

interface VircadiaContextType {
    client: VircadiaClientCore | null;
    connectionStatus: ConnectionStatus;
    error: Error | null;
    isReady: boolean;
    connect: () => Promise<boolean>;
    disconnect: () => void;
    query: <T = unknown>(options: {
        query: string;
        parameters?: unknown[];
        timeoutMs?: number;
    }) => Promise<T[]>;
}

// Create context
const VircadiaContext = createContext<VircadiaContextType>({
    client: null,
    connectionStatus: "disconnected",
    error: null,
    isReady: false,
    connect: async () => false,
    disconnect: () => {},
    query: async () => [],
});

// Provider props
interface VircadiaProviderProps {
    children: JSX.Element;
    config: VircadiaClientCoreConfig;
    autoConnect?: boolean;
}

export function VircadiaProvider(props: VircadiaProviderProps) {
    const [client, setClient] = createSignal<VircadiaClientCore | null>(null);
    const [connectionStatus, setConnectionStatus] =
        createSignal<ConnectionStatus>("disconnected");
    const [error, setError] = createSignal<Error | null>(null);
    const [isReady, setIsReady] = createSignal(false);

    // Connect function
    const connect = async () => {
        const currentClient = client();
        if (!currentClient) return false;

        try {
            setConnectionStatus("connecting");
            setError(null);

            const success = await currentClient.Utilities.Connection.connect();
            if (success) {
                setConnectionStatus("connected");
            } else {
                setConnectionStatus("disconnected");
            }

            return success;
        } catch (err) {
            setError(
                err instanceof Error ? err : new Error("Connection failed"),
            );
            setConnectionStatus("disconnected");
            return false;
        }
    };

    // Disconnect function
    const disconnect = () => {
        const currentClient = client();
        if (!currentClient) return;

        currentClient.Utilities.Connection.disconnect();
        setConnectionStatus("disconnected");
    };

    // Initialize client
    createEffect(() => {
        try {
            const newClient = new VircadiaClientCoreImpl(props.config);
            setClient(newClient);
            setIsReady(true);

            onCleanup(() => {
                newClient.dispose();
            });
        } catch (err) {
            setError(
                err instanceof Error
                    ? err
                    : new Error("Failed to initialize Vircadia client"),
            );
            setIsReady(false);
        }
    });

    // Monitor connection status changes
    createEffect(() => {
        const currentClient = client();
        if (!currentClient) return;

        // Define event listeners for connection status changes
        const handleStatusChange = () => {
            if (currentClient.Utilities.Connection.isConnected()) {
                setConnectionStatus("connected");
            } else if (currentClient.Utilities.Connection.isConnecting()) {
                setConnectionStatus("connecting");
            } else if (currentClient.Utilities.Connection.isReconnecting()) {
                setConnectionStatus("reconnecting");
            } else {
                setConnectionStatus("disconnected");
            }
        };

        // Check if event listener methods exist
        const connection = currentClient.Utilities.Connection;
        if (
            "addEventListener" in connection &&
            "removeEventListener" in connection
        ) {
            // Subscribe to connection events
            connection.addEventListener("statusChange", handleStatusChange);

            // Initial status check
            handleStatusChange();

            onCleanup(() => {
                connection.removeEventListener(
                    "statusChange",
                    handleStatusChange,
                );
            });
        } else {
            // Fallback to initial status check only
            handleStatusChange();
        }
    });

    // Auto-connect if enabled
    createEffect(() => {
        if (props.autoConnect && client() && isReady()) {
            connect();
        }
    });

    // Query function
    const query = async <T = unknown>(options: {
        query: string;
        parameters?: unknown[];
        timeoutMs?: number;
    }): Promise<T[]> => {
        const currentClient = client();
        if (
            !currentClient ||
            !currentClient.Utilities.Connection.isConnected()
        ) {
            throw new Error("Not connected to server");
        }

        try {
            const response =
                await currentClient.Utilities.Connection.query<T[]>(options);
            return response.result || [];
        } catch (err) {
            throw err instanceof Error ? err : new Error("Query failed");
        }
    };

    // Create context value
    const contextValue = {
        get client() {
            return client();
        },
        get connectionStatus() {
            return connectionStatus();
        },
        get error() {
            return error();
        },
        get isReady() {
            return isReady();
        },
        connect,
        disconnect,
        query,
    };

    return (
        <VircadiaContext.Provider value={contextValue}>
            {props.children}
        </VircadiaContext.Provider>
    );
}

// Export useVircadia hook
export function useVircadia() {
    return useContext(VircadiaContext);
}
