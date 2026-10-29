import http from "node:http";
import assert from "node:assert";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentBrowser } from "../packages/browser/dist/index.js";

process.env.ALDURION_HOME = mkdtempSync(join(tmpdir(), "ald-qa-"));
const { openDb, Runner } = await import("../packages/gateway/dist/index.js");

const site = http.createServer((req, res) => {
  if (req.url === "/dead" || req.url === "/missing.png") { res.statusCode = 404; return res.end("nope"); }
  res.setHeader("content-type", "text/html");
  if (req.url === "/form") return res.end(`<html lang="en"><head><title>Form</title><meta name=viewport content="width=device-width"></head><body><label>Name <input id=n></label><button onclick="throw new Error('submit crashed')">Send</button></body></html>`);
  res.end(`<html><body><img src="/missing.png"><a href="/dead">gone</a><a href="/form">form</a><input name=q><button></button><script>console.error("boom")</script></body></html>`);
}).listen(0);
await new Promise((r) => site.once("listening", r));
const origin = `http://127.0.0.1:${site.address().port}`;

const script = [
  { name: "navigate", args: { url: origin + "/" } }, { name: "check_page", args: {} },
  { name: "navigate", args: { url: origin + "/form" } }, { name: "read_page", args: {} }, { name: "click", args: { ref: 1 } }, { name: "check_page", args: {} },
  { name: "set_viewport", args: { width: 390, height: 844 } },
  { name: "report_bug", args: { title: "Send button throws on click", severity: "high", steps: "open /form, click Send", expected: "form submits", actual: "uncaught error" } },
  { name: "finish_report", args: {} },
];
let turn = 0, sawSystem = false;
const llm = http.createServer(async (req, res) => {
  let b = ""; for await (const c of req) b += c;
  if (JSON.parse(b).messages[0].content.includes("exploratory QA tester")) sawSystem = true;
  const c = script[turn++];
  res.end(JSON.stringify({ choices: [{ message: c ? { content: "", tool_calls: [{ id: String(turn), type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }] } : { content: "QA complete" } }] }));
}).listen(0);
await new Promise((r) => llm.once("listening", r));

const db = openDb();
db.prepare("INSERT INTO settings(k,v) VALUES (?,?),(?,?),(?,?),(?,?)").run("baseURL", `http://127.0.0.1:${llm.address().port}`, "apiKey", "k", "model", "m", "confirmMode", "never");
const runner = new Runner(db, () => AgentBrowser.launch("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", true));
const id = runner.start("test this site", undefined, "qa");
let run;
for (let i = 0; i < 150; i++) { await new Promise((r) => setTimeout(r, 200)); run = db.prepare("SELECT * FROM runs WHERE id=?").get(id); if (run.status !== "running") break; }
assert.equal(run.status, "done", run.result);
assert.ok(sawSystem, "QA charter sent as system prompt");
const md = readFileSync(join(process.env.ALDURION_HOME, "reports", `run-${id}`, "report.md"), "utf8");
for (const want of ["Broken image", "Broken link", "Console error", "Form field without a label", "Missing viewport meta tag", "Uncaught JavaScript error", "Send button throws on click", "Buttons or links with no accessible name"]) assert.ok(md.includes(want), `report missing: ${want}`);
console.log("qa ok");
console.log(md.split("\n").filter((l) => l.startsWith("## ") || l.startsWith("Pages")).slice(0, 14).join("\n"));
site.close(); llm.close(); process.exit(0);
