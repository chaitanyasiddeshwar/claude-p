# claude-p

Run **Claude Code** against **local models (llama.cpp)** and **any OpenRouter model**, as a separate `claude-p` command. Your normal `claude` command and Anthropic account are left alone.

- `claude-p` starts with whichever model you used last.
- Switch models inside Claude Code with **`/model`**. The picker lists the local model plus every OpenRouter model, with context size and price.
- Search the long list with **`/models <words>`**, for example `/models deepseek` or `/models free`.
- The local model is whatever server you run yourself (llama.cpp's `llama-server`, or anything else that speaks the Anthropic Messages API). claude-p only needs its URL.
- Thinking from the local model shows up in Claude Code. The router rewrites llama-server's thinking stream into the shape Claude Code expects.

Windows only for now (PowerShell + cmd).

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

Debug: set `CLAUDE_P_DEBUG=1` before starting the router to save the last `/v1/messages` request body to `last-request.json`. The router log is `router.log`.

## Using a cloud GPU as "local"

Run llama-server on a rented GPU (Vast.ai, RunPod, ...) and either tunnel it:

```
ssh -p <port> root@<host> -L 8080:localhost:8080
```

or set `localUrl` to its public address (e.g. a Cloudflare Tunnel hostname). If you expose it to the internet, start llama-server with `--api-key` and put the same key in `local.key`.

## License

MIT. See [LICENSE](LICENSE).
