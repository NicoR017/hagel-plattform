# Sets DATABASE_URL (internal connection string of hagel-staging-db) and APP_URL on the two Render STAGING services, then redeploys them.
# The connection string is read from the Render API and sent straight back; it is never printed.
param([string]$DbId = "dpg-dbcrm05g1s2s73eaf120-a", [string]$Api = "srv-dbcrmmdg1s2s73eags5g", [string]$Worker = "srv-dbcrmmdg1s2s73eags4g", [string]$AppUrl = "https://hagel-staging-api.onrender.com")
$key = $env:RENDER_API_KEY
if (-not $key) { $key = [Environment]::GetEnvironmentVariable("RENDER_API_KEY", "User") }
if (-not $key) { Write-Output "NO_KEY"; exit 2 }
$h = @{ Authorization = "Bearer $key"; Accept = "application/json" }
$db = Invoke-RestMethod -Uri "https://api.render.com/v1/postgres/$DbId" -Headers $h
if ($db.name -ne "hagel-staging-db") { Write-Output ("REFUSED: " + $db.name); exit 3 }
foreach ($sid in @($Api, $Worker)) {
  $svc = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$sid" -Headers $h
  if ($svc.name -notlike "hagel-staging-*") { Write-Output ("REFUSED service " + $svc.name); exit 3 }
}
$ci = Invoke-RestMethod -Uri "https://api.render.com/v1/postgres/$DbId/connection-info" -Headers $h
$internal = [string]$ci.internalConnectionString
if ($internal -notmatch '^postgres(ql)?://') { Write-Output "internal connection string not a URL"; exit 4 }
function Put-Var($sid, $name, $value) {
  $body = (@{ value = $value } | ConvertTo-Json)
  Invoke-RestMethod -Method Put -Uri "https://api.render.com/v1/services/$sid/env-vars/$name" -Headers $h -ContentType "application/json" -Body $body | Out-Null
}
Put-Var $Api "DATABASE_URL" $internal
Put-Var $Worker "DATABASE_URL" $internal
Put-Var $Api "APP_URL" $AppUrl
Write-Output "DATABASE_URL set on api and worker (value hidden), APP_URL = $AppUrl"
foreach ($sid in @($Api, $Worker)) {
  $d = Invoke-RestMethod -Method Post -Uri "https://api.render.com/v1/services/$sid/deploys" -Headers $h -ContentType "application/json" -Body "{}"
  Write-Output ("deploy started: " + $d.id + " " + $d.status)
}
