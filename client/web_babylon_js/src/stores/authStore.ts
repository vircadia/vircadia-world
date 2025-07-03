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

            if (!response.ok) {
                throw new Error("Failed to get authorization URL");
            }

            const data = await response.json();
            if (data.data?.authorizationUrl) {
                // Store current URL to return to after auth
                sessionStorage.setItem(
                    "vircadia-auth-return-url",
                    window.location.href,
                );
                // Redirect to Azure AD
                window.location.href = data.data.authorizationUrl;
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
            // Send code to server for token exchange
            const response = await fetch(
                `${getApiUrl()}/world/rest/auth/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}&provider=azure`,
            );

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.errorMessage || "Authentication failed");
            }

            const data = await response.json();
            if (data.data) {
                // Store session information
                sessionToken.value = data.data.token;
                sessionId.value = data.data.sessionId;
                agentId.value = data.data.agentId;

                // Create a minimal account object for UI display
                account.value = {
                    homeAccountId: data.data.agentId,
                    environment: "azure",
                    tenantId: "",
                    username: data.data.email || "User",
                    localAccountId: data.data.agentId,
                    name: data.data.displayName,
                    idTokenClaims: {
                        email: data.data.email,
                        name: data.data.displayName,
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
