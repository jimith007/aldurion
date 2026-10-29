# Aldurion

Open source (MIT) agentic browser toolkit. Bring your own LLM provider and MCP servers.

- `packages/browser`: CDP driver (accessibility snapshot, click, type, screenshot)
- `packages/core`: agent loop, provider interface, untrusted-content handling, confirm gates

Planned: MCP client, SQLite scheduler, MV3 extension, Electron shell.

## Dev (Codespaces)
Open in a Codespace, then `chromium --remote-debugging-port=9222 --no-sandbox` (view via the noVNC port 6080), and `npm run build`.
