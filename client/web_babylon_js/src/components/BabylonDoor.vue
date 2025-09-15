<template>
	<!-- Renderless component; interacts with Babylon scene and DB -->
	<slot
		:isLoading="isLoading"
		:isOpen="isOpen"
		:toggle="toggleDoor"
	/>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import type {
    Scene,
    AbstractMesh,
    Skeleton,
    Observer,
    PointerInfo,
    Node as BabylonNode,
} from "@babylonjs/core";
import {
    ImportMeshAsync,
    TransformNode,
    PointerEventTypes,
    Quaternion,
    Vector3,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { useAsset, type useVircadia } from "@vircadia/world-sdk/browser/vue";

type QuaternionJson = { x: number; y: number; z: number; w: number };
type PositionJson = { x: number; y: number; z: number };

const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
    vircadiaWorld: {
        type: Object as () => ReturnType<typeof useVircadia>,
        required: true,
    },
    entityName: { type: String, required: true },
    modelFileName: {
        type: String,
        required: true,
    },
    initialPosition: {
        type: Object as () => PositionJson,
        required: false,
        default: () => ({ x: 0, y: 0, z: 0 }),
    },
    initialRotation: {
        type: Object as () => QuaternionJson,
        required: false,
        default: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    },
    initialOpen: { type: Boolean, required: false, default: false },
    rotationOpenRadians: {
        type: Number,
        required: false,
        default: Math.PI / 2,
    },
    rotationAxis: {
        type: String as () => "x" | "y" | "z",
        required: false,
        default: "y",
    },
    pivotOffset: {
        type: Object as () => PositionJson,
        required: false,
        default: () => ({ x: 0, y: 0, z: 0 }),
    },
    syncIntervalMs: { type: Number, required: false, default: 100 },
    updateThrottleMs: { type: Number, required: false, default: 100 },
});

const emit = defineEmits<{
    state: [
        payload: {
            state: "loading" | "ready" | "error";
            step: string;
            message?: string;
            details?: Record<string, unknown>;
        },
    ];
    open: [payload: { open: boolean }];
}>();

const isLoading = ref(false);
const isOpen = ref<boolean>(props.initialOpen);
const hasLoaded = ref(false);
const rootNode = ref<TransformNode | null>(null);
const loadedMeshes = ref<AbstractMesh[]>([]);
const targetSkeleton = ref<Skeleton | null>(null);
const lastPushedAt = ref<number>(0);
let pointerObserver: Observer<PointerInfo> | null = null;
let syncTimer: number | null = null;
let intersectionObserver: Observer<Scene> | null = null;
const wasIntersecting = ref(false);
let cachedAvatarCapsule: AbstractMesh | null = null;
const exitHoldMs = 400;
let outSince: number | null = null;
let manualUntilNextIntersection = false;
type ToggleSource = "manual" | "auto";

console.debug("[BabylonDoor] Component setup started", {
    entityName: props.entityName,
    modelFileName: props.modelFileName,
    hasScene: !!props.scene,
    hasVircadiaWorld: !!props.vircadiaWorld,
});

console.debug("[BabylonDoor] Initial state", {
    isOpen: isOpen.value,
    initialOpen: props.initialOpen,
    entityName: props.entityName,
});

// Asset loader setup
const modelFileNameRef = computed(() => props.modelFileName);
const asset = useAsset({
    fileName: modelFileNameRef,
    useCache: true,
    debug: false,
    instance: props.vircadiaWorld,
});

function getDoorRotationRadians(open: boolean): number {
    return open ? props.rotationOpenRadians : 0;
}

function applyOpenRotation(open: boolean) {
    const node = rootNode.value;
    if (!node) return;
    node.rotationQuaternion = null; // use Euler for easy hinge rotation
    const radians = getDoorRotationRadians(open);
    if (props.rotationAxis === "x") node.rotation.x = radians;
    if (props.rotationAxis === "y") node.rotation.y = radians;
    if (props.rotationAxis === "z") node.rotation.z = radians;
}

function applyTransform(position: PositionJson, rotation: QuaternionJson) {
    const node = rootNode.value;
    if (!node) return;
    // Base pose from metadata
    node.position.set(position.x, position.y, position.z);
    node.rotationQuaternion = new Quaternion(
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w,
    );
    // Overwrite with open angle around chosen axis
    applyOpenRotation(isOpen.value);
}

async function ensureEntityAndMetadata() {
    const instance = props.vircadiaWorld;
    const name = props.entityName;
    await instance.client.Utilities.Connection.query({
        query: "INSERT INTO entity.entities (general__entity_name, group__sync) VALUES ($1, 'public.REALTIME') ON CONFLICT (general__entity_name) DO NOTHING",
        parameters: [name],
        timeoutMs: 5000,
    });
    // Upsert metadata: type, modelFileName, position, rotation, open
    await instance.client.Utilities.Connection.query({
        query: `
			INSERT INTO entity.entity_metadata (general__entity_name, metadata__key, metadata__value, group__sync)
			VALUES
				($1, 'type', '"Door"'::jsonb, 'public.REALTIME'),
				($1, 'modelFileName', to_jsonb($2::text), 'public.REALTIME'),
				($1, 'position', to_jsonb($3::json), 'public.REALTIME'),
				($1, 'rotation', to_jsonb($4::json), 'public.REALTIME'),
				($1, 'open', to_jsonb($5::boolean), 'public.REALTIME')
			ON CONFLICT (general__entity_name, metadata__key)
			DO UPDATE SET metadata__value = EXCLUDED.metadata__value, group__sync = EXCLUDED.group__sync
		`,
        parameters: [
            name,
            props.modelFileName,
            JSON.stringify(props.initialPosition),
            JSON.stringify(props.initialRotation),
            props.initialOpen,
        ],
        timeoutMs: 5000,
    });
}

async function fetchMetadata(): Promise<{
    position: PositionJson;
    rotation: QuaternionJson;
    open: boolean;
}> {
    const instance = props.vircadiaWorld;
    const name = props.entityName;
    const res = await instance.client.Utilities.Connection.query({
        query: "SELECT metadata__key, metadata__value FROM entity.entity_metadata WHERE general__entity_name = $1 AND metadata__key IN ('position','rotation','open')",
        parameters: [name],
        timeoutMs: 3000,
    });
    const meta = new Map<string, unknown>();
    if (Array.isArray(res.result)) {
        for (const row of res.result as {
            metadata__key: string;
            metadata__value: unknown;
        }[]) {
            meta.set(row.metadata__key, row.metadata__value);
        }
    }
    const position =
        (meta.get("position") as PositionJson) || props.initialPosition;
    const rotation =
        (meta.get("rotation") as QuaternionJson) || props.initialRotation;
    const open = (meta.get("open") as boolean) ?? props.initialOpen;
    return { position, rotation, open };
}

async function pushState(open: boolean) {
    const now = Date.now();
    if (now - lastPushedAt.value < props.updateThrottleMs) return;
    lastPushedAt.value = now;
    const node = rootNode.value;
    if (!node) return;
    const baseRotationQ = node.rotationQuaternion
        ? node.rotationQuaternion
        : Quaternion.FromEulerAngles(
              node.rotation.x,
              node.rotation.y,
              node.rotation.z,
          );
    await props.vircadiaWorld.client.Utilities.Connection.query({
        query: `
			INSERT INTO entity.entity_metadata (general__entity_name, metadata__key, metadata__value, group__sync)
			VALUES
				($1, 'open', to_jsonb($2::boolean), 'public.REALTIME'),
				($1, 'rotation', to_jsonb($3::json), 'public.REALTIME')
			ON CONFLICT (general__entity_name, metadata__key)
			DO UPDATE SET metadata__value = EXCLUDED.metadata__value, group__sync = EXCLUDED.group__sync
		`,
        parameters: [
            props.entityName,
            open,
            JSON.stringify({
                x: baseRotationQ.x,
                y: baseRotationQ.y,
                z: baseRotationQ.z,
                w: baseRotationQ.w,
            }),
        ],
        timeoutMs: 3000,
    });
}

async function loadAndAttach() {
    if (!props.scene || !props.modelFileName) {
        emit("state", {
            state: "error",
            step: "validation",
            message: "Missing scene or model file name",
        });
        return;
    }

    isLoading.value = true;
    try {
        // Dispose any previous instance to avoid duplicates
        if (rootNode.value) {
            try {
                rootNode.value.dispose();
            } catch {}
            rootNode.value = null;
        }
        await ensureEntityAndMetadata();
        const meta = await fetchMetadata();
        isOpen.value = !!meta.open;

        emit("state", { state: "loading", step: "assetLoad:start" });
        await asset.executeLoad();
        const blobUrl = asset.assetData.value?.blobUrl;
        if (!blobUrl) throw new Error("No blobUrl from asset loader");

        const result = await ImportMeshAsync(blobUrl, props.scene, {
            pluginExtension: asset.fileExtension.value,
        });

        // Root to parent imported meshes and control hinge rotation
        const node = new TransformNode(
            `${props.entityName}__root`,
            props.scene,
        );
        rootNode.value = node;

        // Apply pivot offset if provided
        const p = props.pivotOffset;
        node.setPivotPoint(new Vector3(p.x, p.y, p.z));

        // Attach only top-level nodes (transform nodes and meshes) and ensure meshes are pickable
        const meshes = result.meshes as AbstractMesh[];
        const transformNodes = result.transformNodes ?? [];
        loadedMeshes.value = meshes;
        for (const mesh of meshes) {
            mesh.isPickable = true;
        }
        for (const t of transformNodes) {
            if (!t.parent) t.parent = node;
        }
        for (const mesh of meshes) {
            if (!mesh.parent) mesh.parent = node;
        }
        // Tag nodes for reliable identification during picking
        for (const t of transformNodes) {
            const tn = t as TransformNode;
            const existing =
                tn.metadata && typeof tn.metadata === "object"
                    ? (tn.metadata as Record<string, unknown>)
                    : ({} as Record<string, unknown>);
            tn.metadata = {
                ...existing,
                entityName: props.entityName,
                entityType: "Door",
            };
        }
        for (const mesh of meshes) {
            const m = mesh as AbstractMesh;
            const existing =
                m.metadata && typeof m.metadata === "object"
                    ? (m.metadata as Record<string, unknown>)
                    : ({} as Record<string, unknown>);
            m.metadata = {
                ...existing,
                entityName: props.entityName,
                entityType: "Door",
            };
        }
        node.computeWorldMatrix(true);
        for (const mesh of meshes) mesh.computeWorldMatrix(true);

        // Skeleton capture (not strictly needed for door)
        if (result.skeletons.length > 0) {
            targetSkeleton.value = result.skeletons[0] as Skeleton;
        }

        // Apply transform from metadata and open state
        applyTransform(meta.position, meta.rotation);
        applyOpenRotation(isOpen.value);

        hasLoaded.value = true;
        emit("state", { state: "ready", step: "complete" });
    } catch (e) {
        console.error("[BabylonDoor] loadAndAttach error", e);
        emit("state", {
            state: "error",
            step: "loadAndAttach",
            message: e instanceof Error ? e.message : String(e),
        });
    } finally {
        isLoading.value = false;
    }
}

function isPickedDoorMesh(picked: AbstractMesh | null | undefined): boolean {
    if (!picked || !rootNode.value) return false;
    if (picked === rootNode.value) return true;
    // Also allow identification via metadata tags
    const metaUnknown = (picked as AbstractMesh).metadata as unknown;
    if (metaUnknown && typeof metaUnknown === "object") {
        const meta = metaUnknown as {
            entityName?: unknown;
            entityType?: unknown;
        };
        const matchesName =
            typeof meta.entityName === "string" &&
            meta.entityName === props.entityName;
        const matchesType =
            typeof meta.entityType === "string" && meta.entityType === "Door";
        if (matchesName || matchesType) return true;
    }
    return picked.isDescendantOf(rootNode.value as unknown as BabylonNode);
}

async function toggleDoor(source: ToggleSource = "manual") {
    const next = !isOpen.value;
    isOpen.value = next;
    applyOpenRotation(next);
    await pushState(next);
    if (source === "manual") {
        manualUntilNextIntersection = true;
    }
    emit("open", { open: isOpen.value });
}

function setupPointerPick() {
    if (!props.scene) return;
    if (pointerObserver) return;
    pointerObserver = props.scene.onPointerObservable.add(async (info) => {
        try {
            if (info.type !== PointerEventTypes.POINTERDOWN) return;
            const picked = info.pickInfo?.pickedMesh as
                | AbstractMesh
                | undefined;
            if (picked) {
                console.debug("[BabylonDoor] pointerdown", {
                    picked: picked.name,
                    isDoor: isPickedDoorMesh(picked),
                    metadata: (picked as AbstractMesh).metadata,
                });
            }
            if (!isPickedDoorMesh(picked)) return;
            await toggleDoor("manual");
        } catch (e) {
            console.error("[BabylonDoor] Pointer handler error", e);
        }
    }, PointerEventTypes.POINTERDOWN);
}

function startSyncTimer() {
    if (syncTimer) return;
    syncTimer = window.setInterval(async () => {
        try {
            // Push (throttled) then fetch authoritative state
            await pushState(isOpen.value);
            const latest = await fetchMetadata();
            // Apply only if differs
            if (!manualUntilNextIntersection && latest.open !== isOpen.value) {
                isOpen.value = !!latest.open;
                applyOpenRotation(isOpen.value);
            }
            applyTransform(latest.position, latest.rotation);
        } catch (_e) {
            // Keep syncing; ignored
        }
    }, props.syncIntervalMs);
}

function stopSyncTimer() {
    if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
    }
}

function resolveAvatarCapsule(): AbstractMesh | null {
    if (cachedAvatarCapsule && !cachedAvatarCapsule.isDisposed())
        return cachedAvatarCapsule;
    const found = props.scene.getMeshByName(
        "avatarCapsule",
    ) as AbstractMesh | null;
    if (found) cachedAvatarCapsule = found;
    return cachedAvatarCapsule;
}

function setupIntersectionCheck() {
    if (!props.scene) return;
    if (intersectionObserver) return;
    intersectionObserver = props.scene.onBeforeRenderObservable.add(
        async () => {
            try {
                if (!rootNode.value || loadedMeshes.value.length === 0) return;
                const capsule = resolveAvatarCapsule();
                if (!capsule) return;
                let isIntersecting = false;
                for (const mesh of loadedMeshes.value) {
                    if (mesh.isDisposed()) continue;
                    if (!mesh.isEnabled() || !mesh.isVisible) continue;
                    if (mesh.intersectsMesh(capsule, true)) {
                        isIntersecting = true;
                        break;
                    }
                }

                // Hysteresis with manual override: open immediately on entry (enables auto),
                // and close only after stable exit if the door was auto-opened
                if (isIntersecting) {
                    outSince = null;
                    // manual lock ends as soon as avatar intersects the door region
                    if (manualUntilNextIntersection)
                        manualUntilNextIntersection = false;
                    if (!isOpen.value) {
                        await toggleDoor("auto");
                    }
                } else {
                    if (outSince == null) outSince = Date.now();
                    if (
                        isOpen.value &&
                        outSince &&
                        Date.now() - outSince >= exitHoldMs
                    ) {
                        // Only auto-close if not under manual lock and last change was auto-triggered.
                        if (!manualUntilNextIntersection) {
                            await toggleDoor("auto");
                        }
                        // reset to avoid repeated close attempts
                        outSince = null;
                    }
                }

                wasIntersecting.value = isIntersecting;
            } catch (_e) {
                // ignore and continue
            }
        },
    );
}

function teardownIntersectionCheck() {
    if (props.scene && intersectionObserver) {
        props.scene.onBeforeRenderObservable.remove(intersectionObserver);
        intersectionObserver = null;
    }
}

onMounted(async () => {
    await loadAndAttach();
    setupPointerPick();
    setupIntersectionCheck();
    startSyncTimer();
});

onUnmounted(() => {
    stopSyncTimer();
    teardownIntersectionCheck();
    if (props.scene && pointerObserver) {
        props.scene.onPointerObservable.remove(pointerObserver);
        pointerObserver = null;
    }
    asset.cleanup();
    if (rootNode.value) {
        rootNode.value.dispose();
        rootNode.value = null;
    }
});

// React to model file changes (rare for door)
watch(
    () => props.modelFileName,
    async () => {
        await loadAndAttach();
    },
);

defineExpose({ isLoading, isOpen, toggleDoor, rootNode });
</script>

<style scoped>
/* renderless */
</style>


