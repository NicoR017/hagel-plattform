# The Azure mirror runs in the WORKER: copy the AZURE_* variables of the staging api to the staging worker (values never printed), redeploy the worker.
param([string]$Api = "srv-dbcrmmdg1s2s73eags5g", [string]$Worker = "srv-dbcrmmdg1s2s73eags4g")
$key = $env:RENDER_API_KEY
if (-not $key) { $key = [Environment]::GetEnvironmentVariable("RENDER_API_KEY", "User") }
if (-not $key) { Write-Output "NO_KEY"; exit 2 }
$h = @{ Authorization = "Bearer $key"; Accept = "application/json" }
foreach ($sid in @($Api, $Worker)) { $n = (Invoke-RestMethod -Uri "https://api.render.com/v1/services/$sid" -Headers $h).name; if ($n -notlike "hagel-staging-*") { Write-Output "REFUSED $n"; exit 3 } }
$vars = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$Api/env-vars" -Headers $h
$copied = @()
foreach ($v in $vars) {
  $e = $v.envVar
  if ($e.key -like "AZURE_*") {
    Invoke-RestMethod -Method Put -Uri "https://api.render.com/v1/services/$Worker/env-vars/$($e.key)" -Headers $h -ContentType "application/json" -Body (@{ value = [string]$e.value } | ConvertTo-Json) | Out-Null
    $copied += $e.key
  }
}
Write-Output ("copied to worker: " + ($copied -join ", "))
$d = Invoke-RestMethod -Method Post -Uri "https://api.render.com/v1/services/$Worker/deploys" -Headers $h -ContentType "application/json" -Body "{}"
Write-Output ("worker deploy: " + $d.id)
