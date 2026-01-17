
import { BunLogModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import { Communication } from "../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import type { WorldSession } from "./world.api.ws.manager";

const LOG_PREFIX = "GameLoopManager";

export interface EntityState {
    id: string;
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    lastUpdated: number;
}

export class GameLoopManager {
    private syncGroup: string;
    private isRunning = false;
    private tickRateMs = 16; // ~60Hz
    private interval: Timer | null = null;
    private entities: Map<string, EntityState> = new Map();
    private lastSnapshotTime = 0;
    private snapshotIntervalMs = 5000; // Save to DB every 5 seconds

    // Callback to broadcast messages to all sessions in this SyncGroup
    private broadcastCallback: (message: string) => void;
    // Callback to persist state to DB
    private persistCallback: (entities: EntityState[]) => Promise<void>;

    constructor(
        syncGroup: string,
        broadcastCallback: (message: string) => void,
        persistCallback: (entities: EntityState[]) => Promise<void>,
        tickRateMs = 16
    ) {
        this.syncGroup = syncGroup;
        this.broadcastCallback = broadcastCallback;
        this.persistCallback = persistCallback;
        this.tickRateMs = tickRateMs;
    }

    public start() {
        if (this.isRunning) return;
        this.isRunning = true;

        BunLogModule({
            prefix: LOG_PREFIX,
            message: `Starting Game Loop for ${this.syncGroup} at ${this.tickRateMs}ms`,
            type: "info",
        });

        this.interval = setInterval(() => {
            this.tick();
        }, this.tickRateMs);
    }

    public stop() {
        this.isRunning = false;
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        BunLogModule({
            prefix: LOG_PREFIX,
            message: `Stopped Game Loop for ${this.syncGroup}`,
            type: "info",
        });
    }

    public handleInput(session: WorldSession, message: Communication.WebSocket.GameInputMessage) {
        // Basic Input Processing Logic
        // In a real implementation, this would queue inputs for the next tick
        // For prototype, we might apply them immediately or update a 'desiredVelocity' on the entity
        
        // Example: If message is "MOVE", update velocity
        const entityId = session.agentId; // Assuming 1:1 Agent:Entity for now
        let entity = this.entities.get(entityId);
        
        if (!entity) {
            // Auto-create entity for new players (simplified)
            entity = {
                id: entityId,
                position: { x: 0, y: 10, z: 0 },
                velocity: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0, w: 1 },
                lastUpdated: Date.now(),
            };
            this.entities.set(entityId, entity);
        }

        if (message.inputType === "MOVE" && message.data) {
             // Type safety would require Zod parsing of 'data' here
             const moveData = message.data as { x: number, y: number, z: number };
             entity.velocity = moveData; 
             entity.lastUpdated = Date.now();
        }
        
        // Log for debugging
        // console.log(`[${this.syncGroup}] Input from ${session.agentId}: ${message.inputType}`);
    }

    private tick() {
        const now = Date.now();
        const dt = this.tickRateMs / 1000; // Seconds

        // 1. Physics / Simulation Step
        for (const entity of this.entities.values()) {
            // Simple Euler integration
            entity.position.x += entity.velocity.x * dt;
            entity.position.y += entity.velocity.y * dt;
            entity.position.z += entity.velocity.z * dt;
        }

        // 2. Broadcast State Update
        // Only broadcast if there are entities
        if (this.entities.size > 0) {
            const updateMessage = new Communication.WebSocket.GameStateUpdateMessage({
                updateType: "FULL_SNAPSHOT", // Or DELTA
                updateData: Array.from(this.entities.values()),
            });
            this.broadcastCallback(JSON.stringify(updateMessage));
        }

        // 3. Persistence Check
        if (now - this.lastSnapshotTime > this.snapshotIntervalMs) {
            this.lastSnapshotTime = now;
            this.persistCallback(Array.from(this.entities.values()));
        }
    }
}
