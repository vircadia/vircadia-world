<template>
	<v-dialog v-model="open" max-width="720">
		<template #activator="{ props: activatorProps }">
			<!-- Optional anchor button for mouse users -->
			<v-btn v-bind="activatorProps" size="small" variant="text" icon="mdi-bug-outline" class="ma-2" />
		</template>
		<v-card>
			<v-card-title class="d-flex align-center justify-space-between">
				<span>Avatar Debug</span>
				<v-chip size="x-small" color="primary" label>Shift + A</v-chip>
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
import { computed, watch } from "vue";
import type {
    Scene,
    TransformNode,
    Skeleton,
    AbstractMesh,
    Node,
    Camera,
} from "@babylonjs/core";
import type { ArcRotateCamera } from "@babylonjs/core";
import { useMagicKeys, whenever, useVModel } from "@vueuse/core";

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
    // External control (v-model)
    modelValue: { type: Boolean, required: false, default: undefined },
});

const emit = defineEmits(["update:modelValue"]);
// Support external v-model while remaining fully backward-compatible
const open = useVModel(props, "modelValue", emit, {
    passive: true,
    defaultValue: false,
});
const keys = useMagicKeys();
whenever(keys["Shift+A"], () => {
    open.value = !open.value;
});

const modelReady = computed(
    () => !props.modelError && !!props.modelFileName && !!props.scene,
);
const modelStateLabel = computed(() =>
    props.modelError ? "error" : modelReady.value ? "ready" : "loading or idle",
);

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
</script>

<style scoped>
.font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
</style>


