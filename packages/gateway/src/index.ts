#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { AgentBrowser } from "@aldurion/browser";
import { HOME, openDb } from "./db.js";
import { Runner } from "./runner.js";
import { createGateway, newToken } from "./server.js";

export { openDb, Runner, createGateway };

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDb();
  const tokenFile = join(HOME, "token");
  const token = process.env.ALDURION_TOKEN ?? (existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : (() => { const t = newToken(); writeFileSync(tokenFile, t, { mode: 0o600 }); chmodSync(tokenFile, 0o600); return t; })());
  const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const launch = () => (process.env.ALDURION_CDP ? AgentBrowser.connect(process.env.ALDURION_CDP) : AgentBrowser.launch(chrome, process.env.ALDURION_HEADFUL !== "1"));
  const port = Number(process.env.PORT ?? 8787);
  createGateway(db, new Runner(db, launch), token).listen(port, process.env.HOST ?? "127.0.0.1", () => console.log(`aldurion gateway on :${port}\ntoken: ${token}`));
}
