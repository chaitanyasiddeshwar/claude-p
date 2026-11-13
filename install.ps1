# claude-p installer (Windows). Run from the cloned repo:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 [-LocalUrl http://127.0.0.1:8080] [-BinDir <dir on PATH>]
# Safe to re-run: it never overwrites an existing config.json or openrouter.key.
param(
    [string]$LocalUrl,
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
    if (-not $LocalUrl) {
        $LocalUrl = Read-Host 'URL of your local model server (Enter for http://127.0.0.1:8080)'
        if (-not $LocalUrl) { $LocalUrl = 'http://127.0.0.1:8080' }
    }
    $cfg = [ordered]@{ localUrl = $LocalUrl.TrimEnd('/'); routerPort = 8099 }
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
