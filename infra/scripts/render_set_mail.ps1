# Staging e-mail in REDIRECT mode: every message goes to $RedirectTo only, never to the real recipients.
# Copies EMAIL_API_KEY and EMAIL_FROM from the Railway production api service (read only; values are never printed) to the Render STAGING api.
param([string]$Api = "srv-dbcrmmdg1s2s73eags5g", [string]$RedirectTo = "nicolas.rasteiro@pdr-team.de")
$key = $env:RENDER_API_KEY
if (-not $key) { $key = [Environment]::GetEnvironmentVariable("RENDER_API_KEY", "User") }
if (-not $key) { Write-Output "NO_KEY"; exit 2 }
$h = @{ Authorization = "Bearer $key"; Accept = "application/json" }
$svc = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$Api" -Headers $h
if ($svc.name -ne "hagel-staging-api") { Write-Output ("REFUSED service " + $svc.name); exit 3 }
$rail = @{}
railway variables --service api --kv 2>$null | ForEach-Object { $p = $_ -split '=', 2; if ($p.Count -eq 2) { $rail[$p[0]] = $p[1] } }
if (-not $rail["EMAIL_API_KEY"]) { Write-Output "EMAIL_API_KEY not found on the Railway api service"; exit 4 }
function Put-Var($name, $value) {
  Invoke-RestMethod -Method Put -Uri "https://api.render.com/v1/services/$Api/env-vars/$name" -Headers $h -ContentType "application/json" -Body (@{ value = $value } | ConvertTo-Json) | Out-Null
}
Put-Var "EMAIL_API_KEY" $rail["EMAIL_API_KEY"]
if ($rail["EMAIL_FROM"]) { Put-Var "EMAIL_FROM" $rail["EMAIL_FROM"] }
Put-Var "MAIL_REDIRECT_TO" $RedirectTo
Put-Var "MAIL_MODE" "redirect"
Write-Output "MAIL_MODE=redirect -> $RedirectTo ; EMAIL_API_KEY / EMAIL_FROM copied (hidden)"
$d = Invoke-RestMethod -Method Post -Uri "https://api.render.com/v1/services/$Api/deploys" -Headers $h -ContentType "application/json" -Body "{}"
Write-Output ("deploy started: " + $d.id)
