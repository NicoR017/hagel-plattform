# Restore a production dump into the Render STAGING database (never the production one). The connection string is read from the
# Render API into a variable and handed to Docker's pg_restore; it is never printed or written to disk.
#   .\infra\scripts\render_restore.ps1 -Dump "C:\...\prod-backup\prod-2026-10-22.dump"
param([Parameter(Mandatory = $true)][string]$Dump, [string]$DbId = "dpg-dbcrm05g1s2s73eaf120-a", [string]$Log = "")
$key = $env:RENDER_API_KEY
if (-not $key) { $key = [Environment]::GetEnvironmentVariable("RENDER_API_KEY", "User") }
if (-not $key) { Write-Output "NO_KEY"; exit 2 }
$h = @{ Authorization = "Bearer $key"; Accept = "application/json" }
$db = Invoke-RestMethod -Uri "https://api.render.com/v1/postgres/$DbId" -Headers $h
# safety: only the database that is named like the staging one
if ($db.name -ne "hagel-staging-db") { Write-Output ("REFUSED: this database is called " + $db.name + ", not hagel-staging-db"); exit 3 }
$ci = Invoke-RestMethod -Uri "https://api.render.com/v1/postgres/$DbId/connection-info" -Headers $h
$env:TARGET_URL = $ci.externalConnectionString
$dir = Split-Path -Parent $Dump; $file = Split-Path -Leaf $Dump
Write-Output "restoring $file into hagel-staging-db (status: $($db.status))"
$sh = Join-Path $PSScriptRoot "restore_in_docker.sh"
docker run --rm -e TARGET_URL -v "${dir}:/d:ro" -v "${sh}:/restore.sh:ro" postgres:18 sh /restore.sh $file
Remove-Item Env:TARGET_URL
