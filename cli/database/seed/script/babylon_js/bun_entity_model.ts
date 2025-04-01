import type { Entity } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import type { Babylon } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.babylon.script";
import { MeshBuilder, type Mesh, Vector3 } from "@babylonjs/core";

interface Position {
    x?: number;
    y?: number;
    z?: number;
}

interface EntityModel {
    transform__position?: Position;
}

interface EntityMetaData {
    transform__position?: Position;
    entity_model?: EntityModel;
}

// Extended entity interface to store mesh reference
interface EntityWithMesh extends Entity.I_Entity {
    _mesh?: Mesh;
}

// Use the new vircadiaScriptMain function name
function vircadiaScriptMain(context: Babylon.I_Context): Babylon.ScriptReturn {
    // Return the script structure directly
    return {
        hooks: {
            // Script state variables
            onScriptInitialize: (
                entity: Entity.I_Entity,
                assets: Entity.Asset.I_Asset[],
            ): void => {
                // Create mesh
                const scene = context.Babylon.Scene;
                const myMesh = MeshBuilder.CreateBox("box", { size: 1 }, scene);

                // Position based on entity data
                const metaData = entity.meta__data as unknown as EntityMetaData;
                const transformPosition = metaData.transform__position;
                const entityModel = metaData.entity_model;
                const position =
                    transformPosition || entityModel?.transform__position;

                if (position) {
                    myMesh.position = new Vector3(
                        position.x || 0,
                        position.y || 0,
                        position.z || 0,
                    );
                }

                // Store mesh in entity metadata for access in other hooks
                (entity as EntityWithMesh)._mesh = myMesh;
            },

            onEntityUpdate: (updatedEntity: Entity.I_Entity): void => {
                console.log(
                    "Entity updated:",
                    updatedEntity.general__entity_id,
                );

                // Update position if entity data changed
                const entityWithMesh = updatedEntity as EntityWithMesh;
                if (entityWithMesh._mesh) {
                    const metaData =
                        updatedEntity.meta__data as unknown as EntityMetaData;
                    const transformPosition = metaData.transform__position;
                    const entityModel = metaData.entity_model;
                    const position =
                        transformPosition || entityModel?.transform__position;

                    if (position) {
                        entityWithMesh._mesh.position.x = position.x || 0;
                        entityWithMesh._mesh.position.y = position.y || 0;
                        entityWithMesh._mesh.position.z = position.z || 0;
                    }
                }
            },

            onScriptTeardown: (): void => {
                console.log("Script being torn down");

                // This could be improved with a better mesh tracking mechanism
                // Currently relying on entity reference cleanup by the system
            },
        },
    };
}

// Make the function available in the global scope
// @ts-ignore - Adding to global scope for script system
globalThis.vircadiaScriptMain = vircadiaScriptMain;
