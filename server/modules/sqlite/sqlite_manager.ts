import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const databaseDir = './database';
const db = new Database(`${databaseDir}/vircadia-world.db`);
const migrationsDir = './migrations';

const runMigrations = () => {
  const files = readdirSync(migrationsDir).sort();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    db.run(sql);
  }
};

runMigrations();