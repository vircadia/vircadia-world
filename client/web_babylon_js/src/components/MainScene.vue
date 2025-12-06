<template>
    <!-- Right Debug Drawer -->
    <RightDrawer v-model:open="rightDrawerOpen" v-model:tab="rightDrawerTab"
        :physics-enabled="physicsRef?.physicsEnabled" :physics-plugin-name="physicsRef?.physicsPluginName || undefined"
        :physics-error="physicsRef?.physicsError || undefined" :gravity="physicsRef?.gravity"
        :physics-engine-type="physicsRef?.physicsEngineType || ''" :physics-initialized="physicsRef?.physicsInitialized"
        :havok-instance-loaded="physicsRef?.havokInstanceLoaded"
        :physics-plugin-created="physicsRef?.physicsPluginCreated" :scene="canvasComponentRef?.scene ?? undefined"
        :avatar-node="avatarRef?.avatarNode || undefined" :avatar-skeleton="avatarRef?.avatarSkeleton || undefined"
        :model-file-name="(avatarRef?.modelFileName) || (modelFileNameRef) || undefined" :model-step="avatarModelStep"
        :model-error="avatarModelError || undefined" :is-talking="!!(avatarRef?.isTalking)"
        :talk-level="Number(avatarRef?.talkLevel || 0)" :talk-threshold="Number(avatarRef?.talkThreshold || 0)"
        :audio-input-devices="(avatarRef?.audioInputDevices) || []" :airborne="!!(avatarRef?.lastAirborne)"
        :vertical-velocity="Number(avatarRef?.lastVerticalVelocity || 0)"
        :support-state="avatarRef?.lastSupportState ?? undefined" :has-touched-ground="!!(avatarRef?.hasTouchedGround)"
        :spawn-settling="!!(avatarRef?.spawnSettleActive)" :ground-probe-hit="!!(avatarRef?.groundProbeHit)"
        :ground-probe-distance="avatarRef?.groundProbeDistance ?? undefined"
        :ground-probe-mesh-name="avatarRef?.groundProbeMeshName ?? undefined"
        :animation-debug="avatarRef?.animationDebug || undefined" :sync-metrics="avatarSyncMetrics || undefined"
        :avatar-reflect-sync-group="'public.REALTIME'" :avatar-entity-sync-group="'public.NORMAL'"
        :avatar-reflect-channel="'avatar_data'" :other-avatar-session-ids="otherAvatarsRef?.otherAvatarSessionIds"
        :avatar-data-map="otherAvatarsRef?.avatarDataMap" :position-data-map="otherAvatarsRef?.positionDataMap || {}"
        :rotation-data-map="otherAvatarsRef?.rotationDataMap || {}"
        :joint-data-map="otherAvatarsRef?.jointDataMap || {}"
        :last-poll-timestamps="otherAvatarsRef?.lastPollTimestamps || {}"
        :last-base-poll-timestamps="otherAvatarsRef?.lastBasePollTimestamps || {}"
        :last-camera-poll-timestamps="otherAvatarsRef?.lastCameraPollTimestamps || {}"
        :other-avatars-is-loading="otherAvatarsRef?.areOtherAvatarsLoading"
        :other-avatars-poll-stats="otherAvatarsRef?.discoveryStats"
        :other-avatar-reflect-stats="otherAvatarsRef?.reflectStats" :voice-chat-active="voiceChatInputRef?.sttActive"
        :voice-chat-processing="voiceChatInputRef?.sttProcessing"
        :voice-chat-worker-ready="!!(voiceChatInputRef?.vadInstance)" :stt-transcripts="sttTranscripts" />
    <VircadiaWorldProvider v-slot="{ vircadiaWorld, connectionInfo, connectionStatus, isConnecting }">

        <VircadiaWorldAuthProvider :vircadia-world="vircadiaWorld"
            :auto-connect="clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_AUTO_CONNECT"
            @auth-denied="onAuthDenied($event)">
            <template
                #default="{ isAuthenticated, isAuthenticating, authError, accountDisplayName, logout, connect, disconnect, loginWithAzure, loginAnonymously, loginWithDebugToken, showDebugLogin }">
                <template v-if="isAuthenticated && connectionStatus === 'connected'">
                    <main>
                        <!-- App Bar with Actions -->
                        <v-app-bar ref="mainAppBar" density="compact" color="primary" flat>
                            <v-app-bar-nav-icon @click="leftDrawerOpen = !leftDrawerOpen" />
                            <v-spacer />

                            <!-- Audio Controls -->
                            <v-tooltip location="bottom">
                                <template #activator="{ props }">
                                    <v-btn v-bind="props" icon variant="text"
                                        :color="activeAudioCount > 0 ? 'success' : undefined" class="ml-2"
                                        @click="showWebRTCControls = true">
                                        <v-icon>mdi-headphones</v-icon>
                                    </v-btn>
                                </template>
                                <span>Audio Controls ({{ activeAudioCount }} active)</span>
                            </v-tooltip>

                            <!-- Performance Speed Dial -->
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
                                        <v-btn v-bind="props" icon variant="text" class="ml-2"
                                            @click="inspectorRef?.toggleInspector()">
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

                        <BabylonCanvas ref="canvasComponentRef" v-model:performanceMode="performanceMode"
                            :engine-type="isAutonomousAgent ? 'nullengine' : 'webgpu'">
                            <template #default="{ scene: providedScene }">

                                <BabylonMic :echo-cancellation="micEchoCancellation"
                                    :noise-suppression="micNoiseSuppression" :auto-gain-control="micAutoGainControl">
                                    <template #default="{ stream: micStream }">
                                        <VircadiaCloudInferenceProvider ref="cloudAgentRef"
                                            :vircadia-world="vircadiaWorld" :webrtc-ref="webrtcApi"
                                            :webrtc-local-stream="webrtcLocalStream"
                                            :webrtc-remote-streams="webrtcRemoteStreamsMap"
                                            :agent-mic-input-stream="micStream"
                                            :agent-echo-output-stream="agentEchoOutputStream"
                                            :agent-tts-output-mode="agentTtsOutputMode" :agent-wake-word="agentWakeWord"
                                            :agent-end-word="agentEndWord" :agent-language="agentLanguage"
                                            :agent-enable-tts="agentEnableTTS && agentActive"
                                            :agent-enable-llm="agentEnableLLM && agentActive"
                                            :agent-enable-stt="agentEnableSTT && agentActive"
                                            :agent-stt-pre-gain="agentSttPreGain"
                                            :agent-stt-input-mode="agentSttInputMode"
                                            :agent-stt-target-sample-rate="agentSttTargetSampleRate"
                                            :agent-stt-worklet-chunk-ms="agentSttWorkletChunkMs"
                                            :agent-vad-config="agentVadConfig"
                                            :agent-llm-max-new-tokens="agentLlmMaxNewTokens"
                                            :agent-llm-temperature="agentLlmTemperature"
                                            :agent-llm-open-think-tag="agentLlmOpenThinkTag"
                                            :agent-llm-close-think-tag="agentLlmCloseThinkTag"
                                            :agent-ui-max-transcripts="agentUiMaxTranscripts"
                                            :agent-ui-max-assistant-replies="agentUiMaxAssistantReplies"
                                            :agent-ui-max-conversation-items="agentUiMaxConversationItems"
                                            :agent-company-name="agentCompanyName">

                                            <template
                                                #default="{ capabilitiesEnabled: agentCapabilities, agentSttWorking, agentTtsWorking, agentLlmWorking, ttsLevel, ttsTalking, ttsThreshold }">
                                                <BabylonTalkLevel :audio-stream="micStream || null"
                                                    v-slot="{ isTalking: micTalking, level: micLevel, threshold: micThreshold }">

                                                    <v-snackbar :model-value="!(providedScene?.isReady())"
                                                        location="bottom">
                                                        <v-progress-circular indeterminate color="white" size="24"
                                                            class="mr-2" />
                                                        <span>Loading scene...</span>
                                                        <span>Scene: {{ providedScene ? 'yes' : 'no' }}</span>
                                                    </v-snackbar>
                                                    <template v-if="providedScene">
                                                        <!-- Component Loader -->
                                                        <template v-for="item in availableComponents" :key="item.name">
                                                            <component :is="item.component" :scene="providedScene"
                                                                :vircadia-world="vircadiaWorld" />
                                                        </template>

                                                        <!-- Babylon Inspector (Dev only) -->
                                                        <BabylonInspector ref="inspectorRef" :scene="providedScene"
                                                            @visible-change="onInspectorVisibleChange" />

                                                        <BabylonSnackbar :scene-ready="!!providedScene"
                                                            :connection-status="connectionStatus"
                                                            :is-connecting="isConnecting"
                                                            :avatar-loading="avatarLoading"
                                                            :other-avatars-loading="otherAvatarsLoading"
                                                            :models-loading="modelsLoading"
                                                            :is-authenticating="isAuthenticating"
                                                            :is-authenticated="isAuthenticated"
                                                            :avatar-model-step="avatarModelStep"
                                                            :avatar-model-error="avatarModelError"
                                                            :model-file-name="modelFileNameRef" />

                                                        <BabylonPhysics :scene="providedScene"
                                                            :vircadia-world="vircadiaWorld" :gravity="[0, -9.81, 0]"
                                                            ref="physicsRef">
                                                            <template
                                                                #default="{ physicsEnabled: envPhysicsEnabled, physicsPluginName: envPhysicsPluginName, physicsError: envPhysicsError, physicsEngineType: envPhysicsEngineType, physicsInitialized: envPhysicsInitialized, havokInstanceLoaded: envHavokInstanceLoaded, physicsPluginCreated: envPhysicsPluginCreated, gravity: sceneGravity }">
                                                                <!-- BabylonMyAvatar component wrapped with MKB controller -->
                                                                <BabylonMyAvatarMKBController :scene="providedScene"
                                                                    :forward-codes="['KeyW', 'ArrowUp']"
                                                                    :backward-codes="['KeyS', 'ArrowDown']"
                                                                    :strafe-left-codes="['KeyA', 'ArrowLeft']"
                                                                    :strafe-right-codes="['KeyD', 'ArrowRight']"
                                                                    :jump-codes="['Space']"
                                                                    :sprint-codes="['ShiftLeft', 'ShiftRight']"
                                                                    :dash-codes="[]" :turn-left-codes="['KeyQ']"
                                                                    :turn-right-codes="['KeyE']"
                                                                    :fly-mode-toggle-codes="['KeyF']"
                                                                    :crouch-toggle-codes="['KeyC']"
                                                                    :prone-toggle-codes="['KeyZ']"
                                                                    :slow-run-toggle-codes="[]"
                                                                    :mouse-lock-camera-rotate-toggle-codes="['Digit1']"
                                                                    :mouse-lock-camera-avatar-rotate-toggle-codes="['Digit2']"
                                                                    v-slot="controls">
                                                                    <BabylonMyAvatar :scene="providedScene"
                                                                        :vircadia-world="vircadiaWorld"
                                                                        :key-state="controls.keyState"
                                                                        :is-talking="isAutonomousAgent ? ttsTalking : micTalking"
                                                                        :talk-level="isAutonomousAgent ? ttsLevel : micLevel"
                                                                        :talk-threshold="isAutonomousAgent ? ttsThreshold : micThreshold"
                                                                        :audio-devices="audioDevices"
                                                                        :physics-enabled="envPhysicsEnabled"
                                                                        :physics-plugin-name="envPhysicsPluginName"
                                                                        :gravity="sceneGravity"
                                                                        :avatar-definition="avatarDefinition"
                                                                        ref="avatarRef">

                                                                        <!-- Entity sync slot -->
                                                                        <template
                                                                            #entity="{ avatarNode, targetSkeleton, modelFileName, avatarDefinition, onEntityDataLoaded }">
                                                                            <BabylonMyAvatarEntity
                                                                                :scene="providedScene"
                                                                                :vircadia-world="vircadiaWorld"
                                                                                :avatar-node="avatarNode as TransformNode | null"
                                                                                :target-skeleton="targetSkeleton || null"
                                                                                :camera="null"
                                                                                :model-file-name="modelFileName || ''"
                                                                                :avatar-definition="avatarDefinition"
                                                                                :persist-pose-snapshot-interval="5000"
                                                                                :position-throttle-interval="50"
                                                                                :rotation-throttle-interval="50"
                                                                                :camera-orientation-throttle-interval="100"
                                                                                :joint-throttle-interval="100"
                                                                                :joint-position-decimals="3"
                                                                                :joint-rotation-decimals="4"
                                                                                :joint-scale-decimals="5"
                                                                                :joint-position-update-decimals="2"
                                                                                :joint-rotation-update-decimals="3"
                                                                                :joint-scale-update-decimals="4"
                                                                                :reflect-sync-group="'public.REALTIME'"
                                                                                :entity-sync-group="'public.NORMAL'"
                                                                                :reflect-channel="'avatar_data'"
                                                                                :position-decimals="4"
                                                                                :rotation-decimals="4"
                                                                                :scale-decimals="4"
                                                                                :position-update-decimals="4"
                                                                                :rotation-update-decimals="4"
                                                                                :scale-update-decimals="3"
                                                                                @entity-data-loaded="onEntityDataLoaded"
                                                                                @sync-stats="onAvatarSyncStats" />
                                                                            <ChatBubble :scene="providedScene"
                                                                                :avatar-node="avatarNode as TransformNode | null"
                                                                                :messages="localChatMessages" />
                                                                        </template>

                                                                        <!-- Model slot -->
                                                                        <template
                                                                            #model="{ avatarNode, modelFileName, meshPivotPoint, capsuleHeight, onSetAvatarModel, animations, targetSkeleton, onAnimationState }">
                                                                            <BabylonMyAvatarModel v-if="modelFileName"
                                                                                :scene="providedScene"
                                                                                :vircadia-world="vircadiaWorld"
                                                                                :avatar-node="(avatarNode as TransformNode | null) || null"
                                                                                :model-file-name="modelFileName"
                                                                                :mesh-pivot-point="meshPivotPoint"
                                                                                :capsule-height="capsuleHeight"
                                                                                :on-set-avatar-model="onSetAvatarModel"
                                                                                :animations="animations"
                                                                                :on-animation-state="onAnimationState"
                                                                                @state="onAvatarModelState"
                                                                                v-slot="{ targetSkeleton }">
                                                                                <!-- Renderless desktop third-person camera -->
                                                                                <BabylonMyAvatarDesktopThirdPersonCamera
                                                                                    :scene="providedScene"
                                                                                    :avatar-node="(avatarNode as TransformNode | null)"
                                                                                    :capsule-height="capsuleHeight"
                                                                                    :min-z="0.1"
                                                                                    :lower-radius-limit="1.2"
                                                                                    :upper-radius-limit="25"
                                                                                    :lower-beta-limit="0.15"
                                                                                    :upper-beta-limit="Math.PI * 0.9"
                                                                                    :inertia="0.6"
                                                                                    :panning-sensibility="0"
                                                                                    :wheel-precision="40" :fov-delta="((controls.keyState.forward ||
                                                                                        controls.keyState.backward ||
                                                                                        controls.keyState.strafeLeft ||
                                                                                        controls.keyState.strafeRight)
                                                                                        ? (controls.keyState.sprint ? 0.08 : 0.04)
                                                                                        : 0)
                                                                                        " :fov-lerp-speed="8"
                                                                                    :mouse-lock-camera-rotate-toggle="controls.mouseLockCameraRotateToggle || controls.rightMouseDown"
                                                                                    :mouse-lock-camera-avatar-rotate-toggle="controls.mouseLockCameraAvatarRotateToggle || controls.rightMouseDown"
                                                                                    :override-mouse-lock-camera-avatar-rotate="controls.keyState.turnLeft || controls.keyState.turnRight" />
                                                                                <!-- Non-visual animation loaders now slotted under model component -->
                                                                                <BabylonMyAvatarAnimation
                                                                                    v-for="anim in animations"
                                                                                    v-if="targetSkeleton"
                                                                                    :key="anim.fileName"
                                                                                    :scene="providedScene"
                                                                                    :vircadia-world="vircadiaWorld"
                                                                                    :animation="anim"
                                                                                    :target-skeleton="targetSkeleton"
                                                                                    @state="onAnimationState" />

                                                                            </BabylonMyAvatarModel>
                                                                        </template>

                                                                        <!-- Agent slot -->
                                                                        <template
                                                                            #agent="{ scene, vircadiaWorld, avatarNode, physicsEnabled, physicsPluginName, gravity, followOffset, maxSpeed, isTalking, talkLevel, talkThreshold }">
                                                                            <VircadiaAgent :scene="scene"
                                                                                :vircadia-world="vircadiaWorld"
                                                                                :avatar-node="(avatarNode as TransformNode | null)"
                                                                                :physics-enabled="physicsEnabled"
                                                                                :physics-plugin-name="physicsPluginName"
                                                                                :gravity="gravity"
                                                                                :follow-offset="(followOffset as [number, number, number])"
                                                                                :max-speed="maxSpeed"
                                                                                :is-talking="ttsTalking"
                                                                                :talk-level="ttsLevel"
                                                                                :talk-threshold="ttsThreshold"
                                                                                :agent-stt-enabled="agentCapabilities.stt"
                                                                                :agent-tts-enabled="agentCapabilities.tts"
                                                                                :agent-llm-enabled="agentCapabilities.llm"
                                                                                :agent-stt-working="agentSttWorking"
                                                                                :agent-tts-working="agentTtsWorking"
                                                                                :agent-llm-working="agentLlmWorking"
                                                                                v-model:active="agentActive" />
                                                                        </template>

                                                                        <!-- Other avatars slot -->
                                                                        <template
                                                                            #other-avatars="{ scene, vircadiaWorld }">
                                                                            <BabylonOtherAvatars :scene="scene"
                                                                                :vircadia-world="vircadiaWorld"
                                                                                :discovery-polling-interval="500"
                                                                                :reflect-sync-group="'public.REALTIME'"
                                                                                :entity-sync-group="'public.NORMAL'"
                                                                                :reflect-channel="'avatar_data'"
                                                                                ref="otherAvatarsRef"
                                                                                v-slot="{ otherAvatarSessionIds, avatarDataMap, positionDataMap, rotationDataMap, jointDataMap }">
                                                                                <BabylonOtherAvatar
                                                                                    v-for="otherFullSessionId in otherAvatarSessionIds || []"
                                                                                    :key="otherFullSessionId"
                                                                                    :scene="scene"
                                                                                    :vircadia-world="vircadiaWorld"
                                                                                    :session-id="otherFullSessionId"
                                                                                    :avatar-data="avatarDataMap?.[otherFullSessionId]"
                                                                                    :position-data="positionDataMap?.[otherFullSessionId]"
                                                                                    :rotation-data="rotationDataMap?.[otherFullSessionId]"
                                                                                    :joint-data="jointDataMap?.[otherFullSessionId]"
                                                                                    :chat-data="otherAvatarsRef?.chatDataMap?.[otherFullSessionId] || []"
                                                                                    @ready="otherAvatarsRef?.markLoaded && otherAvatarsRef.markLoaded(otherFullSessionId)"
                                                                                    @dispose="otherAvatarsRef?.markDisposed && otherAvatarsRef.markDisposed(otherFullSessionId)" />

                                                                                <!-- WebRTC component (now under OtherAvatars slot) -->
                                                                                <BabylonWebRTC ref="webrtcRef"
                                                                                    v-model="showWebRTCControls"
                                                                                    :client="vircadiaWorld"
                                                                                    :avatar-data="new Map(Object.entries((avatarDataMap as Record<string, AvatarBaseData>) || {}))"
                                                                                    :avatar-positions="new Map(Object.entries((positionDataMap as Record<string, AvatarPositionData>) || {}))"
                                                                                    :my-position="audioListenerPosition"
                                                                                    :my-camera-orientation="audioListenerOrientation"
                                                                                    :webrtc-sync-group="'public.NORMAL'"
                                                                                    @permissions="onWebRTCPermissions($event)"
                                                                                    v-model:local-audio-stream="webrtcLocalStream"
                                                                                    v-model:peers-map="webrtcPeersMap"
                                                                                    v-model:remote-streams-map="webrtcRemoteStreamsMap"
                                                                                    :headless-uplink="isAutonomousAgent"
                                                                                    :injected-local-stream="micStream"
                                                                                    v-model:echo-cancellation="micEchoCancellation"
                                                                                    v-model:noise-suppression="micNoiseSuppression"
                                                                                    v-model:auto-gain-control="micAutoGainControl" />

                                                                            </BabylonOtherAvatars>
                                                                        </template>

                                                                    </BabylonMyAvatar>
                                                                </BabylonMyAvatarMKBController>

                                                                <!-- BabylonModel components provided by DB-scanned list -->
                                                                <!-- <BabylonModels :vircadia-world="vircadiaWorld" v-slot="{ models }">
                                            <BabylonModel v-for="def in models" :key="def.fileName" :def="def"
                                                :scene="sceneNonNull" :vircadia-world="vircadiaWorld" ref="modelRefs"
                                                v-slot="{ meshes, def: slotDef }">
                                                <BabylonModelPhysics :scene="sceneNonNull" :meshes="meshes"
                                                    :def="slotDef" ref="modelPhysicsRefs" />
                                            </BabylonModel>

                                            <BabylonModelsDebugOverlay v-model="modelsDebugOpen" :models="models"
                                                :model-runtime="modelRuntime" :physics-summaries="physicsSummaries" />
                                            <div style="display: none">
                                                {{setModelRuntimeFromRefs(models, (modelRefs).map((r: any) =>
                                                    r?.meshes))}}
                                                {{ refreshPhysicsSummaries(models) }}
                                            </div>
                                        </BabylonModels> -->
                                                            </template>
                                                        </BabylonPhysics>
                                                    </template>
                                                </BabylonTalkLevel>
                                            </template>
                                        </VircadiaCloudInferenceProvider>
                                        <VoiceChatInput ref="voiceChatInputRef" :vircadia-world="vircadiaWorld"
                                            :mic-stream="micStream" @message="onChatMessage($event, vircadiaWorld)" />
                                    </template>
                                </BabylonMic>
                            </template>
                        </BabylonCanvas>
                    </main>
                </template>
                <template v-else>
                    <VircadiaWorldAuthLogin :is-authenticating="isAuthenticating" :auth-error="authError"
                        :show-debug-login="showDebugLogin" @azure="loginWithAzure()" @anonymous="loginAnonymously()"
                        @debug="loginWithDebugToken()" />
                </template>
            </template>
        </VircadiaWorldAuthProvider>
    </VircadiaWorldProvider>
</template>

<script setup lang="ts">
// BabylonJS types
import type { TransformNode } from "@babylonjs/core";
import VoiceChatInput from "@/components/VoiceChatInput.vue";
import ChatBubble from "@/components/ChatBubble.vue";

import {
    clientBrowserConfiguration,
    clientBrowserState,
} from "@vircadia/world-sdk/browser/vue";
import { useStorage } from "@vueuse/core";
import type { ComponentPublicInstance } from "vue";
import {
    computed,
    defineComponent,
    getCurrentInstance,
    onMounted,
    provide,
    ref,
    watch,
    type Component,
    type DefineComponent,
} from "vue";
import { useRoute } from "vue-router";
import { useRouteComponents, type NamedComponent } from "@/composables/useUserComponents";
import BabylonCanvas from "@/components/BabylonCanvas.vue";
import BabylonInspector from "@/components/BabylonInspector.vue";
import BabylonMic from "@/components/BabylonMic.vue";
import BabylonModel from "@/components/BabylonModel.vue";
import BabylonModelPhysics, {
    type PhysicsSummary,
} from "@/components/BabylonModelPhysics.vue";
// import BabylonModels from "@/components/BabylonModels.vue";
// import BabylonModelsDebugOverlay from "@/components/BabylonModelsDebugOverlay.vue";
import BabylonMyAvatar, {
    type AvatarDefinition,
} from "@/components/BabylonMyAvatar.vue";
import BabylonMyAvatarAnimation from "@/components/BabylonMyAvatarAnimation.vue";
import BabylonMyAvatarDesktopThirdPersonCamera from "@/components/BabylonMyAvatarDesktopThirdPersonCamera.vue";
import BabylonMyAvatarEntity, {
    type AvatarSyncMetrics,
} from "@/components/BabylonMyAvatarEntity.vue";
import BabylonMyAvatarMKBController from "@/components/BabylonMyAvatarMKBController.vue";
import BabylonMyAvatarModel from "@/components/BabylonMyAvatarModel.vue";
import BabylonOtherAvatar from "@/components/BabylonOtherAvatar.vue";
import BabylonOtherAvatars from "@/components/BabylonOtherAvatars.vue";
import BabylonPhysics from "@/components/BabylonPhysics.vue";
import BabylonSnackbar from "@/components/BabylonSnackbar.vue";
import BabylonTalkLevel from "@/components/BabylonTalkLevel.vue";
import BabylonWebRTC from "@/components/BabylonWebRTC.vue";
import LeftDrawer from "@/components/LeftDrawer.vue";
import RightDrawer from "@/components/RightDrawer.vue";
import VircadiaAgent from "@/components/VircadiaAgent.vue";
import VircadiaCloudInferenceProvider from "@/components/VircadiaCloudInferenceProvider.vue";
import VircadiaWorldAuthLogin from "@/components/VircadiaWorldAuthLogin.vue";
import VircadiaWorldAuthProvider from "@/components/VircadiaWorldAuthProvider.vue";
import VircadiaWorldProvider from "@/components/VircadiaWorldProvider.vue";
import type {
    AvatarBaseData,
    AvatarJointMetadata,
    AvatarPositionData,
    AvatarRotationData,
    ChatMessage,
} from "@/schemas";

// isAutonomousAgent now comes from browser state via URL parameter detection
const isAutonomousAgent = computed(() =>
    clientBrowserState.isAutonomousAgent(),
);

// Auth change handling moved to provider

// Connection count is now managed by BabylonWebRTC component
// WebRTC controls dialog visibility
const showWebRTCControls = ref(false);
// removed collapsible debug app bar state

// Session/agent and world instance are provided reactively via slot props; no local refs needed

// Scene readiness derived from BabylonCanvas exposed API
// Track if avatar is ready
const avatarRef = ref<InstanceType<typeof BabylonMyAvatar> | null>(null);

const otherAvatarsRef = ref<InstanceType<typeof BabylonOtherAvatars> | null>(
    null,
);

// Combined otherAvatarsMetadata removed; use separate maps from BabylonOtherAvatars
const modelRefs = ref<(InstanceType<typeof BabylonModel> | null)[]>([]);
const modelPhysicsRefs = ref<
    (InstanceType<typeof BabylonModelPhysics> | null)[]
>([]);

// Other avatar discovery handled by BabylonOtherAvatars wrapper

// Physics handled by BabylonCanvas

// State for debug overlays with persistence across reloads
const cameraDebugOpen = useStorage<boolean>("vrca.debug.camera", false);
// Models debug overlay
const modelsDebugOpen = useStorage<boolean>("vrca.debug.models", false);

const canvasComponentRef = ref<InstanceType<typeof BabylonCanvas> | null>(null);
const inspectorRef = ref<InstanceType<typeof BabylonInspector> | null>(null);
const inspectorVisible = ref<boolean>(false);
const isDev = import.meta.env.DEV;

// Teleport target for agent controls
const teleportTarget = ref<HTMLElement | null>(null);

// Provide the teleport target for child components
provide("mainAppBarTeleportTarget", teleportTarget);

function onInspectorVisibleChange(v: boolean) {
    inspectorVisible.value = v;
}

const performanceMode = useStorage<"normal" | "low">("vrca.perf.mode", "low");

// WebRTC component ref for direct Agent API access (replaces bus)
const agentActive = useStorage<boolean>("vrca.agent.active", false);

type WebRTCRefApi = {
    getLocalStream: () => MediaStream | null;
    getPeersMap: () => Map<string, RTCPeerConnection>;
    getRemoteStreamsMap: () => Map<string, MediaStream>;
    getUplinkAudioContext: () => AudioContext | null;
    getUplinkDestination: () => MediaStreamAudioDestinationNode | null;
    ensureUplinkDestination: () => Promise<MediaStreamTrack | null>;
    replaceUplinkWithDestination: () => Promise<boolean>;
    restoreUplinkMic: () => Promise<boolean>;
    connectMicToUplink: (enabled: boolean) => void;
    connectNodeToUplink: (node: AudioNode) => void;
};

const webrtcRef = ref<(ComponentPublicInstance & Partial<WebRTCRefApi>) | null>(
    null,
);
const cloudAgentRef = ref<ComponentPublicInstance | null>(null);
const voiceChatInputRef = ref<InstanceType<typeof VoiceChatInput> | null>(null);

// Spatial Audio State
const audioListenerPosition = ref<AvatarPositionData | null>(null);
const audioListenerOrientation = ref<{
    alpha: number;
    beta: number;
    radius: number;
} | null>(null);

function updateSpatialAudioPosition() {
    // Update camera orientation
    if (canvasComponentRef.value?.scene?.activeCamera) {
        const cam = canvasComponentRef.value.scene.activeCamera as any; // Cast to access alpha/beta if arc rotate
        if (cam.alpha !== undefined && cam.beta !== undefined) {
            audioListenerOrientation.value = {
                alpha: cam.alpha,
                beta: cam.beta,
                radius: cam.radius || 10,
            };
        }
    }

    // Update avatar position
    if (avatarRef.value?.avatarNode?.position) {
        const pos = avatarRef.value.avatarNode.position;
        audioListenerPosition.value = {
            x: pos.x,
            y: pos.y,
            z: pos.z
        };
    }
}

const webrtcApi = computed<WebRTCRefApi | null>(() =>
    webrtcRef.value
        ? {
            getLocalStream: () => webrtcRef.value?.getLocalStream?.() ?? null,
            getPeersMap: () =>
                webrtcRef.value?.getPeersMap?.() ??
                new Map<string, RTCPeerConnection>(),
            getRemoteStreamsMap: () =>
                webrtcRef.value?.getRemoteStreamsMap?.() ??
                new Map<string, MediaStream>(),
            getUplinkAudioContext: () =>
                webrtcRef.value?.getUplinkAudioContext?.() ?? null,
            getUplinkDestination: () =>
                webrtcRef.value?.getUplinkDestination?.() ?? null,
            ensureUplinkDestination: async () =>
                await (webrtcRef.value?.ensureUplinkDestination?.() ?? null),
            replaceUplinkWithDestination: async () =>
                await (webrtcRef.value?.replaceUplinkWithDestination?.() ??
                    false),
            restoreUplinkMic: async () =>
                await (webrtcRef.value?.restoreUplinkMic?.() ?? false),
            connectMicToUplink: (enabled: boolean) =>
                webrtcRef.value?.connectMicToUplink?.(enabled),
            connectNodeToUplink: (node: AudioNode) =>
                webrtcRef.value?.connectNodeToUplink?.(node),
        }
        : null,
);
// Agent mic input and echo output streams
const agentEchoAudioContext = ref<AudioContext | null>(null);
const agentEchoOutputStream = ref<MediaStreamAudioDestinationNode | null>(null);

// Initialize echo output stream synchronously
try {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    agentEchoAudioContext.value = ctx;
    agentEchoOutputStream.value = dest;
} catch (e) {
    console.warn(
        "[MainScene] Failed to init agent echo output synchronously:",
        e,
    );
}

// Reactive mirrors of WebRTC internals
const webrtcLocalStream = ref<MediaStream | null>(null);
const webrtcPeersMap = ref(new Map<string, RTCPeerConnection>());
const webrtcRemoteStreamsMap = ref(new Map<string, MediaStream>());

// Agent wake/end words are provided via template props pattern
// Prefer passing from here rather than setting defaults inside the agent
const agentWakeWord = ref<string>("");
const agentEndWord = ref<string>("");
const agentTtsOutputMode = ref<"local" | "webrtc" | "both">("local");
const agentEnableLLM = ref<boolean>(true);
const agentEnableSTT = ref<boolean>(true);
const agentEnableTTS = ref<boolean>(true);
// Default conversational language for ASR/LLM
const agentLanguage = ref<string>("en");
// STT pre-gain (to compensate remote levels prior to worklet)
const agentSttPreGain = ref<number>(0.5);
// STT input selection: 'webrtc' (default), 'mic', or 'both'
const agentSttInputMode = ref<"webrtc" | "mic" | "both">("mic");

// Worker/device/dtype and model runtime tuning passed via template props
const agentSttTargetSampleRate = ref<number>(16000);
const agentSttWorkletChunkMs = ref<number>(120);
const agentVadConfig = ref({
    sampleRate: 16000,
    minSpeechMs: 250,
    minSilenceMs: 400,
    prePadMs: 80,
    postPadMs: 80,
    speechThreshold: 0.06, // Lower threshold for better sensitivity
    exitThreshold: 0.03, // Lower exit threshold
    maxPrevMs: 800,
});

// LLM generation defaults
const agentLlmMaxNewTokens = ref<number>(500);
const agentLlmTemperature = ref<number>(0.7);
const agentLlmOpenThinkTag = ref<string>("<think>");
const agentLlmCloseThinkTag = ref<string>("</think>");

// Agent company name - scene components can override via cloud inference API
const agentCompanyName = ref<string>("Vircadia");

// UI history limits; 0 = unlimited (no truncation in UI)
const agentUiMaxTranscripts = ref<number>(0);
const agentUiMaxAssistantReplies = ref<number>(0);
const agentUiMaxConversationItems = ref<number>(0);

// Force LLM on WASM as well for autonomous agent headless stability
// (LLM device is controlled inside the worker; set via options below)

// Removed: TTS output MediaStream analysis moved into provider

// Audio device list passed to BabylonMyAvatar (placeholder; wire to WebRTC if needed)
const audioDevices = ref<{ deviceId: string; label: string }[]>([]);

// Chat state
const localChatMessages = ref<ChatMessage[]>([]);
const sttTranscripts = ref<string[]>([]);

// Audio Processing Constraints (defaulted to false to prevent cutting out)
const micEchoCancellation = useStorage<boolean>("vrca.audio.echoCancellation", true);
const micNoiseSuppression = useStorage<boolean>("vrca.audio.noiseSuppression", false);
const micAutoGainControl = useStorage<boolean>("vrca.audio.autoGainControl", false);

// We need to change handleChatMessage signature to accept vircadiaWorld
async function onChatMessage(text: string, vircadiaWorld: any) {
    if (!text.trim() || !vircadiaWorld) return;

    const message: ChatMessage = {
        id: crypto.randomUUID(),
        text: text.trim(),
        timestamp: Date.now(),
    };

    localChatMessages.value = [...localChatMessages.value, message].slice(-20);
    sttTranscripts.value = [text.trim(), ...sttTranscripts.value].slice(0, 50);

    const fullSessionId = vircadiaWorld.connectionInfo.value.fullSessionId;
    if (!fullSessionId) return;
    const entityName = `avatar:${fullSessionId}`;

    try {
        // 0. Send to Cloud Agent (if active)
        if (cloudAgentRef.value) {
            // Use 'any' cast or define interface if strict typing is needed
            (cloudAgentRef.value as any).handleLocalUserMessage?.(text.trim());
        }

        // 1. Update DB
        await vircadiaWorld.client.connection.query({
            query: "INSERT INTO entity.entity_metadata (general__entity_name, metadata__key, metadata__jsonb) VALUES ($1, $2, $3) ON CONFLICT (general__entity_name, metadata__key) DO UPDATE SET metadata__jsonb = EXCLUDED.metadata__jsonb",
            parameters: [entityName, "chat_messages", { messages: localChatMessages.value }],
        });

        // 2. Publish Reflect
        await vircadiaWorld.client.connection.publishReflect({
            syncGroup: "public.REALTIME",
            channel: "avatar_data",
            payload: {
                type: "avatar_frame",
                entityName: entityName,
                ts: Date.now(),
                chat_messages: localChatMessages.value,
            },
        });
    } catch (e) {
        console.warn("[MainScene] Failed to send chat message:", e);
    }
}

onMounted(async () => {
    console.debug("[MainScene] Initialized");
    console.debug(
        "[MainScene] Debug",
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG,
    );

    // Initialize autonomous agent flag from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const isAgentParam = urlParams.get("is_autonomous_agent") === "true";
    clientBrowserState.setIsAutonomousAgent(isAgentParam);
    if (isAgentParam) {
        console.debug("[MainScene] Running as autonomous agent");
    }

    // Resume agent echo output audio context if needed
    try {
        const ctx = agentEchoAudioContext.value;
        if (ctx && ctx.state === "suspended") {
            await ctx.resume();
        }
    } catch (e) {
        console.warn("[MainScene] Failed to resume agent echo output:", e);
    }

    // Add keyboard listener for performance mode toggle
    const handleKeyPress = (event: KeyboardEvent) => {
        if (event.key === "p" || event.key === "P") {
            togglePerformanceMode();
        }
    };

    document.addEventListener("keydown", handleKeyPress);
});

const sceneReady = computed(
    () => canvasComponentRef.value?.scene?.isReady() ?? false,
);

watch(sceneReady, (isReady) => {
    if (isReady) {
        clientBrowserState.setSceneReady(true);

        // Hook into render loop for spatial audio updates
        canvasComponentRef.value?.scene?.onAfterRenderObservable.add(() => {
            updateSpatialAudioPosition();
        });
    }
});

// No onUnmounted reset needed; canvas manages its own ready state

// Performance mode toggle function
function togglePerformanceMode() {
    performanceMode.value =
        performanceMode.value === "normal" ? "low" : "normal";
}

// Speed-dial UI state
const perfDialOpen = ref(false);
const moveDialOpen = ref(false);

// (inlined in template) performance/flying helpers removed

// Local debug drawer state
const rightDrawerOpen = useStorage<boolean>("vrca.right.drawer.open", false);
const rightDrawerTab = useStorage<string>(
    "vrca.right.drawer.tab",
    "environment",
);
const leftDrawerOpen = useStorage<boolean>("vrca.nav.left.open", false);

const activeAudioCount = computed(() => 0);

const physicsRef = ref<InstanceType<typeof BabylonPhysics> | null>(null);

// Avatar definition is now provided locally instead of DB
const avatarDefinition: AvatarDefinition = {
    initialAvatarPosition: { x: 25, y: 1.5, z: -5 },
    initialAvatarRotation: { x: 0, y: 0, z: 0, w: 1 },
    modelFileName: "babylon.avatar.glb",
    meshPivotPoint: "bottom",
    throttleInterval: 500,
    capsuleHeight: 1.8,
    capsuleRadius: 0.3,
    slopeLimit: 45,
    jumpSpeed: 5,
    debugBoundingBox: false,
    debugSkeleton: false,
    debugAxes: false,
    walkSpeed: 1.7,
    turnSpeed: Math.PI,
    blendDuration: 0.15,
    disableRootMotion: true,
    startFlying: true,
    runSpeedMultiplier: 2.2,
    backWalkMultiplier: 0.6,
    // Physics character controller properties (using Babylon.js documented defaults)
    maxCastIterations: 10, // default: 10 - maximum number of raycast per integration step
    keepContactTolerance: 0.1, // default: 0.1 - maximum distance to keep contact
    keepDistance: 0.05, // default: 0.05 - minimum distance to make contact
    acceleration: 1.0, // default: 1.0 - acceleration factor (1 = reaching max velocity immediately)
    characterMass: 0, // default: 0 - character mass
    characterStrength: 1e38, // default: 1e38 - strength when pushing other bodies
    dynamicFriction: 1.0, // default: 1.0 - friction with dynamic surfaces
    maxAcceleration: 10.0, // maximum acceleration in world space coordinate
    maxCharacterSpeedForSolver: 10, // default: 10 - character maximum speed
    penetrationRecoverySpeed: 1.0, // default: 1.0 - speed when recovery from penetration
    staticFriction: 0, // default: 0 - friction with static surfaces
    up: { x: 0, y: 1, z: 0 }, // up vector
    animations: [
        {
            fileName: "babylon.avatar.animation.f.idle.1.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.idle.2.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.idle.3.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.idle.4.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.idle.5.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.idle.6.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.idle.7.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.idle.8.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.idle.9.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.idle.10.glb",
            slMotion: "stand",
        },
        {
            fileName: "babylon.avatar.animation.f.walk.1.glb",
            slMotion: "walk",
            direction: "forward",
        },
        {
            fileName: "babylon.avatar.animation.f.walk.2.glb",
            slMotion: "walk",
            direction: "forward",
        },
        {
            fileName: "babylon.avatar.animation.f.crouch_strafe_left.glb",
            slMotion: "crouchwalk",
            direction: "left",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.crouch_strafe_right.glb",
            slMotion: "crouchwalk",
            direction: "right",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.crouch_walk_back.glb",
            slMotion: "crouchwalk",
            direction: "back",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.crouch_walk.glb",
            slMotion: "crouchwalk",
            direction: "forward",
        },
        {
            fileName: "babylon.avatar.animation.f.falling_idle.1.glb",
            slMotion: "falling",
        },
        {
            fileName: "babylon.avatar.animation.f.falling_idle.2.glb",
            slMotion: "falling",
        },
        {
            fileName: "babylon.avatar.animation.f.jog_back.glb",
            slMotion: "run",
            direction: "back",
            variant: "jog",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.jog.glb",
            slMotion: "run",
            direction: "forward",
            variant: "jog",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.jump_small.glb",
            slMotion: "jump",
        },
        { fileName: "babylon.avatar.animation.f.jump.glb", slMotion: "jump" },
        {
            fileName: "babylon.avatar.animation.f.run_back.glb",
            slMotion: "run",
            direction: "back",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.run_strafe_left.glb",
            slMotion: "run",
            direction: "left",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.run_strafe_right.glb",
            slMotion: "run",
            direction: "right",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.run.glb",
            slMotion: "run",
            direction: "forward",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.strafe_left.glb",
            slMotion: "walk",
            direction: "left",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.strafe_right.glb",
            slMotion: "walk",
            direction: "right",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.talking.1.glb",
            slMotion: "talk",
        },
        {
            fileName: "babylon.avatar.animation.f.talking.2.glb",
            slMotion: "talk",
        },
        {
            fileName: "babylon.avatar.animation.f.talking.3.glb",
            slMotion: "talk",
        },
        {
            fileName: "babylon.avatar.animation.f.talking.4.glb",
            slMotion: "talk",
        },
        {
            fileName: "babylon.avatar.animation.f.talking.5.glb",
            slMotion: "talk",
        },
        {
            fileName: "babylon.avatar.animation.f.talking.6.glb",
            slMotion: "talk",
        },
        {
            fileName: "babylon.avatar.animation.f.walk_back.glb",
            slMotion: "walk",
            direction: "back",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.walk_jump.1.glb",
            slMotion: "jump",
        },
        {
            fileName: "babylon.avatar.animation.f.walk_jump.2.glb",
            slMotion: "jump",
        },
        {
            fileName: "babylon.avatar.animation.f.walk_strafe_left.glb",
            slMotion: "walk",
            direction: "left",
            ignoreHipTranslation: true,
        },
        {
            fileName: "babylon.avatar.animation.f.walk_strafe_right.glb",
            slMotion: "walk",
            direction: "right",
            ignoreHipTranslation: true,
        },
    ],
};

// Physics error now comes from BabylonEnvironment slot props (envPhysicsError)

// Child component loading states
const avatarLoading = computed(
    () =>
        // Fallback to model loading only now that entity sync is internal
        avatarModelLoading.value,
);
// Other avatars loading state is handled internally by BabylonOtherAvatars component
const otherAvatarsLoading = computed(() => false); // Placeholder - loading state managed by component
const modelsLoading = computed(() =>
    modelRefs.value.some((m) => {
        const mm = m as unknown as {
            isEntityCreating?: boolean;
            isEntityRetrieving?: boolean;
            isAssetLoading?: boolean;
        } | null;
        return Boolean(
            mm?.isEntityCreating ||
            mm?.isEntityRetrieving ||
            mm?.isAssetLoading,
        );
    }),
);

// Runtime info for models to augment overlay (e.g., mesh counts)
type ModelRuntimeInfo = { meshCount: number };
const modelRuntime = ref<Record<string, ModelRuntimeInfo>>({});
function setModelRuntimeFromRefs(
    models: { entityName: string; fileName: string }[],
    meshesByIndex: unknown[],
) {
    for (let i = 0; i < models.length; i++) {
        const id = models[i].entityName || models[i].fileName;
        if (!id) continue;
        const meshArray = Array.isArray(meshesByIndex[i])
            ? (meshesByIndex[i] as unknown[])
            : [];
        if (!modelRuntime.value[id]) modelRuntime.value[id] = { meshCount: 0 };
        modelRuntime.value[id].meshCount = meshArray.length;
    }
}
function getPhysicsShape(type: unknown): string {
    switch (type) {
        case "convexHull":
            return "Convex Hull";
        case "box":
            return "Box";
        case "mesh":
            return "Mesh";
        default:
            return type ? String(type) : "Mesh";
    }
}

// Physics summaries reported by BabylonModelPhysics instances
const physicsSummaries = ref<Record<string, PhysicsSummary>>({});
function refreshPhysicsSummaries(
    models: { entityName: string; fileName: string }[],
) {
    for (let i = 0; i < models.length; i++) {
        const id = models[i].entityName || models[i].fileName;
        const comp = modelPhysicsRefs.value[i] as unknown as {
            lastEmittedSummary?: { value?: PhysicsSummary };
        } | null;
        const summary = comp?.lastEmittedSummary?.value;
        if (id && summary) physicsSummaries.value[id] = summary;
    }
}

// Avatar model loader debug state
const avatarModelStep = ref<string>("");
const avatarModelError = ref<string | null>(null);
const avatarModelLoading = ref<boolean>(false);
const modelFileNameRef = ref<string | null>(null);
// Avatar sync metrics
const avatarSyncMetrics = ref<AvatarSyncMetrics | null>(null);
function onAvatarSyncStats(m: AvatarSyncMetrics) {
    avatarSyncMetrics.value = m;
}
function onAvatarModelState(payload: {
    state: "loading" | "ready" | "error";
    step: string;
    message?: string;
    details?: Record<string, unknown>;
}): void {
    avatarModelStep.value = payload.step;
    avatarModelLoading.value = payload.state === "loading";
    avatarModelError.value =
        payload.state === "error" ? payload.message || null : null;
    const fileName = payload.details?.fileName;
    if (typeof fileName === "string") modelFileNameRef.value = fileName;
}

// Mic/audio permission indicator state (from BabylonWebRTC)
const microphonePermission = ref<"granted" | "denied" | "prompt" | "unknown">(
    "unknown",
);
const audioContextState = ref<"resumed" | "suspended" | "unknown">("unknown");
const localStreamActive = ref<boolean>(false);

function onWebRTCPermissions(payload: {
    microphone: "granted" | "denied" | "prompt" | "unknown";
    audioContext: "resumed" | "suspended" | "unknown";
    localStreamActive: boolean;
}) {
    microphonePermission.value = payload.microphone;
    audioContextState.value = payload.audioContext;
    localStreamActive.value = payload.localStreamActive;
}

// No local forwarding needed; using slot's onAnimationState

// Component Loader
// const app = getCurrentInstance(); // No longer needed for globbal components
const availableComponents = ref<NamedComponent[]>([]);
const route = useRoute();
const { getComponentsForRoute } = useRouteComponents();

// Load components based on current route
const updateComponents = () => {
    availableComponents.value = getComponentsForRoute(route.path);
};

// Initial load
onMounted(() => {
    updateComponents();
});

// Watch for route changes
watch(
    () => route.path,
    () => {
        updateComponents();
    },
);

// Handle auth denial from provider by showing user feedback
type AuthDeniedPayload = {
    reason: "expired" | "invalid" | "unauthorized" | "authentication_failed";
    message: string;
};
function onAuthDenied(payload: AuthDeniedPayload) {
    console.warn("[MainScene] Auth denied, showing user feedback", payload);
    // Show a toast/snackbar using your global notification system
    // The VircadiaWorldProvider already handles clearing auth state and disconnecting
    // This function now only handles UI feedback for the user

    // For now, just log the message - you can integrate with your notification system here
    console.log(`Authentication failed: ${payload.message}`);

    // TODO: Replace with actual notification system call
    // Example: notificationService.error(`Authentication failed: ${payload.message}`);
}

// Removed local other avatar handlers; events are forwarded to BabylonOtherAvatars via ref

// Door event handlers
function onDoorState(payload: {
    state: "loading" | "ready" | "error";
    step: string;
    message?: string;
    details?: Record<string, unknown>;
}) {
    console.debug("[MainScene] Door state changed", payload);
    if (payload.state === "error") {
        console.error(
            "[MainScene] Door error",
            payload.message,
            payload.details,
        );
    }
}

function onDoorOpen(payload: { open: boolean }) {
    console.debug("[MainScene] Door opened/closed", payload);
}

// Debug bar helper functions
function getConnectionStatusColor(status: string): string {
    switch (status) {
        case "connected":
            return "success";
        case "connecting":
            return "warning";
        case "disconnected":
            return "error";
        case "error":
            return "error";
        default:
            return "grey";
    }
}

function getConnectionStatusIcon(status: string): string {
    switch (status) {
        case "connected":
            return "mdi-wifi-check";
        case "connecting":
            return "mdi-wifi-sync";
        case "disconnected":
            return "mdi-wifi-off";
        case "error":
            return "mdi-wifi-alert";
        default:
            return "mdi-wifi-strength-off";
    }
}

function getAuthStatusColor(
    isAuthenticated: boolean,
    isAuthenticating: boolean,
): string {
    if (isAuthenticating) return "warning";
    if (isAuthenticated) return "success";
    return "error";
}

function getAuthStatusIcon(
    isAuthenticated: boolean,
    isAuthenticating: boolean,
): string {
    if (isAuthenticating) return "mdi-account-clock";
    if (isAuthenticated) return "mdi-account-check";
    return "mdi-account-off";
}

function getAuthStatusText(
    isAuthenticated: boolean,
    isAuthenticating: boolean,
): string {
    if (isAuthenticating) return "Authenticating";
    if (isAuthenticated) return "Authenticated";
    return "Not Authenticated";
}

function getConnectedUrl(): string {
    const baseUri =
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI;
    const useSSL =
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI_USING_SSL;
    return `${useSSL ? "wss" : "ws"}://${baseUri}`;
}
</script>

<style>
html,
body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background-color: #202020;
}

/* AvatarSDKExample loads the sample GLB; removed from MainScene */

main {
    padding: 0;
    margin: 0;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    display: flex;
    position: relative;
}

#renderCanvas {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
    outline: none;
}

.component-loader {
    position: fixed;
    bottom: 16px;
    left: 16px;
    width: 300px;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.2);
    padding: 10px;
    border-radius: 8px;
}

.component-container {
    margin-top: 10px;
    padding: 10px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
}

/* Responsive design for smaller screens */
</style>
