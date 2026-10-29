import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDef } from "@aldurion/core";

const run = promisify(execFile);

/** Any language: pick an image, or use "nix" and install the toolchain on demand with `nix-shell -p`. */
export const LANGUAGE_IMAGES: Record<string, string> = {
  python: "python:3.13-slim", node: "node:24-slim", typescript: "node:24-slim", go: "golang:1.24", rust: "rust:1-slim",
  java: "eclipse-temurin:21", kotlin: "eclipse-temurin:21", ruby: "ruby:3.4-slim", php: "php:8.4-cli", dotnet: "mcr.microsoft.com/dotnet/sdk:9.0",
  c: "gcc:14", cpp: "gcc:14", swift: "swift:6.0", dart: "dart:stable", elixir: "elixir:1.18", haskell: "haskell:9", r: "r-base", julia: "julia:1.11", perl: "perl:5", lua: "nickblah/lua", nix: "nixos/nix",
};

export class Sandbox {
  private constructor(readonly id: string, readonly image: string) {}

  static async create(language = "nix", opts: { network?: boolean; memory?: string } = {}) {
    const image = LANGUAGE_IMAGES[language] ?? language;
    const args = ["run", "-d", "--rm", "--memory", opts.memory ?? "1g", "--cpus", "1", "--pids-limit", "256", "--workdir", "/work", ...(opts.network === false ? ["--network", "none"] : []), image, "sleep", "86400"];
    const { stdout } = await run("docker", args);
    const sb = new Sandbox(stdout.trim(), image);
    await sb.exec("mkdir -p /work");
    return sb;
  }

  exec(cmd: string, timeoutMs = 120_000): Promise<{ code: number; out: string }> {
    return new Promise((resolve) => {
      const p = spawn("docker", ["exec", "-w", "/work", this.id, "sh", "-c", cmd]);
      let out = "";
      const take = (d: Buffer) => { if (out.length < 50_000) out += d; };
      p.stdout.on("data", take); p.stderr.on("data", take);
      const t = setTimeout(() => { p.kill(); out += "\n[timeout]"; }, timeoutMs);
      p.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? -1, out }); });
    });
  }

  async writeFile(path: string, content: string) {
    await new Promise<void>((resolve, reject) => {
      const p = spawn("docker", ["exec", "-i", "-w", "/work", this.id, "sh", "-c", `mkdir -p "$(dirname '${path.replace(/'/g, "'\\''")}')" && cat > '${path.replace(/'/g, "'\\''")}'`]);
      p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`write failed ${c}`))));
      p.stdin.end(content);
    });
  }

  async readFile(path: string) {
    const r = await this.exec(`cat '${path.replace(/'/g, "'\\''")}'`);
    if (r.code) throw new Error(r.out);
    return r.out;
  }

  async destroy() {
    await run("docker", ["rm", "-f", this.id]).catch(() => {});
  }
}

export function sandboxTools(sb: Sandbox): ToolDef[] {
  const str = { type: "string" };
  return [
    { name: "sh", description: "Run a shell command in the sandbox (cwd /work). Install toolchains with the image's package manager or `nix-shell -p <pkg> --run '...'`", parameters: { type: "object", properties: { cmd: str }, required: ["cmd"] }, run: async ({ cmd }) => { const r = await sb.exec(cmd); return `exit ${r.code}\n${r.out}`; } },
    { name: "write_file", description: "Write a file in /work", parameters: { type: "object", properties: { path: str, content: str }, required: ["path", "content"] }, run: async ({ path, content }) => (await sb.writeFile(path, content), "ok") },
    { name: "read_file", description: "Read a file in /work", parameters: { type: "object", properties: { path: str }, required: ["path"] }, run: ({ path }) => sb.readFile(path) },
  ];
}
