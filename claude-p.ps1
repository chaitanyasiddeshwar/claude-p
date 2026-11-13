# claude-p: Claude Code via a local router -> your local model server (via-claude/local) or OpenRouter (everything else).
# Uses the model you picked last time; switch with /model inside Claude Code.
# Usage: claude-p [--refresh-models] [any claude args, e.g. --model via-claude/local]
$ErrorActionPreference = 'Stop'
$dir        = $PSScriptRoot
$cfgDir     = Join-Path $dir 'config'        # Claude Code config dir for claude-p (gitignored: holds sessions/credentials)
$settings   = Join-Path $cfgDir 'settings.json'
$cache      = Join-Path $dir 'models.json'
$userCfg    = $null
try { $userCfg = Get-Content (Join-Path $dir 'config.json') -Raw | ConvertFrom-Json } catch {}
$routerPort = if ($env:CLAUDE_P_ROUTER_PORT) { [int]$env:CLAUDE_P_ROUTER_PORT } elseif ($userCfg -and $userCfg.routerPort) { [int]$userCfg.routerPort } else { 8099 }
$router     = "http://127.0.0.1:$routerPort"
$defaultModel = 'via-claude/local'

$ClaudeArgs = @()
foreach ($a in $args) {
    if ($a -eq '--refresh-models') { Remove-Item $cache -ErrorAction SilentlyContinue; Remove-Item (Join-Path $cfgDir 'cache\gateway-models.json') -ErrorAction SilentlyContinue }
    else { $ClaudeArgs += $a }
}

# ---- separate config dir so /model choices don't touch the regular `claude` ----
if (-not (Test-Path $cfgDir)) {
    New-Item -ItemType Directory -Force $cfgDir | Out-Null
    $main = Join-Path $env:USERPROFILE '.claude'
    $s = @{}
    $mainSettings = Join-Path $main 'settings.json'
    if (Test-Path $mainSettings) {
        $obj = Get-Content $mainSettings -Raw | ConvertFrom-Json
        foreach ($p in $obj.PSObject.Properties) { $s[$p.Name] = $p.Value }
    }
    $s['model'] = $defaultModel
    $s["showThinkingSummaries"] = $true
    $s | ConvertTo-Json -Depth 10 | Set-Content $settings -Encoding utf8
    # Share skills, plugins and user CLAUDE.md with the main config.
    foreach ($d in 'skills', 'plugins', 'agents', 'commands') {
        $src = Join-Path $main $d
        if (Test-Path $src) { cmd /c mklink /J "$(Join-Path $cfgDir $d)" "$src" | Out-Null }
    }
    $md = Join-Path $main 'CLAUDE.md'
    if (Test-Path $md) { cmd /c mklink /H "$(Join-Path $cfgDir 'CLAUDE.md')" "$md" | Out-Null }
}

# ---- /models slash command (kept in sync with the repo copy on every launch) ----
$cmdDir = Join-Path $cfgDir 'commands'
$cmdIsJunction = (Test-Path $cmdDir) -and ((Get-Item $cmdDir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)
if (-not $cmdIsJunction) {   # never write into the main ~/.claude/commands through the junction
    New-Item -ItemType Directory -Force $cmdDir | Out-Null
    $modelsJs = (Join-Path $dir 'bin\models.js') -replace '\\', '/'
    $text = (Get-Content (Join-Path $dir 'commands\models.md') -Raw).Replace('{{MODELS_JS}}', $modelsJs)
    $dst = Join-Path $cmdDir 'models.md'
    if (-not (Test-Path $dst) -or (Get-Content $dst -Raw) -ne $text) { [IO.File]::WriteAllText($dst, $text) }
}

# ---- figure out the saved model (for the context-window hint) ----
$model = $defaultModel
try {
    $raw = Get-Content $settings -Raw
    $m = ($raw | ConvertFrom-Json).model
    if ($m -match '^(via-claude|claude-p)/local/') {
        # Older claude-p had two local entries; there is now just one.
        $raw = $raw -replace [regex]::Escape("`"$m`""), "`"$defaultModel`""
        [IO.File]::WriteAllText($settings, $raw)
        $m = $defaultModel
    }
    if ($m) { $model = $m }
} catch {}
for ($i = 0; $i -lt $ClaudeArgs.Count - 1; $i++) { if ($ClaudeArgs[$i] -eq '--model') { $model = $ClaudeArgs[$i + 1] } }
$model = $model -replace '\[1m\]$', '' -replace '^(via-claude|claude-p)/', ''
$isLocal = $model -eq 'local' -or $model -like 'local/*'

# ---- start the router if needed ----
function Test-Router { try { (Invoke-WebRequest "$router/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false } }
if (-not (Test-Router)) {
    $env:CLAUDE_P_START_MODEL = $model
    Start-Process -FilePath 'node' -ArgumentList "`"$(Join-Path $dir 'router.js')`"" -WindowStyle Hidden | Out-Null
    for ($i = 0; $i -lt 50 -and -not (Test-Router); $i++) { Start-Sleep -Milliseconds 200 }
    if (-not (Test-Router)) { throw "Router failed to start; see $dir\router.log" }
}
$null = Invoke-WebRequest "$router/attach" -Method Post -UseBasicParsing

# ---- context window for the starting model ----
$ctx = $null
if ($isLocal) {
    try {
        $p = Invoke-RestMethod "$router/local/ctx" -TimeoutSec 10
        $ctx = [int]$p.n_ctx
        Write-Host "Local model: $($p.model), $ctx tokens context"
    } catch {
        $msg = $_.ErrorDetails.Message
        try { $msg = ($msg | ConvertFrom-Json).error } catch {}
        Write-Warning "Local model: $(if ($msg) { $msg } else { $_ }). Start your local server, or switch with /model."
    }
} elseif (Test-Path $cache) {
    $hit = (Get-Content $cache -Raw -Encoding utf8 | ConvertFrom-Json) | ForEach-Object { $_ } | Where-Object { $_.id -eq $model } | Select-Object -First 1
    if ($hit -and $hit.context_length) { $ctx = [int]$hit.context_length }
}

# ---- environment for this process only ----
Remove-Item Env:ANTHROPIC_API_KEY, Env:ANTHROPIC_MODEL, Env:ANTHROPIC_DEFAULT_OPUS_MODEL, Env:ANTHROPIC_DEFAULT_SONNET_MODEL, Env:CLAUDE_CODE_SUBAGENT_MODEL -ErrorAction SilentlyContinue
$env:CLAUDE_CONFIG_DIR             = $cfgDir
$env:ANTHROPIC_BASE_URL            = $router
$env:ANTHROPIC_AUTH_TOKEN          = 'claude-p'
$env:ANTHROPIC_API_KEY             = ''
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = 'current'   # background calls follow whatever model you're on
$env:ANTHROPIC_SMALL_FAST_MODEL    = 'current'
$env:CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1'
$env:ENABLE_CLAUDEAI_MCP_SERVERS   = 'false'
if ($ctx) { $env:CLAUDE_CODE_MAX_CONTEXT_TOKENS = "$ctx" } else { Remove-Item Env:CLAUDE_CODE_MAX_CONTEXT_TOKENS -ErrorAction SilentlyContinue }

Write-Host "claude-p -> $model  (switch with /model)" -ForegroundColor Green
try {
    & claude @ClaudeArgs
    $code = $LASTEXITCODE
} finally {
    try { $null = Invoke-WebRequest "$router/detach" -Method Post -UseBasicParsing -TimeoutSec 15 } catch {}
}
exit $code
