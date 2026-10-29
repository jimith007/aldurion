import http from "node:http";
import assert from "node:assert";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ALDURION_HOME = mkdtempSync(join(tmpdir(), "ald-api-"));
const { openDb, Runner, createGateway } = await import("../packages/gateway/dist/index.js");

const target = http.createServer(async (req, res) => {
  let b = ""; for await (const c of req) b += c;
  const j = (code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (req.method === "POST" && req.url === "/users") return j(201, { id: 7, name: JSON.parse(b).name });
  if (req.url === "/users/7") return j(200, { id: 7, name: "Ada" });
  if (req.url === "/users/999") return j(404, { error: "not found" });
  if (req.url === "/me") return j(req.headers.authorization === "Bearer secret123" ? 200 : 401, { me: true });
  j(500, { error: "boom" });
}).listen(0);
await new Promise((r) => target.once("listening", r));
const origin = `http://127.0.0.1:${target.address().port}`;

const collection = JSON.stringify({ variable: [{ key: "base", value: origin }], item: [{ name: "get user", request: { method: "GET", url: { raw: "{{base}}/users/7" } } }, { name: "folder", item: [{ name: "bad", request: { method: "GET", url: "{{base}}/bad" } }] }] });
const script = [
  { name: "http_request", args: { method: "POST", url: origin + "/users", body: { name: "Ada" }, expect: { status: 201, json: { name: "Ada" } }, save: { uid: "id" } } },
  { name: "http_request", args: { method: "GET", url: origin + "/users/{{uid}}", expect: { status: 200, json: { id: 7 } } } },
  { name: "http_request", args: { method: "GET", url: origin + "/users/999", expect: { status: 404 } } },
  { name: "http_request", args: { method: "GET", url: origin + "/me", headers: { Authorization: "Bearer {{token}}" }, expect: { status: 200 } } },
  { name: "http_request", args: { method: "GET", url: origin + "/bad", expect: { status: 200 } } },
  { name: "import_postman", args: { json: collection } },
  { name: "run_collection", args: {} },
  { name: "finish_api_report", args: {} },
];
let turn = 0; const firstReqs = [];
const llm = http.createServer(async (req, res) => {
  let b = ""; for await (const c of req) b += c;
  const m = JSON.parse(b).messages;
  if (m.length === 2) firstReqs.push(m);
  const c = script[turn++];
  res.end(JSON.stringify({ choices: [{ message: c ? { content: "", tool_calls: [{ id: String(turn), type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }] } : { content: "API tests complete" } }] }));
}).listen(0);
await new Promise((r) => llm.once("listening", r));

const db = openDb();
const runner = new Runner(db, async () => { throw new Error("no browser needed"); });
const gw = createGateway(db, runner, "tok").listen(0);
await new Promise((r) => gw.once("listening", r));
const base = `http://127.0.0.1:${gw.address().port}`;
const api = async (m, p, b) => (await fetch(base + p, { method: m, headers: { authorization: "Bearer tok", "content-type": "application/json" }, body: b && JSON.stringify(b) })).json();
await api("PUT", "/settings", { baseURL: `http://127.0.0.1:${llm.address().port}`, apiKey: "k", model: "m", confirmMode: "never", apiVars: { token: "secret123" } });
assert.deepEqual((await api("GET", "/settings")).apiVars, ["token"], "api var values never returned");

const { id } = await api("POST", "/scenarios", { name: "User CRUD", kind: "api", target: origin, steps: "create a user\nfetch the user\nfetch an unknown user", expect: "404 for unknown" });
await api("PUT", `/scenarios/${id}`, { name: "User CRUD v2", kind: "api", target: origin, steps: "create a user\nfetch the user\nfetch an unknown user\ncall /me with the token", expect: "all pass except known bad endpoint" });
const got = await api("GET", `/scenarios/${id}`);
assert.equal(got.name, "User CRUD v2");
assert.match(got.compiled.task, /4\. call \/me with the token/);
await assert.rejects(async () => { const r = await api("POST", "/scenarios", { name: "x" }); if (r.error) throw new Error(r.error); }, /needs name/);

const { id: runId } = await api("POST", `/scenarios/${id}/run`);
let run;
for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 100)); run = await api("GET", `/runs/${runId}`); if (run.status !== "running") break; }
assert.equal(run.status, "done", run.result);
assert.match(firstReqs[0][0].content, /API tester/);
assert.match(firstReqs[0][1].content, /Scenario "User CRUD v2"[\s\S]*Steps:[\s\S]*1\. create a user/);
const md = readFileSync(join(process.env.ALDURION_HOME, "reports", `run-${runId}`, "api-report.md"), "utf8");
assert.match(md, /5\/7 passed/);
assert.match(md, /FAIL \| GET .*\/bad \| 500/);
assert.match(md, /PASS \| get user/);

const job = await api("POST", "/jobs", { name: "nightly", task: `scenario:${id}`, cron: "0 3 * * *" });
const viaJob = await api("POST", `/jobs/${job.id}/run`);
await new Promise((r) => setTimeout(r, 400));
assert.match((await api("GET", `/runs/${viaJob.id}`)).task, /^Scenario "User CRUD v2"/);
console.log("api+scenarios ok");
console.log(md.split("\n").slice(0, 12).join("\n"));
gw.close(); llm.close(); target.close(); process.exit(0);
