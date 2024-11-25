import type { Scene } from "@babylonjs/core";
import { EntityFactory } from "./EntityFactory";
import { MetadataHandler } from "./MetadataHandler";
import type {
    EntityRow,
    EntityMetadataRow,
    EntityUpdate,
    MetadataUpdate,
} from "../types";

export class EntityTransactionQueue {
    private entityFactory: EntityFactory;
    private metadataHandler: MetadataHandler;
    private entityInsertQueue: Map<string, EntityUpdate> = new Map();
    private entityUpdateQueue: Map<string, EntityUpdate> = new Map();
    private entityDeleteQueue: Set<string> = new Set();
    private metadataInsertQueue: Map<string, MetadataUpdate> = new Map();
    private metadataUpdateQueue: Map<string, MetadataUpdate> = new Map();
    private metadataDeleteQueue: Set<string> = new Set();
    private isProcessing = false;

    constructor(private scene: Scene) {
        this.entityFactory = new EntityFactory(scene);
        this.metadataHandler = new MetadataHandler(scene);
    }

    queueUpdate(entity: EntityRow, action: "INSERT" | "UPDATE" | "DELETE") {
        const uuid = entity.general__uuid;

        if (action === "DELETE") {
            this.entityInsertQueue.delete(uuid);
            this.entityUpdateQueue.delete(uuid);
            this.entityDeleteQueue.add(uuid);
            return;
        }

        const update: EntityUpdate = {
            entity,
            timestamp: Date.now(),
        };

        this.entityUpdateQueue.set(uuid, update);
    }

    queueMetadataUpdate(
        metadata: EntityMetadataRow,
        action: "INSERT" | "UPDATE" | "DELETE",
    ) {
        const metadataId = `${metadata.general__entity_id}:${metadata.key}`;

        if (action === "DELETE") {
            this.metadataInsertQueue.delete(metadataId);
            this.metadataUpdateQueue.delete(metadataId);
            this.metadataDeleteQueue.add(metadataId);
            return;
        }

        const update: MetadataUpdate = {
            metadata,
            timestamp: Date.now(),
        };

        this.metadataUpdateQueue.set(metadataId, update);
    }

    processQueues(scene: Scene) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        // Process deletes first
        for (const uuid of this.entityDeleteQueue) {
            this.entityFactory.deleteEntity(uuid);
        }
        this.entityDeleteQueue.clear();

        for (const metadataId of this.metadataDeleteQueue) {
            const [entityId, key] = metadataId.split(":");
            const node = scene.getNodeByName(`entity:${entityId}`);
            if (node) {
                this.metadataHandler.removeMetadata(node, key);
            }
        }
        this.metadataDeleteQueue.clear();

        // Process entity updates
        for (const [uuid, update] of this.entityUpdateQueue) {
            let node = scene.getNodeByName(`entity:${uuid}`);
            if (!node) {
                node = this.entityFactory.createEntity(update.entity);
            } else {
                this.entityFactory.updateEntityProperties(node, update.entity);
            }
        }
        this.entityUpdateQueue.clear();

        // Process metadata updates
        for (const [metadataId, update] of this.metadataUpdateQueue) {
            const [entityId] = metadataId.split(":");
            const node = scene.getNodeByName(`entity:${entityId}`);
            if (node) {
                this.metadataHandler.applyMetadata(node, update.metadata);
            }
        }
        this.metadataUpdateQueue.clear();

        this.isProcessing = false;
    }
}
