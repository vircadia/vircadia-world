import { ref, computed, type Ref } from 'vue';
import type { VircadiaWorldInstance } from '@/components/VircadiaWorldProvider.vue';
import type { Communication } from '@vircadia/world-sdk/browser/vue';

export interface WebRTCReflectMessage {
    type: 'offer' | 'answer' | 'ice-candidate' | 'session-end' | 'peer-announce';
    fromSession: string;
    toSession?: string; // For targeted messages
    payload: Record<string, unknown>;
    timestamp: number;
}

export interface PeerAnnouncement {
    sessionId: string;
    timestamp: number;
    status: 'online' | 'offline';
}

export interface UseWebRTCReflectOptions {
    syncGroup: string; // Default: world ID or 'default'
    announceIntervalMs: number; // Default: 5000
    presenceTimeoutMs: number; // Default: 15000
    autoReconnect?: boolean; // Default: true
    reconnectDelayMs?: number; // Default: 1000
    maxReconnectAttempts?: number; // Default: 5
    enableMessageQueuing?: boolean; // Default: true
}

export function useWebRTCReflect(
    client: VircadiaWorldInstance,
    fullSessionId: Ref<string | null>,
    options: UseWebRTCReflectOptions = {
        syncGroup: 'public.NORMAL',
        announceIntervalMs: 2000,
        presenceTimeoutMs: 10000,
        autoReconnect: true,
        reconnectDelayMs: 1000,
        maxReconnectAttempts: 5,
        enableMessageQueuing: true,
    }
) {
    // Configuration
    const syncGroup = options.syncGroup;
    const announceIntervalMs = options.announceIntervalMs;
    const presenceTimeoutMs = options.presenceTimeoutMs;
    const autoReconnect = options.autoReconnect ?? true;
    const reconnectDelayMs = options.reconnectDelayMs ?? 1000;
    const maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    const enableMessageQueuing = options.enableMessageQueuing ?? true;

    // Channels
    const ANNOUNCE_CHANNEL = 'webrtc.announce';
    const SIGNALING_CHANNEL = 'webrtc.signal';

    // State
    const activePeers = ref<Map<string, PeerAnnouncement>>(new Map());
    const messageHandlers = ref<Map<string, (msg: WebRTCReflectMessage) => void>>(new Map());
    const isInitialized = ref(false);

    // Reconnection state
    const reconnectAttempts = ref(0);
    const reconnectTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
    const isReconnecting = ref(false);

    // Message queuing
    const messageQueue = ref<Map<string, WebRTCReflectMessage[]>>(new Map());
    
    // Intervals
    let announceInterval: ReturnType<typeof setInterval> | null = null;
    let cleanupInterval: ReturnType<typeof setInterval> | null = null;
    
    // Subscriptions
    let unsubscribeAnnounce: (() => void) | null = null;
    let unsubscribeSignaling: (() => void) | null = null;
    
    // Initialize the reflect-based WebRTC system
    async function initialize() {
        if (isInitialized.value || !client || !fullSessionId.value) {
            console.warn('[WebRTC Reflect] Cannot initialize: missing client or session');
            return;
        }
        
        isInitialized.value = true;
        
        // Subscribe to peer announcements
        unsubscribeAnnounce = client.client.connection.subscribeReflect(
            syncGroup,
            ANNOUNCE_CHANNEL,
            handleAnnouncement
        );
        
        // Subscribe to signaling messages
        unsubscribeSignaling = client.client.connection.subscribeReflect(
            syncGroup,
            SIGNALING_CHANNEL,
            handleSignalingMessage
        );
        
        // Start announcing our presence
        announcePresence();
        announceInterval = setInterval(announcePresence, announceIntervalMs);
        
        // Start cleanup interval for stale peers
        cleanupInterval = setInterval(cleanupStalePeers, presenceTimeoutMs / 2);

        // Flush any queued messages after successful initialization
        if (enableMessageQueuing) {
            flushMessageQueue();
        }

        console.log('[WebRTC Reflect] Initialized', {
            syncGroup,
            session: fullSessionId.value,
            channels: [ANNOUNCE_CHANNEL, SIGNALING_CHANNEL],
            autoReconnect,
            maxReconnectAttempts,
            enableMessageQueuing
        });
    }
    
    // Cleanup and stop
    function cleanup() {
        if (!isInitialized.value) return;

        // Cancel any pending reconnection
        if (reconnectTimeout.value) {
            clearTimeout(reconnectTimeout.value);
            reconnectTimeout.value = null;
        }
        reconnectAttempts.value = 0;
        isReconnecting.value = false;

        // Send offline announcement
        if (client && fullSessionId.value) {
            const announcement: PeerAnnouncement = {
                sessionId: fullSessionId.value,
                timestamp: Date.now(),
                status: 'offline'
            };

            client.client.connection.publishReflect({
                syncGroup,
                channel: ANNOUNCE_CHANNEL,
                payload: announcement,
                timeoutMs: 1000 // Quick timeout for cleanup
            }).catch(err => {
                console.error('[WebRTC Reflect] Failed to send offline announcement:', err);
            });
        }

        // Clear intervals
        if (announceInterval) {
            clearInterval(announceInterval);
            announceInterval = null;
        }
        if (cleanupInterval) {
            clearInterval(cleanupInterval);
            cleanupInterval = null;
        }

        // Unsubscribe
        unsubscribeAnnounce?.();
        unsubscribeSignaling?.();
        unsubscribeAnnounce = null;
        unsubscribeSignaling = null;

        // Clear state
        activePeers.value.clear();
        messageHandlers.value.clear();
        messageQueue.value.clear();
        isInitialized.value = false;

        console.log('[WebRTC Reflect] Cleaned up');
    }
    
    // Announce our presence
    async function announcePresence() {
        if (!client || !fullSessionId.value) return;
        
        const announcement: PeerAnnouncement = {
            sessionId: fullSessionId.value,
            timestamp: Date.now(),
            status: 'online'
        };
        
        try {
            await client.client.connection.publishReflect({
                syncGroup,
                channel: ANNOUNCE_CHANNEL,
                payload: announcement
            });
            
            console.log('[WebRTC Reflect] Announced presence');
        } catch (err) {
            console.error('[WebRTC Reflect] Failed to announce presence:', err);
        }
    }
    
    // Handle peer announcements
    function handleAnnouncement(msg: Communication.WebSocket.ReflectDeliveryMessage) {
        try {
            const announcement = msg.payload as PeerAnnouncement;
            
            if (!announcement.sessionId || announcement.sessionId === fullSessionId.value) {
                return; // Ignore our own announcements
            }
            
            if (announcement.status === 'offline') {
                activePeers.value.delete(announcement.sessionId);
                console.log('[WebRTC Reflect] Peer went offline:', announcement.sessionId);
            } else {
                activePeers.value.set(announcement.sessionId, announcement);
                console.log('[WebRTC Reflect] Peer announced:', announcement.sessionId);
            }
        } catch (err) {
            console.error('[WebRTC Reflect] Failed to handle announcement:', err);
        }
    }
    
    // Handle signaling messages
    function handleSignalingMessage(msg: Communication.WebSocket.ReflectDeliveryMessage) {
        try {
            const message = msg.payload as WebRTCReflectMessage;
            
            // Ignore our own messages
            if (message.fromSession === fullSessionId.value) {
                return;
            }
            
            // Check if message is for us (broadcast or targeted)
            if (message.toSession && message.toSession !== fullSessionId.value) {
                return; // Message is for someone else
            }
            
            // Find handler for this peer
            const handler = messageHandlers.value.get(message.fromSession);
            if (handler) {
                handler(message);
            } else {
                console.warn('[WebRTC Reflect] No handler for peer:', message.fromSession);
            }
        } catch (err) {
            console.error('[WebRTC Reflect] Failed to handle signaling message:', err);
        }
    }
    
    // Clean up stale peers
    function cleanupStalePeers() {
        const now = Date.now();
        const staleThreshold = now - presenceTimeoutMs;
        
        for (const [sessionId, announcement] of activePeers.value.entries()) {
            if (announcement.timestamp < staleThreshold) {
                activePeers.value.delete(sessionId);
                console.log('[WebRTC Reflect] Removed stale peer:', sessionId);
            }
        }
    }
    
    // Send a signaling message to a specific peer with queuing support
    async function sendSignalingMessage(
        toSession: string,
        type: WebRTCReflectMessage['type'],
        payload: Record<string, unknown>
    ) {
        if (!client || !fullSessionId.value) {
            throw new Error('WebRTC Reflect not initialized');
        }

        const message: WebRTCReflectMessage = {
            type,
            fromSession: fullSessionId.value,
            toSession,
            payload,
            timestamp: Date.now()
        };

        // If message queuing is enabled and we're not initialized, queue the message
        if (enableMessageQueuing && !isInitialized.value) {
            const queue = messageQueue.value.get(toSession) || [];
            queue.push(message);
            messageQueue.value.set(toSession, queue);

            console.log('[WebRTC Reflect] Queued signaling message (not initialized):', {
                type,
                to: toSession.substring(0, 8) + '...',
                queueLength: queue.length
            });

            // Attempt reconnection if auto-reconnect is enabled
            if (autoReconnect && !isReconnecting.value) {
                attemptReconnection();
            }

            return; // Don't throw error for queued messages
        }

        try {
            await client.client.connection.publishReflect({
                syncGroup,
                channel: SIGNALING_CHANNEL,
                payload: message
            });

            console.log('[WebRTC Reflect] Sent signaling message:', {
                type,
                to: toSession.substring(0, 8) + '...'
            });
        } catch (err) {
            console.error('[WebRTC Reflect] Failed to send signaling message:', err);

            // If queuing is enabled, add to queue and attempt reconnection
            if (enableMessageQueuing) {
                const queue = messageQueue.value.get(toSession) || [];
                queue.push(message);
                messageQueue.value.set(toSession, queue);

                console.log('[WebRTC Reflect] Queued failed message:', {
                    type,
                    to: toSession.substring(0, 8) + '...',
                    queueLength: queue.length
                });

                if (autoReconnect && !isReconnecting.value) {
                    attemptReconnection();
                }
            } else {
                throw err;
            }
        }
    }

    // Attempt to reconnect and flush message queue
    async function attemptReconnection() {
        if (!autoReconnect || isReconnecting.value || reconnectAttempts.value >= maxReconnectAttempts) {
            return;
        }

        isReconnecting.value = true;
        reconnectAttempts.value++;

        console.log(`[WebRTC Reflect] Attempting reconnection ${reconnectAttempts.value}/${maxReconnectAttempts}`);

        // Wait before attempting reconnection
        reconnectTimeout.value = setTimeout(async () => {
            try {
                // Try to re-initialize
                await initialize();
            } catch (err) {
                console.error('[WebRTC Reflect] Reconnection failed:', err);
                isReconnecting.value = false;

                // Schedule another attempt if we haven't exceeded max attempts
                if (reconnectAttempts.value < maxReconnectAttempts) {
                    attemptReconnection();
                } else {
                    console.error('[WebRTC Reflect] Max reconnection attempts reached');
                    // Flush any remaining queued messages as failed
                    flushMessageQueue();
                }
            }
        }, reconnectDelayMs);
    }

    // Flush queued messages
    function flushMessageQueue() {
        console.log('[WebRTC Reflect] Flushing message queue...');

        for (const [toSession, messages] of messageQueue.value) {
            console.log(`[WebRTC Reflect] Flushing ${messages.length} messages to ${toSession.substring(0, 8)}...`);

            // Try to send each message
            for (const message of messages) {
                try {
                    client.client.connection.publishReflect({
                        syncGroup,
                        channel: SIGNALING_CHANNEL,
                        payload: message
                    }).catch(err => {
                        console.error('[WebRTC Reflect] Failed to flush queued message:', err);
                    });
                } catch (err) {
                    console.error('[WebRTC Reflect] Error flushing queued message:', err);
                }
            }
        }

        messageQueue.value.clear();
        console.log('[WebRTC Reflect] Message queue flushed');
    }
    
    // Register a message handler for a specific peer
    function registerMessageHandler(
        peerId: string,
        handler: (msg: WebRTCReflectMessage) => void
    ) {
        messageHandlers.value.set(peerId, handler);
    }
    
    // Unregister a message handler
    function unregisterMessageHandler(peerId: string) {
        messageHandlers.value.delete(peerId);
    }
    
    // Get list of discovered peers
    const discoveredPeers = computed(() => {
        return Array.from(activePeers.value.keys());
    });
    
    // Helper methods for specific message types
    async function sendOffer(toSession: string, sdp: string) {
        await sendSignalingMessage(toSession, 'offer', { sdp });
    }
    
    async function sendAnswer(toSession: string, sdp: string) {
        await sendSignalingMessage(toSession, 'answer', { sdp });
    }
    
    async function sendIceCandidate(
        toSession: string,
        candidate: RTCIceCandidate | null
    ) {
        await sendSignalingMessage(toSession, 'ice-candidate', {
            candidate: candidate ? JSON.stringify(candidate) : null,
            sdpMLineIndex: candidate?.sdpMLineIndex || null,
            sdpMid: candidate?.sdpMid || null
        });
    }
    
    async function sendSessionEnd(toSession: string) {
        await sendSignalingMessage(toSession, 'session-end', {});
    }
    
    return {
        // State
        isInitialized,
        activePeers: computed(() => activePeers.value),
        discoveredPeers,
        isReconnecting: computed(() => isReconnecting.value),
        reconnectAttempts: computed(() => reconnectAttempts.value),
        messageQueueSize: computed(() => {
            let total = 0;
            for (const messages of messageQueue.value.values()) {
                total += messages.length;
            }
            return total;
        }),

        // Lifecycle
        initialize,
        cleanup,

        // Message handling
        registerMessageHandler,
        unregisterMessageHandler,

        // Signaling methods
        sendOffer,
        sendAnswer,
        sendIceCandidate,
        sendSessionEnd,
        sendSignalingMessage,

        // Manual presence
        announcePresence,

        // Reconnection and queuing
        attemptReconnection,
        flushMessageQueue
    };
}
