import { DatabaseSync } from "node:sqlite";
import type { ToolDef } from "@aldurion/core";

export type CachedPage = { url: string; title: string; text: string; saved: number; mhtml?: string };

/** Everything the agent reads is stored locally with full-text search, so research survives flight mode. */
export class PageCache {
  private db: DatabaseSync;
  constructor(file = ":memory:") {
    this.db = new DatabaseSync(file);
    this.db.exec(`CREATE TABLE IF NOT EXISTS pages (url TEXT PRIMARY KEY, title TEXT, text TEXT, saved INTEGER, mhtml TEXT);
      CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(url UNINDEXED, title, text);`);
  }

  save(p: Omit<CachedPage, "saved">) {
    this.db.prepare("DELETE FROM pages_fts WHERE url=?").run(p.url);
    this.db.prepare("INSERT INTO pages(url,title,text,saved,mhtml) VALUES(?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET title=excluded.title,text=excluded.text,saved=excluded.saved,mhtml=excluded.mhtml").run(p.url, p.title, p.text, Date.now(), p.mhtml ?? null);
    this.db.prepare("INSERT INTO pages_fts(url,title,text) VALUES(?,?,?)").run(p.url, p.title, p.text);
  }

  get(url: string) { return this.db.prepare("SELECT url,title,text,saved,mhtml FROM pages WHERE url=?").get(url) as CachedPage | undefined; }

  search(query: string, limit = 5) {
    const q = query.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean).map((w) => `"${w}"`).join(" OR ");
    if (!q) return [];
    return this.db.prepare("SELECT url, title, snippet(pages_fts, 2, '[', ']', ' ... ', 24) AS snippet FROM pages_fts WHERE pages_fts MATCH ? ORDER BY rank LIMIT ?").all(q, limit) as { url: string; title: string; snippet: string }[];
  }
}

/** Tools that work with no network at all. */
export function offlineTools(cache: PageCache): ToolDef[] {
  const str = { type: "string" };
  return [
    { name: "search_cache", description: "Full-text search of every page read so far (works offline)", parameters: { type: "object", properties: { query: str }, required: ["query"] }, run: async ({ query }) => JSON.stringify(cache.search(query)) },
    { name: "read_cached", description: "Read a previously saved page by URL (works offline)", parameters: { type: "object", properties: { url: str }, required: ["url"] }, run: async ({ url }) => { const p = cache.get(url); return p ? `saved ${new Date(p.saved).toISOString()}\n# ${p.title}\n${p.text.slice(0, 20000)}` : "not in cache"; } },
  ];
}

/** After a successful online read, store the page. Offline, navigation falls back to the cache. */
export function cachingTools(tools: ToolDef[], cache: PageCache, page: { url(): string; title(): Promise<string>; text(): Promise<string>; mhtml(): Promise<string> }): ToolDef[] {
  const snap = async () => { try { cache.save({ url: page.url(), title: await page.title(), text: await page.text(), mhtml: await page.mhtml() }); } catch {} };
  return tools.map((t) => {
    if (!["navigate", "get_page_text", "read_page"].includes(t.name)) return t;
    return {
      ...t,
      run: async (args: any) => {
        try {
          const out = await t.run(args);
          if (t.name !== "read_page") await snap();
          return out;
        } catch (e) {
          if (t.name === "navigate" && args?.url) { const p = cache.get(args.url); if (p) return `offline, served from cache (saved ${new Date(p.saved).toISOString()}):\n# ${p.title}\n${p.text.slice(0, 20000)}`; }
          throw e;
        }
      },
    };
  });
}
