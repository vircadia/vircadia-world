import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useStorage } from "@vueuse/core";
import type { AccountInfo } from "@azure/msal-browser";
import { clientBrowserConfiguration } from "../vircadia.browser.config";

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

            // Check both potential response formats
            const responseData = data?.data || (data?.success ? data : null);

            if (responseData?.token) {
                // Store session information
                sessionToken.value = responseData.token;
                sessionId.value = responseData.sessionId;
                agentId.value = responseData.agentId;

                // Create a minimal account object for UI display
                account.value = {
                    homeAccountId: responseData.agentId,
                    environment: "azure",
                    tenantId: "",
                    username: responseData.email || "User",
                    localAccountId: responseData.agentId,
                    name: responseData.displayName,
                    idTokenClaims: {
                        email: responseData.email,
                        name: responseData.displayName,
                    },
                } as AccountInfo;

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
    };
});
