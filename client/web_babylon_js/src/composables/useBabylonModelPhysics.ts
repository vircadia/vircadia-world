import { ref, watch, type Ref } from "vue";
import { PhysicsAggregate, PhysicsShapeType } from "@babylonjs/core";
import type { Scene, AbstractMesh } from "@babylonjs/core";
import type { BabylonModelDefinition } from "./types";

// Composable for applying/removing physics to a Babylon model
export function useBabylonModelPhysics(
    sceneRef: Ref<Scene | null>,
    meshes: Ref<AbstractMesh[]>,
    def: BabylonModelDefinition,
) {
    const physicsAggregates = ref<PhysicsAggregate[]>([]);

    function applyPhysics() {
        const scene = sceneRef.value;
        if (
            !scene ||
            !def.enablePhysics ||
            meshes.value.length === 0 ||
            !scene.physicsEnabled
        ) {
            return;
        }
        // Clean up any existing physics
        removePhysics();

        const mass = def.physicsOptions?.mass ?? 0;
        const friction = def.physicsOptions?.friction ?? 0.2;
        const restitution = def.physicsOptions?.restitution ?? 0.2;

        let shapeType: PhysicsShapeType;
        switch (def.physicsType) {
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

        for (const mesh of meshes.value) {
            try {
                if (
                    mesh.name.includes("__root__") ||
                    mesh.name.includes("__point__") ||
                    mesh.getClassName?.() !== "Mesh"
                ) {
                    continue;
                }
                const aggregate = new PhysicsAggregate(
                    mesh as unknown as import("@babylonjs/core").Mesh,
                    shapeType,
                    { mass, friction, restitution },
                    scene,
                );
                physicsAggregates.value.push(aggregate);
            } catch (e) {
                console.error(
                    `Failed to apply physics to mesh ${mesh.name}:`,
                    e,
                );
            }
        }
    }

    function removePhysics() {
        for (const agg of physicsAggregates.value) {
            agg.dispose();
        }
        physicsAggregates.value = [];
    }

    // React to enablePhysics flag changes
    watch(
        () => def.enablePhysics,
        (enabled) => {
            if (enabled) {
                applyPhysics();
            } else {
                removePhysics();
            }
        },
        { immediate: true },
    );

    return { applyPhysics, removePhysics };
}
