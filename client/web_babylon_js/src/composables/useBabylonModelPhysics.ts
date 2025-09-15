import { ref, type Ref } from "vue";
import { PhysicsAggregate, PhysicsShapeType, Vector3 } from "@babylonjs/core";
import type { Scene, AbstractMesh } from "@babylonjs/core";
import type { BabylonModelDefinition } from "./schemas";

// Composable for applying/removing physics to a Babylon model
export function useBabylonModelPhysics(
    meshes: Ref<AbstractMesh[]>,
    def: BabylonModelDefinition,
) {
    const physicsAggregates = ref<PhysicsAggregate[]>([]);

    function applyPhysics(scene: Scene) {
        if (!scene) {
            console.warn("No scene to apply physics to");
            return;
        }

        if (!def.enablePhysics) {
            console.warn("Physics is not enabled for this model");
            return;
        }

        if (meshes.value.length === 0) {
            console.warn("No meshes to apply physics to");
            return;
        }

        console.log(
            `[useBabylonModelPhysics] Applying physics to model: ${def.fileName}`,
            {
                meshCount: meshes.value.length,
                physicsType: def.physicsType,
                physicsOptions: def.physicsOptions,
            },
        );

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

                // Skip lightmap and other utility meshes
                if (
                    mesh.name.includes("lightmapData") ||
                    mesh.name.includes("lightmap") ||
                    (mesh.name.includes("_primitive") &&
                        mesh.name.includes("lightmap"))
                ) {
                    console.debug(`Skipping lightmap mesh: ${mesh.name}`);
                    continue;
                }

                // Check if mesh has valid geometry (vertices)
                const geometry = mesh.geometry;
                if (!geometry) {
                    console.debug(
                        `Skipping mesh without geometry: ${mesh.name}`,
                    );
                    continue;
                }

                const verticesData = geometry.getVerticesData("position");
                if (!verticesData || verticesData.length === 0) {
                    console.debug(
                        `Skipping mesh with no vertices: ${mesh.name}`,
                    );
                    continue;
                }

                // Additional check for minimum vertex count for valid physics shapes
                const vertexCount = verticesData.length / 3; // 3 components per vertex (x,y,z)
                if (vertexCount < 3) {
                    console.debug(
                        `Skipping mesh with insufficient vertices (${vertexCount}): ${mesh.name}`,
                    );
                    continue;
                }

                console.log(
                    `[useBabylonModelPhysics] Creating physics aggregate for mesh: ${mesh.name}`,
                    {
                        vertexCount,
                        shapeType: PhysicsShapeType[shapeType],
                        mass,
                        friction,
                        restitution,
                    },
                );

                const aggregate = new PhysicsAggregate(
                    mesh as unknown as import("@babylonjs/core").Mesh,
                    shapeType,
                    { mass, friction, restitution },
                    scene,
                );
                physicsAggregates.value.push(aggregate);
                console.log(
                    `[useBabylonModelPhysics] Physics aggregate created successfully for: ${mesh.name}`,
                );
            } catch (e) {
                console.error(
                    `Failed to apply physics to mesh ${mesh.name}:`,
                    e,
                );
            }
        }

        console.log(`[useBabylonModelPhysics] Physics application completed`, {
            aggregatesCreated: physicsAggregates.value.length,
            model: def.fileName,
        });
    }

    function removePhysics() {
        for (const agg of physicsAggregates.value) {
            agg.dispose();
        }
        physicsAggregates.value = [];
    }

    return { applyPhysics, removePhysics };
}
