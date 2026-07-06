import Database from 'better-sqlite3';
import fs from 'fs';
import { config } from './server/config.js';
import path from 'path';

console.log('Running migration to convert INTEGER columns to REAL...');

let dbPath = config.databasePath;
if (fs.existsSync(dbPath)) {
  dbPath = fs.realpathSync(dbPath);
}

const oldDbPath = dbPath + '.bak';
if (!fs.existsSync(oldDbPath) && fs.existsSync(dbPath)) {
  fs.renameSync(dbPath, oldDbPath);
  if (fs.existsSync(dbPath + '-wal')) fs.renameSync(dbPath + '-wal', oldDbPath + '-wal');
  if (fs.existsSync(dbPath + '-shm')) fs.renameSync(dbPath + '-shm', oldDbPath + '-shm');
  console.log(`Backed up existing database to ${oldDbPath}`);
} else {
  console.log(`Backup already exists or no DB to migrate.`);
}

if (fs.existsSync(oldDbPath)) {
  const oldDb = new Database(oldDbPath, { readonly: true });
  const { db: newDb } = await import('./server/db.js');

  const tables = oldDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();

  for (const t of tables) {
    const tableName = t.name;
    console.log(`Migrating table ${tableName}...`);
    let rows;
    try {
      rows = oldDb.prepare(`SELECT * FROM ${tableName}`).all();
    } catch (e) {
      console.error(`Error reading from ${tableName}:`, e.message);
      continue;
    }
    
    if (rows.length === 0) continue;
    
    newDb.prepare(`DELETE FROM ${tableName}`).run();
    
    const cols = Object.keys(rows[0]);
    const placeholders = cols.map(() => '?').join(', ');
    const insert = newDb.prepare(`INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`);
    
    const insertMany = newDb.transaction((rowsToInsert) => {
      for (const row of rowsToInsert) {
        const values = cols.map(c => row[c]);
        insert.run(values);
      }
    });
    
    insertMany(rows);
  }
}
console.log('Migration complete.');
