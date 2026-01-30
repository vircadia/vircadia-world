<template>
    <v-app>
        <!-- Right Debug Drawer -->
        <RightDrawer v-model:open="rightDrawerOpen" v-model:tab="rightDrawerTab"
            :physics-enabled="canvasComponentRef?.physicsEnabled"
            :physics-plugin-name="canvasComponentRef?.physicsPluginName || undefined"
            :physics-error="canvasComponentRef?.physicsError || undefined" :gravity="canvasComponentRef?.gravity"
            :physics-engine-type="canvasComponentRef?.physicsEngineType || ''"
            :physics-initialized="canvasComponentRef?.physicsInitialized"
            :havok-instance-loaded="canvasComponentRef?.havokInstanceLoaded"
            :physics-plugin-created="canvasComponentRef?.physicsPluginCreated"
            :scene="canvasComponentRef?.scene ?? undefined" :canvas="canvasComponentRef?.canvas ?? undefined"
            :avatar-node="avatarRef?.avatarNode || undefined" :avatar-skeleton="avatarRef?.avatarSkeleton || undefined"
            :model-file-name="(avatarRef?.modelFileName) || (modelFileNameRef) || undefined"
            :model-step="avatarModelStep" :model-error="avatarModelError || undefined"
            :is-talking="!!(avatarRef?.isTalking)" :talk-level="Number(avatarRef?.talkLevel || 0)"
            :talk-threshold="Number(avatarRef?.talkThreshold || 0)"
            :audio-input-devices="(avatarRef?.audioInputDevices) || []" :airborne="!!(avatarRef?.lastAirborne)"
            :vertical-velocity="Number(avatarRef?.lastVerticalVelocity || 0)"
            :support-state="avatarRef?.lastSupportState ?? undefined"
            :has-touched-ground="!!(avatarRef?.hasTouchedGround)" :spawn-settling="!!(avatarRef?.spawnSettleActive)"
            :ground-probe-hit="!!(avatarRef?.groundProbeHit)"
            :ground-probe-distance="avatarRef?.groundProbeDistance ?? undefined"
            :ground-probe-mesh-name="avatarRef?.groundProbeMeshName ?? undefined"
            :animation-debug="avatarRef?.animationDebug || undefined" :sync-metrics="avatarSyncMetrics || undefined"
            :avatar-reflect-sync-group="'public.REALTIME'" :avatar-entity-sync-group="'public.NORMAL'"
            :avatar-reflect-channel="'avatar_data'" :other-avatar-session-ids="otherAvatarsRef?.otherAvatarSessionIds"
            :avatar-data-map="otherAvatarsRef?.avatarDataMap"
            :position-data-map="otherAvatarsRef?.positionDataMap || {}"
            :rotation-data-map="otherAvatarsRef?.rotationDataMap || {}"
            :joint-data-map="otherAvatarsRef?.jointDataMap || {}"
            :last-poll-timestamps="otherAvatarsRef?.lastPollTimestamps || {}"
            :last-base-poll-timestamps="otherAvatarsRef?.lastBasePollTimestamps || {}"
            :last-camera-poll-timestamps="otherAvatarsRef?.lastCameraPollTimestamps || {}"
            :other-avatars-is-loading="otherAvatarsRef?.areOtherAvatarsLoading"
            :other-avatars-poll-stats="otherAvatarsRef?.discoveryStats"
            :other-avatar-reflect-stats="otherAvatarsRef?.reflectStats" :voice-chat-active="false"
            :voice-chat-processing="false" :voice-chat-worker-ready="false" :stt-transcripts="[]" />

        <VircadiaWorldProvider v-slot="{ vircadiaWorld, connectionInfo, connectionStatus, isConnecting }">

            <VircadiaWorldAuthProvider :vircadia-world="vircadiaWorld"
                :auto-connect="clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_AUTO_CONNECT"
                @auth-denied="onAuthDenied($event)">
                <template
                    #default="{ isAuthenticated, isAuthenticating, authError, accountDisplayName, logout, connect, disconnect, loginWithAzure, loginAnonymously, loginWithDebugToken, showDebugLogin }">
                    <template v-if="isAuthenticated && connectionStatus === 'connected'">
                        <!-- App Bar with Actions -->
                        <v-app-bar ref="mainAppBar" density="compact" color="primary" flat app>
                            <v-app-bar-nav-icon @click="leftDrawerOpen = !leftDrawerOpen" />
                            <v-spacer />

                            <!-- Audio Controls / Active Users -->
                            <!-- TODO: Re-connect active user count if available from VircadiaScene or Provider -->
                            <v-tooltip location="bottom">
                                <template #activator="{ props }">
                                    <v-badge :content="0" color="secondary" overlap location="bottom start"
                                        offset-x="10" offset-y="10" :model-value="false" class="ml-2">
                                        <v-btn v-bind="props" icon variant="text" @click="showWebRTCControls = true">
                                            <v-icon>mdi-account-group</v-icon>
                                        </v-btn>
                                    </v-badge>
                                </template>
                                <span>Active Users</span>
                            </v-tooltip>

                            <!-- World Stats Dialog -->
                            <v-tooltip location="bottom">
                                <template #activator="{ props }">
                                    <v-btn v-bind="props" icon variant="text" class="ml-2"
                                        @click="worldStatsDialogOpen = true">
                                        <v-icon>mdi-chart-bar</v-icon>
                                    </v-btn>
                                </template>
                                <span>World Stats</span>
                            </v-tooltip>
                            <WorldStatsDialog v-model="worldStatsDialogOpen" />

                            <v-speed-dial v-model="perfDialOpen" location="bottom end" transition="fade-transition">
                                <template #activator="{ props }">
                                    <v-btn v-bind="props" icon class="ml-2"
                                        :color="performanceMode === 'normal' ? 'success' : 'warning'">
                                        <v-icon>{{ performanceMode === 'normal' ? 'mdi-speedometer' :
                                            'mdi-speedometer-slow'
                                            }}</v-icon>
                                    </v-btn>
                                </template>
                                <div key="normalPerf">
                                    <v-tooltip location="bottom">
                                        <template #activator="{ props: aprops }">
                                            <v-btn v-bind="aprops" icon
                                                :color="performanceMode === 'normal' ? 'success' : undefined"
                                                @click="performanceMode = 'normal'; perfDialOpen = false">
                                                <v-icon>mdi-speedometer</v-icon>
                                            </v-btn>
                                        </template>
                                        <span>Normal performance</span>
                                    </v-tooltip>
                                </div>
                                <div key="lowPerf">
                                    <v-tooltip location="bottom">
                                        <template #activator="{ props: aprops }">
                                            <v-btn v-bind="aprops" icon
                                                :color="performanceMode === 'low' ? 'warning' : undefined"
                                                @click="performanceMode = 'low'; perfDialOpen = false">
                                                <v-icon>mdi-speedometer-slow</v-icon>
                                            </v-btn>
                                        </template>
                                        <span>Low performance</span>
                                    </v-tooltip>
                                </div>
                            </v-speed-dial>

                            <!-- Movement Speed Dial -->
                            <v-speed-dial v-model="moveDialOpen" location="bottom end" transition="fade-transition">
                                <template #activator="{ props }">
                                    <v-btn v-bind="props" icon class="ml-2"
                                        :color="(avatarRef?.isFlying) ? 'success' : undefined">
                                        <v-icon>{{ (avatarRef?.isFlying) ? 'mdi-airplane' : 'mdi-walk'
                                            }}</v-icon>
                                    </v-btn>
                                </template>
                                <div key="fly">
                                    <v-tooltip location="bottom">
                                        <template #activator="{ props: aprops }">
                                            <v-btn v-bind="aprops" icon color="success"
                                                :disabled="!!(avatarRef?.isFlying)"
                                                @click="!(avatarRef?.isFlying) && avatarRef?.toggleFlying && avatarRef.toggleFlying(); moveDialOpen = false">
                                                <v-icon>mdi-airplane-takeoff</v-icon>
                                            </v-btn>
                                        </template>
                                        <span>Fly on</span>
                                    </v-tooltip>
                                </div>
                                <div key="walk">
                                    <v-tooltip location="bottom">
                                        <template #activator="{ props: aprops }">
                                            <v-btn v-bind="aprops" icon
                                                :color="!(avatarRef?.isFlying) ? 'grey' : 'error'"
                                                :disabled="!(avatarRef?.isFlying)"
                                                @click="(avatarRef?.isFlying) && avatarRef?.toggleFlying && avatarRef.toggleFlying(); moveDialOpen = false">
                                                <v-icon>mdi-walk</v-icon>
                                            </v-btn>
                                        </template>
                                        <span>Fly off</span>
                                    </v-tooltip>
                                </div>
                            </v-speed-dial>

                            <!-- Babylon Inspector (Dev only) -->
                            <template v-if="isDev">
                                <v-tooltip key="inspector" location="bottom">
                                    <template #activator="{ props }">
                                        <v-btn v-bind="props" icon variant="text" class="ml-2" @click="toggleInspector">
                                            <v-icon>{{ inspectorVisible ? 'mdi-file-tree' :
                                                'mdi-file-tree-outline'
                                                }}</v-icon>
                                        </v-btn>
                                    </template>
                                    <span>Babylon Inspector (T)</span>
                                </v-tooltip>
                            </template>

                            <!-- Teleport target for agent controls -->
                            <div ref="teleportTarget" class="teleport-container"></div>

                            <!-- Toggle Right Debug Drawer -->
                            <v-tooltip location="bottom">
                                <template #activator="{ props }">
                                    <v-btn v-bind="props" icon variant="text" class="ml-2"
                                        @click="rightDrawerOpen = !rightDrawerOpen">
                                        <v-icon>mdi-dock-right</v-icon>
                                    </v-btn>
                                </template>
                                <span>Debug Drawer</span>
                            </v-tooltip>
                        </v-app-bar>

                        <!-- Left Navigation Drawer extracted to component -->
                        <LeftDrawer v-model:open="leftDrawerOpen" :width="320" :isAuthenticated="isAuthenticated"
                            :displayName="accountDisplayName || undefined"
                            :provider="connectionInfo.authProvider || 'anon'" :onLogout="logout"
                            :vircadia-world="vircadiaWorld" :connection-info="connectionInfo" />

                        <v-main style="height: 100%; overflow: hidden">
                            <!-- Mount the Active World Component -->
                            <component :is="activeWorldComponent" ref="activeWorldRef" :vircadia-world="vircadiaWorld"
                                :engine-type="isAutonomousAgent ? 'nullengine' : 'webgpu'" />
                        </v-main>
                    </template>
                    <template v-else>
                        <VircadiaWorldAuthLogin :is-authenticating="isAuthenticating" :auth-error="authError"
                            :show-debug-login="showDebugLogin" @azure="loginWithAzure()" @anonymous="loginAnonymously()"
                            @debug="loginWithDebugToken()" />
                    </template>
                </template>
            </VircadiaWorldAuthProvider>
        </VircadiaWorldProvider>

        <div class="build-overlay" aria-label="Build info">
            <span class="build-overlay__dot" />
            <span class="build-overlay__text">v{{ appVersion }} • {{ buildDate }} • {{ commitHash }}</span>
        </div>
    </v-app>
</template>

<script setup lang="ts">
import {
    clientBrowserConfiguration,
    clientBrowserState,
} from "@vircadia/world-sdk/browser/vue";
import { useStorage } from "@vueuse/core";
import {
    computed,
    defineComponent,
    provide,
    ref,
    defineAsyncComponent,
    markRaw
} from "vue";
import { useRoute } from "vue-router";
import { useRouteComponents, type NamedComponent } from "@/composables/useUserComponents";

// Components
import LeftDrawer from "@/components/LeftDrawer.vue";
import RightDrawer from "@/components/RightDrawer.vue";
import WorldStatsDialog from "@/components/WorldStatsDialog.vue";
import VircadiaWorldAuthLogin from "@/components/VircadiaWorldAuthLogin.vue";
import VircadiaWorldAuthProvider from "@/components/VircadiaWorldAuthProvider.vue";
import VircadiaWorldProvider from "@/components/VircadiaWorldProvider.vue";
import DefaultWorld from "@/components/DefaultWorld.vue";

const appVersion = __APP_VERSION__;
const buildDate = new Date(__BUILD_DATE__).toLocaleString();
const commitHash = __COMMIT_HASH__;

// isAutonomousAgent now comes from browser state via URL parameter detection
const isAutonomousAgent = computed(() =>
    clientBrowserState.isAutonomousAgent(),
);

// UI State
const leftDrawerOpen = ref(true);
const rightDrawerOpen = ref(false);
const rightDrawerTab = ref("properties");
const perfDialOpen = ref(false);
const moveDialOpen = ref(false);
const worldStatsDialogOpen = ref(false);
const showWebRTCControls = ref(false);
const isDev = import.meta.env.DEV;
const performanceMode = useStorage<"normal" | "low">("vrca.perf.mode", "normal");
// Note: inspectorVisible is technically inside VircadiaScene, we can guess it or just track local toggle state if needed,
// but for the icon flip we might need to know. For now, assume a local toggle or just button click.
const inspectorVisible = ref(false);

// Teleport target for agent controls (still needed if VircadiaScene's children use it)
const teleportTarget = ref<HTMLElement | null>(null);
provide("mainAppBarTeleportTarget", teleportTarget);

function onAuthDenied(event: { reason: string; message: string }) {
    console.warn("Auth denied:", event.reason, event.message);
}

// Dynamic World Loading
const { getComponentsForRoute } = useRouteComponents();
const route = useRoute();

const activeWorldComponent = computed(() => {
    const path = route.path;
    const components = getComponentsForRoute(path);
    if (components.length > 0) {
        console.debug(`[MainScene] Loaded world component: ${components[0].name}`);
        return components[0].component;
    }
    return markRaw(DefaultWorld);
});

// Ref to the currently mounted world (DefaultWorld, COVE, etc.)
const activeWorldRef = ref<any>(null);

// expose refs via computed chains for the RightDrawer
const canvasComponentRef = computed(() => activeWorldRef.value?.canvasComponentRef);
const avatarRef = computed(() => activeWorldRef.value?.avatarRef);
const otherAvatarsRef = computed(() => activeWorldRef.value?.otherAvatarsRef);

// Stub data for now - these would need to be exposed from VircadiaScene if needed in MainScene
const avatarModelStep = ref("");
const avatarModelError = ref("");
const modelFileNameRef = ref("");
const avatarSyncMetrics = ref(null);

function toggleInspector() {
    activeWorldRef.value?.toggleInspector?.();
    inspectorVisible.value = !inspectorVisible.value;
}
</script>
