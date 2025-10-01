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
import { StorageSerializers, useStorage } from "@vueuse/core";
import { computed, onMounted, ref } from "vue";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";
import { clientBrowserConfiguration } from "../../../../sdk/vircadia-world-sdk-ts/browser/src/config/vircadia.browser.config";

const props = defineProps<{
    vircadiaWorld: VircadiaWorldInstance;
}>();

const emit = defineEmits<{
    authenticated: [];
}>();

const isAuthenticating = ref(false);
const authError = ref<string | null>(null);

const account = useStorage<AccountInfo | null>(
    "vircadia-account",
    null,
    localStorage,
    { serializer: StorageSerializers.object },
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

const isAuthenticated = computed(() => !!sessionToken.value && !!account.value);

const showDebugLogin = computed(() => {
    return !!clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN;
});

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

const loginAnonymously = async () => {
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
            sessionToken.value = token;
            sessionId.value = newSessionId;
            agentId.value = newAgentId;
            authProvider.value = "anon";
            account.value = {
                homeAccountId: newAgentId,
                environment: "anonymous",
                tenantId: "",
                username: `Anonymous ${newAgentId.substring(0, 8)}`,
                localAccountId: newAgentId,
                name: `Anonymous ${newAgentId.substring(0, 8)}`,
            } as AccountInfo;
            emit("authenticated");
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

        sessionToken.value = token;
        authProvider.value = configuredProvider;
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

        console.log("[VircadiaWorldAuthProvider] Debug token login complete", {
            sessionToken: !!sessionToken.value,
            sessionId: sessionId.value,
            agentId: agentId.value,
            authProvider: authProvider.value,
            isAuthenticated: isAuthenticated.value,
        });
        emit("authenticated");
    } catch (err) {
        console.error("Debug token login failed:", err);
        authError.value =
            err instanceof Error ? err.message : "Debug token login failed";
    } finally {
        isAuthenticating.value = false;
    }
};

async function logout() {
    if (!sessionId.value) {
        // Still clear local state
        account.value = null;
        sessionToken.value = null;
        sessionId.value = null;
        agentId.value = null;
        authProvider.value = "anon";
        authError.value = null;
        return;
    }
    try {
        await props.vircadiaWorld.client.logout();
    } catch (e) {
        console.warn("Logout request failed:", e);
    } finally {
        account.value = null;
        sessionToken.value = null;
        sessionId.value = null;
        agentId.value = null;
        authProvider.value = "anon";
        authError.value = null;
    }
}

/**
 * Clears local authentication state without calling the server.
 * Use this when the server has already denied/expired the session (e.g., 401).
 */
function logoutLocal(reason?: string) {
    account.value = null;
    sessionToken.value = null;
    sessionId.value = null;
    agentId.value = null;
    authProvider.value = "anon";
    authError.value = reason ?? null;
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

        const {
            token,
            sessionId: newSessionId,
            agentId: newAgentId,
            provider,
            email,
            displayName,
            username,
        } = resp as unknown as {
            token: string;
            sessionId: string;
            agentId: string;
            provider: string;
            email?: string;
            displayName?: string;
            username?: string;
        };

        // Persist provider FIRST so any token-triggered connect uses correct provider
        authProvider.value = provider || "azure";
        props.vircadiaWorld.client.setAuthProvider(authProvider.value);

        // Then persist token/session/agent and sync SDK
        sessionToken.value = token;
        sessionId.value = newSessionId;
        agentId.value = newAgentId;
        props.vircadiaWorld.client.setAuthToken(token);
        props.vircadiaWorld.client.setSessionId(newSessionId);

        // Minimal account profile for UI
        const nameGuess = displayName || username || email || newAgentId;
        account.value = {
            homeAccountId: newAgentId,
            environment: "azure",
            tenantId: "",
            username: email || username || nameGuess,
            localAccountId: newAgentId,
            name: nameGuess,
        } as AccountInfo;

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

        emit("authenticated");
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

    // Handle OAuth redirect (code/state) before any auto-login logic
    try {
        const handled = await handleOAuthRedirectIfPresent();
        if (handled) return;
    } catch (e) {
        console.warn("[VircadiaWorldAuthProvider] OAuth redirect handling error", e);
    }

    const suppressed = localStorage.getItem("vircadia-auth-suppressed") === "1";
    if (
        !isAuthenticated.value &&
        !suppressed &&
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN
    ) {
        console.log(
            "[VircadiaWorldAuthProvider] Auto-logging in with debug token",
        );
        await loginWithDebugToken();
        // Give a moment for the reactive system to propagate the changes
        await new Promise((resolve) => setTimeout(resolve, 100));
        console.log(
            "[VircadiaWorldAuthProvider] Debug token auto-login completed",
        );
    }
});

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