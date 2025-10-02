<template>
    <v-navigation-drawer v-model="openModel" location="right" :width="width" :temporary="$vuetify.display.smAndDown"
        elevation="8">
        <v-tabs v-model="tabModel" density="compact" grow>
            <v-tab value="environment" prepend-icon="mdi-earth">Environment</v-tab>
            <v-tab value="physics" prepend-icon="mdi-atom-variant">Physics</v-tab>
            <v-tab value="avatar" prepend-icon="mdi-account">Avatar</v-tab>
            <v-tab value="otherAvatars" prepend-icon="mdi-account-group">Other Avatars</v-tab>
        </v-tabs>
        <v-divider />
        <v-window v-model="tabModel">
            <v-window-item value="environment">
                <v-list density="compact" class="px-2">
                    <v-list-item>
                        <v-list-item-title>Loading</v-list-item-title>
                        <template #append>
                            <v-chip :color="environmentIsLoading ? 'warning' : 'success'" size="small" variant="flat">
                                {{ environmentIsLoading ? 'Loading' : 'Ready' }}
                            </v-chip>
                        </template>
                    </v-list-item>
                </v-list>
            </v-window-item>
            <v-window-item value="physics">
                <v-list density="compact" class="px-2">
                    <v-list-subheader>Runtime</v-list-subheader>
                    <v-list-item>
                        <v-list-item-title>Enabled</v-list-item-title>
                        <template #append>
                            <v-chip :color="physicsEnabled ? 'success' : 'error'" size="small" variant="flat">
                                {{ String(physicsEnabled) }}
                            </v-chip>
                        </template>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Plugin</v-list-item-title>
                        <v-list-item-subtitle>{{ physicsPluginName || '-' }}</v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Engine Type</v-list-item-title>
                        <v-list-item-subtitle>{{ physicsEngineType || '-' }}</v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Initialized</v-list-item-title>
                        <template #append>
                            <v-chip :color="physicsInitialized ? 'success' : 'warning'" size="small" variant="flat">
                                {{ String(physicsInitialized) }}
                            </v-chip>
                        </template>
                    </v-list-item>

                    <v-list-subheader>Havok Module</v-list-subheader>
                    <v-list-item>
                        <v-list-item-title>Module Loaded</v-list-item-title>
                        <template #append>
                            <v-chip :color="havokInstanceLoaded ? 'success' : 'error'" size="small" variant="flat">
                                {{ String(havokInstanceLoaded) }}
                            </v-chip>
                        </template>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Plugin Created</v-list-item-title>
                        <template #append>
                            <v-chip :color="physicsPluginCreated ? 'success' : 'error'" size="small" variant="flat">
                                {{ String(physicsPluginCreated) }}
                            </v-chip>
                        </template>
                    </v-list-item>

                    <v-list-subheader>World</v-list-subheader>
                    <v-list-item>
                        <v-list-item-title>Gravity</v-list-item-title>
                        <v-list-item-subtitle>
                            [{{ gravity && gravity[0] }}, {{ gravity && gravity[1] }}, {{ gravity && gravity[2] }}]
                        </v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item v-if="physicsError">
                        <v-alert type="error" density="compact" variant="tonal" title="Physics Error"
                            :text="physicsError || ''" />
                    </v-list-item>
                </v-list>
            </v-window-item>
            <v-window-item value="avatar">
                <div class="px-2 py-2">
                    <v-tabs v-model="avatarTab" density="compact">
                        <v-tab value="overview">Overview</v-tab>
                        <v-tab value="physics">Physics</v-tab>
                        <v-tab value="cameraAudio">Camera & Audio</v-tab>
                        <v-tab value="reflect">Reflect Sync</v-tab>
                        <v-tab value="meshes">Meshes & Skeleton</v-tab>
                        <v-tab value="blend">Blendshapes</v-tab>
                        <v-tab value="anim">Animations</v-tab>
                    </v-tabs>
                    <v-window v-model="avatarTab" class="mt-3">
                        <v-window-item value="overview">
                            <v-row dense>
                                <v-col cols="12" md="6">
                                    <v-list density="compact" class="bg-transparent">
                                        <v-list-subheader>General</v-list-subheader>
                                        <v-list-item title="Scene initialized" :subtitle="String(!!scene)" />
                                        <v-list-item title="Active camera" :subtitle="cameraLabel" />
                                        <v-list-item title="Avatar node" :subtitle="avatarNode ? 'yes' : 'no'" />
                                        <v-list-item title="Model file" :subtitle="modelFileName || '-'" />
                                        <v-list-item title="Model load step" :subtitle="modelStep || '-'" />
                                        <v-list-item title="Model state" :subtitle="modelStateLabel"
                                            :class="{ 'text-error': modelError, 'text-success': modelReady }" />
                                        <v-list-item v-if="modelError" title="Model error" :subtitle="modelError"
                                            class="text-error" />
                                        <v-list-item title="Talking" :subtitle="String(isTalking)" />
                                        <v-list-item title="Talk level" :subtitle="talkLevelLabel" />
                                        <v-list-subheader>Transform</v-list-subheader>
                                        <v-list-item title="Position" :subtitle="myAvatarPositionLabel" />
                                        <v-list-item title="Rotation (quat)" :subtitle="myAvatarRotationLabel" />
                                        <v-list-item title="Scale" :subtitle="myAvatarScaleLabel" />
                                    </v-list>
                                </v-col>
                                <v-col cols="12" md="6">
                                    <v-list density="compact" class="bg-transparent">
                                        <v-list-subheader>Status</v-list-subheader>
                                        <v-list-item title="# meshes under avatar"
                                            :subtitle="String(meshesUnderAvatar.length)" />
                                        <v-list-item title="# skinned (match skeleton)"
                                            :subtitle="String(skinnedMeshesUnderAvatar.length)" />
                                    </v-list>
                                </v-col>
                            </v-row>
                        </v-window-item>

                        <v-window-item value="physics">
                            <v-row dense>
                                <v-col cols="12" md="6">
                                    <v-list density="compact" class="bg-transparent">
                                        <v-list-subheader>Physics/State</v-list-subheader>
                                        <v-list-item title="Physics enabled" :subtitle="String(physicsEnabled)" />
                                        <v-list-item title="Airborne" :subtitle="String(airborne)" />
                                        <v-list-item title="Vertical velocity" :subtitle="verticalVelocityLabel" />
                                        <v-list-item title="Support state" :subtitle="supportStateLabel" />
                                        <v-list-item title="Spawn settling" :subtitle="String(spawnSettling)" />
                                        <v-list-item title="Has touched ground" :subtitle="String(hasTouchedGround)" />
                                    </v-list>
                                </v-col>
                                <v-col cols="12" md="6">
                                    <v-list density="compact" class="bg-transparent">
                                        <v-list-subheader>Ground Probe</v-list-subheader>
                                        <v-list-item title="Probe hit" :subtitle="String(groundProbeHit)" />
                                        <v-list-item title="Probe distance" :subtitle="groundProbeDistanceLabel" />
                                        <v-list-item title="Probe mesh" :subtitle="groundProbeMeshName || '-'" />
                                    </v-list>
                                </v-col>
                            </v-row>
                        </v-window-item>

                        <v-window-item value="cameraAudio">
                            <v-row dense>
                                <v-col cols="12" md="6">
                                    <v-list density="compact" class="bg-transparent">
                                        <v-list-subheader>Camera</v-list-subheader>
                                        <v-list-item title="Position" :subtitle="cameraPositionLabel" />
                                        <v-list-item title="Target" :subtitle="cameraTargetLabel" />
                                    </v-list>
                                </v-col>
                                <v-col cols="12" md="6">
                                    <v-list density="compact" class="bg-transparent">
                                        <v-list-subheader>Audio</v-list-subheader>
                                        <v-list-item title="Threshold" :subtitle="String(talkThreshold)" />
                                        <v-list-item title="Inputs" :subtitle="String(audioInputDevices.length)" />
                                        <v-expansion-panels variant="accordion" density="compact"
                                            v-if="audioInputDevices.length">
                                            <v-expansion-panel>
                                                <v-expansion-panel-title>Input devices</v-expansion-panel-title>
                                                <v-expansion-panel-text>
                                                    <div v-for="d in audioInputDevices" :key="d.deviceId"
                                                        class="text-caption">
                                                        <span class="font-mono">{{ d.label }}</span>
                                                    </div>
                                                </v-expansion-panel-text>
                                            </v-expansion-panel>
                                        </v-expansion-panels>
                                    </v-list>
                                </v-col>
                            </v-row>
                        </v-window-item>

                        <v-window-item value="sync">
                            <v-list density="compact" class="bg-transparent">
                                <v-list-subheader>Reflect Receive Stats</v-list-subheader>
                                <v-list-item>
                                    <v-list-item-title>Total Frames</v-list-item-title>
                                    <v-list-item-subtitle>{{ otherAvatarReflectStats?.totalFrames || 0
                                        }}</v-list-item-subtitle>
                                </v-list-item>
                                <v-list-item>
                                    <v-list-item-title>Bad Frames</v-list-item-title>
                                    <v-list-item-subtitle>{{ otherAvatarReflectStats?.badFrames || 0
                                        }}</v-list-item-subtitle>
                                </v-list-item>
                                <v-list-item>
                                    <v-list-item-title>Error Rate</v-list-item-title>
                                    <v-list-item-subtitle>{{ otherAvatarReflectErrorRate }}%</v-list-item-subtitle>
                                </v-list-item>
                                <v-list-item>
                                    <v-list-item-title>Last Frame</v-list-item-title>
                                    <v-list-item-subtitle>{{ otherAvatarReflectLastFrameLabel }}</v-list-item-subtitle>
                                </v-list-item>
                                <v-list-item>
                                    <v-list-item-title>Avg Frame Interval</v-list-item-title>
                                    <v-list-item-subtitle>{{ otherAvatarReflectAvgIntervalLabel
                                        }}</v-list-item-subtitle>
                                </v-list-item>
                            </v-list>
                        </v-window-item>

                        <v-window-item value="reflect">
                            <v-list density="compact" class="bg-transparent">
                                <v-list-subheader>My Avatar Sync Groups</v-list-subheader>
                                <v-list-item>
                                    <v-list-item-title>Reflect Sync Group</v-list-item-title>
                                    <v-list-item-subtitle>{{ avatarReflectSyncGroup || '-' }}</v-list-item-subtitle>
                                </v-list-item>
                                <v-list-item>
                                    <v-list-item-title>Entity Sync Group</v-list-item-title>
                                    <v-list-item-subtitle>{{ avatarEntitySyncGroup || '-' }}</v-list-item-subtitle>
                                </v-list-item>
                                <v-list-item>
                                    <v-list-item-title>Reflect Channel</v-list-item-title>
                                    <v-list-item-subtitle>{{ avatarReflectChannel || '-' }}</v-list-item-subtitle>
                                </v-list-item>

                                <v-divider class="my-2" />

                                <v-list-subheader>Reflect Sync (Publish)</v-list-subheader>
                                <v-list-item title="Entity name" :subtitle="syncEntityName" />
                                <v-list-item title="Queued keys" :subtitle="String(syncQueuedKeys)" />
                                <v-list-item title="Last batch count" :subtitle="String(syncLastBatchCount)" />
                                <v-list-item title="Total pushed" :subtitle="String(syncTotalPushed)" />
                                <v-list-item title="Last pushed" :subtitle="lastPushedAtLabel" />
                                <v-list-item title="Push interval" :subtitle="pushIntervalLabel" />
                                <v-list-item title="Pushes/min" :subtitle="String(syncPushesPerMinute)" />
                                <v-list-item title="Last batch size" :subtitle="`${syncLastBatchSizeKb} KB`" />
                                <v-list-item title="Avg batch size" :subtitle="`${syncAvgBatchSizeKb} KB`" />
                                <v-list-item title="Avg batch time" :subtitle="`${syncAvgBatchProcessTimeMs} ms`" />
                                <v-divider class="my-2" />
                                <v-list-subheader>Sync Errors</v-list-subheader>
                                <v-list-item title="Error count" :subtitle="String(syncErrorCount)"
                                    :class="{ 'text-success': syncErrorCount === 0, 'text-error': syncErrorCount > 0 }" />
                                <v-list-item title="Last error at" :subtitle="syncLastErrorAt" />
                                <v-expansion-panels variant="accordion" density="compact" v-if="syncErrorCount > 0">
                                    <v-expansion-panel>
                                        <v-expansion-panel-title>Last error details</v-expansion-panel-title>
                                        <v-expansion-panel-text>
                                            <div class="text-caption">
                                                <div><strong>Source:</strong> <span class="font-mono">{{
                                                    syncLastErrorSource
                                                        }}</span></div>
                                                <div class="mt-1"><strong>Message:</strong> <span class="font-mono">{{
                                                    syncLastErrorMessage }}</span></div>
                                            </div>
                                        </v-expansion-panel-text>
                                    </v-expansion-panel>
                                </v-expansion-panels>
                                <v-expansion-panels variant="accordion" density="compact" class="mt-1"
                                    v-if="(props.syncMetrics?.lastKeys?.length || 0) > 0">
                                    <v-expansion-panel>
                                        <v-expansion-panel-title>Last keys pushed</v-expansion-panel-title>
                                        <v-expansion-panel-text>
                                            <div v-for="k in (props.syncMetrics?.lastKeys || [])" :key="k"
                                                class="text-caption">
                                                <span class="font-mono">{{ k }}</span>
                                            </div>
                                        </v-expansion-panel-text>
                                    </v-expansion-panel>
                                </v-expansion-panels>
                                <v-expansion-panels variant="accordion" density="compact" class="mt-1"
                                    v-if="(props.syncMetrics?.lastEntries?.length || 0) > 0">
                                    <v-expansion-panel>
                                        <v-expansion-panel-title>
                                            Last entries (values + sizes) — total ~{{ lastEntriesTotalSizeKb.toFixed(2)
                                            }}
                                            KB
                                        </v-expansion-panel-title>
                                        <v-expansion-panel-text>
                                            <div v-for="e in lastEntries" :key="e.key" class="mb-2">
                                                <div class="d-flex align-center justify-space-between text-caption">
                                                    <span class="font-mono">{{ e.key }}</span>
                                                    <span>{{ e.sizeBytes }} bytes ({{ (e.sizeBytes / 1024).toFixed(2) }}
                                                        KB)</span>
                                                </div>
                                                <pre class="font-mono"
                                                    style="white-space: pre-wrap; word-break: break-all; background: transparent;">
                                        {{ formatValue(e.value) }}</pre>
                                                <v-divider class="my-2" />
                                            </div>
                                        </v-expansion-panel-text>
                                    </v-expansion-panel>
                                </v-expansion-panels>
                            </v-list>
                        </v-window-item>

                        <v-window-item value="meshes">
                            <v-row dense>
                                <v-col cols="12" md="6">
                                    <v-list density="compact" class="bg-transparent">
                                        <v-list-subheader>Avatar Meshes</v-list-subheader>
                                        <v-list-item title="# under avatar"
                                            :subtitle="String(meshesUnderAvatar.length)" />
                                        <v-list-item title="# skinned (match skeleton)"
                                            :subtitle="String(skinnedMeshesUnderAvatar.length)" />
                                        <v-expansion-panels variant="accordion" density="compact">
                                            <v-expansion-panel>
                                                <v-expansion-panel-title>Mesh visibility (first
                                                    15)</v-expansion-panel-title>
                                                <v-expansion-panel-text>
                                                    <div v-for="m in meshesUnderAvatar.slice(0, 15)" :key="m.uniqueId"
                                                        class="text-caption">
                                                        <span class="font-mono">{{ m.name || '(unnamed)' }}</span>
                                                        — vis: {{ m.isVisible }} — enabled: {{ m.isEnabled() }}
                                                    </div>
                                                </v-expansion-panel-text>
                                            </v-expansion-panel>
                                        </v-expansion-panels>
                                    </v-list>
                                </v-col>
                                <v-col cols="12" md="6">
                                    <v-list density="compact" class="bg-transparent">
                                        <v-list-subheader>Skeleton</v-list-subheader>
                                        <v-list-item title="Present" :subtitle="avatarSkeleton ? 'yes' : 'no'" />
                                        <v-list-item title="Bone count"
                                            :subtitle="avatarSkeleton ? String(avatarSkeleton.bones.length) : '-'" />
                                    </v-list>
                                </v-col>
                            </v-row>
                        </v-window-item>

                        <v-window-item value="blend">
                            <v-list density="compact" class="bg-transparent">
                                <v-list-subheader>Blendshapes (Morph Targets)</v-list-subheader>
                                <v-list-item :title="'Distinct targets'" :subtitle="String(morphTargets.length)" />
                                <v-expansion-panels variant="accordion" density="compact" class="mt-1">
                                    <v-expansion-panel>
                                        <v-expansion-panel-title>Visemes overview</v-expansion-panel-title>
                                        <v-expansion-panel-text>
                                            <div v-for="v in supportedVisemeNames" :key="v" class="text-caption mb-1">
                                                <span class="font-mono" :class="{ 'text-success': hasMorph(v) }">{{ v
                                                    }}</span>
                                                <v-progress-linear v-if="influenceOf(v) !== null" :height="6"
                                                    :rounded="true" :striped="true" color="primary"
                                                    :model-value="Math.round(100 * (influenceOf(v) || 0))"
                                                    class="ml-2" />
                                            </div>
                                        </v-expansion-panel-text>
                                    </v-expansion-panel>
                                    <v-expansion-panel>
                                        <v-expansion-panel-title>All targets (top 50 by avg
                                            influence)</v-expansion-panel-title>
                                        <v-expansion-panel-text>
                                            <div v-for="t in morphTargetsSorted.slice(0, 50)" :key="t.name"
                                                class="mb-1">
                                                <div class="d-flex align-center justify-space-between">
                                                    <span class="font-mono">{{ t.name }}</span>
                                                    <span class="text-caption">avg {{ t.avg.toFixed(3) }} — min {{
                                                        t.min.toFixed(3)
                                                        }} — max {{ t.max.toFixed(3) }} (n={{ t.count }})</span>
                                                </div>
                                                <v-progress-linear :model-value="Math.round(100 * t.avg)" :height="6"
                                                    color="secondary" rounded class="mt-1" />
                                            </div>
                                        </v-expansion-panel-text>
                                    </v-expansion-panel>
                                </v-expansion-panels>
                            </v-list>
                        </v-window-item>

                        <v-window-item value="anim">
                            <v-list density="compact" class="bg-transparent">
                                <v-list-subheader>Primary Groups</v-list-subheader>
                                <v-list-item title="Idle ready" :subtitle="boolLabel(animDebug.idle.ready)" />
                                <v-list-item title="Walk ready" :subtitle="boolLabel(animDebug.walk.ready)" />
                                <v-list-item title="Blend weight" :subtitle="animDebug.blendWeight.toFixed(2)" />
                            </v-list>
                            <v-divider class="my-3" />
                            <v-list density="compact" class="bg-transparent">
                                <v-list-subheader>All Animations</v-list-subheader>
                                <div class="font-mono text-caption">
                                    <div v-for="(row, idx) in animDebug.animations" :key="idx">{{ row.fileName }} — {{
                                        row.state }}
                                    </div>
                                </div>
                            </v-list>
                            <v-divider class="my-3" />
                            <v-list density="compact" class="bg-transparent">
                                <v-list-subheader>Last Loader Events</v-list-subheader>
                                <div class="font-mono text-caption">
                                    <div v-for="(line, idx) in animDebug.events.slice(-30)" :key="idx">{{ line }}</div>
                                </div>
                            </v-list>
                        </v-window-item>

                    </v-window>
                </div>
            </v-window-item>
            <v-window-item value="otherAvatars">
                <div class="px-2 py-2">
                    <v-tabs v-model="otherAvatarsTab" density="compact">
                        <v-tab value="overview">Overview</v-tab>
                        <v-tab value="reflect">Reflect Sync</v-tab>
                        <v-tab value="sessions">Sessions</v-tab>
                        <v-tab value="errors">Errors</v-tab>
                    </v-tabs>
                    <v-window v-model="otherAvatarsTab" class="mt-3">
                        <v-window-item value="overview">
                            <v-row dense>
                                <v-col cols="12" md="6">
                                    <v-list density="compact" class="bg-transparent">
                                        <v-list-subheader>Overview</v-list-subheader>
                                        <v-list-item title="# other avatars"
                                            :subtitle="String((props.otherAvatarSessionIds || []).length)" />
                                        <v-list-item title="Any loading"
                                            :subtitle="String(!!props.otherAvatarsIsLoading)" />
                                        <v-list-item title="Discovery rows"
                                            :subtitle="String(props.otherAvatarsPollStats?.discovery?.rows || 0)" />
                                        <v-list-item title="Discovery last ms"
                                            :subtitle="String(props.otherAvatarsPollStats?.discovery?.lastDurationMs || 0)" />
                                        <v-list-item title="Discovery timeouts/errors"
                                            :subtitle="`${props.otherAvatarsPollStats?.discovery?.timeouts || 0} / ${props.otherAvatarsPollStats?.discovery?.errors || 0}`" />
                                    </v-list>
                                </v-col>
                                <v-col cols="12" md="6">
                                    <v-list density="compact" class="bg-transparent">
                                        <v-list-subheader>Latest Discovery (UTC)</v-list-subheader>
                                        <div v-if="(props.otherAvatarSessionIds || []).length === 0"
                                            class="text-caption">-</div>
                                        <div v-else class="text-caption">
                                            <div v-for="sid in (props.otherAvatarSessionIds || []).slice(0, 20)"
                                                :key="sid" class="mb-1">
                                                <span class="font-mono">{{ shortId(sid) }}</span>
                                                <template v-if="props.lastPollTimestamps">
                                                    — last joints: <span class="font-mono">{{
                                                        tsLabel(props.lastPollTimestamps?.[sid]) }}</span>
                                                </template>
                                            </div>
                                        </div>
                                    </v-list>
                                </v-col>
                            </v-row>
                        </v-window-item>
                        <v-window-item value="reflect">
                            <v-list density="compact" class="bg-transparent">
                                <v-list-subheader>Other Avatars Sync Groups</v-list-subheader>
                                <v-list-item>
                                    <v-list-item-title>Reflect Sync Group</v-list-item-title>
                                    <v-list-item-subtitle>{{ avatarReflectSyncGroup || '-' }}</v-list-item-subtitle>
                                </v-list-item>
                                <v-list-item>
                                    <v-list-item-title>Entity Sync Group</v-list-item-title>
                                    <v-list-item-subtitle>{{ avatarEntitySyncGroup || '-' }}</v-list-item-subtitle>
                                </v-list-item>
                                <v-list-item>
                                    <v-list-item-title>Reflect Channel</v-list-item-title>
                                    <v-list-item-subtitle>{{ avatarReflectChannel || '-' }}</v-list-item-subtitle>
                                </v-list-item>

                                <v-divider class="my-2" />

                                <v-list-subheader>Reflect Statistics</v-list-subheader>
                                <v-list-item>
                                    <v-list-item-title>Total Frames</v-list-item-title>
                                    <v-list-item-subtitle>{{ otherAvatarReflectStats?.totalFrames || 0
                                        }}</v-list-item-subtitle>
                                </v-list-item>
                                <v-list-item>
                                    <v-list-item-title>Bad Frames</v-list-item-title>
                                    <v-list-item-subtitle>{{ otherAvatarReflectStats?.badFrames || 0
                                        }}</v-list-item-subtitle>
                                </v-list-item>
                                <v-list-item>
                                    <v-list-item-title>Error Rate</v-list-item-title>
                                    <v-list-item-subtitle>{{ otherAvatarReflectErrorRate }}%</v-list-item-subtitle>
                                </v-list-item>
                                <v-list-item>
                                    <v-list-item-title>Last Frame</v-list-item-title>
                                    <v-list-item-subtitle>{{ otherAvatarReflectLastFrameLabel }}</v-list-item-subtitle>
                                </v-list-item>
                                <v-list-item>
                                    <v-list-item-title>Avg Frame Interval</v-list-item-title>
                                    <v-list-item-subtitle>{{ otherAvatarReflectAvgIntervalLabel
                                        }}</v-list-item-subtitle>
                                </v-list-item>

                                <v-divider class="my-2" />

                                <v-list-subheader>Reflect (Deliveries)</v-list-subheader>
                                <div v-if="(props.otherAvatarSessionIds || []).length === 0" class="text-caption">-
                                </div>
                                <div v-else class="text-caption">
                                    <div v-for="sid in (props.otherAvatarSessionIds || []).slice(0, 20)" :key="sid"
                                        class="mb-1">
                                        <span class="font-mono">{{ shortId(sid) }}</span>
                                        <template
                                            v-if="props.lastBasePollTimestamps || props.lastCameraPollTimestamps || props.lastPollTimestamps">
                                            — base: <span class="font-mono">{{
                                                tsLabel(props.lastBasePollTimestamps?.[sid]) }}</span>
                                            — camera: <span class="font-mono">{{
                                                tsLabel(props.lastCameraPollTimestamps?.[sid]) }}</span>
                                            — joints: <span class="font-mono">{{
                                                tsLabel(props.lastPollTimestamps?.[sid]) }}</span>
                                        </template>
                                    </div>
                                </div>
                            </v-list>
                        </v-window-item>
                        <v-window-item value="sessions">
                            <v-expansion-panels variant="accordion" density="compact">
                                <v-expansion-panel v-for="sid in (props.otherAvatarSessionIds || [])" :key="sid">
                                    <v-expansion-panel-title>
                                        <div class="d-flex align-center justify-space-between w-100">
                                            <span class="font-mono">{{ sid }}</span>
                                            <span class="text-caption">
                                                model: <span class="font-mono">{{
                                                    (props.avatarDataMap?.[sid]?.modelFileName) || '-'
                                                }}</span>
                                                — joints: {{ jointCount(sid) }}
                                            </span>
                                        </div>
                                    </v-expansion-panel-title>
                                    <v-expansion-panel-text>
                                        <v-row dense>
                                            <v-col cols="12" md="6">
                                                <v-list density="compact" class="bg-transparent">
                                                    <v-list-subheader>Base</v-list-subheader>
                                                    <v-list-item title="sessionId"
                                                        :subtitle="(props.avatarDataMap?.[sid]?.sessionId) || '-'" />
                                                    <v-list-item title="modelFileName"
                                                        :subtitle="(props.avatarDataMap?.[sid]?.modelFileName) || '-'" />
                                                    <v-list-item title="camera (alpha, beta, radius)"
                                                        :subtitle="otherCameraLabel(props.avatarDataMap?.[sid]?.cameraOrientation)" />
                                                    <v-list-item title="position"
                                                        :subtitle="positionLabel(props.positionDataMap?.[sid])" />
                                                    <v-list-item title="rotation (quat)"
                                                        :subtitle="rotationLabel(props.rotationDataMap?.[sid])" />
                                                </v-list>
                                            </v-col>
                                            <v-col cols="12" md="6">
                                                <v-list density="compact" class="bg-transparent">
                                                    <v-list-subheader>Joints</v-list-subheader>
                                                    <div v-if="jointCount(sid) === 0" class="text-caption">-</div>
                                                    <div v-else class="text-caption">
                                                        <div v-for="jn in jointNames(sid).slice(0, 20)" :key="jn"
                                                            class="mb-1">
                                                            <span class="font-mono">{{ jn }}</span>
                                                            <span class="ml-2">{{ jointPosRotLabel(sid, jn) }}</span>
                                                        </div>
                                                    </div>
                                                </v-list>
                                            </v-col>
                                        </v-row>
                                    </v-expansion-panel-text>
                                </v-expansion-panel>
                            </v-expansion-panels>
                        </v-window-item>
                        <v-window-item value="errors">
                            <v-list density="compact" class="bg-transparent">
                                <v-list-subheader>Discovery Errors</v-list-subheader>
                                <v-list-item title="Timeouts"
                                    :subtitle="String(props.otherAvatarsPollStats?.discovery?.timeouts || 0)" />
                                <v-list-item title="Errors"
                                    :subtitle="String(props.otherAvatarsPollStats?.discovery?.errors || 0)" />
                                <v-list-item title="Last error at"
                                    :subtitle="tsLabel(props.otherAvatarsPollStats?.discovery?.lastErrorAt || null)" />
                                <v-list-item title="Last error"
                                    :subtitle="props.otherAvatarsPollStats?.discovery?.lastError || '-'" />
                            </v-list>
                        </v-window-item>
                    </v-window>
                </div>
            </v-window-item>
        </v-window>
    </v-navigation-drawer>
</template>

<script setup>
import { useIntervalFn, useStorage } from "@vueuse/core";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

const props = defineProps({
    open: { type: Boolean, default: false },
    tab: { type: String, default: "environment" },
    width: { type: Number, default: 360 },
    environmentIsLoading: { type: Boolean, required: true },
    physicsEnabled: { type: Boolean, default: undefined },
    physicsPluginName: { type: String, default: null },
    physicsEngineType: { type: String, default: undefined },
    physicsInitialized: { type: Boolean, default: undefined },
    havokInstanceLoaded: { type: Boolean, default: undefined },
    physicsPluginCreated: { type: Boolean, default: undefined },
    physicsError: { type: String, default: null },
    gravity: { type: Array, default: undefined },
    // Avatar debug props (mirrored from MainScene)
    scene: { type: Object, default: null },
    avatarNode: { type: Object, default: null },
    avatarSkeleton: { type: Object, default: null },
    modelFileName: { type: String, default: null },
    modelStep: { type: String, default: null },
    modelError: { type: String, default: null },
    isTalking: { type: Boolean, default: false },
    talkLevel: { type: Number, default: 0 },
    talkThreshold: { type: Number, default: 0 },
    audioInputDevices: { type: Array, default: () => [] },
    airborne: { type: Boolean, default: false },
    verticalVelocity: { type: Number, default: 0 },
    supportState: { type: Number, default: null },
    hasTouchedGround: { type: Boolean, default: false },
    spawnSettling: { type: Boolean, default: false },
    groundProbeHit: { type: Boolean, default: false },
    groundProbeDistance: { type: Number, default: null },
    groundProbeMeshName: { type: String, default: null },
    syncMetrics: { type: Object, default: null },
    animationDebug: { type: Object, default: null },
    // Avatar sync group props
    avatarReflectSyncGroup: { type: String, default: null },
    avatarEntitySyncGroup: { type: String, default: null },
    avatarReflectChannel: { type: String, default: null },
    // Other Avatars debug props
    otherAvatarSessionIds: { type: Array, default: () => [] },
    avatarDataMap: { type: Object, default: () => ({}) },
    positionDataMap: { type: Object, default: () => ({}) },
    rotationDataMap: { type: Object, default: () => ({}) },
    jointDataMap: { type: Object, default: () => ({}) },
    lastPollTimestamps: { type: Object, default: undefined },
    lastBasePollTimestamps: { type: Object, default: undefined },
    lastCameraPollTimestamps: { type: Object, default: undefined },
    otherAvatarsIsLoading: { type: Boolean, default: false },
    otherAvatarsPollStats: { type: Object, default: undefined },
    otherAvatarReflectStats: { type: Object, default: undefined },
});

const emit = defineEmits(["update:open", "update:tab"]);

const openModel = computed({
    get: () => props.open,
    set: (v) => emit("update:open", v),
});
const tabModel = computed({
    get: () => props.tab,
    set: (v) => emit("update:tab", v),
});

// Avatar tab internal state and computed helpers (ported from BabylonMyAvatarDebugOverlay)
const avatarTab = useStorage("vrca.right.drawer.avatar.tab", "overview")
// Other Avatars internal tab state
const otherAvatarsTab = useStorage("vrca.right.drawer.other-avatars.tab", "overview")

const modelReady = computed(
    () => !props.modelError && !!props.modelFileName && !!props.scene,
);
const talkLevelLabel = computed(() => (props.talkLevel || 0).toFixed(3));
const modelStateLabel = computed(() =>
    props.modelError ? "error" : modelReady.value ? "ready" : "loading or idle",
);
const verticalVelocityLabel = computed(() =>
    (props.verticalVelocity || 0).toFixed(3),
);
const supportStateLabel = computed(() => {
    const s = props.supportState;
    if (s === null || s === undefined) return "unknown";
    switch (s) {
        case 0:
            return "unsupported";
        case 1:
            return "supported";
        default:
            return String(s);
    }
});
const groundProbeDistanceLabel = computed(() =>
    props.groundProbeDistance === null ||
        props.groundProbeDistance === undefined
        ? "-"
        : Number(props.groundProbeDistance).toFixed(3),
);
// Sync metrics labels
const syncEntityName = computed(() => props.syncMetrics?.entityName || "-");
const syncQueuedKeys = computed(() => props.syncMetrics?.queuedKeys ?? 0);
const syncLastBatchCount = computed(
    () => props.syncMetrics?.lastBatchCount ?? 0,
);
const syncTotalPushed = computed(() => props.syncMetrics?.totalPushed ?? 0);
const syncPushesPerMinute = computed(
    () => props.syncMetrics?.avgPushesPerMinute ?? 0,
);
const syncLastBatchSizeKb = computed(
    () => props.syncMetrics?.lastBatchSizeKb ?? 0,
);
const syncAvgBatchSizeKb = computed(
    () => props.syncMetrics?.avgBatchSizeKb ?? 0,
);
const syncAvgBatchProcessTimeMs = computed(
    () => props.syncMetrics?.avgBatchProcessTimeMs ?? 0,
);
const syncErrorCount = computed(() => props.syncMetrics?.errorCount ?? 0);
const syncLastErrorAt = computed(() => {
    const s = props.syncMetrics?.lastErrorAt;
    if (!s) return "-";
    try {
        return new Date(s).toLocaleTimeString();
    } catch {
        return s;
    }
});
const syncLastErrorMessage = computed(
    () => props.syncMetrics?.lastErrorMessage || "-",
);
const syncLastErrorSource = computed(
    () => props.syncMetrics?.lastErrorSource || "-",
);
const lastPushedAtLabel = computed(() => {
    const s = props.syncMetrics?.lastPushedAt;
    if (!s) return "-";
    try {
        return new Date(s).toLocaleTimeString();
    } catch {
        return s;
    }
});
const pushIntervalLabel = computed(() => {
    const ms = props.syncMetrics?.pushIntervalMs;
    if (ms === null || ms === undefined) return "-";
    return `${ms} ms`;
});
const lastEntries = computed(() => props.syncMetrics?.lastEntries || []);
const lastEntriesTotalSizeKb = computed(
    () =>
        lastEntries.value.reduce((sum, e) => sum + (e?.sizeBytes || 0), 0) /
        1024,
);
function formatValue(v) {
    try {
        return JSON.stringify(v, null, 2);
    } catch {
        return String(v);
    }
}

function isUnderAvatarNode(mesh, root) {
    if (!root) return false;
    let p = mesh?.parent || null;
    while (p) {
        if (p === root) return true;
        p = p.parent;
    }
    return false;
}

const meshesUnderAvatar = computed(
    () =>
        props.scene?.meshes.filter((m) =>
            isUnderAvatarNode(m, props.avatarNode),
        ) || [],
);
const skinnedMeshesUnderAvatar = computed(() =>
    meshesUnderAvatar.value.filter(
        (m) =>
            m.skeleton &&
            (!props.avatarSkeleton || m.skeleton === props.avatarSkeleton),
    ),
);

const camera = computed(() => props.scene?.activeCamera || null);
const cameraLabel = computed(() =>
    camera.value ? camera.value.name || "yes" : "no",
);
const cameraPositionLabel = computed(() => {
    const c = camera.value;
    if (!c || !c.position) return "-";
    const p = c.position;
    return `x:${p.x.toFixed(2)} y:${p.y.toFixed(2)} z:${p.z.toFixed(2)}`;
});
const cameraTargetLabel = computed(() => {
    const c = camera.value;
    if (!c || !c.getTarget) return "-";
    const t = c.getTarget();
    if (!t) return "-";
    return `x:${t.x.toFixed(2)} y:${t.y.toFixed(2)} z:${t.z.toFixed(2)}`;
});

// My Avatar transform (sampled periodically for reactivity)
const myAvatarPos = ref({ x: 0, y: 0, z: 0 });
const myAvatarRot = ref({ x: 0, y: 0, z: 0, w: 1 });
const myAvatarScale = ref({ x: 1, y: 1, z: 1 });
const myAvatarPositionLabel = computed(() => positionLabel(myAvatarPos.value));
const myAvatarRotationLabel = computed(() => rotationLabel(myAvatarRot.value));
const myAvatarScaleLabel = computed(() => positionLabel(myAvatarScale.value));

const { pause: pauseAvatarTransform, resume: resumeAvatarTransform } = useIntervalFn(
    () => {
        const n = props.avatarNode;
        if (!n) return;
        const p = n.position;
        if (p) myAvatarPos.value = { x: p.x, y: p.y, z: p.z };
        const q = n.rotationQuaternion;
        if (q) myAvatarRot.value = { x: q.x, y: q.y, z: q.z, w: q.w };
        const s = n.scaling;
        if (s) myAvatarScale.value = { x: s.x, y: s.y, z: s.z };
    },
    100,
    { immediate: true },
);

// Blendshape (morph target) diagnostics
const supportedVisemeNames = [
    "viseme_sil",
    "viseme_PP",
    "viseme_FF",
    "viseme_TH",
    "viseme_DD",
    "viseme_kk",
    "viseme_CH",
    "viseme_SS",
    "viseme_nn",
    "viseme_RR",
    "viseme_aa",
    "viseme_E",
    "viseme_I",
    "viseme_O",
    "viseme_U",
];

const morphTargets = ref([]);

function snapshotMorphTargets() {
    const map = new Map();
    for (const m of meshesUnderAvatar.value) {
        const manager = m?.morphTargetManager;
        if (!manager || !manager.numTargets || !manager.getTarget) continue;
        for (let i = 0; i < manager.numTargets; i++) {
            const t = manager.getTarget(i);
            if (!t || typeof t.influence !== "number") continue;
            const key = t.name || "(unnamed)";
            const rec = map.get(key);
            if (!rec) {
                map.set(key, {
                    sum: t.influence,
                    count: 1,
                    min: t.influence,
                    max: t.influence,
                });
            } else {
                rec.sum += t.influence;
                rec.count += 1;
                if (t.influence < rec.min) rec.min = t.influence;
                if (t.influence > rec.max) rec.max = t.influence;
            }
        }
    }
    const out = [];
    for (const [name, v] of map.entries()) {
        out.push({
            name,
            count: v.count,
            avg: v.sum / Math.max(1, v.count),
            min: v.min,
            max: v.max,
        });
    }
    return out;
}

const { pause: pauseSnapshot, resume: resumeSnapshot } = useIntervalFn(
    () => {
        morphTargets.value = snapshotMorphTargets();
    },
    200,
    { immediate: true },
);

onMounted(() => {
    resumeSnapshot();
    resumeAvatarTransform();
});
onUnmounted(() => {
    pauseSnapshot();
    pauseAvatarTransform();
});

const morphTargetsSorted = computed(() =>
    [...morphTargets.value].sort(
        (a, b) => b.avg - a.avg || a.name.localeCompare(b.name),
    ),
);

function hasMorph(name) {
    const needle = String(name || "").toLowerCase();
    for (const t of morphTargets.value) {
        if ((t.name || "").toLowerCase() === needle) return true;
    }
    return false;
}
function influenceOf(name) {
    const needle = String(name || "").toLowerCase();
    for (const t of morphTargets.value) {
        if ((t.name || "").toLowerCase() === needle) return t.avg;
    }
    return null;
}

const animDebug = computed(
    () =>
        props.animationDebug || {
            idle: { ready: false },
            walk: { ready: false },
            blendWeight: 0,
            events: [],
            animations: [],
        },
);

function boolLabel(v) {
    return v ? "yes" : "no";
}

// Other Avatars helpers (ported from BabylonOtherAvatarsDebugOverlay)
function shortId(id) {
    if (!id) return "-";
    return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}
function tsLabel(d) {
    if (!d) return "-";
    try {
        return new Date(d).toISOString().split("T")[1].split(".")[0];
    } catch {
        return String(d);
    }
}
function positionLabel(p) {
    if (!p) return "-";
    return `x:${Number(p.x).toFixed(2)} y:${Number(p.y).toFixed(2)} z:${Number(p.z).toFixed(2)}`;
}
function rotationLabel(r) {
    if (!r) return "-";
    return `x:${Number(r.x).toFixed(2)} y:${Number(r.y).toFixed(2)} z:${Number(r.z).toFixed(2)} w:${Number(r.w).toFixed(2)}`;
}
function otherCameraLabel(c) {
    if (!c) return "-";
    return `a:${Number(c.alpha).toFixed(2)} b:${Number(c.beta).toFixed(2)} r:${Number(c.radius).toFixed(2)}`;
}
function jointCount(sessionId) {
    const m = props.jointDataMap?.[sessionId];
    return m && typeof m.size === "number" ? m.size : 0;
}
function jointNames(sessionId) {
    const m = props.jointDataMap?.[sessionId];
    if (!m) return [];
    const out = [];
    for (const [k] of m) out.push(k);
    return out.sort();
}
function jointPosRotLabel(sessionId, jointName) {
    const m = props.jointDataMap?.[sessionId];
    const j = m?.get ? m.get(jointName) : null;
    if (!j || !j.position) return "";
    const px = Number(j.position.x).toFixed(2);
    const py = Number(j.position.y).toFixed(2);
    const pz = Number(j.position.z).toFixed(2);
    return `pos(${px},${py},${pz})`;
}

// Sync and reflect stats computed properties
const otherAvatarReflectErrorRate = computed(() => {
    const stats = props.otherAvatarReflectStats;
    if (!stats || stats.totalFrames === 0) return "0.00";
    return ((stats.badFrames / stats.totalFrames) * 100).toFixed(2);
});

const otherAvatarReflectLastFrameLabel = computed(() => {
    const stats = props.otherAvatarReflectStats;
    if (!stats?.lastFrameAt) return "-";
    try {
        return new Date(stats.lastFrameAt).toLocaleTimeString();
    } catch {
        return String(stats.lastFrameAt);
    }
});

const otherAvatarReflectAvgIntervalLabel = computed(() => {
    const stats = props.otherAvatarReflectStats;
    if (!stats?.avgFrameIntervalMs) return "-";
    return `${stats.avgFrameIntervalMs.toFixed(1)}ms`;
});
</script>

<style scoped>
.font-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}
</style>