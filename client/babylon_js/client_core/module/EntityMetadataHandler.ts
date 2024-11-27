import type { Node, Scene } from "@babylonjs/core";
import type { EntityMetadataRow } from "../types";

export class EntityMetadataHandler {
    constructor(private scene: Scene) {}

    applyMetadata(node: Node, metadata: EntityMetadataRow): void {
        switch (metadata.key) {
            case "babylonjs_transform":
                this.applyTransform(node, metadata);
                break;
            case "babylonjs_material":
                this.applyMaterial(node, metadata);
                break;
        }
    }

    removeMetadata(node: Node, key: string): void {
        switch (key) {
            case "babylonjs_transform":
                // Reset transform to defaults
                break;
            case "babylonjs_material":
                // Reset material to defaults
                break;
        }
    }

    private applyTransform(node: Node, metadata: EntityMetadataRow): void {
        if (metadata.values__numeric) {
            // Apply transform values
        }
    }

    private applyMaterial(node: Node, metadata: EntityMetadataRow): void {
        if (metadata.values__text) {
            // Apply material properties
        }
    }
}
