# Dumps a Render database (read only, pg_dump custom format) into a local file, with the same name check as the other helpers.
#   .\infra\scripts\render_dump.ps1 -Out "C:\...\prod-backup\x.dump" -DbId dpg-... -ExpectName hagel-db
param([Parameter(Mandatory = $true)][string]$Out, [Parameter(Mandatory = $true)][string]$DbId, [Parameter(Mandatory = $true)][string]$ExpectName)
$key = $env:RENDER_API_KEY
if (-not $key) { $key = [Environment]::GetEnvironmentVariable("RENDER_API_KEY", "User") }
if (-not $key) { Write-Output "NO_KEY"; exit 2 }
$h = @{ Authorization = "Bearer $key"; Accept = "application/json" }
$db = Invoke-RestMethod -Uri "https://api.render.com/v1/postgres/$DbId" -Headers $h
if ($db.name -ne $ExpectName) { Write-Output ("REFUSED: " + $db.name); exit 3 }
$ci = Invoke-RestMethod -Uri "https://api.render.com/v1/postgres/$DbId/connection-info" -Headers $h
$env:TARGET_URL = $ci.externalConnectionString
$dir = Split-Path -Parent $Out; $file = Split-Path -Leaf $Out
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$sh = Join-Path $PSScriptRoot "dump_in_docker.sh"
docker run --rm -e TARGET_URL -v "${dir}:/o" -v "${sh}:/dump.sh:ro" postgres:18 sh /dump.sh $file
Remove-Item Env:TARGET_URL
if (Test-Path $Out) { "dump written: " + [int]((Get-Item $Out).Length / 1024) + " KB, sha256 " + (Get-FileHash $Out -Algorithm SHA256).Hash } else { "NO DUMP"; exit 4 }
