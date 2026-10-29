import http from "node:http";
import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentBrowser } from "../packages/browser/dist/index.js";

process.env.ALDURION_HOME = mkdtempSync(join(tmpdir(), "ald-"));
const { openDb, Runner, createGateway } = await import("../packages/gateway/dist/index.js");

const page = `<h1>Shop</h1><button onclick="document.title='clicked'">Buy</button>`;
const script = [
  [{ id: "1", name: "navigate", args: { url: "data:text/html," + encodeURIComponent(page) } }],
  [{ id: "2", name: "read_page", args: {} }],
  [{ id: "3", name: "click", args: { ref: 1 } }],
  [{ id: "4", name: "request_human", args: { kind: "captcha", reason: "solve the captcha" } }],
  [{ id: "5", name: "get_page_text", args: {} }],
];
let turn = 0;
const llm = http.createServer(async (req, res) => {
  for await (const _ of req);
  const calls = script[turn++];
  const message = calls ? { content: "", tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : { content: "all done" };
  res.end(JSON.stringify({ choices: [{ message }] }));
}).listen(0);
await new Promise((r) => llm.once("listening", r));

const db = openDb();
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const runner = new Runner(db, () => AgentBrowser.launch(chrome, true), 20000);
const gw = createGateway(db, runner, "tok").listen(0);
await new Promise((r) => gw.once("listening", r));
const base = `http://127.0.0.1:${gw.address().port}`;
const api = async (m, p, b) => (await fetch(base + p, { method: m, headers: { authorization: "Bearer tok", "content-type": "application/json" }, body: b && JSON.stringify(b) })).json();

assert.equal((await fetch(base + "/jobs")).status, 401, "auth required");
await api("PUT", "/settings", { baseURL: `http://127.0.0.1:${llm.address().port}`, apiKey: "k-test-1234", model: "m", confirmMode: "never" });
assert.equal((await api("GET", "/settings")).apiKey, "...1234");

const { default: WebSocket } = await import("ws");
const wsMsgs = [];
const sock = new WebSocket(base.replace("http", "ws") + "/ws?token=tok");
sock.on("message", (m) => wsMsgs.push(JSON.parse(String(m))));
await new Promise((r) => sock.once("open", r));
const { id } = await api("POST", "/runs", { task: "buy it" });
let human;
for (let i = 0; i < 100 && !human; i++) { await new Promise((r) => setTimeout(r, 200)); human = (await api("GET", "/humans"))[0]; }
assert.ok(human, "agent paused for human");
assert.equal(human.kind, "captcha");
for (let i = 0; i < 50 && !wsMsgs.some((m) => m.type === "frame"); i++) await new Promise((r) => setTimeout(r, 100));
assert.ok(wsMsgs.some((m) => m.type === "human" && m.id === human.id), "ws got human request");
assert.ok(wsMsgs.some((m) => m.type === "frame" && m.data.length > 100), "ws streamed screencast frames");
sock.send(JSON.stringify({ type: "input", runId: id, event: { type: "tap", x: 0.1, y: 0.1 } }));
await api("POST", `/humans/${human.id}`, { resolved: true, note: "solved" });
for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 200)); const r = await api("GET", `/runs/${id}`); if (r.status !== "running") { assert.equal(r.status, "done", r.result); assert.equal(r.result, "all done"); break; } }
const run = await api("GET", `/runs/${id}`);
const ev = JSON.parse(run.events);
assert.ok(ev.some((e) => e.type === "tool" && e.name === "read_page" && e.result.includes('button "Buy"')), "snapshot saw the button");
assert.ok(ev.some((e) => e.type === "human_done" && e.resolved), "human resolved");

assert.ok(wsMsgs.some((m) => m.type === "finished"), "ws got finished");
const job = await api("POST", "/jobs", { name: "t", task: "x", cron: "*/5 * * * *" });
assert.ok(job.next_run > Date.now());
assert.equal((await api("GET", "/jobs")).length, 1);
console.log("e2e ok", { runId: id, events: ev.length });
gw.close(); llm.close(); process.exit(0);
