import * as BABYLON from "@babylonjs/core";
import type { EntityRow } from "../types";

export class EntityFactory {
    constructor(private scene: BABYLON.Scene) {}

    createEntity(entity: EntityRow): BABYLON.Node | null {
        try {
            // Dynamically create the entity using the type name
            // biome-ignore lint/suspicious/noExplicitAny: <explanation>
            const mesh = new (BABYLON as any)[entity.type__babylonjs](
                `${entity.general__uuid}`,
                this.scene,
            );
            this.updateEntityProperties(mesh, entity);
            return mesh;
        } catch (error) {
            console.warn(
                `Failed to create entity of type ${entity.type__babylonjs}:`,
                error,
            );
            return null;
        }
    }

    updateEntityProperties(node: BABYLON.Node, entity: EntityRow): void {
        // Update only core properties from entities table
        node.name = `${entity.general__uuid}`;

        // Store metadata using database keys
        node.metadata = {
            general__name: entity.general__name,
            general__semantic_version: entity.general__semantic_version,
            general__created_at: entity.general__created_at,
            general__created_by: entity.general__created_by,
            general__updated_at: entity.general__updated_at,
            permissions__roles__view: entity.permissions__roles__view,
            permissions__roles__full: entity.permissions__roles__full,
        };
    }

    deleteEntity(uuid: string): void {
        const node = this.scene.getNodeByName(`entity:${uuid}`);
        if (node) {
            node.dispose();
        }
    }
}
