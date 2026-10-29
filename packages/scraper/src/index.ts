import type { AgentBrowser } from "@aldurion/browser";
import type { ToolDef } from "@aldurion/core";

export function scraperTools(b: AgentBrowser): ToolDef[] {
  const str = { type: "string" };
  return [
    { name: "get_page_text", description: "Visible text of the current page", parameters: { type: "object", properties: {} }, run: () => b.text() },
    { name: "get_links", description: "All links on the current page as JSON", parameters: { type: "object", properties: {} }, run: async () => JSON.stringify(await b.links()) },
    {
      name: "fetch_url",
      description: "HTTP GET a URL without the browser (APIs, RSS, static pages). Returns text, truncated to 20000 chars",
      parameters: { type: "object", properties: { url: str }, required: ["url"] },
      run: async ({ url }) => {
        const r = await fetch(url, { headers: { "user-agent": "aldurion/0.0.1" } });
        return `${r.status}\n${(await r.text()).slice(0, 20000)}`;
      },
    },
    {
      name: "crawl",
      description: "Breadth-first crawl of up to `limit` same-origin pages starting at the current page. Returns url and first 2000 chars of text per page",
      parameters: { type: "object", properties: { limit: { type: "number" } } },
      run: async ({ limit = 5 }) => {
        const start = b.url();
        const origin = new URL(start).origin;
        const queue = [start], seen = new Set<string>(), pages: { url: string; text: string }[] = [];
        while (queue.length && pages.length < limit) {
          const u = queue.shift()!;
          if (seen.has(u)) continue;
          seen.add(u);
          await b.navigate(u);
          pages.push({ url: u, text: (await b.text()).slice(0, 2000) });
          for (const l of await b.links()) {
            const h = l.href.split("#")[0];
            if (h.startsWith(origin) && !seen.has(h)) queue.push(h);
          }
        }
        return JSON.stringify(pages);
      },
    },
  ];
}
