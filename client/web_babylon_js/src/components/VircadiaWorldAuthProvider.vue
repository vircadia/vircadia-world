<template>
    <slot :authError="authError" :account="account" :sessionToken="sessionToken" :sessionId="sessionId"
        :agentId="agentId" :authProvider="authProvider" :logout="logout" :logoutLocal="logoutLocal"
        :isAuthenticated="isAuthenticated" :isAuthenticating="isAuthenticating" :accountDisplayName="accountDisplayName"
        :connect="connect" :disconnect="disconnect" :loginWithAzure="loginWithAzure"
        :loginAnonymously="loginAnonymously" :loginWithDebugToken="loginWithDebugToken" :showDebugLogin="showDebugLogin"
        :authValidationState="authValidationState" />
</template>

<script setup lang="ts">
import type { AccountInfo } from "@azure/msal-browser";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";
import { clientBrowserConfiguration } from "../../../../sdk/vircadia-world-sdk-ts/browser/src/config/vircadia.browser.config";

const props = defineProps<{
    vircadiaWorld: VircadiaWorldInstance;
    autoConnect?: boolean;
    reconnectDelayMs?: number;
}>();

const emit = defineEmits<{
    authenticated: [];
    "auth-denied": [
        payload: {
            reason:
            | "expired"
            | "invalid"
            | "unauthorized"
            | "authentication_failed";
            message: string;
        },
    ];
}>();

const autoConnect = computed(() => props.autoConnect !== false);
const reconnectDelayMs = computed(() => props.reconnectDelayMs ?? 2000);

const isAuthenticating = ref(false);
const authError = ref<string | null>(null);

// Session storage keys for tracking failed auto-connect attempts
const AUTO_CONNECT_DEBUG_FAILED_KEY = 'vircadia-auto-connect-debug-failed';
const AUTO_CONNECT_ANONYMOUS_FAILED_KEY = 'vircadia-auto-connect-anonymous-failed';
// Local storage key for the last token we invalidated/cleared on this browser
const LAST_INVALIDATED_TOKEN_KEY = 'vircadia-last-invalidated-token';

const account = ref<AccountInfo | null>(props.vircadiaWorld.client.getStoredAccount<AccountInfo>());
const sessionToken = ref<string | null>(props.vircadiaWorld.client.getStoredToken());
const sessionId = ref<string | null>(props.vircadiaWorld.client.getStoredSessionId());
const agentId = ref<string | null>(props.vircadiaWorld.client.getStoredAgentId());
const authProvider = ref<string>(props.vircadiaWorld.client.getStoredProvider());

// Track authentication validation state
const authValidationState = ref<'pending' | 'validating' | 'valid' | 'invalid'>('pending');

const isAuthenticated = computed(() => {
    // Reactive: authenticated if a token is present in local state
    return !!sessionToken.value;
});

const showDebugLogin = computed(() => {
    return !!clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN;
});

// Helper functions for tracking auto-connect failures
const hasAutoConnectFailed = (type: 'debug' | 'anonymous'): boolean => {
    const key = type === 'debug' ? AUTO_CONNECT_DEBUG_FAILED_KEY : AUTO_CONNECT_ANONYMOUS_FAILED_KEY;
    return sessionStorage.getItem(key) === 'true';
};

const markAutoConnectFailed = (type: 'debug' | 'anonymous'): void => {
    const key = type === 'debug' ? AUTO_CONNECT_DEBUG_FAILED_KEY : AUTO_CONNECT_ANONYMOUS_FAILED_KEY;
    sessionStorage.setItem(key, 'true');
};

const clearAutoConnectFailure = (type: 'debug' | 'anonymous'): void => {
    const key = type === 'debug' ? AUTO_CONNECT_DEBUG_FAILED_KEY : AUTO_CONNECT_ANONYMOUS_FAILED_KEY;
    sessionStorage.removeItem(key);
};

const clearAllAutoConnectFailures = (): void => {
    sessionStorage.removeItem(AUTO_CONNECT_DEBUG_FAILED_KEY);
    sessionStorage.removeItem(AUTO_CONNECT_ANONYMOUS_FAILED_KEY);
};

// Persist the last invalidated token so we can avoid retrying it (e.g., debug token)
function setLastInvalidatedToken(token: string): void {
    try {
        window.localStorage.setItem(LAST_INVALIDATED_TOKEN_KEY, token);
    } catch { }
}

function getLastInvalidatedToken(): string | null {
    try {
        return window.localStorage.getItem(LAST_INVALIDATED_TOKEN_KEY);
    } catch {
        return null;
    }
}

function clearLastInvalidatedToken(): void {
    try {
        window.localStorage.removeItem(LAST_INVALIDATED_TOKEN_KEY);
    } catch { }
}

const loginWithAzure = async () => {
    isAuthenticating.value = true;
    authError.value = null;

    try {
        const data =
            await props.vircadiaWorld.client.restAuth.authorizeOAuth("azure");
        console.log("Auth authorize response:", data);

        if (data.success && data.redirectUrl) {
            sessionStorage.setItem(
                "vircadia-auth-return-url",
                window.location.href,
            );
            window.location.href = data.redirectUrl;
        } else {
            throw new Error("No authorization URL received");
        }
    } catch (err) {
        console.error("Login failed:", err);
        authError.value = err instanceof Error ? err.message : "Login failed";
        isAuthenticating.value = false;
    }
};

const loginAnonymously = async (isAutoConnect = false) => {
    isAuthenticating.value = true;
    authError.value = null;
    try {
        const data = await props.vircadiaWorld.client.loginAnonymous();
        if (data.success && data.data) {
            const {
                token,
                agentId: newAgentId,
                sessionId: newSessionId,
            } = data.data;
            sessionToken.value = token; props.vircadiaWorld.client.setAuthToken(token);
            sessionId.value = newSessionId; props.vircadiaWorld.client.setSessionId(newSessionId);
            agentId.value = newAgentId; props.vircadiaWorld.client.setStoredAgentId(newAgentId);
            authProvider.value = "anon"; props.vircadiaWorld.client.setAuthProvider("anon");
            account.value = {
                homeAccountId: newAgentId,
                environment: "anonymous",
                tenantId: "",
                username: `Anonymous ${newAgentId.substring(0, 8)}`,
                localAccountId: newAgentId,
                name: `Anonymous ${newAgentId.substring(0, 8)}`,
            } as AccountInfo;
            props.vircadiaWorld.client.setStoredAccount(account.value);

            // Clear any previous auto-connect failure on successful login
            if (isAutoConnect) {
                clearAutoConnectFailure('anonymous');
            }

            // Mark auth as valid and auto-connect; rely on server to reject if invalid
            authValidationState.value = 'valid';
            emit("authenticated");
            if (autoConnect.value) {
                await connect();
            }
        } else {
            throw new Error("Invalid response from server");
        }
    } catch (err) {
        console.error("Anonymous login failed:", err);
        authError.value =
            err instanceof Error ? err.message : "Anonymous login failed";

        // Mark auto-connect as failed if this was an auto-connect attempt
        if (isAutoConnect) {
            markAutoConnectFailed('anonymous');
        }
    } finally {
        isAuthenticating.value = false;
    }
};

const loginWithDebugToken = async (isAutoConnect = false) => {
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

        // Skip if this token was the last invalidated one
        const lastInvalidated = getLastInvalidatedToken();
        if (lastInvalidated && lastInvalidated === token) {
            if (isAutoConnect) {
                markAutoConnectFailed('debug');
            }
            throw new Error("Debug token was previously invalidated; skipping auto-login");
        }

        console.log("[VircadiaWorldAuthProvider] Setting debug token auth", {
            token,
            provider: configuredProvider,
        });

        // Parse the JWT to extract sessionId and agentId
        try {
            const tokenParts = token.split(".");
            if (tokenParts.length === 3) {
                const payload = JSON.parse(atob(tokenParts[1]));
                console.log(
                    "[VircadiaWorldAuthProvider] Debug token payload",
                    payload,
                );

                if (payload.sessionId) {
                    sessionId.value = payload.sessionId;
                }
                if (payload.agentId) {
                    agentId.value = payload.agentId;
                }
            }
        } catch (parseError) {
            console.error(
                "[VircadiaWorldAuthProvider] Failed to parse debug token",
                parseError,
            );
        }

        sessionToken.value = token; props.vircadiaWorld.client.setAuthToken(token);
        authProvider.value = configuredProvider; props.vircadiaWorld.client.setAuthProvider(configuredProvider);
        // Update client config to use this token/provider
        props.vircadiaWorld.client.setAuthToken(token);
        props.vircadiaWorld.client.setAuthProvider(configuredProvider);
        account.value = {
            homeAccountId: agentId.value || "debug-user",
            environment: "debug",
            tenantId: "",
            username: "Debug User",
            localAccountId: agentId.value || "debug-user",
            name: "Debug User",
        } as AccountInfo;
        props.vircadiaWorld.client.setStoredAccount(account.value);

        // Clear any previous auto-connect failure on successful login
        if (isAutoConnect) {
            clearAutoConnectFailure('debug');
        }

        // Mark auth as valid and auto-connect; rely on server to reject if invalid
        authValidationState.value = 'valid';
        clearLastInvalidatedToken();
        console.log("[VircadiaWorldAuthProvider] Debug token login complete", {
            sessionToken: !!sessionToken.value,
            sessionId: sessionId.value,
            agentId: agentId.value,
            authProvider: authProvider.value,
            isAuthenticated: isAuthenticated.value,
        });
        emit("authenticated");
        if (autoConnect.value) {
            await connect();
        }
    } catch (err) {
        console.error("Debug token login failed:", err);
        authError.value =
            err instanceof Error ? err.message : "Debug token login failed";

        // Mark auto-connect as failed if this was an auto-connect attempt
        if (isAutoConnect) {
            markAutoConnectFailed('debug');
        }
    } finally {
        isAuthenticating.value = false;
    }
};

async function logout() {
    try {
        // Pre-unmount dependent components (e.g., WebRTC) while connection is still alive
        // by marking authentication false in local state and yielding a tick
        const originalToken = sessionToken.value;
        if (originalToken) {
            sessionToken.value = null;
            await nextTick();
            // Give onUnmounted hooks a micro window to run async cleanup (offline announces)
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        await props.vircadiaWorld.client.logout();
    } catch (e) {
        console.warn("Logout request failed:", e);
    } finally {
        // Clear local state regardless of server result
        logoutLocal("User logged out");
    }
}

/**
 * Clears local authentication state without calling the server.
 * Use this when the server has already denied/expired the session (e.g., 401).
 */
function logoutLocal(reason?: string) {
    // Persist the current token as invalidated to avoid auto-retrying it
    const currentToken = sessionToken.value || props.vircadiaWorld.client.getStoredToken();
    if (currentToken) setLastInvalidatedToken(currentToken);
    props.vircadiaWorld.client.clearLocalAuth();
    // Clear reactive auth state to prevent auto-reconnect logic from considering the user authenticated
    sessionToken.value = null;
    sessionId.value = null;
    agentId.value = null;
    authProvider.value = "";
    account.value = null;
    authError.value = reason ?? null;
    // Clear auto-connect failure tracking on logout
    clearAllAutoConnectFailures();
    // Reset validation state
    authValidationState.value = 'pending';
    // Ensure connection is terminated
    ensureDisconnected();
}

async function handleOAuthRedirectIfPresent(): Promise<boolean> {
    try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code) return false;

        isAuthenticating.value = true;
        authError.value = null;

        const resp = await props.vircadiaWorld.client.restAuth.handleOAuthCallback({
            provider: "azure",
            code,
            state: state || undefined,
        });

        if (!(resp as { success?: boolean })?.success) {
            const message = (resp as { message?: string })?.message || "OAuth callback failed";
            authError.value = message;
            return true;
        }

        const { token, provider, email, displayName, username } = resp as unknown as {
            token: string;
            sessionId: string;
            agentId: string;
            provider: string;
            email?: string;
            displayName?: string;
            username?: string;
        };

        // Persist provider FIRST so any token-triggered connect uses correct provider
        props.vircadiaWorld.client.setAuthProvider(provider || "azure");

        // Then persist token and sync SDK
        props.vircadiaWorld.client.setAuthToken(token);

        // Minimal account profile for UI
        const nameGuess = displayName || username || email || "User";
        const newAccount = {
            homeAccountId: "", // Filled in by SDK from token
            environment: "azure",
            tenantId: "",
            username: email || username || nameGuess,
            localAccountId: "", // Filled in by SDK from token
            name: nameGuess,
        } as AccountInfo;
        props.vircadiaWorld.client.setStoredAccount(newAccount);

        // Keep local refs in sync with core across tabs/flows
        const removeAuthListener = props.vircadiaWorld.client.addAuthChangeListener(() => {
            sessionToken.value = props.vircadiaWorld.client.getStoredToken();
            sessionId.value = props.vircadiaWorld.client.getStoredSessionId();
            agentId.value = props.vircadiaWorld.client.getStoredAgentId();
            authProvider.value = props.vircadiaWorld.client.getStoredProvider();
            account.value = props.vircadiaWorld.client.getStoredAccount();
        });

        onUnmounted(() => {
            removeAuthListener();
        });

        // Clean query params to avoid re-processing on refresh
        try {
            const cleanUrl = `${url.origin}${url.pathname}${url.hash}`;
            window.history.replaceState({}, document.title, cleanUrl);
        } catch { }

        // Navigate back to the stored return URL if present and same-origin
        try {
            const returnUrl = sessionStorage.getItem("vircadia-auth-return-url");
            sessionStorage.removeItem("vircadia-auth-return-url");
            if (returnUrl) {
                const ret = new URL(returnUrl, window.location.href);
                if (ret.origin === window.location.origin) {
                    window.location.replace(ret.toString());
                }
            }
        } catch { }

        // Mark auth as valid and auto-connect; rely on server to reject if invalid
        authValidationState.value = 'valid';
        emit("authenticated");
        if (autoConnect.value) {
            await connect();
        }
        return true;
    } finally {
        isAuthenticating.value = false;
    }
}

// Auto-login with debug token if available and not already authenticated
onMounted(async () => {
    console.log(
        "[VircadiaWorldAuthProvider] Mounted, checking for auto-login",
        {
            isAuthenticated: isAuthenticated.value,
            hasDebugToken:
                !!clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN,
            debugTokenProvider:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER,
        },
    );

    // Only perform any auto-login when auto-connect is enabled
    if (!autoConnect.value) {
        return;
    }

    // Handle OAuth redirect (code/state) before any auto-login logic
    try {
        const handled = await handleOAuthRedirectIfPresent();
        if (handled) return;
    } catch (e) {
        console.warn("[VircadiaWorldAuthProvider] OAuth redirect handling error", e);
    }

    // 1) Prefer existing valid OAuth session (Azure) when present
    try {
        const currentToken = sessionToken.value;
        const provider = authProvider.value;
        const lastInvalidated = getLastInvalidatedToken();
        if (
            currentToken &&
            provider === "azure" &&
            lastInvalidated !== currentToken
        ) {
            console.log("[VircadiaWorldAuthProvider] Using existing OAuth session (Azure)");
            await connect();
            return;
        }
    } catch (e) {
        console.warn("[VircadiaWorldAuthProvider] OAuth auto-connect attempt skipped", e);
    }

    if (!isAuthenticated.value) {
        const debugToken = clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN;
        const lastInvalidated = getLastInvalidatedToken();
        let attemptedDebug = false;

        if (debugToken) {
            if (hasAutoConnectFailed('debug')) {
                console.log(
                    "[VircadiaWorldAuthProvider] Skipping debug auto-login - previous attempt failed in this session",
                );
            } else if (lastInvalidated && lastInvalidated === debugToken) {
                console.log(
                    "[VircadiaWorldAuthProvider] Skipping debug auto-login - token was previously invalidated",
                );
                markAutoConnectFailed('debug');
            } else {
                console.log(
                    "[VircadiaWorldAuthProvider] Auto-logging in with debug token",
                );
                await loginWithDebugToken(true);
                console.log(
                    "[VircadiaWorldAuthProvider] Debug token auto-login completed",
                );
                attemptedDebug = true;
            }
        }

        // Fallback to anonymous if enabled and still not authenticated after any debug attempt
        if (
            !isAuthenticated.value &&
            autoConnect.value
        ) {
            if (hasAutoConnectFailed('anonymous')) {
                console.log(
                    "[VircadiaWorldAuthProvider] Skipping anonymous auto-login - previous attempt failed in this session",
                );
            } else if (!isAuthenticated.value) {
                console.log(
                    "[VircadiaWorldAuthProvider] Auto-logging in anonymously",
                );
                await loginAnonymously(true);
                console.log(
                    "[VircadiaWorldAuthProvider] Anonymous auto-login completed",
                );
            }
        }
    }
});

// Add connection management logic
const connectionInfo = props.vircadiaWorld.connectionInfo;
const isConnecting = computed(() => connectionInfo.value.isConnecting);
const connectionStatus = computed(() => connectionInfo.value.status);
const lastConnectedToken = ref<string | null>(null);

const accountDisplayName = computed(() => {
    const value = account.value as AccountInfo | null | undefined;
    if (!value) {
        const agentIdFromConnection = connectionInfo.value.agentId || null;
        if (isAuthenticated.value && agentIdFromConnection) {
            return agentIdFromConnection;
        }
        if (isAuthenticated.value) {
            return "Authenticated";
        }
        return "Not signed in";
    }
    return (
        value.username ||
        value.name ||
        value.localAccountId ||
        "User"
    );
});

function ensureDisconnected() {
    const info = connectionInfo.value;
    if (info.isConnected || info.isConnecting) {
        props.vircadiaWorld.client.connection.disconnect();
    }
    lastConnectedToken.value = null;
}

async function validateAuthentication(): Promise<boolean> {
    // Simplified: consider auth valid if token and provider exist
    const ok = !!sessionToken.value && !!authProvider.value;
    authValidationState.value = ok ? 'valid' : 'invalid';
    return ok;
}

async function connect() {
    if (isConnecting.value) {
        return;
    }

    const currentToken = sessionToken.value;
    if (!currentToken) {
        ensureDisconnected();
        return;
    }

    if (connectionInfo.value.isConnected && lastConnectedToken.value === currentToken) {
        return;
    }

    try {
        if (connectionInfo.value.isConnected) {
            if (lastConnectedToken.value !== currentToken) {
                props.vircadiaWorld.client.connection.disconnect();
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }

        const currentAuthProvider = authProvider.value || "anon";
        props.vircadiaWorld.client.setAuthToken(currentToken);
        props.vircadiaWorld.client.setAuthProvider(currentAuthProvider);

        await props.vircadiaWorld.client.connection.connect({ timeoutMs: 15000 });
        lastConnectedToken.value = currentToken;
        authValidationState.value = 'valid';
    } catch (error) {
        lastConnectedToken.value = null;

        const message = error instanceof Error ? error.message : String(error);

        // Unauthorized-like errors -> clear auth and surface to UI
        if (
            message.includes("401") ||
            message.includes("Unauthorized") ||
            message.includes("Authentication") ||
            message.includes("Invalid token")
        ) {
            logoutLocal(`Authentication failed: ${message}`);
            emit("auth-denied", { reason: "unauthorized", message });
            return;
        }

        // Network/connection failures -> keep auth, notify
        if (message.includes("Failed to fetch") || message.includes("ERR_CONNECTION_REFUSED")) {
            authValidationState.value = 'valid';
            emit("auth-denied", { reason: "authentication_failed", message });
            return;
        }

        // Other errors -> mark invalid and notify
        authValidationState.value = 'invalid';
        emit("auth-denied", { reason: "authentication_failed", message });
    }
}

function disconnect() {
    ensureDisconnected();
}

async function handleAuthDenied(
    reason: "expired" | "invalid" | "unauthorized" | "authentication_failed",
    message: string,
) {
    logoutLocal(`Authentication failed: ${message}`);
    emit("auth-denied", { reason, message });
}

async function handleAuthChange() {
    if (!autoConnect.value) {
        return;
    }

    const hasToken = props.vircadiaWorld.client.getAuthState().hasToken;
    if (hasToken) {
        authValidationState.value = 'valid';
        if (connectionInfo.value.isConnected && lastConnectedToken.value === sessionToken.value) {
            return;
        }
        connect();
    } else {
        authValidationState.value = 'invalid';
        ensureDisconnected();
    }
}

watch(
    () => sessionToken.value,
    async (newToken, oldToken) => {
        if (!autoConnect.value || (newToken === oldToken && connectionInfo.value.isConnected)) {
            return;
        }
        await handleAuthChange();
    },
    { immediate: true },
);

watch(
    () => connectionStatus.value,
    (newStatus, oldStatus) => {
        if (
            autoConnect.value &&
            newStatus === "disconnected" &&
            oldStatus === "connected" &&
            isAuthenticated.value &&
            !isConnecting.value
        ) {
            setTimeout(() => {
                connect();
            }, reconnectDelayMs.value);
        }
    },
);

defineExpose({
    loginWithAzure,
    loginAnonymously,
    loginWithDebugToken,
    logout,
    logoutLocal,
    showDebugLogin,
    isAuthenticated,
    isAuthenticating,
    authError,
    account,
    sessionToken,
    sessionId,
    agentId,
    authProvider,
    connect,
    disconnect,
    connectionInfo,
    connectionStatus,
    isConnecting,
    authValidationState,
    validateAuthentication,
});
</script>