<template>
    <v-dialog v-model="open" max-width="880">
        <template #activator="{ props: activatorProps }">
            <v-btn v-bind="activatorProps" size="small" variant="text" icon="mdi-account-group-outline" class="ma-2" />
        </template>
        <v-card>
            <v-card-title class="d-flex align-center justify-space-between">
                <span>Other Avatars Debug</span>
                <div class="d-flex align-center">
                    <v-chip size="x-small" class="mr-2" color="primary" label>{{ hotkeyLabel }}</v-chip>
                    <v-chip size="x-small" :color="statusColor" label>{{ connectionStatus }}</v-chip>
                </div>
            </v-card-title>
            <v-card-text>
                <v-row dense>
                    <v-col cols="12" md="6">
                        <v-list density="compact" class="bg-transparent">
                            <v-list-subheader>Overview</v-list-subheader>
                            <v-list-item title="# other avatars" :subtitle="String(otherAvatarSessionIds.length)" />
                            <v-list-item title="Any loading" :subtitle="String(!!isLoading)" />
                            <v-list-item title="Polling: pos/rot" :subtitle="String(isPollingPositionRotation)" />
                            <v-list-item title="Polling: camera" :subtitle="String(isPollingCamera)" />
                            <v-list-item title="Polling: joints" :subtitle="String(isPollingJoints)" />
                            <v-list-item title="Discovery rows" :subtitle="String(pollStats?.discovery?.rows ?? 0)" />
                            <v-list-item title="Discovery last ms" :subtitle="String(pollStats?.discovery?.lastDurationMs ?? 0)" />
                            <v-list-item title="Discovery timeouts/errors" :subtitle="`${pollStats?.discovery?.timeouts ?? 0} / ${pollStats?.discovery?.errors ?? 0}`" />
                        </v-list>
                    </v-col>
                    <v-col cols="12" md="6">
                        <v-list density="compact" class="bg-transparent">
                            <v-list-subheader>Latest Poll Timestamps (UTC)</v-list-subheader>
                            <div v-if="otherAvatarSessionIds.length === 0" class="text-caption">-</div>
                            <div v-else class="text-caption">
                                <div v-for="sid in otherAvatarSessionIds.slice(0, 20)" :key="sid" class="mb-1">
                                    <span class="font-mono">{{ shortId(sid) }}</span>
                                    — base: <span class="font-mono">{{ tsLabel(lastBasePollTimestamps[sid]) }}</span>
                                    — camera: <span class="font-mono">{{ tsLabel(lastCameraPollTimestamps[sid]) }}</span>
                                    — joints: <span class="font-mono">{{ tsLabel(lastPollTimestamps[sid]) }}</span>
                                </div>
                            </div>
                        </v-list>
                    </v-col>
                </v-row>

                <v-divider class="my-3" />

                <v-expansion-panels variant="accordion" density="compact">
                    <v-expansion-panel v-for="sid in otherAvatarSessionIds" :key="sid">
                        <v-expansion-panel-title>
                            <div class="d-flex align-center justify-space-between w-100">
                                <span class="font-mono">{{ sid }}</span>
                                <span class="text-caption">
                                    model: <span class="font-mono">{{ avatarDataMap[sid]?.modelFileName || '-' }}</span>
                                    — joints: {{ jointCount(sid) }}
                                    — pr: {{ statFor(pollStats?.posRot, sid)?.rows ?? 0 }} rows
                                    — cam: {{ statFor(pollStats?.camera, sid)?.rows ?? 0 }} rows
                                    — jnt: {{ statFor(pollStats?.joints, sid)?.rows ?? 0 }} rows
                                </span>
                            </div>
                        </v-expansion-panel-title>
                        <v-expansion-panel-text>
                            <v-row dense>
                                <v-col cols="12" md="6">
                                    <v-list density="compact" class="bg-transparent">
                                        <v-list-subheader>Base</v-list-subheader>
                                        <v-list-item title="sessionId" :subtitle="avatarDataMap[sid]?.sessionId || '-'" />
                                        <v-list-item title="modelFileName" :subtitle="avatarDataMap[sid]?.modelFileName || '-'" />
                                        <v-list-item title="camera (alpha, beta, radius)"
                                            :subtitle="cameraLabel(avatarDataMap[sid]?.cameraOrientation)" />
                                        <v-list-item title="position" :subtitle="positionLabel(positionDataMap[sid])" />
                                        <v-list-item title="rotation (quat)" :subtitle="rotationLabel(rotationDataMap[sid])" />
                                        <v-list-item title="Errors (pos/rot)" :subtitle="errorLabel(pollStats?.posRot, sid)" />
                                        <v-list-item title="Errors (camera)" :subtitle="errorLabel(pollStats?.camera, sid)" />
                                        <v-list-item title="Errors (joints)" :subtitle="errorLabel(pollStats?.joints, sid)" />
                                    </v-list>
                                </v-col>
                                <v-col cols="12" md="6">
                                    <v-list density="compact" class="bg-transparent">
                                        <v-list-subheader>Joints</v-list-subheader>
                                        <div v-if="jointCount(sid) === 0" class="text-caption">-</div>
                                        <div v-else class="text-caption">
                                            <div v-for="jn in jointNames(sid).slice(0, 20)" :key="jn" class="mb-1">
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
            </v-card-text>
            <v-card-actions>
                <v-spacer />
                <v-btn variant="text" @click="open = false">Close</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useMagicKeys, whenever, useVModel } from "@vueuse/core";
import type {
    AvatarJointMetadata,
    AvatarBaseData,
    AvatarPositionData,
    AvatarRotationData,
} from "@schemas";

const props = defineProps({
    // Reactive debug state from BabylonOtherAvatars
    otherAvatarSessionIds: { type: Array as () => string[], required: true },
    avatarDataMap: {
        type: Object as () => Record<string, AvatarBaseData | undefined>,
        required: true,
    },
    positionDataMap: {
        type: Object as () => Record<string, AvatarPositionData | undefined>,
        required: true,
    },
    rotationDataMap: {
        type: Object as () => Record<string, AvatarRotationData | undefined>,
        required: true,
    },
    jointDataMap: {
        type: Object as () => Record<
            string,
            Map<string, AvatarJointMetadata> | undefined
        >,
        required: true,
    },
    lastPollTimestamps: {
        type: Object as () => Record<string, Date | null | undefined>,
        required: true,
    },
    lastBasePollTimestamps: {
        type: Object as () => Record<string, Date | null | undefined>,
        required: true,
    },
    lastCameraPollTimestamps: {
        type: Object as () => Record<string, Date | null | undefined>,
        required: true,
    },
    isPollingPositionRotation: {
        type: Boolean,
        required: false,
        default: false,
    },
    isPollingCamera: { type: Boolean, required: false, default: false },
    isPollingJoints: { type: Boolean, required: false, default: false },
    isLoading: { type: Boolean, required: false, default: false },
    connectionStatus: { type: String, required: false, default: "unknown" },
    // Poll stats including errors/timeouts and row counts
    pollStats: {
        type: Object as () => {
            discovery: {
                lastDurationMs: number;
                rows: number;
                timeouts: number;
                errors: number;
                lastError: string | null;
                lastErrorAt: Date | null;
            };
            posRot: Record<
                string,
                {
                    lastDurationMs: number;
                    rows: number;
                    timeouts: number;
                    errors: number;
                    lastError: string | null;
                    lastErrorAt: Date | null;
                }
            >;
            camera: Record<
                string,
                {
                    lastDurationMs: number;
                    rows: number;
                    timeouts: number;
                    errors: number;
                    lastError: string | null;
                    lastErrorAt: Date | null;
                }
            >;
            joints: Record<
                string,
                {
                    lastDurationMs: number;
                    rows: number;
                    timeouts: number;
                    errors: number;
                    lastError: string | null;
                    lastErrorAt: Date | null;
                }
            >;
        },
        required: false,
        default: undefined,
    },
    // External control (v-model)
    modelValue: { type: Boolean, required: false, default: undefined },
    // Configurable hotkey (default "o")
    hotkey: { type: String, required: false, default: "o" },
});

const emit = defineEmits(["update:modelValue"]);
const open = useVModel(props, "modelValue", emit, {
    passive: true,
    defaultValue: false,
});
const keys = useMagicKeys();
whenever(
    computed(() => {
        const map = keys as unknown as Record<
            string,
            { value: boolean } | undefined
        >;
        const r = map[props.hotkey];
        return !!r?.value;
    }),
    () => {
        open.value = !open.value;
    },
);

const hotkeyLabel = computed(() => props.hotkey.replace("+", " + "));
const statusColor = computed(() => {
    switch (props.connectionStatus) {
        case "connected":
            return "success";
        case "disconnected":
            return "error";
        default:
            return "secondary";
    }
});

function shortId(id: string): string {
    if (!id) return "-";
    return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}
function tsLabel(d?: Date | null): string {
    if (!d) return "-";
    try {
        return new Date(d).toISOString().split("T")[1].split(".")[0];
    } catch {
        return String(d);
    }
}
function positionLabel(p?: AvatarPositionData): string {
    if (!p) return "-";
    return `x:${p.x.toFixed(2)} y:${p.y.toFixed(2)} z:${p.z.toFixed(2)}`;
}
function rotationLabel(r?: AvatarRotationData): string {
    if (!r) return "-";
    return `x:${r.x.toFixed(2)} y:${r.y.toFixed(2)} z:${r.z.toFixed(2)} w:${r.w.toFixed(2)}`;
}
function cameraLabel(
    c?: { alpha: number; beta: number; radius: number } | null,
): string {
    if (!c) return "-";
    return `a:${c.alpha.toFixed(2)} b:${c.beta.toFixed(2)} r:${c.radius.toFixed(2)}`;
}
function jointCount(sessionId: string): number {
    const m = props.jointDataMap[sessionId];
    return m ? m.size : 0;
}
function jointNames(sessionId: string): string[] {
    const m = props.jointDataMap[sessionId];
    if (!m) return [];
    const out: string[] = [];
    for (const [k] of m) out.push(k);
    return out.sort();
}

function statFor(
    map: Record<string, { rows: number }> | undefined,
    id: string,
): { rows: number } | undefined {
    return map ? map[id] : undefined;
}

function errorLabel(
    map:
        | Record<
              string,
              {
                  timeouts: number;
                  errors: number;
                  lastError: string | null;
                  lastErrorAt: Date | null;
              }
          >
        | undefined,
    id: string,
): string {
    if (!map || !map[id]) return "-";
    const c = map[id];
    const ts = c.lastErrorAt
        ? new Date(c.lastErrorAt).toISOString().split("T")[1]?.split(".")[0]
        : "";
    if (c.errors || c.timeouts)
        return `${c.timeouts} timeouts, ${c.errors} errors${c.lastError ? ` (${ts} ${c.lastError.substring(0, 60)}...)` : ""}`;
    return "-";
}

function jointPosRotLabel(sessionId: string, jointName: string): string {
    const m = props.jointDataMap[sessionId];
    const j = m?.get(jointName);
    if (!j) return "";
    const px = j.position.x.toFixed(2);
    const py = j.position.y.toFixed(2);
    const pz = j.position.z.toFixed(2);
    return `pos(${px},${py},${pz})`;
}

// mark used in template
void hotkeyLabel;
void statusColor;
void jointCount;
void jointNames;
void shortId;
void tsLabel;
void cameraLabel;
void positionLabel;
void rotationLabel;
void statFor;
void errorLabel;
void jointPosRotLabel;
</script>

<style scoped>
.font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
</style>


