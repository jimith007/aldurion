import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { compileScenario, getScenario, listScenarios, saveScenario } from "./scenarios.js";
import { nextRun } from "./cron.js";
import { getSetting, setSetting, type Db } from "./db.js";
import type { Runner } from "./runner.js";

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const newToken = () => randomBytes(24).toString("hex");

async function body(req: IncomingMessage) {
  let s = "";
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}

export function createGateway(db: Db, runner: Runner, token: string) {
  const send = (res: ServerResponse, code: number, data: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
  const authed = (req: IncomingMessage, url: URL) => safeEq((req.headers.authorization ?? "").replace(/^Bearer /, "") || (url.searchParams.get("token") ?? ""), token);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    try {
      if (url.pathname === "/health") return send(res, 200, { ok: true });
      if (!authed(req, url)) return send(res, 401, { error: "unauthorized" });
      const m = req.method, p = url.pathname;

      if (p === "/settings" && m === "PUT") {
        const b = await body(req);
        for (const k of ["baseURL", "apiKey", "model", "ntfyUrl", "confirmMode", "adblock", "egressAllow", "egressDeny", "offlineBaseURL", "offlineModel"]) if (typeof b[k] === "string") setSetting(db, k, b[k]);
        if (b.apiVars && typeof b.apiVars === "object") setSetting(db, "apiVars", JSON.stringify(b.apiVars));
        if (Array.isArray(b.mcpServers)) setSetting(db, "mcpServers", JSON.stringify(b.mcpServers));
        return send(res, 200, { ok: true });
      }
      if (p === "/settings" && m === "GET") {
        const key = getSetting(db, "apiKey");
        return send(res, 200, { baseURL: getSetting(db, "baseURL"), model: getSetting(db, "model"), apiKey: key ? `...${key.slice(-4)}` : null, ntfyUrl: getSetting(db, "ntfyUrl"), confirmMode: getSetting(db, "confirmMode") ?? "sensitive", adblock: getSetting(db, "adblock") ?? "on", egressAllow: getSetting(db, "egressAllow"), egressDeny: getSetting(db, "egressDeny"), offlineBaseURL: getSetting(db, "offlineBaseURL"), offlineModel: getSetting(db, "offlineModel"), apiVars: Object.keys(JSON.parse(getSetting(db, "apiVars") ?? "{}")), mcpServers: JSON.parse(getSetting(db, "mcpServers") ?? "[]") });
      }
      if (p === "/runs" && m === "POST") { const b = await body(req); return send(res, 200, { id: runner.start(b.task, undefined, b.mode === "code" ? "code" : b.mode === "qa" ? "qa" : b.mode === "api" ? "api" : "browser", b.language) }); }
      if (p === "/runs" && m === "GET") return send(res, 200, db.prepare("SELECT id,job_id,task,status,started,finished,result FROM runs ORDER BY id DESC LIMIT 50").all());
      const run = p.match(/^\/runs\/(\d+)$/);
      if (run && m === "GET") { const r = db.prepare("SELECT * FROM runs WHERE id=?").get(Number(run[1])); return r ? send(res, 200, r) : send(res, 404, {}); }

      if (p === "/scenarios" && m === "GET") return send(res, 200, listScenarios(db));
      if (p === "/scenarios" && m === "POST") return send(res, 200, { id: saveScenario(db, await body(req)) });
      const sc = p.match(/^\/scenarios\/(\d+)(\/run)?$/);
      if (sc && m === "GET") { const x = getScenario(db, Number(sc[1])); return x ? send(res, 200, { ...x, compiled: compileScenario(x) }) : send(res, 404, {}); }
      if (sc && m === "PUT") return send(res, 200, { id: saveScenario(db, await body(req), Number(sc[1])) });
      if (sc && m === "DELETE") { db.prepare("DELETE FROM scenarios WHERE id=?").run(Number(sc[1])); return send(res, 200, { ok: true }); }
      if (sc && sc[2] && m === "POST") return getScenario(db, Number(sc[1])) ? send(res, 200, { id: runner.start(`scenario:${sc[1]}`) }) : send(res, 404, {});

      if (p === "/jobs" && m === "POST") {
        const b = await body(req);
        const next = nextRun(b.cron);
        const id = Number(db.prepare("INSERT INTO jobs(name,task,cron,next_run) VALUES(?,?,?,?)").run(b.name, b.task, b.cron, next).lastInsertRowid);
        return send(res, 200, { id, next_run: next });
      }
      if (p === "/jobs" && m === "GET") return send(res, 200, db.prepare("SELECT * FROM jobs ORDER BY id").all());
      const job = p.match(/^\/jobs\/(\d+)(\/run)?$/);
      if (job && m === "DELETE") { db.prepare("DELETE FROM jobs WHERE id=?").run(Number(job[1])); return send(res, 200, { ok: true }); }
      if (job && job[2] && m === "POST") {
        const j = db.prepare("SELECT * FROM jobs WHERE id=?").get(Number(job[1])) as { task: string } | undefined;
        return j ? send(res, 200, { id: runner.start(j.task, Number(job[1])) }) : send(res, 404, {});
      }

      if (p === "/humans" && m === "GET") return send(res, 200, runner.pendingHumans());
      const hum = p.match(/^\/humans\/(\w+)$/);
      if (hum && m === "POST") { const b = await body(req); return send(res, runner.resolveHuman(hum[1], b.resolved !== false, b.note) ? 200 : 404, {}); }
      send(res, 404, { error: "not found" });
    } catch (e) {
      send(res, 400, { error: (e as Error).message });
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/ws" || !authed(req, url)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("message", (raw) => {
        try { const m = JSON.parse(String(raw)); if (m.type === "input") void runner.input(m.runId, m.event); } catch {}
      });
    });
  });
  const broadcast = (o: object) => { const s = JSON.stringify(o); for (const c of wss.clients) if (c.readyState === 1) c.send(s); };
  runner.on("event", (e) => broadcast({ type: "event", ...e }));
  runner.on("frame", (f) => broadcast({ type: "frame", ...f }));

  const tick = setInterval(() => {
    const due = db.prepare("SELECT * FROM jobs WHERE enabled=1 AND next_run<=?").all(Date.now()) as { id: number; task: string; cron: string }[];
    for (const j of due) {
      db.prepare("UPDATE jobs SET next_run=? WHERE id=?").run(nextRun(j.cron), j.id);
      runner.start(j.task, j.id);
    }
  }, 15_000);
  server.on("close", () => clearInterval(tick));
  return server;
}
