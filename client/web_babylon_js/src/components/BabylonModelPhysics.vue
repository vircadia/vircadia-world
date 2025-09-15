<template>
  <!-- Renderless physics applier for a model's meshes -->
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch, ref } from "vue";
import type { Scene, AbstractMesh } from "@babylonjs/core";
import { PhysicsAggregate, PhysicsShapeType } from "@babylonjs/core";
import type { BabylonModelDefinition } from "../composables/schemas";

const props = defineProps<{
    scene: Scene;
    meshes: AbstractMesh[];
    def: BabylonModelDefinition;
}>();

export type PhysicsSummary = {
    entityId: string;
    enablePhysics: boolean;
    aggregatesCount: number;
    shapeType: "MESH" | "BOX" | "CONVEX_HULL";
    mass: number;
    friction: number;
    restitution: number;
    includedMeshNames: string[];
    skippedMeshNames: string[];
};

const emit = defineEmits<{
    (e: "state", payload: PhysicsSummary): void;
}>();

const physicsAggregates = ref<PhysicsAggregate[]>([]);
const includedMeshNames = ref<string[]>([]);
const skippedMeshNames = ref<string[]>([]);
const lastEmittedSummary = ref<PhysicsSummary | null>(null);
let lastSummary: PhysicsSummary | null = null;

function applyPhysics(scene: Scene) {
    if (!scene) {
        console.warn("No scene to apply physics to");
        return;
    }

    if (!props.def.enablePhysics) {
        console.warn("Physics is not enabled for this model");
        return;
    }

    if (!props.meshes || props.meshes.length === 0) {
        console.warn("No meshes to apply physics to");
        return;
    }

    // Clean up any existing physics
    removePhysics();

    const mass = props.def.physicsOptions?.mass ?? 0;
    const friction = props.def.physicsOptions?.friction ?? 0.2;
    const restitution = props.def.physicsOptions?.restitution ?? 0.2;

    let shapeType: PhysicsShapeType;
    switch (props.def.physicsType) {
        case "convexHull":
            shapeType = PhysicsShapeType.CONVEX_HULL;
            break;
        case "box":
            shapeType = PhysicsShapeType.BOX;
            break;
        default:
            shapeType = PhysicsShapeType.MESH;
            break;
    }

    includedMeshNames.value = [];
    skippedMeshNames.value = [];

    for (const mesh of props.meshes) {
        try {
            if (
                mesh.name.includes("__root__") ||
                mesh.name.includes("__point__") ||
                // @ts-ignore
                mesh.getClassName?.() !== "Mesh"
            ) {
                skippedMeshNames.value.push(mesh.name);
                continue;
            }

            // Skip lightmap and other utility meshes
            if (
                mesh.name.includes("lightmapData") ||
                mesh.name.includes("lightmap") ||
                (mesh.name.includes("_primitive") &&
                    mesh.name.includes("lightmap"))
            ) {
                skippedMeshNames.value.push(mesh.name);
                continue;
            }

            // Check if mesh has valid geometry (vertices)
            // @ts-ignore
            const geometry = mesh.geometry;
            if (!geometry) {
                skippedMeshNames.value.push(mesh.name);
                continue;
            }

            const verticesData = geometry.getVerticesData("position");
            if (!verticesData || verticesData.length === 0) {
                skippedMeshNames.value.push(mesh.name);
                continue;
            }

            const vertexCount = verticesData.length / 3;
            if (vertexCount < 3) {
                skippedMeshNames.value.push(mesh.name);
                continue;
            }

            const aggregate = new PhysicsAggregate(
                // @ts-ignore
                mesh as unknown as import("@babylonjs/core").Mesh,
                shapeType,
                { mass, friction, restitution },
                scene,
            );
            physicsAggregates.value.push(aggregate);
            includedMeshNames.value.push(mesh.name);
        } catch (e) {
            console.error(`Failed to apply physics to mesh ${mesh.name}:`, e);
            skippedMeshNames.value.push(mesh.name);
        }
    }

    const entityId = props.def.entityName || props.def.fileName;
    const summary: PhysicsSummary = {
        entityId,
        enablePhysics: !!props.def.enablePhysics,
        aggregatesCount: physicsAggregates.value.length,
        shapeType:
            shapeType === PhysicsShapeType.BOX
                ? "BOX"
                : shapeType === PhysicsShapeType.CONVEX_HULL
                  ? "CONVEX_HULL"
                  : "MESH",
        mass,
        friction,
        restitution,
        includedMeshNames: [...includedMeshNames.value],
        skippedMeshNames: [...skippedMeshNames.value],
    };
    lastSummary = summary;
    lastEmittedSummary.value = summary;
    emit("state", summary);
}

function removePhysics() {
    for (const agg of physicsAggregates.value) {
        agg.dispose();
    }
    physicsAggregates.value = [];
    includedMeshNames.value = [];
    skippedMeshNames.value = [];
    const entityId = props.def.entityName || props.def.fileName;
    const summary: PhysicsSummary = {
        entityId,
        enablePhysics: !!props.def.enablePhysics,
        aggregatesCount: 0,
        shapeType: "MESH",
        mass: props.def.physicsOptions?.mass ?? 0,
        friction: props.def.physicsOptions?.friction ?? 0.2,
        restitution: props.def.physicsOptions?.restitution ?? 0.2,
        includedMeshNames: [],
        skippedMeshNames: [],
    };
    lastSummary = summary;
    lastEmittedSummary.value = summary;
    emit("state", summary);
}

onMounted(() => {
    if (props.def.enablePhysics && props.scene && props.meshes?.length) {
        applyPhysics(props.scene);
    }
    // If physics is disabled initially, still emit a baseline summary once
    if (!props.def.enablePhysics) {
        const entityId = props.def.entityName || props.def.fileName;
        const summary: PhysicsSummary = {
            entityId,
            enablePhysics: false,
            aggregatesCount: 0,
            shapeType: "MESH",
            mass: props.def.physicsOptions?.mass ?? 0,
            friction: props.def.physicsOptions?.friction ?? 0.2,
            restitution: props.def.physicsOptions?.restitution ?? 0.2,
            includedMeshNames: [],
            skippedMeshNames: [],
        };
        lastSummary = summary;
        lastEmittedSummary.value = summary;
        emit("state", summary);
    }
});

watch(
    () => props.def.enablePhysics,
    (enabled) => {
        if (enabled) {
            if (props.scene) {
                applyPhysics(props.scene);
            }
        } else {
            removePhysics();
        }
    },
);

watch(
    () => props.meshes,
    (m) => {
        if (props.def.enablePhysics && props.scene && m?.length) {
            applyPhysics(props.scene);
        } else if (!props.def.enablePhysics) {
            // still keep overlay data fresh
            if (lastSummary) emit("state", lastSummary);
        }
    },
);

onUnmounted(() => {
    removePhysics();
});

defineExpose({ removePhysics, lastEmittedSummary });
// Also expose last summary for read-only debug overlays
void lastEmittedSummary;
</script>


