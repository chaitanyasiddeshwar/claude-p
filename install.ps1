# claude-p installer (Windows). Run from the cloned repo:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 [-LocalCommand C:\path\to\run-llama-server.bat] [-BinDir <dir on PATH>]
# Safe to re-run: it never overwrites an existing config.json or openrouter.key.
param(
    [string]$LocalCommand,
    [int]$LlamaPort = 8080,
    [string]$BinDir = (Join-Path $env:USERPROFILE '.local\bin')
)
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot

# ---- prerequisites ----
foreach ($exe in 'node', 'claude') {
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) {
        throw "'$exe' was not found on PATH. Install Node.js 18+ and Claude Code (npm i -g @anthropic-ai/claude-code) first."
    }
}

# ---- config.json (machine-specific, gitignored) ----
$cfgPath = Join-Path $repo 'config.json'
if (-not (Test-Path $cfgPath)) {
    if (-not $LocalCommand) {
        $LocalCommand = Read-Host 'Path to the .bat/.cmd that starts llama-server (Enter to skip; local model then only works if llama-server is already running)'
    }
    $cfg = [ordered]@{ localCommand = $(if ($LocalCommand) { $LocalCommand } else { $null }); llamaPort = $LlamaPort; routerPort = 8099 }
    [IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json))
    Write-Host "Wrote $cfgPath"
} else { Write-Host "Keeping existing $cfgPath" }

# ---- OpenRouter key (gitignored) ----
$keyPath = Join-Path $repo 'openrouter.key'
if (-not (Test-Path $keyPath) -and -not $env:OPENROUTER_API_KEY) {
    $sec = Read-Host 'OpenRouter API key (Enter to skip; OpenRouter models need it)' -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    if ($plain) { [IO.File]::WriteAllText($keyPath, $plain.Trim()); Write-Host "Saved key to $keyPath (gitignored)" }
}

# ---- claude-p command ----
New-Item -ItemType Directory -Force $BinDir | Out-Null
$shim = Join-Path $BinDir 'claude-p.cmd'
$ps1 = Join-Path $repo 'claude-p.ps1'
[IO.File]::WriteAllText($shim, "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"$ps1`" %*`r`n")
Write-Host "Installed $shim"

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (($userPath -split ';') -contains $BinDir) -and -not (($env:Path -split ';') -contains $BinDir)) {
    [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $BinDir), 'User')
    Write-Host "Added $BinDir to your user PATH - open a new terminal before running claude-p." -ForegroundColor Yellow
}

Write-Host "`nDone. Run: claude-p   (switch models inside with /model, search them with /models <words>)" -ForegroundColor Green
