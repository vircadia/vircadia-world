import type { Scene } from "@babylonjs/core";
import { EntityFactory } from "./EntityFactory";
import type { EntityRow, EntityUpdate } from "../types";

export class TransactionQueue {
    private entityFactory: EntityFactory;
    private entityInsertQueue: Map<string, EntityUpdate> = new Map();
    private entityUpdateQueue: Map<string, EntityUpdate> = new Map();
    private entityDeleteQueue: Set<string> = new Set();
    private isProcessing = false;

    constructor(private scene: Scene) {
        this.entityFactory = new EntityFactory(scene);
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

    processQueues(scene: Scene) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        // Process deletes first
        for (const uuid of this.entityDeleteQueue) {
            this.entityFactory.deleteEntity(uuid);
        }
        this.entityDeleteQueue.clear();

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

        this.isProcessing = false;
    }
}
