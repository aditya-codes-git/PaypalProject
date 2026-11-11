$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw 'Python environment missing. Follow the fresh-checkout instructions in README.md.'
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'frontend\node_modules'))) {
    throw 'Frontend dependencies missing. Run npm ci in the frontend directory.'
}
$logPath = Join-Path $projectRoot '.tools'
New-Item -ItemType Directory -Force -Path $logPath | Out-Null
$backendProcess = Start-Process -FilePath $pythonPath -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', '8000') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logPath 'api.stdout.log') -RedirectStandardError (Join-Path $logPath 'api.stderr.log')
Write-Host 'ReliefOps: http://127.0.0.1:5173'
Write-Host 'API logs: .tools/api.stderr.log. Press Ctrl+C to stop.'
try {
    Start-Sleep -Seconds 2
    $backendProcess.Refresh()
    if ($backendProcess.HasExited) { throw 'API failed to start. Check .tools/api.stderr.log (port 8000 may already be in use).' }
    Push-Location (Join-Path $projectRoot 'frontend')
    try { npm run dev } finally { Pop-Location }
}
finally {
    $backendProcess.Refresh()
    if (-not $backendProcess.HasExited) { Stop-Process -Id $backendProcess.Id }
}
