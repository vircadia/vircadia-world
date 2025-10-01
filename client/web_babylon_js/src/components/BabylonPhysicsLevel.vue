<template>
    <!-- Renderless level loader with built-in physics application -->
    <slot :meshes="loadedMeshes" :def="def"></slot>
</template>

<script setup lang="ts">
import type { AbstractMesh, Mesh, Scene } from "@babylonjs/core";
import {
    HingeConstraint,
    ImportMeshAsync,
    PhysicsAggregate,
    PhysicsShapeType,
    Vector3,
} from "@babylonjs/core";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import "@babylonjs/loaders/glTF";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";
import type { BabylonModelDefinition } from "@/schemas";

const props = defineProps<{
    scene: Scene;
    vircadiaWorld: VircadiaWorldInstance;
    entityName: string;
    modelFileName: string;
    enablePhysics: boolean;
    physicsType: "box" | "convexHull" | "mesh";
    physicsOptions?: {
        mass?: number;
        friction?: number;
        restitution?: number;
        isKinematic?: boolean;
    };
}>();

const loadedMeshes = ref<AbstractMesh[]>([]);
const physicsAggregates = ref<PhysicsAggregate[]>([]);

const meshesArray = computed(() => loadedMeshes.value as AbstractMesh[]);

const def = computed<BabylonModelDefinition>(() => ({
    entityName: props.entityName,
    fileName: props.modelFileName,
    entityType: "Model",
    enablePhysics: props.enablePhysics,
    physicsType: props.physicsType,
    physicsOptions: props.physicsOptions,
}));

function extensionFromFileName(fileName: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase();
    switch (ext) {
        case "glb":
            return ".glb";
        case "gltf":
            return ".gltf";
        case "fbx":
            return ".fbx";
        default:
            return "";
    }
}

async function loadLevel(): Promise<void> {
    if (!props.scene || !props.modelFileName) return;

    // Dispose previous meshes
    for (const m of loadedMeshes.value) {
        try {
            m.dispose(false, true);
        } catch { }
    }
    loadedMeshes.value = [];
    // Dispose previous physics
    for (const agg of physicsAggregates.value) {
        try {
            agg.dispose();
        } catch { }
    }
    physicsAggregates.value = [];
    // Build direct asset URL with auth/session query params
    const directUrl = props.vircadiaWorld.client.buildAssetRequestUrl(
        props.modelFileName,
    );
    const result = await ImportMeshAsync(directUrl, props.scene, {
        pluginExtension: extensionFromFileName(props.modelFileName),
    });

    const meshes = (result.meshes as AbstractMesh[]) || [];
    // Record loaded meshes; they will be passed to BabylonModelPhysics via template
    loadedMeshes.value = meshes;

    // Apply custom physics makeup to match BabylonExamplePhysicsController.ts
    try {
        applyCustomPhysics();
    } catch (e) {
        console.error(
            "[BabylonPhysicsLevel] Failed to apply custom physics:",
            e,
        );
    }
}

onMounted(async () => {
    try {
        await loadLevel();
    } catch (e) {
        console.error("[BabylonPhysicsLevel] Failed to load level:", e);
    }
});

watch(
    () => [props.modelFileName, props.scene] as const,
    async () => {
        try {
            await loadLevel();
        } catch (e) {
            console.error("[BabylonPhysicsLevel] Reload failed:", e);
        }
    },
);

onUnmounted(() => {
    for (const m of loadedMeshes.value) {
        try {
            m.dispose(false, true);
        } catch { }
    }
    loadedMeshes.value = [];
    for (const agg of physicsAggregates.value) {
        try {
            agg.dispose();
        } catch { }
    }
    physicsAggregates.value = [];
});

defineExpose({ def, loadedMeshes });

function addAggregateIfMesh(
    mesh: unknown,
    shape: PhysicsShapeType,
    options: { mass: number; friction?: number; restitution?: number },
): void {
    if (!mesh) return;
    const abs = mesh as AbstractMesh;
    const getClassName = (abs as { getClassName?: () => string } | null)
        ?.getClassName;
    const isMesh =
        typeof getClassName === "function" && getClassName.call(abs) === "Mesh";
    if (!isMesh) return;
    const asMesh = abs as unknown as Mesh;
    try {
        const agg = new PhysicsAggregate(asMesh, shape, options, props.scene);
        physicsAggregates.value.push(agg);
    } catch (e) {
        const name = (abs as { name?: string } | null)?.name;
        console.warn(
            "[BabylonPhysicsLevel] Failed to add aggregate for",
            name,
            e,
        );
    }
}

function applyCustomPhysics(): void {
    if (!props.enablePhysics) return;
    const s = props.scene;
    if (!s.getPhysicsEngine?.()) {
        console.warn(
            "[BabylonPhysicsLevel] Physics engine not ready; skipping custom physics",
        );
        return;
    }

    const friction = props.physicsOptions?.friction ?? 0.5;
    const restitution = props.physicsOptions?.restitution ?? 0.3;

    // 1) Static level meshes with mesh collider
    const lightmapped = [
        "level_primitive0",
        "level_primitive1",
        "level_primitive2",
    ];
    let createdAggregates = 0;
    for (const name of lightmapped) {
        const mesh = s.getMeshByName(name) as AbstractMesh | null;
        addAggregateIfMesh(mesh, PhysicsShapeType.MESH, {
            mass: 0,
            friction,
            restitution,
        });
        if (mesh) {
            mesh.isPickable = false;
            createdAggregates++;
        }
    }

    // 2) Static physics cubes (light props mass: 0.1, box shape)
    const cubes = [
        "Cube",
        "Cube.001",
        "Cube.002",
        "Cube.003",
        "Cube.004",
        "Cube.005",
    ];
    for (const name of cubes) {
        const mesh = s.getMeshByName(name) as AbstractMesh | null;
        addAggregateIfMesh(mesh, PhysicsShapeType.BOX, {
            mass: 0.1,
            friction,
            restitution,
        });
        if (mesh) createdAggregates++;
    }

    // 3) Inclined plane with hinge constraint
    const planeMesh = s.getMeshByName("Cube.006") as AbstractMesh | null;
    if (planeMesh && (planeMesh as Mesh).scaling) {
        // match example scaling
        (planeMesh as Mesh).scaling.set(0.03, 3, 1);
    }

    const fixedMassMesh = s.getMeshByName("Cube.007") as AbstractMesh | null;
    let fixedMassAgg: PhysicsAggregate | null = null;
    let planeAgg: PhysicsAggregate | null = null;

    if (fixedMassMesh) {
        try {
            fixedMassAgg = new PhysicsAggregate(
                fixedMassMesh as Mesh,
                PhysicsShapeType.BOX,
                { mass: 0, friction, restitution },
                s,
            );
            physicsAggregates.value.push(fixedMassAgg);
        } catch (e) {
            console.warn(
                "[BabylonPhysicsLevel] Failed to create fixed mass aggregate",
                e,
            );
        }
    }
    if (planeMesh) {
        try {
            planeAgg = new PhysicsAggregate(
                planeMesh as Mesh,
                PhysicsShapeType.BOX,
                { mass: 0.1, friction, restitution },
                s,
            );
            physicsAggregates.value.push(planeAgg);
        } catch (e) {
            console.warn(
                "[BabylonPhysicsLevel] Failed to create plane aggregate",
                e,
            );
        }
    }

    if (
        fixedMassAgg?.body &&
        planeAgg?.body &&
        typeof HingeConstraint === "function"
    ) {
        try {
            const joint = new HingeConstraint(
                new Vector3(0.75, 0, 0),
                new Vector3(-0.25, 0, 0),
                new Vector3(0, 0, -1),
                new Vector3(0, 0, 1),
                s,
            );
            fixedMassAgg.body.addConstraint(planeAgg.body, joint);
        } catch (e) {
            console.warn(
                "[BabylonPhysicsLevel] Failed to create hinge constraint",
                e,
            );
        }
    }

    // Fallback: if we didn't create any aggregates (names differ), attach mesh colliders to all meshes
    if (createdAggregates === 0) {
        for (const m of loadedMeshes.value) {
            // Skip utility/root meshes
            if (
                m.name.includes("__root__") ||
                m.name.includes("__point__") ||
                m.name.includes("lightmapData")
            )
                continue;
            addAggregateIfMesh(m, PhysicsShapeType.MESH, {
                mass: 0,
                friction,
                restitution,
            });
        }
    }
}
</script>
