<template>
    <div>
        <slot v-if="isAuthenticated" :isAuthenticated="isAuthenticated" :isAuthenticating="isAuthenticating"
            :authError="authError" :account="account" :sessionToken="sessionToken" :sessionId="sessionId"
            :agentId="agentId" :authProvider="authProvider" :logout="logout" :logoutLocal="logoutLocal" />
        <v-container v-else fluid fill-height class="intro-screen">
            <v-row align="center" justify="center">
                <v-col cols="12" sm="8" md="6" lg="4">
                    <v-card class="elevation-12" :loading="isAuthenticating">
                        <v-toolbar color="primary" dark flat>
                            <v-toolbar-title>Welcome to Vircadia</v-toolbar-title>
                        </v-toolbar>
                        <v-card-text class="pa-6">
                            <p class="text-center text-h6 font-weight-regular">
                                Please choose your login method to continue.
                            </p>
                            <v-alert v-if="authError" type="error" dense class="mt-4">
                                {{ authError }}
                            </v-alert>
                        </v-card-text>
                        <v-card-actions class="d-flex flex-column pa-6 pt-0">
                            <v-btn block x-large color="primary" @click="loginWithAzure" :disabled="isAuthenticating"
                                class="mb-4">
                                <v-icon left>mdi-microsoft-azure</v-icon>
                                Login with Azure AD
                            </v-btn>
                            <v-btn block x-large color="secondary" @click="loginAnonymously"
                                :disabled="isAuthenticating" class="mb-4">
                                <v-icon left>mdi-account-circle-outline</v-icon>
                                Continue as Anonymous
                            </v-btn>
                            <v-btn v-if="showDebugLogin" block x-large color="accent" @click="loginWithDebugToken"
                                :disabled="isAuthenticating">
                                <v-icon left>mdi-bug-check</v-icon>
                                Continue with Debug Token
                            </v-btn>
                        </v-card-actions>
                    </v-card>
                </v-col>
            </v-row>
        </v-container>
    </div>
</template>

<script setup lang="ts">
import type { AccountInfo } from "@azure/msal-browser";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
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

const account = ref<AccountInfo | null>(props.vircadiaWorld.client.getStoredAccount<AccountInfo>());
const sessionToken = ref<string | null>(props.vircadiaWorld.client.getStoredToken());
const sessionId = ref<string | null>(props.vircadiaWorld.client.getStoredSessionId());
const agentId = ref<string | null>(props.vircadiaWorld.client.getStoredAgentId());
const authProvider = ref<string>(props.vircadiaWorld.client.getStoredProvider());

// Track authentication validation state
const authValidationState = ref<'pending' | 'validating' | 'valid' | 'invalid'>('pending');

const isAuthenticated = computed(() => {
    const hasToken = props.vircadiaWorld.client.getAuthState().hasToken;
    const hasAccount = !!account.value;

    // If we have no token or account, definitely not authenticated
    if (!hasToken || !hasAccount) {
        return false;
    }

    // If we have token and account, check validation state
    // Only consider authenticated if validation is complete and valid
    return authValidationState.value === 'valid';
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

            // Validate authentication before marking as valid
            const isValid = await validateAuthentication();
            if (isValid) {
                emit("authenticated");
            } else {
                throw new Error("Anonymous authentication validation failed - server may be offline");
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

        // Validate authentication before marking as valid
        const isValid = await validateAuthentication();
        if (isValid) {
            console.log("[VircadiaWorldAuthProvider] Debug token login complete", {
                sessionToken: !!sessionToken.value,
                sessionId: sessionId.value,
                agentId: agentId.value,
                authProvider: authProvider.value,
                isAuthenticated: isAuthenticated.value,
            });
            emit("authenticated");
        } else {
            throw new Error("Debug token validation failed - server may be offline");
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
    props.vircadiaWorld.client.clearLocalAuth();
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

        // Validate authentication before marking as valid
        const isValid = await validateAuthentication();
        if (isValid) {
            emit("authenticated");
            return true;
        } else {
            throw new Error("OAuth authentication validation failed - server may be offline");
        }
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

    // Handle OAuth redirect (code/state) before any auto-login logic
    try {
        const handled = await handleOAuthRedirectIfPresent();
        if (handled) return;
    } catch (e) {
        console.warn("[VircadiaWorldAuthProvider] OAuth redirect handling error", e);
    }

    if (!isAuthenticated.value) {
        if (clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN) {
            // Check if debug auto-connect has failed before in this session
            if (hasAutoConnectFailed('debug')) {
                console.log(
                    "[VircadiaWorldAuthProvider] Skipping debug auto-login - previous attempt failed in this session",
                );
            } else {
                console.log(
                    "[VircadiaWorldAuthProvider] Auto-logging in with debug token",
                );
                await loginWithDebugToken(true);
                console.log(
                    "[VircadiaWorldAuthProvider] Debug token auto-login completed",
                );
            }
        } else if (clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_AUTO_CONNECT_ANONYMOUS) {
            // Check if anonymous auto-connect has failed before in this session
            if (hasAutoConnectFailed('anonymous')) {
                console.log(
                    "[VircadiaWorldAuthProvider] Skipping anonymous auto-login - previous attempt failed in this session",
                );
            } else {
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

function ensureDisconnected() {
    const info = connectionInfo.value;
    if (info.isConnected || info.isConnecting) {
        props.vircadiaWorld.client.connection.disconnect();
    }
    lastConnectedToken.value = null;
}

async function validateAuthentication(): Promise<boolean> {
    const currentToken = sessionToken.value;
    const currentProvider = authProvider.value;

    if (!currentToken || !currentProvider) {
        authValidationState.value = 'invalid';
        return false;
    }

    authValidationState.value = 'validating';

    try {
        const sessionResp = await props.vircadiaWorld.client.restAuth.validateSession({
            token: currentToken,
            provider: currentProvider,
        });

        const isValid = !!(sessionResp as { success?: boolean })?.success;

        if (isValid) {
            authValidationState.value = 'valid';
            return true;
        } else {
            authValidationState.value = 'invalid';
            return false;
        }
    } catch (error) {
        console.warn('[VircadiaWorldAuthProvider] Authentication validation failed:', error);
        authValidationState.value = 'invalid';
        return false;
    }
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

    // First validate authentication before attempting to connect
    const isAuthValid = await validateAuthentication();
    if (!isAuthValid) {
        // Authentication validation failed - don't clear tokens, just show login page
        authValidationState.value = 'invalid';
        emit("auth-denied", {
            reason: "authentication_failed",
            message: "Authentication failed: Failed to fetch"
        });
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

        // Check if this is a fetch failure or connection error
        if (message.includes("Failed to fetch") || message.includes("ERR_CONNECTION_REFUSED")) {
            // Don't clear tokens for fetch failures, just mark as invalid and show login
            authValidationState.value = 'invalid';
            emit("auth-denied", {
                reason: "authentication_failed",
                message: `Authentication failed: ${message}`
            });
            return;
        }

        // For other errors, clear local state
        logoutLocal(`Connection failed: ${message}`);

        if (error instanceof Error) {
            if (
                error.message.includes("Authentication") ||
                error.message.includes("401") ||
                error.message.includes("Invalid token")
            ) {
                let reason:
                    | "expired"
                    | "invalid"
                    | "unauthorized"
                    | "authentication_failed" = "authentication_failed";
                const msg = error.message || "Authentication failed";
                if (msg.includes("expired")) reason = "expired";
                else if (msg.includes("Invalid session")) reason = "invalid";
                else if (msg.includes("401") || msg.includes("Unauthorized"))
                    reason = "unauthorized";

                emit("auth-denied", { reason, message: msg });
            }
        }
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
    const hasAccount = !!account.value;

    if (hasToken && hasAccount) {
        // We have token and account, validate authentication first
        if (authValidationState.value === 'pending') {
            await validateAuthentication();
        }

        if (isAuthenticated.value) {
            if (connectionInfo.value.isConnected && lastConnectedToken.value === sessionToken.value) {
                return;
            }
            connect();
        } else {
            // Authentication is invalid, show login page but don't clear tokens
            ensureDisconnected();
        }
    } else {
        // No token or account, disconnect
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

<style scoped>
.intro-screen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 2000;
    background: #202020;
}
</style>