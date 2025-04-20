import { useState, useEffect } from "react";
import { useVircadiaQuery } from "../../../../../../sdk/vircadia-world-sdk-ts/module/client/react/hook/useVircadiaQuery";
import { useVircadiaConnection } from "../../../../../../sdk/vircadia-world-sdk-ts/module/client/react/hook/useVircadiaConnection";

/**
 * A component that displays the current connection status and provides controls
 * for connecting to and disconnecting from a Vircadia world.
 */
export const VircadiaConnectionStatus = () => {
    const { connectionStatus, connect, disconnect, error } =
        useVircadiaConnection();
    const executeQuery = useVircadiaQuery();
    const [entityCount, setEntityCount] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Get entity count when connected
    useEffect(() => {
        if (connectionStatus === "connected") {
            fetchEntityCount();
        } else {
            setEntityCount(null);
        }
    }, [connectionStatus]);

    // Fetch the count of entities in the world
    const fetchEntityCount = async () => {
        try {
            setIsLoading(true);
            const entities = await executeQuery<{ count: number }>({
                query: "SELECT COUNT(*) as count FROM entity.entities",
            });
            setEntityCount(entities[0]?.count || 0);
        } catch (err) {
            console.error("Failed to fetch entity count:", err);
        } finally {
            setIsLoading(false);
        }
    };

    // Function to get entity by ID
    const getEntityById = async (entityId: string) => {
        return executeQuery({
            query: `
                SELECT * FROM entity.entities 
                WHERE general__entity_id = $1
            `,
            parameters: [entityId],
        });
    };

    // Function to test fetching a specific entity
    const handleFetchEntity = async () => {
        if (connectionStatus !== "connected") {
            alert("Must be connected to fetch entities");
            return;
        }

        try {
            const entityId = prompt("Enter entity ID to fetch:");
            if (!entityId) return;

            const result = await getEntityById(entityId);
            console.log("Entity data:", result);
            alert("Entity fetched. See console for details.");
        } catch (err) {
            console.error("Error fetching entity:", err);
            const errorMessage =
                err instanceof Error ? err.message : "Unknown error";
            alert(`Error: ${errorMessage}`);
        }
    };

    // Get status color based on connection state
    const getStatusColor = () => {
        switch (connectionStatus) {
            case "connected":
                return "#4CAF50"; // Green
            case "connecting":
            case "reconnecting":
                return "#FF9800"; // Orange
            default:
                return "#F44336"; // Red
        }
    };

    return (
        <div
            style={{
                position: "absolute",
                top: "10px",
                right: "10px",
                padding: "15px",
                borderRadius: "8px",
                backgroundColor: "rgba(0, 0, 0, 0.7)",
                color: "white",
                fontFamily: "Arial, sans-serif",
                width: "250px",
                zIndex: 1000,
            }}
        >
            <div style={{ marginBottom: "15px" }}>
                <h3 style={{ margin: "0 0 10px 0", fontSize: "16px" }}>
                    Vircadia Connection
                </h3>

                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        marginBottom: "10px",
                    }}
                >
                    <div
                        style={{
                            width: "12px",
                            height: "12px",
                            borderRadius: "50%",
                            backgroundColor: getStatusColor(),
                            marginRight: "10px",
                        }}
                    />
                    <span>
                        {connectionStatus.charAt(0).toUpperCase() +
                            connectionStatus.slice(1)}
                    </span>
                </div>

                {error && (
                    <div
                        style={{
                            color: "#F44336",
                            marginBottom: "10px",
                            fontSize: "12px",
                            wordBreak: "break-word",
                        }}
                    >
                        Error: {error.message}
                    </div>
                )}

                {entityCount !== null && (
                    <div style={{ fontSize: "14px", marginBottom: "10px" }}>
                        Entities in world:{" "}
                        {isLoading ? "Loading..." : entityCount}
                    </div>
                )}
            </div>

            <div
                style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
                <button
                    type="button"
                    onClick={() => connect()}
                    disabled={
                        connectionStatus === "connected" ||
                        connectionStatus === "connecting"
                    }
                    style={{
                        padding: "8px 12px",
                        backgroundColor:
                            connectionStatus === "connected"
                                ? "#666"
                                : "#4CAF50",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor:
                            connectionStatus === "connected"
                                ? "default"
                                : "pointer",
                        opacity: connectionStatus === "connected" ? 0.7 : 1,
                    }}
                >
                    Connect
                </button>

                <button
                    type="button"
                    onClick={() => disconnect()}
                    disabled={connectionStatus === "disconnected"}
                    style={{
                        padding: "8px 12px",
                        backgroundColor:
                            connectionStatus === "disconnected"
                                ? "#666"
                                : "#F44336",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor:
                            connectionStatus === "disconnected"
                                ? "default"
                                : "pointer",
                        opacity: connectionStatus === "disconnected" ? 0.7 : 1,
                    }}
                >
                    Disconnect
                </button>

                <button
                    type="button"
                    onClick={handleFetchEntity}
                    disabled={connectionStatus !== "connected"}
                    style={{
                        padding: "8px 12px",
                        backgroundColor:
                            connectionStatus === "connected"
                                ? "#2196F3"
                                : "#666",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor:
                            connectionStatus === "connected"
                                ? "pointer"
                                : "default",
                        opacity: connectionStatus === "connected" ? 1 : 0.7,
                        marginTop: "4px",
                    }}
                >
                    Fetch Entity
                </button>
            </div>
        </div>
    );
};

export default VircadiaConnectionStatus;
