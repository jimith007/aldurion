import { EventEmitter } from "node:events";
import { AgentBrowser } from "@aldurion/browser";
import { FallbackProvider, OpenAICompatible, browserTools, humanTool, runAgent, type HumanKind, type ToolDef } from "@aldurion/core";
import { PageCache, cachingTools, offlineTools } from "@aldurion/offline";
import { Sandbox, sandboxTools } from "@aldurion/sandbox";
import { QA_PROMPT, QaReport, qaTools } from "@aldurion/qa";
import { EgressPolicy, guardTools } from "@aldurion/shield";
import { join } from "node:path";
import { McpManager, type McpServerConfig } from "@aldurion/mcp";
import { scraperTools } from "@aldurion/scraper";
import { HOME, getSetting, type Db } from "./db.js";
import { API_PROMPT, ApiRun, apiTools } from "@aldurion/api";
import { compileScenario, getScenario, type Mode } from "./scenarios.js";
import { NoopNotifier, Ntfy, type Notifier } from "./push.js";

export type Human = { id: string; runId: number; kind: HumanKind; reason: string };
type Pending = Human & { resolve: (r: { resolved: boolean; note?: string }) => void };

export class Runner extends EventEmitter {
  private browsers = new Map<number, AgentBrowser>();
  private humans = new Map<string, Pending>();
  private seq = 0;
  private cache = new PageCache(process.env.ALDURION_CACHE ?? join(HOME, "cache.db"));

  constructor(private db: Db, private launchBrowser: () => Promise<AgentBrowser>, private humanTimeoutMs = 15 * 60_000) { super(); }

  pendingHumans(): Human[] {
    return [...this.humans.values()].map(({ resolve, ...h }) => h);
  }

  resolveHuman(id: string, resolved: boolean, note?: string) {
    const h = this.humans.get(id);
    if (!h) return false;
    h.resolve({ resolved, note });
    return true;
  }

  async input(runId: number, e: Parameters<AgentBrowser["input"]>[0]) {
    await this.browsers.get(runId)?.input(e);
  }

  private notifier(): Notifier {
    const url = getSetting(this.db, "ntfyUrl");
    return url ? new Ntfy(url) : new NoopNotifier();
  }

  start(task: string, jobId?: number, mode: Mode = "browser", language = "nix"): number {
    const ref = task.match(/^scenario:(\d+)$/);
    if (ref) {
      const sc = getScenario(this.db, Number(ref[1]));
      if (!sc) throw new Error(`scenario ${ref[1]} not found`);
      ({ task, mode } = compileScenario(sc));
    }
    const started = Date.now();
    const id = Number(this.db.prepare("INSERT INTO runs(job_id,task,status,started) VALUES(?,?,?,?)").run(jobId ?? null, task, "running", started).lastInsertRowid);
    void this.execute(id, task, mode, language);
    return id;
  }

  private async execute(runId: number, task: string, mode: Mode, language: string) {
    const events: unknown[] = [];
    const emit = (e: object) => { events.push(e); this.emit("event", { runId, ...e }); };
    const mcp = new McpManager();
    let browser: AgentBrowser | undefined;
    let sandbox: Sandbox | undefined;
    let status = "done", result = "";
    try {
      const baseURL = getSetting(this.db, "baseURL"), apiKey = getSetting(this.db, "apiKey"), model = getSetting(this.db, "model");
      if (!baseURL || !apiKey || !model) throw new Error("LLM not configured: PUT /settings with baseURL, apiKey, model");
      if (mode === "browser" || mode === "qa") {
        browser = await this.launchBrowser();
        this.browsers.set(runId, browser);
        if (getSetting(this.db, "adblock") !== "off") await browser.blockAds();
      } else if (mode === "code") sandbox = await Sandbox.create(language);
      for (const cfg of JSON.parse(getSetting(this.db, "mcpServers") ?? "[]") as McpServerConfig[]) {
        await mcp.add(cfg).catch((e) => emit({ type: "text", text: `mcp ${cfg.name} failed: ${e.message}` }));
      }
      const ask = async (kind: HumanKind, reason: string) => {
        const id = `h${++this.seq}`;
        const wait = new Promise<{ resolved: boolean; note?: string }>((resolve) => {
          const timer = setTimeout(() => done({ resolved: false, note: "timeout" }), this.humanTimeoutMs);
          const done = (r: { resolved: boolean; note?: string }) => { clearTimeout(timer); this.humans.delete(id); resolve(r); };
          this.humans.set(id, { id, runId, kind, reason, resolve: done });
        });
        emit({ type: "human", id, kind, reason });
        await browser?.startScreencast((data) => this.emit("frame", { runId, data }));
        void this.notifier().notify(`Aldurion needs you (${kind})`, reason, { urgent: true });
        const r = await wait;
        await browser?.stopScreencast();
        emit({ type: "human_done", id, ...r });
        return r;
      };
      const alert = (a: { kind: string; tool: string; detail: string }) => { emit({ type: "alert", ...a }); void this.notifier().notify(`Aldurion blocked a ${a.kind} risk`, `${a.tool}: ${a.detail}`, { urgent: a.kind !== "secret" }); };
      const csv = (k: string) => (getSetting(this.db, k) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      const egress = new EgressPolicy(csv("egressAllow").length ? csv("egressAllow") : ["*"], csv("egressDeny"));
      const base: ToolDef[] = browser
        ? [...cachingTools([...browserTools(browser), ...scraperTools(browser)], this.cache, { url: () => browser!.url(), title: () => browser!.title(), text: () => browser!.text(), mhtml: () => browser!.mhtml() }), ...offlineTools(this.cache)]
        : mode === "api" ? apiTools(new ApiRun(JSON.parse(getSetting(this.db, "apiVars") ?? "{}"), join(HOME, "reports", `run-${runId}`))) : sandboxTools(sandbox!);
      const report = new QaReport();
      const qa = mode === "qa" ? qaTools(browser!, report, join(HOME, "reports", `run-${runId}`)) : [];
      const tools = [...guardTools([...base, ...qa, ...(await mcp.tools())], { egress, onAlert: alert }), humanTool({ ask })];
      const primary = new OpenAICompatible({ baseURL, apiKey, model });
      const localURL = getSetting(this.db, "offlineBaseURL"), localModel = getSetting(this.db, "offlineModel");
      const provider = localURL && localModel ? new FallbackProvider(primary, new OpenAICompatible({ baseURL: localURL, apiKey: "local", model: localModel }), (e) => emit({ type: "text", text: `offline, using local model (${e.message})` })) : primary;
      const confirm = getSetting(this.db, "confirmMode") === "never" ? undefined : async (c: { name: string; args: unknown }) => (await ask("approve", `Allow ${c.name} ${JSON.stringify(c.args).slice(0, 200)}?`)).resolved;
      result = await runAgent({ provider, tools, task, confirm, onEvent: emit, system: mode === "qa" ? QA_PROMPT : mode === "api" ? API_PROMPT : undefined });
    } catch (e) {
      status = "error";
      result = (e as Error).message;
    } finally {
      this.browsers.delete(runId);
      await browser?.close().catch(() => {});
      await sandbox?.destroy();
      await mcp.close().catch(() => {});
      this.db.prepare("UPDATE runs SET status=?, finished=?, result=?, events=? WHERE id=?").run(status, Date.now(), result, JSON.stringify(events), runId);
      this.emit("event", { runId, type: "finished", status, result });
      void this.notifier().notify(`Run ${runId} ${status}`, result.slice(0, 300));
    }
  }
}
