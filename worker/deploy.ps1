# Deploys worker\worker.js to the personal Cloudflare Worker ("noofgains")
# via the REST API — no wrangler. Credentials come from ..\secrets.local.json
# (gitignored); secrets live in worker bindings, which this deploy preserves.
# Usage:  & '<repo>\worker\deploy.ps1'
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$s = Get-Content (Join-Path $root 'secrets.local.json') -Raw | ConvertFrom-Json
$src = Join-Path $PSScriptRoot 'worker.js'

# Stage in %TEMP% — curl -F chokes on the spaces in the repo path, and
# node --check only accepts ESM syntax under an .mjs name.
$check = Join-Path $env:TEMP 'noofgains-worker-check.mjs'
Copy-Item $src $check -Force
node --check $check
if ($LASTEXITCODE -ne 0) { throw 'worker.js failed syntax check - not deploying' }

$staged = Join-Path $env:TEMP 'noofgains-worker.js'
Copy-Item $src $staged -Force
$meta = Join-Path $env:TEMP 'noofgains-worker-metadata.json'
Set-Content $meta '{"main_module":"worker.js","keep_bindings":["secret_text","kv_namespace"]}' -Encoding ascii

$out = & curl.exe -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$($s.accountId)/workers/scripts/noofgains" `
  -H "Authorization: Bearer $($s.cloudflareToken)" `
  -F "metadata=<$meta;type=application/json" `
  -F "worker.js=@$staged;type=application/javascript+module;filename=worker.js"
$r = $out | ConvertFrom-Json
if (-not $r.success) { Write-Output $out; throw 'deploy failed' }
Write-Output "Deployed worker (etag $($r.result.etag))"

# Smoke check: /status must answer 200 with the bearer.
Write-Output (& curl.exe -s -H "Authorization: Bearer $($s.appBearer)" 'https://noofgains.noofgains-dylan.workers.dev/status')
