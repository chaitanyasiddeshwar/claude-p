# claude-p — notes for Claude

`claude-p` is a launcher (`claude-p.ps1`) plus a small Node router (`router.js`). Together they run Claude Code against a user-run local model server (`localUrl`) or OpenRouter. See README.md for the user-facing picture.

## Layout
- `claude-p.ps1`: entry point. It sets up `./config` (a separate CLAUDE_CONFIG_DIR), syncs `commands/models.md` into it, starts the router, reads the local context size (llama-server `/props`) when the model is local, sets the ANTHROPIC_* env vars, runs `claude`, and detaches from the router on exit.
- `router.js`: Anthropic-compatible HTTP proxy on 127.0.0.1:8099. It routes by `model`: `local` goes to `localUrl`, everything else to OpenRouter. It also serves `/v1/models` for the `/model` picker, hoists `role:"system"` messages, and rewrites llama-server's thinking SSE (`SseThinkingFixer`). It shuts down when the attach count drops to 0.
- `bin/models.js` + `commands/models.md`: the `/models <filter>` slash command. `{{MODELS_JS}}` is filled in by claude-p.ps1.
- `install.ps1`: sets up a new machine (config.json, optional key, `claude-p.cmd` shim on PATH).

## Rules
- **Never commit secrets.** `openrouter.key`, `local.key`, `config.json`, `config/` (has Claude OAuth `.credentials.json`, history, sessions), `models.json`, `*.log` and `last-request.json` are gitignored. Before every commit, run `git status` and check that the staged diff contains no keys (`git diff --cached | grep -iE 'sk-or-|api[_-]?key|bearer [a-z0-9]'`).
- No machine-specific paths in tracked files. Put them in `config.json`, an env var, or `$PSScriptRoot`/`__dirname`.
- The live install is this checkout (usually `%USERPROFILE%\.claude-p`). Changes take effect on the next `claude-p` launch, because the router restarts when the last session exits.
- claude-p never starts or stops the local model server. The user runs it; config holds only its URL.
- Windows-only: PowerShell 5.1 (no `??`, `?.`, `&&`).
- Keep the router dependency-free (Node built-ins only).

## Testing
- `node --check router.js` and `node --check bin/models.js`.
- Run a router on a spare port: `CLAUDE_P_ROUTER_PORT=8098 node router.js`, then `curl 127.0.0.1:8098/v1/models` and stop it with `curl -X POST 127.0.0.1:8098/shutdown`.
- End-to-end: `claude-p --model via-claude/local -p "hi"`, and the same with an OpenRouter model.
- Loading a big model on the owner's PC stalls it for about a minute, so ask before starting one for a test.

## Open work
- Thinking-level control: Claude Code sends `output_config.effort` (low/high/max) and `thinking:{type:"adaptive"}`. llama-server turns thinking off with `chat_template_kwargs.enable_thinking=false`, and accepts `thinking_budget_tokens` / `reasoning_budget_tokens` / `reasoning_effort` (their effect is not yet verified). Still to do: map effort to these fields for local, and to OpenRouter's `reasoning` for remote models.
