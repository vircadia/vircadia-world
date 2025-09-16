<template>
	<v-dialog v-model="open" max-width="720">
		<template #activator="{ props: activatorProps }">
			<!-- Optional anchor button for mouse users -->
			<v-btn v-bind="activatorProps" size="small" variant="text" icon="mdi-bug-outline" class="ma-2" />
		</template>
		<v-card>
			<v-card-title class="d-flex align-center justify-space-between">
				<span>Avatar Debug</span>
				<v-chip size="x-small" color="primary" label>{{ hotkeyLabel }}</v-chip>
			</v-card-title>
			<v-card-text>
				<v-row dense>
					<v-col cols="12" md="6">
						<v-list density="compact" class="bg-transparent">
							<v-list-subheader>General</v-list-subheader>
							<v-list-item title="Scene initialized" :subtitle="String(!!scene)" />
							<v-list-item title="Active camera" :subtitle="cameraLabel" />
							<v-list-item title="Avatar node" :subtitle="avatarNode ? 'yes' : 'no'" />
							<v-list-item title="Model file" :subtitle="modelFileName || '-'" />
							<v-list-item title="Model load step" :subtitle="modelStep || '-'" />
							<v-list-item title="Model state" :subtitle="modelStateLabel" :class="{ 'text-error': modelError, 'text-success': modelReady }" />
							<v-list-item v-if="modelError" title="Model error" :subtitle="modelError" class="text-error" />
							<v-list-item title="Talking" :subtitle="String(isTalking)" />
							<v-list-item title="Talk level" :subtitle="talkLevelLabel" />
							<v-divider class="my-2" />
							<v-list-subheader>Physics/State</v-list-subheader>
							<v-list-item title="Physics enabled" :subtitle="String(physicsEnabled)" />
							<v-list-item title="Airborne" :subtitle="String(airborne)" />
							<v-list-item title="Vertical velocity" :subtitle="verticalVelocityLabel" />
							<v-list-item title="Support state" :subtitle="supportStateLabel" />
							<v-list-item title="Spawn settling" :subtitle="String(spawnSettling)" />
							<v-list-item title="Has touched ground" :subtitle="String(hasTouchedGround)" />
							<v-divider class="my-2" />
							<v-list-subheader>Ground Probe</v-list-subheader>
							<v-list-item title="Probe hit" :subtitle="String(groundProbeHit)" />
							<v-list-item title="Probe distance" :subtitle="groundProbeDistanceLabel" />
							<v-list-item title="Probe mesh" :subtitle="groundProbeMeshName || '-'" />
						</v-list>
					</v-col>
					<v-col cols="12" md="6">
						<v-list density="compact" class="bg-transparent">
							<v-list-subheader>Avatar Meshes</v-list-subheader>
							<v-list-item title="# under avatar" :subtitle="String(meshesUnderAvatar.length)" />
							<v-list-item title="# skinned (match skeleton)" :subtitle="String(skinnedMeshesUnderAvatar.length)" />
							<v-expansion-panels variant="accordion" density="compact">
								<v-expansion-panel>
									<v-expansion-panel-title>Mesh visibility (first 15)</v-expansion-panel-title>
									<v-expansion-panel-text>
										<div v-for="m in meshesUnderAvatar.slice(0, 15)" :key="m.uniqueId" class="text-caption">
											<span class="font-mono">{{ m.name || '(unnamed)' }}</span>
											— vis: {{ m.isVisible }} — enabled: {{ m.isEnabled() }}
										</div>
									</v-expansion-panel-text>
								</v-expansion-panel>
							</v-expansion-panels>
						</v-list>
					</v-col>
				</v-row>
				<v-divider class="my-3" />
				<v-row dense>
					<v-col cols="12" md="6">
						<v-list density="compact" class="bg-transparent">
							<v-list-subheader>Skeleton</v-list-subheader>
							<v-list-item title="Present" :subtitle="avatarSkeleton ? 'yes' : 'no'" />
							<v-list-item title="Bone count" :subtitle="avatarSkeleton ? String(avatarSkeleton.bones.length) : '-'" />
						</v-list>
					</v-col>
					<v-col cols="12" md="6">
						<v-list density="compact" class="bg-transparent">
							<v-list-subheader>Camera</v-list-subheader>
							<v-list-item title="Position" :subtitle="cameraPositionLabel" />
							<v-list-item title="Target" :subtitle="cameraTargetLabel" />
						</v-list>

						<v-list density="compact" class="bg-transparent mt-4">
							<v-list-subheader>Audio</v-list-subheader>
							<v-list-item title="Threshold" :subtitle="String(talkThreshold)" />
							<v-list-item title="Inputs" :subtitle="String(audioInputDevices.length)" />
							<v-expansion-panels variant="accordion" density="compact" v-if="audioInputDevices.length">
								<v-expansion-panel>
									<v-expansion-panel-title>Input devices</v-expansion-panel-title>
									<v-expansion-panel-text>
										<div v-for="d in audioInputDevices" :key="d.deviceId" class="text-caption">
											<span class="font-mono">{{ d.label }}</span>
										</div>
									</v-expansion-panel-text>
								</v-expansion-panel>
							</v-expansion-panels>
						</v-list>

						<v-list density="compact" class="bg-transparent mt-4">
							<v-list-subheader>Sync (Entity)</v-list-subheader>
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
							<v-list-item title="Error count" :subtitle="String(syncErrorCount)" :class="{ 'text-success': syncErrorCount === 0, 'text-error': syncErrorCount > 0 }" />
							<v-list-item title="Last error at" :subtitle="syncLastErrorAt" />
							<v-expansion-panels variant="accordion" density="compact" v-if="syncErrorCount > 0">
								<v-expansion-panel>
									<v-expansion-panel-title>Last error details</v-expansion-panel-title>
									<v-expansion-panel-text>
										<div class="text-caption">
											<div><strong>Source:</strong> <span class="font-mono">{{ syncLastErrorSource }}</span></div>
											<div class="mt-1"><strong>Message:</strong> <span class="font-mono">{{ syncLastErrorMessage }}</span></div>
										</div>
									</v-expansion-panel-text>
								</v-expansion-panel>
							</v-expansion-panels>
							<v-expansion-panels variant="accordion" density="compact" class="mt-1" v-if="(props.syncMetrics?.lastKeys?.length || 0) > 0">
								<v-expansion-panel>
									<v-expansion-panel-title>Last keys pushed</v-expansion-panel-title>
									<v-expansion-panel-text>
										<div v-for="k in (props.syncMetrics?.lastKeys || [])" :key="k" class="text-caption">
											<span class="font-mono">{{ k }}</span>
										</div>
									</v-expansion-panel-text>
								</v-expansion-panel>
							</v-expansion-panels>
							<v-expansion-panels variant="accordion" density="compact" class="mt-1" v-if="(props.syncMetrics?.lastEntries?.length || 0) > 0">
								<v-expansion-panel>
									<v-expansion-panel-title>
										Last entries (values + sizes) — total ~{{ lastEntriesTotalSizeKb.toFixed(2) }} KB
									</v-expansion-panel-title>
									<v-expansion-panel-text>
										<div v-for="e in lastEntries" :key="e.key" class="mb-2">
											<div class="d-flex align-center justify-space-between text-caption">
												<span class="font-mono">{{ e.key }}</span>
												<span>{{ e.sizeBytes }} bytes ({{ (e.sizeBytes/1024).toFixed(2) }} KB)</span>
											</div>
											<pre class="font-mono" style="white-space: pre-wrap; word-break: break-all; background: transparent;">{{ formatValue(e.value) }}</pre>
											<v-divider class="my-2" />
										</div>
									</v-expansion-panel-text>
								</v-expansion-panel>
							</v-expansion-panels>
						</v-list>

						<v-list density="compact" class="bg-transparent mt-4">
							<v-list-subheader>Blendshapes (Morph Targets)</v-list-subheader>
							<v-list-item :title="'Distinct targets'" :subtitle="String(morphTargets.length)" />
							<v-expansion-panels variant="accordion" density="compact" class="mt-1">
								<v-expansion-panel>
									<v-expansion-panel-title>Visemes overview</v-expansion-panel-title>
									<v-expansion-panel-text>
										<div v-for="v in supportedVisemeNames" :key="v" class="text-caption mb-1">
											<span class="font-mono" :class="{ 'text-success': hasMorph(v) }">{{ v }}</span>
											<v-progress-linear
												v-if="influenceOf(v) !== null"
												:height="6"
												:rounded="true"
												:striped="true"
												color="primary"
												:model-value="Math.round(100 * (influenceOf(v) || 0))"
												class="ml-2"
											/>
									</div>
									</v-expansion-panel-text>
								</v-expansion-panel>
								<v-expansion-panel>
									<v-expansion-panel-title>All targets (top 50 by avg influence)</v-expansion-panel-title>
									<v-expansion-panel-text>
										<div v-for="t in morphTargetsSorted.slice(0, 50)" :key="t.name" class="mb-1">
											<div class="d-flex align-center justify-space-between">
												<span class="font-mono">{{ t.name }}</span>
												<span class="text-caption">avg {{ t.avg.toFixed(3) }} — min {{ t.min.toFixed(3) }} — max {{ t.max.toFixed(3) }} (n={{ t.count }})</span>
											</div>
											<v-progress-linear :model-value="Math.round(100 * t.avg)" :height="6" color="secondary" rounded class="mt-1" />
										</div>
									</v-expansion-panel-text>
								</v-expansion-panel>
							</v-expansion-panels>
						</v-list>
					</v-col>
				</v-row>
			</v-card-text>
			<v-card-actions>
				<v-spacer />
				<v-btn variant="text" @click="open = false">Close</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import { computed, watch, ref, onMounted, onUnmounted } from "vue";
import type {
    Scene,
    TransformNode,
    Skeleton,
    AbstractMesh,
    Node,
    Camera,
} from "@babylonjs/core";
import type { ArcRotateCamera } from "@babylonjs/core";
import { useMagicKeys, whenever, useVModel, useIntervalFn } from "@vueuse/core";

type SyncMetrics = {
    entityName: string | null;
    queuedKeys: number;
    lastBatchCount: number;
    totalPushed: number;
    lastPushedAt: string | null;
    pushIntervalMs: number | null;
    avgPushesPerMinute: number;
    lastKeys: string[];
    lastBatchSizeKb: number;
    avgBatchSizeKb: number;
    avgBatchProcessTimeMs: number;
    // Error metrics from BabylonMyAvatarEntity
    errorCount: number;
    lastErrorAt: string | null;
    lastErrorMessage: string | null;
    lastErrorSource: string | null;
    // Detailed last entries with full values and per-entry sizes (bytes)
    lastEntries: { key: string; value: unknown; sizeBytes: number }[];
};

const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
    vircadiaWorld: { type: Object as () => unknown, required: true },
    avatarNode: {
        type: Object as () => TransformNode | null,
        required: false,
        default: null,
    },
    avatarSkeleton: {
        type: Object as () => Skeleton | null,
        required: false,
        default: null,
    },
    modelFileName: { type: String, required: false, default: null },
    modelStep: { type: String, required: false, default: null },
    modelError: { type: String, required: false, default: null },
    // Talking diagnostics
    isTalking: { type: Boolean, required: false, default: false },
    talkLevel: { type: Number, required: false, default: 0 },
    talkThreshold: { type: Number, required: false, default: 0 },
    audioInputDevices: {
        type: Array as () => { deviceId: string; label: string }[],
        required: false,
        default: () => [],
    },
    // Live debug state from avatar
    airborne: { type: Boolean, required: false, default: false },
    verticalVelocity: { type: Number, required: false, default: 0 },
    supportState: { type: Number, required: false, default: null },
    physicsEnabled: { type: Boolean, required: false, default: false },
    physicsPluginName: { type: String, required: false, default: null },
    physicsError: { type: String, required: false, default: null },
    hasTouchedGround: { type: Boolean, required: false, default: false },
    spawnSettling: { type: Boolean, required: false, default: false },
    groundProbeHit: { type: Boolean, required: false, default: false },
    groundProbeDistance: { type: Number, required: false, default: null },
    groundProbeMeshName: { type: String, required: false, default: null },
    // External control (v-model)
    modelValue: { type: Boolean, required: false, default: undefined },
    // Configurable hotkey (default "m")
    hotkey: { type: String, required: true },
    // Avatar entity sync metrics
    syncMetrics: {
        type: Object as () => SyncMetrics | null,
        required: false,
        default: null,
    },
});

const emit = defineEmits(["update:modelValue"]);
// Support external v-model while remaining fully backward-compatible
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

const modelReady = computed(
    () => !props.modelError && !!props.modelFileName && !!props.scene,
);
const talkLevelLabel = computed(() => props.talkLevel.toFixed(3));
const modelStateLabel = computed(() =>
    props.modelError ? "error" : modelReady.value ? "ready" : "loading or idle",
);
const verticalVelocityLabel = computed(() => props.verticalVelocity.toFixed(3));
const supportStateLabel = computed(() => {
    const s = props.supportState as unknown as number | null;
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
    props.groundProbeDistance === null
        ? "-"
        : props.groundProbeDistance.toFixed(3),
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
function formatValue(v: unknown): string {
    try {
        return JSON.stringify(v, null, 2);
    } catch {
        return String(v);
    }
}
// mark used in template
void verticalVelocityLabel;
void supportStateLabel;
void groundProbeDistanceLabel;
void syncEntityName;
void syncQueuedKeys;
void syncLastBatchCount;
void syncTotalPushed;
void syncPushesPerMinute;
void syncLastBatchSizeKb;
void syncAvgBatchSizeKb;
void syncAvgBatchProcessTimeMs;
void lastPushedAtLabel;
void pushIntervalLabel;
void syncErrorCount;
void syncLastErrorAt;
void syncLastErrorMessage;
void syncLastErrorSource;
void lastEntries;
void lastEntriesTotalSizeKb;
void formatValue;

function isUnderAvatarNode(
    mesh: AbstractMesh,
    root: TransformNode | null,
): boolean {
    if (!root) return false;
    let p: Node | null = mesh.parent;
    while (p) {
        if (p === root) return true;
        p = p.parent;
    }
    return false;
}

const meshesUnderAvatar = computed<AbstractMesh[]>(
    () =>
        (props.scene?.meshes.filter((m) =>
            isUnderAvatarNode(m as AbstractMesh, props.avatarNode),
        ) as AbstractMesh[]) || [],
);
const skinnedMeshesUnderAvatar = computed(() =>
    meshesUnderAvatar.value.filter(
        (m) =>
            m.skeleton &&
            (!props.avatarSkeleton || m.skeleton === props.avatarSkeleton),
    ),
);

const camera = computed<Camera | null>(() => props.scene?.activeCamera || null);
const cameraLabel = computed(() =>
    camera.value ? camera.value.name || "yes" : "no",
);
const cameraPositionLabel = computed(() => {
    const c = camera.value as ArcRotateCamera | null;
    if (!c) return "-";
    const p = c.position;
    return `x:${p.x.toFixed(2)} y:${p.y.toFixed(2)} z:${p.z.toFixed(2)}`;
});
const cameraTargetLabel = computed(() => {
    const c = camera.value as ArcRotateCamera | null;
    if (!c) return "-";
    const t = c.getTarget();
    if (!t) return "-";
    return `x:${t.x.toFixed(2)} y:${t.y.toFixed(2)} z:${t.z.toFixed(2)}`;
});

// Blendshape (morph target) diagnostics
type MorphTargetLike = { name: string; influence: number };
type MorphTargetManagerLike = {
    numTargets: number;
    getTarget: (index: number) => MorphTargetLike | null;
};

type TargetStat = {
    name: string;
    count: number;
    avg: number;
    min: number;
    max: number;
};

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

const morphTargets = ref<TargetStat[]>([]);

function snapshotMorphTargets(): TargetStat[] {
    const map = new Map<
        string,
        { sum: number; count: number; min: number; max: number }
    >();
    for (const m of meshesUnderAvatar.value) {
        const manager = (
            m as unknown as { morphTargetManager?: MorphTargetManagerLike }
        ).morphTargetManager;
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
    const out: TargetStat[] = [];
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
});
onUnmounted(() => {
    pauseSnapshot();
});

const morphTargetsSorted = computed(() =>
    [...morphTargets.value].sort(
        (a, b) => b.avg - a.avg || a.name.localeCompare(b.name),
    ),
);

function hasMorph(name: string): boolean {
    for (const t of morphTargets.value) {
        if (t.name === name) return true;
    }
    return false;
}
function influenceOf(name: string): number | null {
    for (const t of morphTargets.value) {
        if (t.name === name) return t.avg;
    }
    return null;
}

// Auto-open briefly if an error occurs
watch(
    () => props.modelError,
    (err) => {
        if (err) open.value = true;
    },
);
// mark used in template
void modelStateLabel;
void skinnedMeshesUnderAvatar;
void cameraLabel;
void cameraPositionLabel;
void cameraTargetLabel;
void hotkeyLabel;
void talkLevelLabel;
void morphTargets;
void morphTargetsSorted;
void supportedVisemeNames;
void hasMorph;
void influenceOf;
</script>

<style scoped>
.font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
</style>


