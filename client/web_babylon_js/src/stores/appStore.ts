import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useStorage, StorageSerializers } from "@vueuse/core";
import type { AccountInfo } from "@azure/msal-browser";
import type {
    BabylonModelDefinition,
    BabylonAnimationDefinition,
    PeerAudioState,
} from "../composables/schemas";
import type { AvatarMetadata } from "../composables/schemas";
import {
    AvatarMetadataSchema,
    AvatarMetadataWithDefaultsSchema,
} from "../composables/schemas";
import { clientBrowserConfiguration } from "../vircadia.browser.config";
import type { Communication } from "@vircadia/world-sdk/browser/vue";

export const useAppStore = defineStore("app", () => {
    // global loading indicator
    const loading = ref(false);
    // global error message
    const error = ref<string | null>(null);
    // model definitions for environments
    const modelDefinitions = ref<BabylonModelDefinition[]>(
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_MODEL_DEFINITIONS,
    );
    // HDR environment list
    const hdrList = ref<string[]>(["babylon.level.hdr.1k.hdr"]);
    // IDs for session, agent, and instance
    const instanceId = ref<string | null>(null);
    // My avatar metadata
    const myAvatarMetadata = ref<AvatarMetadata | null>(null);
    // avatar configuration
    const avatarDefinition = ref({
        initialAvatarPosition: { x: 0, y: 0, z: -5 },
        initialAvatarRotation: { x: 0, y: 0, z: 0, w: 1 },
        initialAvatarCameraOrientation: {
            alpha: -Math.PI / 2,
            beta: Math.PI / 3,
            radius: 5,
        },
        modelFileName: "babylon.avatar.glb",
        meshPivotPoint: "bottom" as "bottom" | "center",
        throttleInterval: 500,
        capsuleHeight: 1.8,
        capsuleRadius: 0.3,
        slopeLimit: 45,
        jumpSpeed: 5,
        debugBoundingBox: false,
        debugSkeleton: true,
        debugAxes: false,
        walkSpeed: 1.47,
        turnSpeed: Math.PI,
        blendDuration: 0.15, // seconds for animation blend transition
        gravity: -9.8, // gravity acceleration (units per second squared)
        animations: [
            {
                fileName: "babylon.avatar.animation.f.idle.1.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.idle.2.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.idle.3.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.idle.4.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.idle.5.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.idle.6.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.idle.7.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.idle.8.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.idle.9.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.idle.10.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.walk.1.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.walk.2.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.crouch_strafe_left.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.crouch_strafe_right.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.crouch_walk_back.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.crouch_walk.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.falling_idle.1.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.falling_idle.2.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.jog_back.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.jog.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.jump_small.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.jump.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.run_back.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.run_strafe_left.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.run_strafe_right.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.run.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.strafe_left.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.strafe_right.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.talking.1.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.talking.2.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.talking.3.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.talking.4.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.talking.5.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.talking.6.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.walk_back.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.walk_jump.1.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.walk_jump.2.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.walk_strafe_left.glb",
            },
            {
                fileName: "babylon.avatar.animation.f.walk_strafe_right.glb",
            },
        ] as BabylonAnimationDefinition[],
    });
    // Performance mode is now handled exclusively by BabylonCanvas

    // Polling intervals configuration (in milliseconds)
    const pollingIntervals = ref({
        // Avatar discovery interval - how often to check for new avatars
        avatarDiscovery: 2000,
        // Other avatar data polling - how often to fetch other avatars' position/state
        otherAvatarData: 1000,
        // Other avatar joint data polling - how often to fetch other avatars' skeleton joints
        // Using incremental updates (only fetches joints updated since last poll)
        otherAvatarJointData: 2500,
        // WebRTC signaling polling - how often to check for offers/answers
        webRTCSignaling: 1500,
        // WebRTC stale threshold - time before considering signaling data stale
        webRTCStaleThreshold: 20000,
        // Spatial audio update interval - how often to update 3D audio positions
        spatialAudioUpdate: 100,
        // Debug overlay refresh rate
        debugOverlayRefresh: 100,
        // Avatar data transmission intervals (position, rotation, camera)
        avatarData: 1000,
        // Avatar joint data transmission interval (skeleton bones) - less frequent
        avatarJointData: 2500,
    });
    // Spatial audio state
    const spatialAudioEnabled = ref(false);
    const peerAudioStates = ref<Record<string, PeerAudioState>>({});

    // Persisted state from authStore
    const account = useStorage<AccountInfo | null>(
        "vircadia-account",
        null,
        localStorage,
        {
            serializer: StorageSerializers.object,
        },
    );
    const sessionToken = useStorage<string | null>(
        "vircadia-session-token",
        null,
        localStorage,
    );
    const sessionId = useStorage<string | null>(
        "vircadia-session-id",
        null,
        localStorage,
    );
    const agentId = useStorage<string | null>(
        "vircadia-agent-id",
        null,
        localStorage,
    );
    const authProvider = useStorage<string>(
        "vircadia-auth-provider",
        "anon",
        localStorage,
    );

    // Loading state from authStore
    const isAuthenticating = ref(false);
    const authError = ref<string | null>(null);

    // whether an error is set
    const hasError = computed((): boolean => error.value !== null);
    // get current auth provider
    const getCurrentAuthProvider = computed((): string => authProvider.value);
    // get full session ID (sessionId + instanceId)
    const fullSessionId = computed((): string | null => {
        if (!sessionId.value || !instanceId.value) return null;
        return `${sessionId.value}-${instanceId.value}`;
    });
    // Other avatars metadata moved out of the store; managed by components
    // get active audio connections count
    const activeAudioConnectionsCount = computed((): number => {
        return Object.values(peerAudioStates.value).filter(
            (peer) => peer.isReceiving || peer.isSending,
        ).length;
    });
    // get peer audio state
    const getPeerAudioState = computed(
        () =>
            (sessionId: string): PeerAudioState | null => {
                return peerAudioStates.value[sessionId] || null;
            },
    );
    // get all active peer audio states
    const activePeerAudioStates = computed((): PeerAudioState[] => {
        return Object.values(peerAudioStates.value).filter(
            (peer) => peer.isReceiving || peer.isSending,
        );
    });

    // Computed properties from authStore
    const isAuthenticated = computed(
        () => !!sessionToken.value && !!account.value,
    );

    // set the loading flag
    function setLoading(value: boolean) {
        loading.value = value;
    }
    // set a global error message
    function setError(message: string | null) {
        error.value = message;
    }
    // clear the error
    function clearError() {
        error.value = null;
    }
    // set the session ID
    function setSessionId(id: string | null) {
        sessionId.value = id;
    }
    // set the agent ID
    function setAgentId(id: string | null) {
        agentId.value = id;
    }
    // set the instance ID
    function setInstanceId(id: string | null) {
        instanceId.value = id;
    }
    // set my avatar metadata
    function setMyAvatarMetadata(
        metadata: AvatarMetadata | Map<string, unknown> | unknown,
    ) {
        if (metadata === null) {
            myAvatarMetadata.value = null;
        } else {
            try {
                // Use the safe parser to validate and fill in defaults
                myAvatarMetadata.value =
                    AvatarMetadataWithDefaultsSchema.parse(metadata);
            } catch (error) {
                console.error("Invalid avatar metadata:", error);
                // Keep existing metadata if validation fails
            }
        }
    }
    // update my avatar metadata partially
    function updateMyAvatarMetadata(partialMetadata: Partial<AvatarMetadata>) {
        if (!myAvatarMetadata.value) {
            // If no metadata exists, create new with defaults
            setMyAvatarMetadata(partialMetadata);
        } else {
            try {
                // Validate the partial update
                const validatedUpdate =
                    AvatarMetadataSchema.partial().parse(partialMetadata);
                // Merge with existing metadata
                const merged = {
                    ...myAvatarMetadata.value,
                    ...validatedUpdate,
                };
                // Re-validate the complete object
                myAvatarMetadata.value =
                    AvatarMetadataWithDefaultsSchema.parse(merged);
            } catch (error) {
                console.error("Invalid avatar metadata update:", error);
                // Keep existing metadata if validation fails
            }
        }
    }
    // Other avatars metadata helpers removed
    // Performance controls removed from store
    // set polling interval
    function setPollingInterval(
        key: keyof typeof pollingIntervals.value,
        value: number,
    ) {
        pollingIntervals.value[key] = value;
    }
    // set all polling intervals
    function setPollingIntervals(
        intervals: Partial<typeof pollingIntervals.value>,
    ) {
        Object.assign(pollingIntervals.value, intervals);
    }
    // generate and set a new instance ID
    function generateInstanceId() {
        const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        let result = "";
        for (let i = 0; i < 6; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        instanceId.value = result;
        return result;
    }
    // Spatial audio actions
    function setSpatialAudioEnabled(enabled: boolean) {
        spatialAudioEnabled.value = enabled;
    }
    function setPeerAudioState(
        sessionId: string,
        state: Partial<PeerAudioState>,
    ) {
        if (!peerAudioStates.value[sessionId]) {
            peerAudioStates.value[sessionId] = {
                sessionId,
                volume: 100,
                isMuted: false,
                isReceiving: false,
                isSending: false,
            };
        }
        Object.assign(peerAudioStates.value[sessionId], state);
    }
    function removePeerAudioState(sessionId: string) {
        delete peerAudioStates.value[sessionId];
    }
    function setPeerVolume(sessionId: string, volume: number) {
        if (peerAudioStates.value[sessionId]) {
            peerAudioStates.value[sessionId].volume = volume;
        }
    }
    function setPeerMuted(sessionId: string, muted: boolean) {
        if (peerAudioStates.value[sessionId]) {
            peerAudioStates.value[sessionId].isMuted = muted;
        }
    }
    function clearPeerAudioStates() {
        peerAudioStates.value = {};
    }

    // Helper to construct API URL
    const getApiUrl = () => {
        const protocol =
            clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI_USING_SSL
                ? "https"
                : "http";
        return `${protocol}://${clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}`;
    };

    const loginAnonymously = async () => {
        isAuthenticating.value = true;
        authError.value = null;
        try {
            const response = await fetch(
                `${getApiUrl()}/world/rest/auth/anonymous`,
                {
                    method: "POST",
                },
            );
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    `Failed to login anonymously: ${response.status} ${response.statusText} - ${errorText}`,
                );
            }
            const data = await response.json();
            if (data.success && data.data) {
                const {
                    token,
                    agentId: newAgentId,
                    sessionId: newSessionId,
                } = data.data;
                sessionToken.value = token;
                sessionId.value = newSessionId;
                agentId.value = newAgentId;
                authProvider.value = "anon"; // Set provider for anonymous login
                account.value = {
                    homeAccountId: newAgentId,
                    environment: "anonymous",
                    tenantId: "",
                    username: `Anonymous ${newAgentId.substring(0, 8)}`,
                    localAccountId: newAgentId,
                    name: `Anonymous ${newAgentId.substring(0, 8)}`,
                } as AccountInfo;
            } else {
                throw new Error("Invalid response from server");
            }
        } catch (err) {
            console.error("Anonymous login failed:", err);
            authError.value =
                err instanceof Error ? err.message : "Anonymous login failed";
        } finally {
            isAuthenticating.value = false;
        }
    };

    const loginWithDebugToken = async () => {
        isAuthenticating.value = true;
        authError.value = null;
        try {
            const token =
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN;
            const configuredProvider =
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER;

            if (!token) {
                throw new Error("No debug token found in configuration.");
            }

            // The client does not validate the token, it just passes it to the server.
            // The server will validate it. We just need to store it and the user info.
            // We can decode it to get some info, but it's not secure.
            // For now, we'll just use a placeholder account object.
            // A proper implementation might decode the token to get basic info without verification.

            sessionToken.value = token;
            authProvider.value = configuredProvider; // Use configured provider (defaults to "system")
            // The app will connect to the server which will then validate the token and provide session/agent IDs.
            // We will get session/agent id from the websocket connection
            account.value = {
                homeAccountId: "debug-user",
                environment: "debug",
                tenantId: "",
                username: "Debug User",
                localAccountId: "debug-user",
                name: "Debug User",
            } as AccountInfo;
        } catch (err) {
            console.error("Debug token login failed:", err);
            authError.value =
                err instanceof Error ? err.message : "Debug token login failed";
        } finally {
            isAuthenticating.value = false;
        }
    };

    // Login with server-side OAuth flow
    const loginWithAzure = async () => {
        isAuthenticating.value = true;
        authError.value = null;

        try {
            // Get authorization URL from server
            const response = await fetch(
                `${getApiUrl()}/world/rest/auth/oauth/authorize?provider=azure`,
            );

            // Debug: Log response details
            console.log("Auth URL Response:", {
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                url: response.url,
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error("Auth URL Error Response:", errorText);
                throw new Error(
                    `Failed to get authorization URL: ${response.status} ${response.statusText}`,
                );
            }

            const data = await response.json();

            // Debug: Log the full response data
            console.log("Auth URL Response Data:", data);
            console.log("Data structure:", {
                hasData: !!data,
                hasDataData: !!data?.data,
                hasAuthorizationUrl: !!data?.data?.authorizationUrl,
                hasSuccess: !!data?.success,
                hasRedirectUrl: !!data?.redirectUrl,
                actualStructure: JSON.stringify(data, null, 2),
            });

            if (data.success && data.redirectUrl) {
                // Store current URL to return to after auth
                sessionStorage.setItem(
                    "vircadia-auth-return-url",
                    window.location.href,
                );
                // Redirect to Azure AD
                window.location.href = data.redirectUrl;
            } else {
                throw new Error("No authorization URL received");
            }
        } catch (err) {
            console.error("Login failed:", err);
            authError.value =
                err instanceof Error ? err.message : "Login failed";
            isAuthenticating.value = false;
        }
    };

    // Handle OAuth callback
    const handleOAuthCallback = async (code: string, state: string) => {
        isAuthenticating.value = true;
        authError.value = null;

        try {
            // Debug: Log the callback URL being constructed
            const callbackUrl = `${getApiUrl()}/world/rest/auth/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}&provider=azure`;
            console.log("OAuth Callback - Request URL:", callbackUrl);
            console.log("OAuth Callback - API Base URL:", getApiUrl());

            // Send code to server for token exchange
            const response = await fetch(callbackUrl);

            // Debug: Log response details
            console.log("OAuth Callback - Response status:", response.status);
            console.log(
                "OAuth Callback - Response headers:",
                Object.fromEntries(response.headers.entries()),
            );

            if (!response.ok) {
                const errorText = await response.text();
                console.error("OAuth Callback - Error response:", errorText);
                try {
                    const parsedError = JSON.parse(errorText);
                    throw new Error(
                        parsedError.errorMessage ||
                            parsedError.error ||
                            "Authentication failed",
                    );
                } catch {
                    throw new Error(
                        `Authentication failed: ${response.status} ${response.statusText}`,
                    );
                }
            }

            const data = await response.json();

            // Debug: Log callback response
            console.log("OAuth Callback Response Data:", data);
            console.log("Response structure:", {
                hasData: !!data,
                hasSuccess: data?.success,
                dataKeys: data ? Object.keys(data) : [],
                fullData: JSON.stringify(data, null, 2),
            });

            // Handle the response based on the actual structure
            // The schema defines the response type in AUTH_OAUTH_CALLBACK.createSuccess
            type OAuthCallbackSuccessResponse = ReturnType<
                typeof Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK.createSuccess
            >;
            let responseData: Omit<
                OAuthCallbackSuccessResponse,
                "success" | "timestamp"
            >;
            if (data?.success && data?.data) {
                // Response is wrapped in { success: true, data: {...} }
                responseData = data.data;
            } else if (data?.token) {
                // Response is the data directly
                responseData = data;
            } else {
                console.error("Unexpected response structure:", data);
                throw new Error("Invalid response structure");
            }

            console.log("Extracted response data:", {
                token: responseData.token ? "present" : "missing",
                agentId: responseData.agentId,
                sessionId: responseData.sessionId,
                email: responseData.email,
                displayName: responseData.displayName,
                username: responseData.username,
            });

            if (responseData?.token) {
                // Store session information
                sessionToken.value = responseData.token;
                sessionId.value = responseData.sessionId;
                agentId.value = responseData.agentId;
                authProvider.value = "azure"; // Set provider for Azure login

                // Create a minimal account object for UI display
                const newAccount: AccountInfo = {
                    homeAccountId: responseData.agentId,
                    environment: "azure",
                    tenantId: "",
                    username:
                        responseData.username ||
                        responseData.displayName ||
                        responseData.email ||
                        "User",
                    localAccountId: responseData.agentId,
                    name:
                        responseData.displayName ||
                        responseData.username ||
                        responseData.email ||
                        "User",
                    idTokenClaims: {
                        email: responseData.email,
                        name:
                            responseData.displayName ||
                            responseData.username ||
                            responseData.email,
                        preferred_username: responseData.email,
                    },
                } as AccountInfo;

                // Set the account value
                account.value = newAccount;

                // Redirect back to original page
                const returnUrl =
                    sessionStorage.getItem("vircadia-auth-return-url") || "/";
                sessionStorage.removeItem("vircadia-auth-return-url");
                window.location.href = returnUrl;
            }
        } catch (err) {
            console.error("OAuth callback failed:", err);
            authError.value =
                err instanceof Error ? err.message : "Authentication failed";
        } finally {
            isAuthenticating.value = false;
        }
    };

    // Logout
    const logout = async () => {
        if (sessionId.value) {
            try {
                await fetch(`${getApiUrl()}/world/rest/auth/logout`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sessionId: sessionId.value }),
                });
            } catch (err) {
                console.error("Logout request failed:", err);
            }
        }

        // Clear local state
        account.value = null;
        sessionToken.value = null;
        sessionId.value = null;
        agentId.value = null;
        authProvider.value = "anon"; // Reset to default anon provider
        authError.value = null;
    };

    // Get session token for API calls
    const getSessionToken = () => sessionToken.value;

    // Initialize - check for OAuth callback and auto-login with debug token
    const initialize = async () => {
        // Debug: Check state on initialization
        console.log("Auth Store Initialize - state:", {
            account: account.value,
            sessionToken: sessionToken.value,
            sessionId: sessionId.value,
            agentId: agentId.value,
            isAuthenticated: isAuthenticated.value,
        });

        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get("code");
        const state = urlParams.get("state");

        if (code && state) {
            // We're in an OAuth callback
            await handleOAuthCallback(code, state);
            // Clear the URL parameters
            window.history.replaceState(
                {},
                document.title,
                window.location.pathname,
            );
        } else if (!isAuthenticated.value) {
            // If not already authenticated, try debug token auto-login
            const debugToken =
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN;
            if (debugToken) {
                console.log(
                    "Auth Store Initialize - attempting debug token auto-login",
                );
                await loginWithDebugToken();
            } else {
                // No debug token configured, automatically login as anonymous
                console.log(
                    "Auth Store Initialize - no debug token found, attempting anonymous login",
                );
                await loginAnonymously();
            }
        }
    };

    // Refresh account data
    // Note: With useStorage, the reactive values are automatically synced with localStorage
    // This function is kept for backward compatibility but likely not needed
    const refreshAccountData = () => {
        console.log("Account data is automatically synced via useStorage", {
            account: account.value,
            isAuthenticated: isAuthenticated.value,
        });
    };

    // Initialize on store creation
    initialize();

    return {
        loading,
        error,
        modelDefinitions,
        hdrList,
        instanceId,
        myAvatarMetadata,
        avatarDefinition,
        pollingIntervals,
        spatialAudioEnabled,
        peerAudioStates,
        account,
        sessionToken,
        sessionId,
        agentId,
        authProvider,
        isAuthenticating,
        authError,
        hasError,
        getCurrentAuthProvider,
        fullSessionId,
        activeAudioConnectionsCount,
        getPeerAudioState,
        activePeerAudioStates,
        isAuthenticated,
        setLoading,
        setError,
        clearError,
        setSessionId,
        setAgentId,
        setInstanceId,
        setMyAvatarMetadata,
        updateMyAvatarMetadata,
        // other avatar metadata actions removed

        setPollingInterval,
        setPollingIntervals,
        generateInstanceId,
        setSpatialAudioEnabled,
        setPeerAudioState,
        removePeerAudioState,
        setPeerVolume,
        setPeerMuted,
        clearPeerAudioStates,
        loginWithAzure,
        loginAnonymously,
        loginWithDebugToken,
        logout,
        getSessionToken,
        handleOAuthCallback,
        refreshAccountData,
    };
});
