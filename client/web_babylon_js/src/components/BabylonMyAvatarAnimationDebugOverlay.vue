<template>
	<v-dialog v-model="open" max-width="720">
		<v-card>
			<v-card-title class="d-flex align-center justify-space-between">
				<span>Animation Debug</span>
				<v-chip size="x-small" color="primary" label>{{ hotkeyLabel }}</v-chip>
			</v-card-title>
			<v-card-text>
				<v-list density="compact" class="bg-transparent">
					<v-list-subheader>Primary Groups</v-list-subheader>
					<v-list-item title="Idle ready" :subtitle="boolLabel(animData.idle.ready)" />
					<v-list-item title="Walk ready" :subtitle="boolLabel(animData.walk.ready)" />
					<v-list-item title="Blend weight" :subtitle="animData.blendWeight.toFixed(2)" />
				</v-list>
				<v-divider class="my-3" />
				<v-list density="compact" class="bg-transparent">
					<v-list-subheader>All Animations</v-list-subheader>
					<div class="mono text-caption">
						<div v-for="(row, idx) in animData.animations" :key="idx">{{ row.fileName }} — {{ row.state }}</div>
					</div>
				</v-list>
				<v-divider class="my-3" />
				<v-list density="compact" class="bg-transparent">
					<v-list-subheader>Last Loader Events</v-list-subheader>
					<div class="mono text-caption">
						<div v-for="(line, idx) in animData.events.slice(-15)" :key="idx">{{ line }}</div>
					</div>
				</v-list>
			</v-card-text>
			<v-card-actions>
				<v-spacer />
				<v-btn variant="text" @click="open = false">Close</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useMagicKeys, whenever, useVModel } from "@vueuse/core";

type AnimRow = { fileName: string; state: string };
type AnimData = {
    idle: { ready: boolean };
    walk: { ready: boolean };
    blendWeight: number;
    events: string[];
    animations: AnimRow[];
};

const props = defineProps({
    modelValue: { type: Boolean, required: false, default: undefined },
    // Configurable hotkey (e.g., "Shift+B", "n")
    hotkey: { type: String, required: true },
});
const emit = defineEmits(["update:modelValue"]);
const open = useVModel(props, "modelValue", emit, {
    passive: true,
    defaultValue: false,
});
const keys = useMagicKeys();
const hotkeyPressed = computed<boolean>(() => {
    const map = keys as unknown as Record<
        string,
        { value: boolean } | undefined
    >;
    const r = map[props.hotkey];
    return !!r?.value;
});
whenever(hotkeyPressed, () => {
    open.value = !open.value;
});

const hotkeyLabel = computed(() => props.hotkey.replace("+", " + "));

const animData = ref<AnimData>({
    idle: { ready: false },
    walk: { ready: false },
    blendWeight: 0,
    events: [],
    animations: [],
});

interface DebugWindow extends Window {
    __debugMyAvatarAnimation?: () => AnimData | null;
}

let timer: number | null = null;

function poll() {
    const w = window as DebugWindow;
    if (typeof w.__debugMyAvatarAnimation === "function") {
        const data = w.__debugMyAvatarAnimation();
        if (data) animData.value = data;
    }
}

function boolLabel(v: boolean) {
    return v ? "yes" : "no";
}

onMounted(() => {
    timer = window.setInterval(poll, 250);
});
onUnmounted(() => {
    if (timer) window.clearInterval(timer);
});
// used in template
void boolLabel;
void hotkeyLabel;
</script>

<style scoped>
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
</style>


