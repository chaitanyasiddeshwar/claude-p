@echo off
REM Example llama-server launcher for claude-p. Copy next to llama-server.exe, edit MODEL/CTX/NGL,
REM and point "localCommand" in claude-p's config.json at it.
REM Sized for a 12 GB GPU with a ~17 GB 27B Q4_K_M model split between GPU and CPU.
REM If the whole model fits in VRAM (e.g. 24 GB+ GPU), use NGL=99.
cd /d "%~dp0"

set MODEL=your-model-Q4_K_M.gguf
set CTX=65536
set NGL=22
set PORT=8080

REM Refuse to start a second server: two copies double the VRAM use, which can crash the GPU driver.
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul && (echo llama-server already listening on :%PORT% - not starting another. & exit /b 1)

set OMP_NUM_THREADS=8
set KMP_DUPLICATE_LIB_OK=TRUE

if not exist logs mkdir logs
if exist "logs\llama-server.log" move /y "logs\llama-server.log" "logs\llama-server.prev.log" >nul

REM Full path to the exe: some shells (incl. Claude Code's) set NoDefaultCurrentDirectoryInExePath.
REM  -fit off  : use -ngl/-c exactly as given, never auto-grow into VRAM headroom
REM  --poll 0  : idle threads sleep instead of spinning
REM  -ctk/-ctv q8_0 : quantized KV cache, half the memory of f16
"%~dp0llama-server.exe" -m "%MODEL%" -c %CTX% -ngl %NGL% -fit off -t 8 -b 512 -ub 256 -ctk q8_0 -ctv q8_0 -fa on --poll 0 --jinja -np 1 --no-webui --port %PORT% --log-file "logs\llama-server.log" --log-timestamps --log-prefix
