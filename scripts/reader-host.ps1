param([ValidateSet('Start', 'Stop', 'Restart', 'Status', 'Logs')][string]$Action = 'Status')
$ErrorActionPreference = 'Stop'
$readerConfig = Join-Path $env:LOCALAPPDATA 'Yoru\reader\.env'
$readerCompose = Join-Path (Split-Path $PSScriptRoot -Parent) 'services\reader-bridge\compose.yml'
if (!(Test-Path -LiteralPath $readerConfig)) {
    throw "Reader secrets are missing from $readerConfig. Restore the private configuration before starting."
}
& docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop, wait until its engine is running, then try again.' }
$readerArgs = @('compose', '--env-file', $readerConfig, '-f', $readerCompose)
switch ($Action) {
    'Start' { & docker @readerArgs up --detach --build }
    'Stop' { & docker @readerArgs stop }
    'Restart' { & docker @readerArgs restart }
    'Status' { & docker @readerArgs ps }
    'Logs' { & docker @readerArgs logs --tail 30 bridge }
}
if ($LASTEXITCODE -ne 0) { throw 'The reader command did not finish successfully. Check Docker Desktop for details.' }
