# Runs a SQL file against the Render STAGING database (read the file's SQL yourself first: it is executed as is).
param([Parameter(Mandatory = $true)][string]$SqlFile, [string]$DbId = "dpg-dbcrm05g1s2s73eaf120-a")
$key = $env:RENDER_API_KEY
if (-not $key) { $key = [Environment]::GetEnvironmentVariable("RENDER_API_KEY", "User") }
if (-not $key) { Write-Output "NO_KEY"; exit 2 }
$h = @{ Authorization = "Bearer $key"; Accept = "application/json" }
$db = Invoke-RestMethod -Uri "https://api.render.com/v1/postgres/$DbId" -Headers $h
if ($db.name -ne "hagel-staging-db") { Write-Output ("REFUSED: " + $db.name); exit 3 }
$ci = Invoke-RestMethod -Uri "https://api.render.com/v1/postgres/$DbId/connection-info" -Headers $h
$env:TARGET_URL = $ci.externalConnectionString
$dir = Split-Path -Parent (Resolve-Path $SqlFile); $f = Split-Path -Leaf $SqlFile
Copy-Item $SqlFile (Join-Path $dir "query.sql") -ErrorAction SilentlyContinue
$sh = Join-Path $PSScriptRoot "query_in_docker.sh"
docker run --rm -e TARGET_URL -v "${dir}:/q:ro" -v "${sh}:/run.sh:ro" postgres:18 sh /run.sh
Remove-Item Env:TARGET_URL
