# Sets the Microsoft Graph mail variables (GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, EMAIL_FROM) on ONE Render api service, then redeploys it.
# Values come from the local environment ($env:GRAPH_TENANT_ID ...) or are asked (the secret with a hidden prompt). Nothing is printed or stored.
# Safety: only services named hagel-staging-* are accepted. Production needs the explicit -Production switch (evening window, Nicolas's go).
# Staging is forced to MAIL_MODE=redirect -> $RedirectTo. Production keeps its MAIL_MODE (live) untouched.
# Rollback = remove the three GRAPH_* from the service (Render dashboard) and redeploy: Resend takes over again, no code change.
param(
  [Parameter(Mandatory = $true)][string]$Api,                      # Render service id (srv-...)
  [string]$From = "noreplay-spain@pdr-team.com",
  [string]$RedirectTo = "nicolas.rasteiro@pdr-team.de",
  [switch]$Production,
  [switch]$NoDeploy
)
$key = $env:RENDER_API_KEY
if (-not $key) { $key = [Environment]::GetEnvironmentVariable("RENDER_API_KEY", "User") }
if (-not $key) { Write-Output "NO_KEY"; exit 2 }
$h = @{ Authorization = "Bearer $key"; Accept = "application/json" }
$svc = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$Api" -Headers $h
$isStaging = $svc.name -like "hagel-staging-*"
if (-not $isStaging -and -not $Production) { Write-Output ("REFUSED service " + $svc.name + " (not hagel-staging-*; use -Production on purpose)"); exit 3 }
if ($isStaging -and $Production) { Write-Output "REFUSED: -Production given but the service is a staging one"; exit 3 }
if ($svc.name -like "*worker*") { Write-Output "REFUSED: the worker sends no e-mails, set this on the api service"; exit 3 }

function Read-Value($name, [bool]$secret) {
  $v = [Environment]::GetEnvironmentVariable($name)
  if ($v) { return $v.Trim() }
  if ($secret) {
    $s = Read-Host -Prompt $name -AsSecureString
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
  }
  return (Read-Host -Prompt $name).Trim()
}
$tenant = Read-Value "GRAPH_TENANT_ID" $false
$client = Read-Value "GRAPH_CLIENT_ID" $false
$secret = Read-Value "GRAPH_CLIENT_SECRET" $true
if (-not $tenant -or -not $client -or -not $secret) { Write-Output "GRAPH_TENANT_ID, GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET are all required"; exit 4 }

function Put-Var($name, $value) {
  Invoke-RestMethod -Method Put -Uri "https://api.render.com/v1/services/$Api/env-vars/$name" -Headers $h -ContentType "application/json" -Body (@{ value = $value } | ConvertTo-Json) | Out-Null
}
Put-Var "GRAPH_TENANT_ID" $tenant
Put-Var "GRAPH_CLIENT_ID" $client
Put-Var "GRAPH_CLIENT_SECRET" $secret
Put-Var "EMAIL_FROM" $From
if ($isStaging) {
  Put-Var "MAIL_REDIRECT_TO" $RedirectTo
  Put-Var "MAIL_MODE" "redirect"
  Write-Output "$($svc.name): GRAPH_* + EMAIL_FROM=$From set (secret hidden), MAIL_MODE=redirect -> $RedirectTo"
} else {
  Write-Output "$($svc.name) (PRODUCTION): GRAPH_* + EMAIL_FROM=$From set (secret hidden), MAIL_MODE unchanged"
}
if ($NoDeploy) { Write-Output "no deploy requested (-NoDeploy)"; exit 0 }
$d = Invoke-RestMethod -Method Post -Uri "https://api.render.com/v1/services/$Api/deploys" -Headers $h -ContentType "application/json" -Body "{}"
Write-Output ("deploy started: " + $d.id)
