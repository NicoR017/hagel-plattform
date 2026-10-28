# Small helper: call the Render REST API with the key from the RENDER_API_KEY environment variable (never printed).
#   .\infra\scripts\render_api.ps1 GET /v1/services
#   .\infra\scripts\render_api.ps1 GET "/v1/services/srv-xxx/events?limit=5"
#   .\infra\scripts\render_api.ps1 POST /v1/services/srv-xxx/deploys
param([string]$Method = "GET", [string]$Path = "/v1/services", [string]$Body = "", [string]$Out = "")
$key = $env:RENDER_API_KEY
if (-not $key) { $key = [Environment]::GetEnvironmentVariable("RENDER_API_KEY", "User") }
if (-not $key) { Write-Output "NO_KEY: RENDER_API_KEY is not set in this shell (set it with setx, then open a new terminal tab)"; exit 2 }
$h = @{ Authorization = "Bearer $key"; Accept = "application/json" }
try {
  if ($Body) { $r = Invoke-RestMethod -Method $Method -Uri ("https://api.render.com" + $Path) -Headers $h -ContentType "application/json" -Body $Body }
  else { $r = Invoke-RestMethod -Method $Method -Uri ("https://api.render.com" + $Path) -Headers $h }
  $json = $r | ConvertTo-Json -Depth 8
  if ($Out) { Set-Content -Path $Out -Value $json -Encoding utf8; Write-Output "saved to $Out" } else { Write-Output $json }
} catch { Write-Output ("HTTP_ERROR: " + $_.Exception.Message) }
