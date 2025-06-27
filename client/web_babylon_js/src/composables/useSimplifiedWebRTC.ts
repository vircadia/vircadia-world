import { ref } from "vue";
import type { useVircadia } from "@vircadia/world-sdk/browser/vue";

// Message payload types
interface OfferAnswerPayload {
    sdp: string;
}

interface IceCandidatePayload {
    candidate: string | null;
    sdpMLineIndex: number | null;
    sdpMid: string | null;
}

type SessionEndPayload = Record<string, never>;

type MessagePayload =
    | OfferAnswerPayload
    | IceCandidatePayload
    | SessionEndPayload;

// Simplified message structure
interface WebRTCMessage {
    type: "offer" | "answer" | "ice-candidate" | "session-end";
    payload: MessagePayload;
    fromSession: string;
    timestamp: number;
}

// Database row type
interface MetadataRow {
    metadata__key: string;
    metadata__value: string;
}

interface EntityRow {
    general__entity_name: string;
}

export function useSimplifiedWebRTC(
    vircadiaWorld: ReturnType<typeof useVircadia>,
    fullSessionId: string,
) {
    const peers = ref<Map<string, RTCPeerConnection>>(new Map());
    const lastProcessedTimestamps = ref<Map<string, number>>(new Map());

    // Single entity name for this peer
    const myEntityName = `webrtc-${fullSessionId}`;

    // Initialize our presence entity (acts as both presence indicator and message inbox)
    const initializePresence = async () => {
        try {
            // Create or update our entity with auto-expiry
            await vircadiaWorld.client.Utilities.Connection.query({
                query: `
                    INSERT INTO entity.entities 
                    (general__entity_name, group__sync, general__expiry__delete_since_updated_at_ms) 
                    VALUES ($1, $2, $3)
                    ON CONFLICT (general__entity_name) 
                    DO UPDATE SET general__expiry__delete_since_updated_at_ms = $3
                `,
                parameters: [myEntityName, "public.NORMAL", 30000], // Auto-delete after 30s of inactivity
            });

            // Update our presence metadata
            await vircadiaWorld.client.Utilities.Connection.query({
                query: `
                    INSERT INTO entity.entity_metadata 
                    (general__entity_name, metadata__key, metadata__value, group__sync)
                    VALUES ($1, 'status', 'online', $2), ($1, 'lastSeen', $3, $2)
                    ON CONFLICT (general__entity_name, metadata__key) 
                    DO UPDATE SET metadata__value = EXCLUDED.metadata__value
                `,
                parameters: [
                    myEntityName,
                    "public.NORMAL",
                    Date.now().toString(),
                ],
            });
        } catch (error) {
            console.error(
                "[SimplifiedWebRTC] Failed to initialize presence:",
                error,
            );
        }
    };

    // Discover active peers
    const discoverPeers = async (): Promise<string[]> => {
        try {
            const cutoffTime = Date.now() - 35000; // 35 seconds ago (slightly more than expiry)

            // Find all webrtc entities with recent activity
            const result =
                await vircadiaWorld.client.Utilities.Connection.query({
                    query: `
                    SELECT DISTINCT e.general__entity_name 
                    FROM entity.entities e
                    JOIN entity.entity_metadata m ON e.general__entity_name = m.general__entity_name
                    WHERE e.general__entity_name LIKE 'webrtc-%' 
                    AND e.general__entity_name != $1
                    AND m.metadata__key = 'lastSeen'
                    AND CAST(m.metadata__value AS BIGINT) > $2
                `,
                    parameters: [myEntityName, cutoffTime],
                });

            if (Array.isArray(result.result)) {
                return (result.result as EntityRow[]).map((row) =>
                    row.general__entity_name.replace("webrtc-", ""),
                );
            }
            return [];
        } catch (error) {
            console.error(
                "[SimplifiedWebRTC] Failed to discover peers:",
                error,
            );
            return [];
        }
    };

    // Send message by writing to recipient's entity
    const sendMessage = async (
        toSession: string,
        type: WebRTCMessage["type"],
        payload: MessagePayload,
    ) => {
        const recipientEntity = `webrtc-${toSession}`;
        const timestamp = Date.now();
        const messageKey = `${type}-from-${fullSessionId}-${timestamp}`;

        const message: WebRTCMessage = {
            type,
            payload,
            fromSession: fullSessionId,
            timestamp,
        };

        try {
            await vircadiaWorld.client.Utilities.Connection.query({
                query: `
                    INSERT INTO entity.entity_metadata 
                    (general__entity_name, metadata__key, metadata__value, group__sync)
                    VALUES ($1, $2, $3, $4)
                `,
                parameters: [
                    recipientEntity,
                    messageKey,
                    JSON.stringify(message),
                    "public.NORMAL",
                ],
            });
        } catch (error) {
            console.error(`[SimplifiedWebRTC] Failed to send ${type}:`, error);
        }
    };

    // Receive messages from our inbox
    const receiveMessages = async (): Promise<WebRTCMessage[]> => {
        try {
            // Get all messages from our entity
            const result =
                await vircadiaWorld.client.Utilities.Connection.query({
                    query: `
                    SELECT metadata__key, metadata__value 
                    FROM entity.entity_metadata 
                    WHERE general__entity_name = $1
                    AND (
                        metadata__key LIKE 'offer-from-%' OR
                        metadata__key LIKE 'answer-from-%' OR
                        metadata__key LIKE 'ice-candidate-from-%' OR
                        metadata__key LIKE 'session-end-from-%'
                    )
                `,
                    parameters: [myEntityName],
                });

            const messages: WebRTCMessage[] = [];

            if (Array.isArray(result.result)) {
                for (const row of result.result as MetadataRow[]) {
                    try {
                        const message = JSON.parse(
                            row.metadata__value,
                        ) as WebRTCMessage;

                        // Check if we've already processed this message
                        const lastProcessed =
                            lastProcessedTimestamps.value.get(
                                message.fromSession,
                            ) || 0;
                        if (message.timestamp > lastProcessed) {
                            messages.push(message);
                        }
                    } catch (error) {
                        console.warn(
                            "[SimplifiedWebRTC] Failed to parse message:",
                            error,
                        );
                    }
                }
            }

            // Sort by timestamp
            messages.sort((a, b) => a.timestamp - b.timestamp);
            return messages;
        } catch (error) {
            console.error(
                "[SimplifiedWebRTC] Failed to receive messages:",
                error,
            );
            return [];
        }
    };

    // Clean up old messages from our inbox
    const cleanupOldMessages = async () => {
        const cutoffTime = Date.now() - 60000; // 1 minute old

        try {
            await vircadiaWorld.client.Utilities.Connection.query({
                query: `
                    DELETE FROM entity.entity_metadata 
                    WHERE general__entity_name = $1
                    AND (
                        metadata__key LIKE 'offer-from-%' OR
                        metadata__key LIKE 'answer-from-%' OR
                        metadata__key LIKE 'ice-candidate-from-%' OR
                        metadata__key LIKE 'session-end-from-%'
                    )
                    AND CAST(SPLIT_PART(metadata__key, '-', -1) AS BIGINT) < $2
                `,
                parameters: [myEntityName, cutoffTime],
            });
        } catch (error) {
            console.error(
                "[SimplifiedWebRTC] Failed to cleanup old messages:",
                error,
            );
        }
    };

    // Clean up on unmount
    const cleanup = async () => {
        // Delete our entity (this also removes all metadata)
        try {
            await vircadiaWorld.client.Utilities.Connection.query({
                query: "DELETE FROM entity.entities WHERE general__entity_name = $1",
                parameters: [myEntityName],
            });
        } catch (error) {
            console.error("[SimplifiedWebRTC] Failed to cleanup:", error);
        }
    };

    // Update last processed timestamp for a peer
    const updateLastProcessed = (fromSession: string, timestamp: number) => {
        const current = lastProcessedTimestamps.value.get(fromSession) || 0;
        if (timestamp > current) {
            lastProcessedTimestamps.value.set(fromSession, timestamp);
        }
    };

    return {
        peers,
        myEntityName,
        initializePresence,
        discoverPeers,
        sendMessage,
        receiveMessages,
        cleanupOldMessages,
        cleanup,
        updateLastProcessed,
    };
}
