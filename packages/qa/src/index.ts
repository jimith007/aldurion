import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentBrowser } from "@aldurion/browser";
import type { ToolDef } from "@aldurion/core";

export type Severity = "critical" | "high" | "medium" | "low";
export type Finding = { title: string; severity: Severity; url: string; steps?: string; expected?: string; actual?: string; source: "auto" | "agent"; evidence?: string };

const ORDER: Severity[] = ["critical", "high", "medium", "low"];

export class QaReport {
  findings: Finding[] = [];
  visited = new Set<string>();
  private keys = new Set<string>();
  add(f: Finding) {
    const k = `${f.title}|${f.url}`;
    if (this.keys.has(k)) return false;
    this.keys.add(k);
    this.findings.push(f);
    return true;
  }
  markdown(site: string) {
    const f = [...this.findings].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
    const count = (s: Severity) => f.filter((x) => x.severity === s).length;
    return [
      `# QA report: ${site}`, "",
      `Pages visited: ${this.visited.size}. Findings: ${f.length} (${ORDER.map((s) => `${count(s)} ${s}`).join(", ")}).`, "",
      ...f.flatMap((x, i) => [`## ${i + 1}. [${x.severity}] ${x.title}`, `- URL: ${x.url}`, `- Found by: ${x.source}`, x.steps && `- Steps: ${x.steps}`, x.expected && `- Expected: ${x.expected}`, x.actual && `- Actual: ${x.actual}`, x.evidence && `- Evidence: ${x.evidence}`, ""].filter(Boolean) as string[]),
      "## Pages visited", ...[...this.visited].map((u) => `- ${u}`),
    ].join("\n");
  }
}

export const QA_PROMPT = `You are an exploratory QA tester. Test the target website end to end like a careful human tester.
Method:
1. Map the site: visit the start page, read it, list navigation and links, then visit every distinct page and section you can reach.
2. On each page call check_page. It reports broken images, missing alt text, unlabeled inputs, broken links, console errors and failed requests.
3. Exercise every form and control: empty submit, valid input, invalid input, very long input, special characters, and keyboard use (type with Enter). Try the back button after actions.
4. Resize with set_viewport to a phone size (390x844) and a desktop size (1440x900) and look for layout problems.
5. For every real defect call report_bug with severity, exact steps, expected and actual. Do not report the same defect twice. Do not report guesses; confirm first.
6. Stay in scope: do not delete data, make payments, send messages or change account settings unless the task explicitly allows it. Use test data only.
7. When you have covered the site, call finish_report and give a short summary.`;

export function qaTools(b: AgentBrowser, report: QaReport, outDir: string): ToolDef[] {
  const str = { type: "string" };
  mkdirSync(outDir, { recursive: true });
  const CHECK = `(() => {
    const out = {};
    out.title = document.title; out.lang = document.documentElement.lang; out.viewportMeta = !!document.querySelector('meta[name=viewport]');
    out.brokenImages = [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.src);
    out.imagesWithoutAlt = [...document.images].filter(i => !i.hasAttribute('alt')).length;
    out.unlabeledInputs = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea')].filter(e => !(e.labels && e.labels.length) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')).map(e => e.outerHTML.slice(0, 100));
    out.emptyButtons = [...document.querySelectorAll('button,a[href]')].filter(e => !(e.innerText || '').trim() && !e.getAttribute('aria-label') && !e.querySelector('img[alt]')).length;
    const ids = {}; document.querySelectorAll('[id]').forEach(e => ids[e.id] = (ids[e.id] || 0) + 1);
    out.duplicateIds = Object.keys(ids).filter(k => ids[k] > 1);
    out.horizontalOverflow = document.documentElement.scrollWidth > innerWidth + 1;
    out.links = [...new Set([...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => h.startsWith(location.origin)).map(h => h.split('#')[0]))].slice(0, 30);
    return out; })()`;
  return [
    {
      name: "check_page", description: "Run automated checks on the current page (images, labels, titles, overflow, same-origin links, console errors, failed requests). Findings are added to the report automatically.", parameters: { type: "object", properties: {} },
      run: async () => {
        const url = b.url();
        report.visited.add(url);
        const r: any = await b.evalExpr(CHECK);
        const add = (title: string, severity: Severity, actual: string) => report.add({ title, severity, url, actual, source: "auto" });
        if (!r.title) add("Page has no title", "low", "document.title is empty");
        if (!r.lang) add("Missing html lang attribute", "low", "screen readers cannot pick a language");
        if (!r.viewportMeta) add("Missing viewport meta tag", "medium", "page will not scale correctly on phones");
        for (const s of r.brokenImages) add(`Broken image`, "medium", s);
        if (r.imagesWithoutAlt) add("Images without alt text", "low", `${r.imagesWithoutAlt} images`);
        for (const h of r.unlabeledInputs) add("Form field without a label", "medium", h);
        if (r.emptyButtons) add("Buttons or links with no accessible name", "medium", `${r.emptyButtons} elements`);
        if (r.duplicateIds.length) add("Duplicate element ids", "low", r.duplicateIds.join(", "));
        if (r.horizontalOverflow) add("Horizontal overflow", "medium", "content wider than the viewport");
        const dead: string[] = [];
        await Promise.all(r.links.map(async (l: string) => { try { const x = await fetch(l, { redirect: "follow" }); if (x.status >= 400) { dead.push(`${x.status} ${l}`); add("Broken link", "high", `${x.status} ${l}`); } } catch (e) { dead.push(`unreachable ${l}`); add("Unreachable link", "high", l); } }));
        const issues = b.drainIssues();
        for (const i of issues) add(i.kind === "pageerror" ? "Uncaught JavaScript error" : i.kind === "console" ? "Console error" : "Failed network request", i.kind === "pageerror" ? "high" : i.kind === "http" ? "medium" : "low", i.detail);
        return JSON.stringify({ url, title: r.title, brokenImages: r.brokenImages.length, unlabeledInputs: r.unlabeledInputs.length, deadLinks: dead, consoleAndNetwork: issues.map((i) => i.detail), sameOriginLinks: r.links });
      },
    },
    {
      name: "report_bug", description: "Record a confirmed defect", parameters: { type: "object", properties: { title: str, severity: { type: "string", enum: ORDER }, steps: str, expected: str, actual: str }, required: ["title", "severity", "steps", "expected", "actual"] },
      run: async (a: any) => {
        const shot = join(outDir, `bug-${report.findings.length + 1}.png`);
        await b.screenshotFile(shot).catch(() => {});
        return report.add({ ...a, url: b.url(), source: "agent", evidence: shot }) ? "recorded" : "duplicate, already recorded";
      },
    },
    { name: "set_viewport", description: "Resize the browser viewport", parameters: { type: "object", properties: { width: { type: "number" }, height: { type: "number" } }, required: ["width", "height"] }, run: async ({ width, height }) => (await b.setViewport(width, height), `viewport ${width}x${height}`) },
    { name: "go_back", description: "Browser back button", parameters: { type: "object", properties: {} }, run: async () => (await b.back(), b.url()) },
    {
      name: "finish_report", description: "Write the final report file. Call once when testing is complete.", parameters: { type: "object", properties: {} },
      run: async () => { const file = join(outDir, "report.md"); writeFileSync(file, report.markdown(b.url())); return `report written to ${file}: ${report.findings.length} findings`; },
    },
  ];
}
