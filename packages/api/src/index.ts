import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolDef } from "@aldurion/core";

export type Expect = { status?: number; bodyContains?: string; json?: Record<string, unknown>; maxMs?: number };
export type ApiCase = { name?: string; method: string; url: string; headers?: Record<string, string>; body?: unknown; expect?: Expect; save?: Record<string, string> };
export type ApiResult = { name: string; method: string; url: string; status: number; ms: number; pass: boolean; failures: string[] };

export const getPath = (obj: unknown, path: string): unknown =>
  path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean).reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);

export const API_PROMPT = `You are an API tester, like Postman but automatic. Given requests, a collection, or a description of an API, send the requests with http_request, always with expect assertions (status, json values, maxMs), and chain them with save (store response values into variables, reuse as {{name}}). Also try negative cases: missing fields, wrong types, bad auth, unknown ids. Never put secrets in tool arguments; use {{variables}} that the owner configured. When done call finish_api_report and summarise failures.`;

export class ApiRun {
  results: ApiResult[] = [];
  collection: ApiCase[] = [];
  constructor(public vars: Record<string, string> = {}, public outDir = "") {}
  sub<T>(v: T): T {
    return JSON.parse(JSON.stringify(v).replace(/\{\{(\w+)\}\}/g, (_, k) => (k in this.vars ? JSON.stringify(this.vars[k]).slice(1, -1) : `{{${k}}}`)));
  }
  async send(c: ApiCase): Promise<ApiResult & { body: string }> {
    const r = this.sub(c);
    const body = r.body === undefined || typeof r.body === "string" ? (r.body as string | undefined) : JSON.stringify(r.body);
    const headers = { ...(body && typeof r.body !== "string" ? { "content-type": "application/json" } : {}), ...r.headers };
    const t0 = performance.now();
    let status = 0, text = "", failures: string[] = [];
    try {
      const res = await fetch(r.url, { method: r.method, headers, body: r.method === "GET" || r.method === "HEAD" ? undefined : body, signal: AbortSignal.timeout(30_000) });
      status = res.status;
      text = await res.text();
    } catch (e) {
      failures.push(`request failed: ${(e as Error).message}`);
    }
    const ms = Math.round(performance.now() - t0);
    let json: unknown;
    try { json = JSON.parse(text); } catch {}
    const e = r.expect;
    if (e?.status !== undefined && status !== e.status) failures.push(`status ${status}, expected ${e.status}`);
    if (e?.bodyContains && !text.includes(e.bodyContains)) failures.push(`body does not contain "${e.bodyContains}"`);
    if (e?.maxMs !== undefined && ms > e.maxMs) failures.push(`took ${ms}ms, limit ${e.maxMs}ms`);
    for (const [p, want] of Object.entries(e?.json ?? {})) { const got = getPath(json, p); if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${p} = ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`); }
    for (const [name, p] of Object.entries(c.save ?? {})) { const v = getPath(json, p); if (v !== undefined) this.vars[name] = String(v); else failures.push(`save: ${p} not found in response`); }
    const result = { name: r.name ?? `${r.method} ${r.url}`, method: r.method, url: r.url, status, ms, pass: failures.length === 0 && (!e || status > 0), failures };
    this.results.push(result);
    return { ...result, body: text };
  }
  markdown() {
    const pass = this.results.filter((x) => x.pass).length;
    return [`# API test report`, "", `${pass}/${this.results.length} passed.`, "", "| | Name | Status | ms | Failures |", "|---|---|---|---|---|",
      ...this.results.map((x) => `| ${x.pass ? "PASS" : "FAIL"} | ${x.name} | ${x.status} | ${x.ms} | ${x.failures.join("; ") || ""} |`)].join("\n");
  }
}

/** Postman Collection v2.1 to flat cases. Postman test scripts (pm.test) are not executed; use `expect` instead. */
export function importPostman(collection: any): { cases: ApiCase[]; vars: Record<string, string> } {
  const cases: ApiCase[] = [];
  const walk = (items: any[]) => {
    for (const it of items ?? []) {
      if (it.item) { walk(it.item); continue; }
      const q = it.request; if (!q) continue;
      const raw = typeof q.url === "string" ? q.url : q.url?.raw ?? "";
      let body: unknown = q.body?.mode === "raw" ? q.body.raw : undefined;
      try { if (typeof body === "string") body = JSON.parse(body); } catch {}
      cases.push({ name: it.name, method: (q.method ?? "GET").toUpperCase(), url: raw, headers: Object.fromEntries((q.header ?? []).filter((h: any) => !h.disabled).map((h: any) => [h.key, h.value])), body });
    }
  };
  walk(collection.item);
  return { cases, vars: Object.fromEntries((collection.variable ?? []).map((v: any) => [v.key, String(v.value ?? "")])) };
}

export function apiTools(run: ApiRun): ToolDef[] {
  const str = { type: "string" }, obj = { type: "object" };
  const summary = (r: ApiResult & { body: string }) => `${r.pass ? "PASS" : "FAIL"} ${r.method} ${r.url} -> ${r.status} in ${r.ms}ms${r.failures.length ? `\nfailures: ${r.failures.join("; ")}` : ""}\n${r.body.slice(0, 3000)}`;
  return [
    {
      name: "http_request", description: "Send an HTTP request and check it. {{var}} placeholders are replaced from variables. expect: {status, bodyContains, json:{'path.to.field': value}, maxMs}. save: {varName: 'json.path'} stores response values.",
      parameters: { type: "object", properties: { name: str, method: str, url: str, headers: obj, body: {}, expect: obj, save: obj }, required: ["method", "url"] },
      run: async (a: ApiCase) => summary(await run.send(a)),
    },
    { name: "set_var", description: "Set a variable for {{name}} substitution", parameters: { type: "object", properties: { name: str, value: str }, required: ["name", "value"] }, run: async ({ name, value }) => ((run.vars[name] = value), "ok") },
    {
      name: "import_postman", description: "Load a Postman collection (v2.1 JSON text). Then call run_collection.", parameters: { type: "object", properties: { json: str }, required: ["json"] },
      run: async ({ json }) => { const { cases, vars } = importPostman(JSON.parse(json)); run.collection = cases; Object.assign(run.vars, vars); return `${cases.length} requests loaded: ${cases.map((c) => c.name).join(", ")}`; },
    },
    {
      name: "run_collection", description: "Run all imported requests in order (no assertions unless you add them; status < 400 counts as pass)", parameters: { type: "object", properties: {} },
      run: async () => {
        const out: string[] = [];
        for (const c of run.collection) { const r = await run.send({ ...c, expect: c.expect ?? {} }); if (r.status >= 400 && !r.failures.length) { r.pass = false; r.failures.push(`status ${r.status}`); run.results[run.results.length - 1] = r; } out.push(`${r.pass ? "PASS" : "FAIL"} ${r.name} ${r.status} ${r.ms}ms ${r.failures.join("; ")}`); }
        return out.join("\n");
      },
    },
    {
      name: "finish_api_report", description: "Write the report file", parameters: { type: "object", properties: {} },
      run: async () => { mkdirSync(run.outDir, { recursive: true }); const f = join(run.outDir, "api-report.md"); writeFileSync(f, run.markdown()); return `written ${f}: ${run.results.filter((x) => x.pass).length}/${run.results.length} passed`; },
    },
  ];
}
