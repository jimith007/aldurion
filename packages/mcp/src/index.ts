import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolDef } from "@aldurion/core";

export type McpServerConfig = { name: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> };

export class McpManager {
  private clients = new Map<string, Client>();

  async add(cfg: McpServerConfig) {
    const transport = cfg.url
      ? new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } })
      : new StdioClientTransport({ command: cfg.command!, args: cfg.args, env: { ...(process.env as Record<string, string>), ...cfg.env } });
    const client = new Client({ name: "aldurion", version: "0.0.1" });
    await client.connect(transport);
    this.clients.set(cfg.name, client);
  }

  async tools(): Promise<ToolDef[]> {
    const out: ToolDef[] = [];
    for (const [server, client] of this.clients) {
      for (const t of (await client.listTools()).tools) {
        out.push({
          name: `${server}__${t.name}`.slice(0, 64),
          description: t.description ?? t.name,
          parameters: t.inputSchema as object,
          sensitive: t.annotations?.readOnlyHint !== true,
          run: async (args) => {
            const r: any = await client.callTool({ name: t.name, arguments: args });
            return (r.content ?? []).map((c: any) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
          },
        });
      }
    }
    return out;
  }

  async close() {
    await Promise.all([...this.clients.values()].map((c) => c.close()));
  }
}
