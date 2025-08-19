<template>
    <div v-if="visible" class="camera-debug">
        <div class="row">
            <strong>Active</strong>
            <span>{{ activeName }}</span>
        </div>
        <div class="row"><strong>Type</strong><span>{{ activeType }}</span></div>
        <div class="row"><strong>Pos</strong><span>{{ cameraPosition }}</span></div>
        <div class="row"><strong>Target</strong><span>{{ cameraTarget }}</span></div>
        <div class="row"><strong>Locked</strong><span>{{ lockedTarget }}</span></div>
        <div class="row" v-if="isArcRotate">
            <strong>α/β/r</strong>
            <span>{{ alphaBetaRadius }}</span>
        </div>
        <div class="row"><strong>Inputs</strong><span>{{ attachedInputs }}</span></div>
        <div class="buttons">
            <button @click="makeActive">Make Active</button>
            <button @click="recenterOnAvatar">Recenter</button>
            <button @click="relockToAvatar">Relock</button>
        </div>
        <details>
            <summary>All cameras ({{ allCameras.length }})</summary>
            <ul>
                <li v-for="c in allCameras" :key="c.name">
                    <code>{{ c.name }}</code>
                    <span> — {{ c.type }}</span>
                    <span v-if="c.isActive"> (active)</span>
                </li>
            </ul>
        </details>
    </div>
    
</template>

<script setup lang="ts">
import { computed } from "vue";
import type {
    Scene,
    Camera,
    ArcRotateCamera,
    AbstractMesh,
    TransformNode,
    Vector3 as V3,
} from "@babylonjs/core";

const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
    avatarNode: {
        type: Object as () => TransformNode | AbstractMesh | null,
        required: false,
        default: null,
    },
    visible: { type: Boolean, default: true },
});

function getActive(): Camera | null {
    return props.scene?.activeCamera ?? null;
}

const activeName = computed(() => getActive()?.name || "-");
const activeType = computed(() => getActive()?.getClassName() || "-");
const isArcRotate = computed(() =>
    (getActive()?.getClassName?.() || "").includes("ArcRotateCamera"),
);

const cameraPosition = computed(() => {
    const c = getActive();
    const p = c?.position as V3 | undefined;
    if (!p) return "-";
    return `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`;
});

const cameraTarget = computed(() => {
    const c = getActive() as unknown as { getTarget?: () => V3 } | null;
    const t = c?.getTarget?.();
    if (!t) return "-";
    return `${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)}`;
});

const lockedTarget = computed(() => {
    const c = getActive() as unknown as { lockedTarget?: unknown } | null;
    const lt = c?.lockedTarget as
        | (AbstractMesh | TransformNode | null)
        | undefined;
    const name = (lt && (lt as any).name) || null;
    return name || "-";
});

const alphaBetaRadius = computed(() => {
    const c = getActive() as ArcRotateCamera | null;
    if (!c || !isArcRotate.value) return "-";
    return `${c.alpha.toFixed(2)} / ${c.beta.toFixed(2)} / ${c.radius.toFixed(2)}`;
});

const attachedInputs = computed(() => {
    const c = getActive() as unknown as {
        inputs?: { attached?: Record<string, unknown> };
    } | null;
    const keys = c?.inputs?.attached ? Object.keys(c.inputs.attached) : [];
    return keys.length ? keys.join(", ") : "none";
});

const allCameras = computed(() => {
    return (props.scene?.cameras || []).map((c) => ({
        name: c.name,
        type: c.getClassName?.() || c.constructor?.name || "Camera",
        isActive: c === props.scene.activeCamera,
    }));
});

function resolveAvatarMesh(): AbstractMesh | null {
    const node = props.avatarNode;
    if (!node) return null;
    const asMesh = node as AbstractMesh;
    if (typeof (asMesh as any).isVerticesDataPresent === "function")
        return asMesh;
    // Try to find the capsule child
    const children = (node as any).getChildMeshes?.(true) as
        | AbstractMesh[]
        | undefined;
    const capsule =
        children?.find((m) => m.name === "avatarCapsule") ||
        children?.[0] ||
        null;
    return capsule || null;
}

function relockToAvatar(): void {
    const active = getActive() as unknown as {
        lockedTarget?: AbstractMesh | TransformNode | null;
    } | null;
    if (!active) return;
    const mesh = resolveAvatarMesh();
    if (mesh) (active as any).lockedTarget = mesh;
}

function recenterOnAvatar(): void {
    const active = getActive() as ArcRotateCamera | null;
    const mesh = resolveAvatarMesh();
    if (!active || !mesh) return;
    // Move target to avatar and keep current alpha/beta/radius
    active.setTarget(mesh.getAbsolutePosition());
}

function makeActive(): void {
    const active = getActive();
    if (!active) return;
    props.scene.activeCamera = active;
    const canvas = props.scene.getEngine().getRenderingCanvas();
    if (canvas && (active as any).attachControl) {
        try {
            (active as any).attachControl(canvas, true);
        } catch {}
    }
}
</script>

<style scoped>
.camera-debug {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 1100;
    background: rgba(0,0,0,0.6);
    color: #fff;
    padding: 10px 12px;
    border-radius: 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 12px;
    line-height: 1.4;
    max-width: 360px;
}
.row { display: flex; gap: 8px; justify-content: space-between; }
.row + .row { margin-top: 4px; }
.buttons { display: flex; gap: 8px; margin-top: 8px; }
button { background: #2e7d32; color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; }
button:hover { background: #1b5e20; }
summary { cursor: pointer; margin-top: 8px; }
ul { margin: 6px 0 0 0; padding-left: 16px; }
li { margin: 2px 0; }
</style>


