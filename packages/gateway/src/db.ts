import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HOME = process.env.ALDURION_HOME ?? join(homedir(), ".aldurion");

export function openDb(file = join(HOME, "aldurion.db")) {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY, name TEXT NOT NULL, task TEXT NOT NULL, cron TEXT NOT NULL, next_run INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY, job_id INTEGER, task TEXT NOT NULL, status TEXT NOT NULL, started INTEGER NOT NULL, finished INTEGER, result TEXT, events TEXT NOT NULL DEFAULT '[]');
  `);
  try { chmodSync(file, 0o600); } catch {}
  return db;
}

export type Db = ReturnType<typeof openDb>;

export const getSetting = (db: Db, k: string) => (db.prepare("SELECT v FROM settings WHERE k=?").get(k) as { v: string } | undefined)?.v;
export const setSetting = (db: Db, k: string, v: string) => void db.prepare("INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, v);
