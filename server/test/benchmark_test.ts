import { Database } from "bun:sqlite";
import { test, expect } from "bun:test";

// Constants
const TEST_NAME = "MMO-like SQLite Performance Test";
const NUM_PLAYERS = 1000;
const WORLD_SIZE = 10000; // 10000x10000 units
const PLAYER_VIEW_DISTANCE = 1000;
const ZONES = 16; // 4x4 grid of zones
const ZONE_SIZE = WORLD_SIZE / Math.sqrt(ZONES);
const TEST_DURATION = 10000; // milliseconds

// Simulation rates
const MOVEMENT_FPS = 20; // Player position updates
const COMBAT_FPS = 10; // Combat interactions
const CHAT_FPS = 2; // Chat messages
const INVENTORY_FPS = 1; // Inventory operations

// Entity counts
const NUM_NPCS = 5000;
const NUM_ITEMS = 10000;

interface Position {
    x: number;
    y: number;
    zone: number;
}

interface TestResults {
    spatialQueries: number;
    combatUpdates: number;
    inventoryOperations: number;
    chatMessages: number;
    queryLatencies: {
        spatial: number[];
        combat: number[];
        inventory: number[];
        chat: number[];
    };
    conflictCount: number;
}

function setupDatabase(): Database {
    const db = new Database(":memory:", { create: true });

    // Enable WAL mode and other optimizations
    db.run("PRAGMA journal_mode=WAL");
    db.run("PRAGMA synchronous=NORMAL");
    db.run("PRAGMA busy_timeout=1000");
    db.run("PRAGMA mmap_size=268435456");
    db.run("PRAGMA page_size=4096");
    db.run("PRAGMA wal_autocheckpoint=1000");

    // Create tables with spatial indexing
    db.run(`
        CREATE TABLE players (
            id INTEGER PRIMARY KEY,
            x FLOAT,
            y FLOAT,
            zone INTEGER,
            health INTEGER,
            mana INTEGER,
            last_updated INTEGER
        )
    `);

    db.run(`
        CREATE TABLE npcs (
            id INTEGER PRIMARY KEY,
            x FLOAT,
            y FLOAT,
            zone INTEGER,
            type TEXT,
            health INTEGER,
            respawn_time INTEGER
        )
    `);

    db.run(`
        CREATE TABLE items (
            id INTEGER PRIMARY KEY,
            x FLOAT,
            y FLOAT,
            zone INTEGER,
            type TEXT,
            owner_id INTEGER NULL,
            properties TEXT
        )
    `);

    db.run(`
        CREATE TABLE inventories (
            player_id INTEGER,
            item_id INTEGER,
            slot INTEGER,
            FOREIGN KEY(player_id) REFERENCES players(id),
            FOREIGN KEY(item_id) REFERENCES items(id)
        )
    `);

    // Create spatial indexes
    db.run("CREATE INDEX idx_players_zone ON players(zone)");
    db.run("CREATE INDEX idx_npcs_zone ON npcs(zone)");
    db.run("CREATE INDEX idx_items_zone ON items(zone)");

    // Initialize with test data
    initializeTestData(db);

    return db;
}

function initializeTestData(db: Database): void {
    const playerStmt = db.prepare(
        "INSERT INTO players (id, x, y, zone, health, mana, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const npcStmt = db.prepare(
        "INSERT INTO npcs (id, x, y, zone, type, health, respawn_time) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const itemStmt = db.prepare(
        "INSERT INTO items (id, x, y, zone, type, properties) VALUES (?, ?, ?, ?, ?, ?)",
    );

    db.run("BEGIN TRANSACTION");

    // Initialize players
    for (let i = 0; i < NUM_PLAYERS; i++) {
        const pos = getRandomPosition();
        playerStmt.run(
            i,
            pos.x,
            pos.y,
            pos.zone,
            100, // health
            100, // mana
            Date.now(),
        );
    }

    // Initialize NPCs
    for (let i = 0; i < NUM_NPCS; i++) {
        const pos = getRandomPosition();
        const npcType = ["monster", "vendor", "quest_giver"][
            Math.floor(Math.random() * 3)
        ];
        npcStmt.run(
            i,
            pos.x,
            pos.y,
            pos.zone,
            npcType,
            100, // health
            0, // respawn_time
        );
    }

    // Initialize Items
    for (let i = 0; i < NUM_ITEMS; i++) {
        const pos = getRandomPosition();
        const itemType = ["weapon", "armor", "consumable"][
            Math.floor(Math.random() * 3)
        ];
        const properties = JSON.stringify({
            level: Math.floor(Math.random() * 50) + 1,
        });
        itemStmt.run(i, pos.x, pos.y, pos.zone, itemType, properties);
    }

    db.run("COMMIT");
}

function getRandomPosition(): Position {
    const x = Math.random() * WORLD_SIZE;
    const y = Math.random() * WORLD_SIZE;
    const zoneX = Math.floor(x / ZONE_SIZE);
    const zoneY = Math.floor(y / ZONE_SIZE);
    const zone = zoneY * Math.sqrt(ZONES) + zoneX;
    return { x, y, zone };
}

async function simulatePlayer(
    db: Database,
    playerId: number,
    startTime: number,
    results: TestResults,
): Promise<void> {
    const spatialInterval = 1000 / MOVEMENT_FPS;
    const combatInterval = 1000 / COMBAT_FPS;
    const chatInterval = 1000 / CHAT_FPS;
    const inventoryInterval = 1000 / INVENTORY_FPS;

    let lastSpatialQuery = 0;
    let lastCombatUpdate = 0;
    let lastChatMessage = 0;
    let lastInventoryOp = 0;

    while (performance.now() - startTime < TEST_DURATION) {
        const now = performance.now();

        // Spatial query (player movement and surroundings update)
        if (now - lastSpatialQuery >= spatialInterval) {
            const queryStart = performance.now();
            try {
                db.transaction(() => {
                    // Update player position
                    const pos = getRandomPosition();
                    db.prepare(`
                        UPDATE players 
                        SET x = ?, y = ?, zone = ?, last_updated = ? 
                        WHERE id = ?
                    `).run(pos.x, pos.y, pos.zone, Date.now(), playerId);

                    // Query nearby entities
                    const zoneQuery = db
                        .prepare(`
                        SELECT * FROM players 
                        WHERE zone = ? AND id != ?
                        UNION ALL
                        SELECT * FROM npcs WHERE zone = ?
                        UNION ALL
                        SELECT * FROM items 
                        WHERE zone = ? AND owner_id IS NULL
                    `)
                        .all(pos.zone, playerId, pos.zone);
                })();
            } catch (e) {
                results.conflictCount++;
            }
            results.queryLatencies.spatial.push(performance.now() - queryStart);
            results.spatialQueries++;
            lastSpatialQuery = now;
        }

        // Simulate other actions...
        await new Promise((resolve) => setTimeout(resolve, 1));
    }
}

test(
    TEST_NAME,
    async () => {
        console.log(`Starting ${TEST_NAME}`);
        console.log(`Configuration:
        - Players: ${NUM_PLAYERS}
        - NPCs: ${NUM_NPCS}
        - Items: ${NUM_ITEMS}
        - World Size: ${WORLD_SIZE}x${WORLD_SIZE}
        - Zones: ${ZONES}
        - Duration: ${TEST_DURATION}ms
    `);

        const db = setupDatabase();
        const results: TestResults = {
            spatialQueries: 0,
            combatUpdates: 0,
            inventoryOperations: 0,
            chatMessages: 0,
            queryLatencies: {
                spatial: [],
                combat: [],
                inventory: [],
                chat: [],
            },
            conflictCount: 0,
        };

        const startTime = performance.now();

        // Start all player simulations
        const players = Array(NUM_PLAYERS)
            .fill(0)
            .map((_, i) => simulatePlayer(db, i, startTime, results));

        await Promise.all(players);

        // Calculate and display results
        const totalDuration = (performance.now() - startTime) / 1000;

        console.log("\nTest Results:");
        console.log(
            `Spatial Queries/second: ${(results.spatialQueries / totalDuration).toFixed(2)}`,
        );
        console.log(`Transaction Conflicts: ${results.conflictCount}`);

        // Calculate percentiles for spatial queries
        const spatialPercentiles = [50, 95, 99].map((p) => {
            const sorted = [...results.queryLatencies.spatial].sort(
                (a, b) => a - b,
            );
            const index = Math.floor((p / 100) * sorted.length);
            return `${p}th: ${sorted[index].toFixed(2)}ms`;
        });

        console.log(
            "\nSpatial Query Latencies:",
            spatialPercentiles.join(", "),
        );

        db.close();
    },
    { timeout: TEST_DURATION + 5000 },
);
