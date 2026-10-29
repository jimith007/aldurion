# Aldurion

Open source (MIT) agentic browser and coding platform. Bring your own LLM key and your own MCP servers.

## Packages
| Package | What it does | Tested |
|---|---|---|
| `browser` | CDP driver: accessibility snapshot, click, type, screencast, ad/tracker blocking, MHTML capture | real Chrome |
| `core` | agent loop, OpenAI-compatible provider, local-model fallback, `request_human` tool | real Chrome + mock LLM |
| `mcp` | MCP client (stdio and HTTP), MCP tools become agent tools | stdio server |
| `scraper` | page text, links, crawl, plain HTTP fetch | partly (crawl untested) |
| `shield` | secret redaction, prompt-injection flags, egress allow/deny, tool guard | unit + integration |
| `offline` | SQLite full-text page cache, cache-backed navigate and search | unit |
| `sandbox` | per-task Docker sandbox for any language (`sh`, `write_file`, `read_file`) | node image |
| `gateway` | HTTP + WebSocket API, cron scheduler, run history, ntfy push, human handoff | end to end |
| `apps/mobile` | Expo app: run tasks, live browser view, tap/type to clear CAPTCHA and 2FA | **not run on a device yet** |
| `apps/code` | OpenVSCode Server compose file | **not run yet** |

## Human handoff
The agent never bypasses CAPTCHA or 2FA. It calls `request_human`, the run pauses, your phone gets a push (ntfy), and the app streams the live page so you can tap and type. Press Done and the run resumes in the same session.

## Run
```bash
npm install && npm run build && npm test
node packages/gateway/dist/index.js        # prints a token
curl -X PUT localhost:8787/settings -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"baseURL":"https://api.openai.com/v1","apiKey":"sk-...","model":"gpt-4.1","ntfyUrl":"https://ntfy.sh/my-secret-topic"}'
curl -X POST localhost:8787/runs -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"task":"..."}'
```
Any OpenAI-compatible endpoint works (OpenRouter, Ollama, vLLM). Set `offlineBaseURL` and `offlineModel` (for example Ollama at `http://localhost:11434/v1`) to keep working with no internet. Code tasks: `{"task":"...","mode":"code","language":"rust"}`.

## Security notes
Shield reduces risk, it cannot guarantee that data never leaks. The gateway binds to 127.0.0.1 by default; put it behind TLS before exposing it. The LLM key is stored in `~/.aldurion/aldurion.db` (mode 0600), not encrypted.
