import { type Scene, type Node, Mesh } from "@babylonjs/core";
import type { EntityRow } from "../types";

export class EntityFactory {
    constructor(private scene: Scene) {}

    createEntity(entity: EntityRow): Node | null {
        // Create a basic mesh as default entity representation
        const mesh = new Mesh(`entity:${entity.general__uuid}`, this.scene);

        // Apply initial properties from entity row
        this.updateEntityProperties(mesh, entity);

        return mesh;
    }

    updateEntityProperties(node: Node, entity: EntityRow): void {
        // Update basic properties
        node.name = `entity:${entity.general__uuid}`;

        // Handle parent relationship
        if (entity.general__parent_entity_id) {
            const parentNode = this.scene.getNodeByName(
                `entity:${entity.general__parent_entity_id}`,
            );
            if (parentNode) {
                node.parent = parentNode;
            }
        }
    }

    deleteEntity(uuid: string): void {
        const node = this.scene.getNodeByName(`entity:${uuid}`);
        if (node) {
            node.dispose();
        }
    }
}
