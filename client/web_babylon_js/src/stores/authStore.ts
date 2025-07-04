import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useStorage, StorageSerializers } from "@vueuse/core";
import type { AccountInfo } from "@azure/msal-browser";
import { clientBrowserConfiguration } from "../vircadia.browser.config";
import type { Communication } from "@vircadia/world-sdk/browser/vue";

export const useAuthStore = defineStore("auth", () => {
    // Helper to construct API URL
    const getApiUrl = () => {
        const protocol =
            clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI_USING_SSL
                ? "https"
                : "http";
        return `${protocol}://${clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}`;
    };

    // Persisted state
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

    // Loading state
    const isAuthenticating = ref(false);
    const authError = ref<string | null>(null);

    // Computed properties
    const isAuthenticated = computed(
        () => !!sessionToken.value && !!account.value,
    );

    // Login with server-side OAuth flow
    const login = async () => {
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
                    const error = JSON.parse(errorText);
                    throw new Error(
                        error.errorMessage ||
                            error.error ||
                            "Authentication failed",
                    );
                } catch (parseError) {
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

                // Force sync to localStorage by manually setting items
                // This ensures data is persisted before redirect
                try {
                    localStorage.setItem(
                        "vircadia-session-token",
                        responseData.token,
                    );
                    localStorage.setItem(
                        "vircadia-session-id",
                        responseData.sessionId,
                    );
                    localStorage.setItem(
                        "vircadia-agent-id",
                        responseData.agentId,
                    );
                    // Ensure proper JSON stringification
                    localStorage.setItem(
                        "vircadia-account",
                        JSON.stringify(newAccount),
                    );
                } catch (err) {
                    console.error(
                        "Failed to save auth data to localStorage:",
                        err,
                    );
                }

                // Add a small delay to ensure localStorage operations complete
                await new Promise((resolve) => setTimeout(resolve, 100));

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
        authError.value = null;
    };

    // Get session token for API calls
    const getSessionToken = () => sessionToken.value;

    // Initialize - check for OAuth callback
    const initialize = async () => {
        // Fix corrupted account data if it exists
        const storedAccount = localStorage.getItem("vircadia-account");
        if (storedAccount === "[object Object]") {
            console.warn(
                "Detected corrupted account data, attempting to recover...",
            );

            // Try to recover from other stored values
            const storedToken = localStorage.getItem("vircadia-session-token");
            const storedAgentId = localStorage.getItem("vircadia-agent-id");

            if (storedToken && storedAgentId) {
                // Parse JWT to get email
                try {
                    const tokenParts = storedToken.split(".");
                    if (tokenParts.length === 3) {
                        const payload = JSON.parse(atob(tokenParts[1]));
                        const email = payload.email || "User";

                        const recoveredAccount: AccountInfo = {
                            homeAccountId: storedAgentId,
                            environment: "azure",
                            tenantId: "",
                            username: email,
                            localAccountId: storedAgentId,
                            name: email,
                            idTokenClaims: {
                                email: email,
                                name: email,
                                preferred_username: email,
                            },
                        } as AccountInfo;

                        account.value = recoveredAccount;
                        localStorage.setItem(
                            "vircadia-account",
                            JSON.stringify(recoveredAccount),
                        );
                        console.log(
                            "Successfully recovered account data:",
                            recoveredAccount,
                        );
                    }
                } catch (err) {
                    console.error("Failed to recover account data:", err);
                    localStorage.removeItem("vircadia-account");
                }
            } else {
                // Can't recover, remove corrupted data
                localStorage.removeItem("vircadia-account");
            }
        }

        // Debug: Check what's in localStorage on initialization
        console.log("Auth Store Initialize - localStorage state:", {
            account: localStorage.getItem("vircadia-account"),
            sessionToken: localStorage.getItem("vircadia-session-token"),
            sessionId: localStorage.getItem("vircadia-session-id"),
            agentId: localStorage.getItem("vircadia-agent-id"),
            parsedAccount: account.value,
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
        }
    };

    // Refresh account data from localStorage
    const refreshAccountData = () => {
        const storedAccount = localStorage.getItem("vircadia-account");
        if (storedAccount && storedAccount !== "[object Object]") {
            try {
                const parsed = JSON.parse(storedAccount);
                account.value = parsed;
                console.log(
                    "Account data refreshed from localStorage:",
                    parsed,
                );
            } catch (err) {
                console.error("Failed to parse stored account data:", err);

                // Try to recover from JWT token
                const storedToken = localStorage.getItem(
                    "vircadia-session-token",
                );
                const storedAgentId = localStorage.getItem("vircadia-agent-id");

                if (storedToken && storedAgentId) {
                    try {
                        const tokenParts = storedToken.split(".");
                        if (tokenParts.length === 3) {
                            const payload = JSON.parse(atob(tokenParts[1]));
                            const email = payload.email || "User";

                            const recoveredAccount: AccountInfo = {
                                homeAccountId: storedAgentId,
                                environment: "azure",
                                tenantId: "",
                                username: email,
                                localAccountId: storedAgentId,
                                name: email,
                                idTokenClaims: {
                                    email: email,
                                    name: email,
                                    preferred_username: email,
                                },
                            } as AccountInfo;

                            account.value = recoveredAccount;
                            localStorage.setItem(
                                "vircadia-account",
                                JSON.stringify(recoveredAccount),
                            );
                            console.log(
                                "Successfully recovered account data in refresh:",
                                recoveredAccount,
                            );
                        }
                    } catch (err) {
                        console.error(
                            "Failed to recover account data in refresh:",
                            err,
                        );
                    }
                }
            }
        } else if (storedAccount === "[object Object]") {
            // Handle corrupted data
            console.warn("Corrupted account data detected in refresh");
            initialize(); // Re-run initialize to fix it
        }
    };

    // Initialize on store creation
    initialize();

    return {
        // State
        account,
        sessionToken,
        sessionId,
        agentId,
        isAuthenticating,
        authError,

        // Computed
        isAuthenticated,

        // Actions
        login,
        logout,
        getSessionToken,
        handleOAuthCallback,
        refreshAccountData,
    };
});
