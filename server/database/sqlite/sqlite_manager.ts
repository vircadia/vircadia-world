import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../../../sdk/vircadia-world-sdk-ts/module/general/log.ts";

export class SQLiteManager {
    private static instance: SQLiteManager | null = null;
    private db: Database;
    private databaseDir = "./database";
    private migrationsDir = "./migrations";
    private debugMode: boolean;

    private constructor(debugMode: boolean = false) {
        this.debugMode = debugMode;
        this.db = new Database(`${this.databaseDir}/vircadia-world.db`);
    }

    public static getInstance(debugMode: boolean = false): SQLiteManager {
        if (!SQLiteManager.instance) {
            SQLiteManager.instance = new SQLiteManager(debugMode);
        }
        return SQLiteManager.instance;
    }

    public runMigrations(): void {
        this.initMigrationsTable();

        const files = readdirSync(this.migrationsDir).sort();
        for (const file of files) {
            const executed = this.db
                .query("SELECT name FROM migrations WHERE name = ?")
                .get(file);

            if (!executed) {
                log({
                    message: `Running migration: ${file}`,
                    type: "info",
                });
                const sql = readFileSync(
                    join(this.migrationsDir, file),
                    "utf-8",
                );

                this.db.transaction(() => {
                    this.db.run(sql);
                    this.db.run("INSERT INTO migrations (name) VALUES (?)", [
                        file,
                    ]);
                })();
            } else {
                log({
                    message: `Skipping migration: ${file} (already executed)`,
                    type: "info",
                    debug: this.debugMode,
                });
            }
        }
    }

    private initMigrationsTable(): void {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS migrations (
                name TEXT PRIMARY KEY,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }
}

export default SQLiteManager.getInstance();
