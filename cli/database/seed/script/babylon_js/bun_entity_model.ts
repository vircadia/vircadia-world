import type { Entity } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { MeshBuilder, type Mesh } from "@babylonjs/core";

export default function main(context: Entity.Script.Babylon.I_Context) {
    // Access the API and scene
    const vircadia = context.Vircadia.v1;
    const scene = vircadia.Babylon.Scene;

    // Initialize variables
    let myMesh: Mesh | null = null;

    // Define hooks for different events
    const hooks = {
        // Called when the script is first loaded
        onScriptInitialize: (
            entity: Entity.I_Entity,
            assets: Entity.Asset.I_Asset[],
        ) => {
            console.log(
                "Script initialized for entity:",
                entity.general__entity_id,
            );

            // Create a simple cube
            myMesh = MeshBuilder.CreateBox("box", { size: 1 }, scene);

            // Position the mesh based on entity data
            // Access transform__position from meta__data
            interface PositionData {
                x?: number;
                y?: number;
                z?: number;
            }
            interface EntityModel {
                transform__position?: PositionData;
            }

            const transformPosition = entity.meta__data
                .transform__position as PositionData;
            const entityModel = entity.meta__data.entity_model as EntityModel;
            const position =
                transformPosition || entityModel?.transform__position;

            if (position) {
                myMesh.position.x = position.x || 0;
                myMesh.position.y = position.y || 0;
                myMesh.position.z = position.z || 0;
            }
        },

        // Called when the entity is updated
        onEntityUpdate: (updatedEntity: Entity.I_Entity) => {
            console.log("Entity updated:", updatedEntity.general__entity_id);

            // Update mesh position if entity position changed
            // Access transform__position from meta__data
            interface PositionData {
                x?: number;
                y?: number;
                z?: number;
            }
            interface EntityModel {
                transform__position?: PositionData;
            }

            const transformPosition = updatedEntity.meta__data
                .transform__position as PositionData;
            const entityModel = updatedEntity.meta__data
                .entity_model as EntityModel;
            const position =
                transformPosition || entityModel?.transform__position;

            if (position && myMesh) {
                myMesh.position.x = position.x || 0;
                myMesh.position.y = position.y || 0;
                myMesh.position.z = position.z || 0;
            }
        },

        // Called when the script is being unloaded
        onScriptTeardown: () => {
            console.log("Script being torn down");

            // Clean up resources
            if (myMesh) {
                myMesh.dispose();
                myMesh = null;
            }
        },
    };

    // Return the hooks object
    return { hooks };
}
