# claude-p

Run **Claude Code** against **local models (llama.cpp)** and **any OpenRouter model**, as a separate `claude-p` command. Your normal `claude` command and Anthropic account are left alone.

- `claude-p` starts with whichever model you used last.
- Switch models inside Claude Code with **`/model`**. The picker lists the local model plus every OpenRouter model, with context size and price.
- Search the long list with **`/models <words>`**, for example `/models deepseek` or `/models free`.
- The local model is whatever server you run yourself (llama.cpp's `llama-server`, or anything else that speaks the Anthropic Messages API). claude-p only needs its URL.
- **Thinking** from self-hosted models can't render inline in Claude Code's TUI: it only displays thinking whose signature decodes as an Anthropic "narration" envelope (it fails closed on anything else), which a self-hosted model can't produce. The thinking is still used for context. To *see* it live, the router tees it to `thinking.log`; run `claude-p --thinking` (or `thinking.cmd`) in a second terminal to watch the model think in real time. Set `CLAUDE_P_NO_THINK_LOG=1` to disable the tee.

Windows only for now (PowerShell + cmd).

- A **status line** under the prompt shows context usage, e.g. `vast  ·  72k/131k ctx (55%)`. claude-p sets it in its own config on launch (only if you haven't set your own). It reads the window from `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, so it matches the self-hosted server's real size.

## How it works

```
claude-p.ps1 ──starts──> router.js (127.0.0.1:8099, Anthropic-compatible)
     │                      ├─ model "local"  ──> localUrl, e.g. 127.0.0.1:8080 (/v1/messages)
     └─ runs `claude` with  └─ anything else  ──> https://openrouter.ai/api     (Anthropic-compatible)
        ANTHROPIC_BASE_URL=router, CLAUDE_CONFIG_DIR=./config
```

- `claude-p` uses its own Claude Code config dir (`./config`, gitignored), so `/model` choices and sessions stay separate from your regular `claude`. Skills, plugins, agents and your user `CLAUDE.md` are shared with `~/.claude` through links.
- Model ids that don't contain "claude"/"anthropic" are shown as `via-claude/<id>`, because Claude Code's model discovery only keeps ids that match those words. The router strips the prefix.
- Background ("haiku") calls use the model you're currently on.

## Requirements

- Windows 10/11, PowerShell 5.1+
- [Node.js](https://nodejs.org) 18+
- [Claude Code](https://docs.claude.com/en/docs/claude-code) (`npm i -g @anthropic-ai/claude-code`)
- For local models: a running server that speaks the Anthropic Messages API (`/v1/messages`), e.g. a recent [llama.cpp](https://github.com/ggml-org/llama.cpp/releases) `llama-server`
- For OpenRouter models: an [OpenRouter API key](https://openrouter.ai/keys)

## Install

```powershell
git clone git@github.com:chaitanyasiddeshwar/claude-p.git $HOME\.claude-p
cd $HOME\.claude-p
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The installer:
1. writes `config.json` (asks for your local model server's URL);
2. optionally saves your OpenRouter key to `openrouter.key`;
3. puts a `claude-p.cmd` shim in `%USERPROFILE%\.local\bin` and adds that folder to your PATH if needed.

`config.json` and `openrouter.key` are gitignored. The installer never overwrites them.

### Local model

Start your local server the way you normally do. For example:

```
llama-server -m your-model.gguf -c 65536 -ngl 99 --jinja --port 8080
```

claude-p doesn't start or stop it. It sends `local` requests to `localUrl`. With llama-server, claude-p also reads the context size from `/props`, so Claude Code knows when to compact.

## Usage

```
claude-p                         # last-used model
claude-p --model via-claude/local
claude-p --model via-claude/deepseek/deepseek-v4-flash
claude-p --refresh-models        # re-download the OpenRouter model list (otherwise cached 12h)
claude-p --effort low            # any normal claude flags pass through
```

Inside a session: `/model` to switch, `/models <words>` to search.

## Configuration

`config.json` (see `config.example.json`). Environment variables override it.

| key | env var | default | meaning |
|---|---|---|---|
| `localUrl` | `CLAUDE_P_LOCAL_URL` | `http://127.0.0.1:8080` | base URL of your local model server (http or https, optional path) |
| `routerPort` | `CLAUDE_P_ROUTER_PORT` | 8099 | router port |
| (file `openrouter.key`) | `OPENROUTER_API_KEY` | none | OpenRouter key |
| (file `local.key`) | `CLAUDE_P_LOCAL_API_KEY` | none | API key for the local server, sent as `Authorization: Bearer` (e.g. llama-server `--api-key` on a remote GPU) |
| `servers` | none | none | more self-hosted servers, see below |
| `localCtx` | none | live probe | fallback context (tokens) for `local` when its `/props` probe fails |

### More self-hosted servers

Besides `local`, you can add named servers. Each one appears in `/model` as `via-claude/<name>`:

```json
"servers": {
  "vast": { "url": "https://llm.example.com", "keyFile": "vast.key" }
}
```

`keyFile` (default `<name>.key`, relative to this folder, gitignored) holds that server's API key. It is sent as `Authorization: Bearer` and only to that server. Names may only contain letters, digits, `-` and `_`.

Add `"ctx"` (tokens) to a server, and `localCtx` for `local`, so claude-p sets the context window correctly even when the server isn't reachable at launch. Without it, an unreachable self-hosted server makes Claude Code assume a 1M window and overflow the real one.

**Context limit and `/model`:** Claude Code reads the context window once, at launch, from `CLAUDE_CODE_MAX_CONTEXT_TOKENS`. claude-p sets it from the launch model's server (live `/props`, else `ctx`). Switching with `/model` **mid-session does not change it**. So if you launch on a self-hosted model (e.g. 131k) and switch to a 1M OpenRouter model, you stay capped at 131k; switching the other way would overflow. To change the limit, relaunch with `--model <id>`. Switching among models with the same window (e.g. `local` and `vast`, both 131k) is always fine.

**Images with a text-only model:** `WebSearch`/`WebFetch` and image input assume Anthropic's server-side tools, which don't exist behind a non-Anthropic backend. If a message carries an image (a pasted screenshot, an image-returning tool) the router strips `image`/`document` blocks before forwarding to a self-hosted server and replaces them with a text placeholder, so a text-only model (e.g. a coder model with no `mmproj`) doesn't 500. If a server *is* multimodal, add `"vision": true` to its entry to keep images intact.

Debug: set `CLAUDE_P_DEBUG=1` before starting the router to save the last `/v1/messages` request body to `last-request.json`. The router log is `router.log`.

## Web search

`WebSearch`/`WebFetch` are Anthropic **server-side** tools; Claude Code drops them when pointed at a non-Anthropic backend, so self-hosted and OpenRouter models get no search. Give them one with an MCP search server, which is backend-agnostic. Example (DuckDuckGo, no API key; needs [`uv`](https://docs.astral.sh/uv/)):

```
# writes to claude-p's own config dir, not your main `claude`
set CLAUDE_CONFIG_DIR=%USERPROFILE%\.claude-p\config    # PowerShell: $env:CLAUDE_CONFIG_DIR=...
claude mcp add ddg-search --scope user -- uvx duckduckgo-mcp-server
```

The model then has `search` / `fetch_content` tools it can call. (For OpenRouter models only, you can instead append `:online` to the model id to use OpenRouter's own server-side search.)

## Using a cloud GPU as "local"

Run llama-server on a rented GPU (Vast.ai, RunPod, ...) and either tunnel it:

```
ssh -p <port> root@<host> -L 8080:localhost:8080
```

or set `localUrl` to its public address (e.g. a Cloudflare Tunnel hostname). If you expose it to the internet, start llama-server with `--api-key` and put the same key in `local.key`.

## License

MIT. See [LICENSE](LICENSE).
