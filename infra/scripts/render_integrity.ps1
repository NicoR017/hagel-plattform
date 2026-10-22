# Integrity report (read-only SELECTs) of the Render STAGING database, compared with a saved "before" report.
#   .\infra\scripts\render_integrity.ps1 -Compare "C:\...\prod-backup\integrity-before.json"
param([string]$Compare = "", [string]$Out = "", [string]$DbId = "dpg-dbcrm05g1s2s73eaf120-a", [string]$ExpectName = "hagel-staging-db")
$key = $env:RENDER_API_KEY
if (-not $key) { $key = [Environment]::GetEnvironmentVariable("RENDER_API_KEY", "User") }
if (-not $key) { Write-Output "NO_KEY"; exit 2 }
$h = @{ Authorization = "Bearer $key"; Accept = "application/json" }
$db = Invoke-RestMethod -Uri "https://api.render.com/v1/postgres/$DbId" -Headers $h
if ($db.name -ne $ExpectName) { Write-Output ("REFUSED: " + $db.name); exit 3 }
$ci = Invoke-RestMethod -Uri "https://api.render.com/v1/postgres/$DbId/connection-info" -Headers $h
$u = [string]$ci.externalConnectionString
$env:DATABASE_URL = $(if ($u -match '\?') { $u + "&sslmode=no-verify" } else { $u + "?sslmode=no-verify" })
try {
  if ($Compare) { npm run integrity --silent -- --compare $Compare } elseif ($Out) { npm run integrity --silent -- --out $Out } else { npm run integrity --silent }
} finally { Remove-Item Env:DATABASE_URL }
