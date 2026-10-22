# Creates the PRODUCTION of PDR Hagel on Render (database, api with disk, worker). Secrets are read from the Railway production api service
# (read only) and sent to Render; nothing is printed. The mail starts in REDIRECT mode (everything to $RedirectTo) until the cutover.
#   .\infra\scripts\render_create_prod.ps1
param([string]$RedirectTo = "nicolas.rasteiro@pdr-team.de", [string]$Branch = "feature/ui-v3", [string]$Repo = "https://github.com/NicoR017/hagel-plattform",
      [string]$Owner = "tea-dbcrf2tg1s2s73e9repg", [string]$DbPlan = "basic_1gb", [string]$WebPlan = "starter", [int]$DiskGB = 5)
$ErrorActionPreference = "Stop"
$key = $env:RENDER_API_KEY
if (-not $key) { $key = [Environment]::GetEnvironmentVariable("RENDER_API_KEY", "User") }
if (-not $key) { Write-Output "NO_KEY"; exit 2 }
$h = @{ Authorization = "Bearer $key"; Accept = "application/json" }
function Api($method, $path, $body = $null) {
  if ($body) { Invoke-RestMethod -Method $method -Uri ("https://api.render.com" + $path) -Headers $h -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 10) }
  else { Invoke-RestMethod -Method $method -Uri ("https://api.render.com" + $path) -Headers $h }
}
# never twice
$have = (Api GET "/v1/services?limit=50" | ForEach-Object { $_.service.name })
if ($have -contains "hagel-api" -or $have -contains "hagel-worker") { Write-Output "production services already exist"; exit 3 }

# 1. production secrets from Railway (read only)
$rail = @{}
$ErrorActionPreference = "Continue" # the Railway CLI prints a deprecation warning on stderr
railway variables --service api --kv 2>$null | ForEach-Object { $p = $_ -split '=', 2; if ($p.Count -eq 2) { $rail[$p[0]] = $p[1] } }
$ErrorActionPreference = "Stop"
foreach ($need in @("EMAIL_API_KEY", "AZURE_STORAGE_SAS", "AZURE_STORAGE_ACCOUNT", "SEED_SUPERADMIN_EMAIL")) { if (-not $rail[$need]) { Write-Output "missing on Railway: $need"; exit 4 } }

# 2. database
$db = Api POST "/v1/postgres" @{ name = "hagel-db"; ownerId = $Owner; plan = $DbPlan; region = "frankfurt"; version = "18"; databaseName = "hagel"; databaseUser = "hagel" }
$dbId = $db.id
Write-Output "database created ($dbId), waiting until it is available ..."
for ($i = 0; $i -lt 60; $i++) { Start-Sleep -Seconds 10; $st = (Api GET "/v1/postgres/$dbId").status; if ($st -eq "available") { break } }
if ($st -ne "available") { Write-Output "database not available: $st"; exit 5 }
$internal = [string](Api GET "/v1/postgres/$dbId/connection-info").internalConnectionString

# 3. env
$bytes = New-Object byte[] 36; (New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($bytes)
$secret = [Convert]::ToBase64String($bytes)
function Ev($k, $v) { @{ key = $k; value = [string]$v } }
$common = @((Ev "APP_ENV" "production"), (Ev "DATABASE_URL" $internal), (Ev "SESSION_SECRET" $secret))
$azure = @("AZURE_STORAGE_SAS", "AZURE_STORAGE_ACCOUNT", "AZURE_SYNC_MINUTES", "AZURE_INITIAL_DAYS") | Where-Object { $rail[$_] } | ForEach-Object { Ev $_ $rail[$_] }
$apiEnv = $common + $azure + @((Ev "MAIL_MODE" "redirect"), (Ev "MAIL_REDIRECT_TO" $RedirectTo), (Ev "EMAIL_API_KEY" $rail["EMAIL_API_KEY"]), (Ev "STORAGE_DIR" "/data/files"), (Ev "UI_V3_DEFAULT" "true"), (Ev "SEED_SUPERADMIN_EMAIL" $rail["SEED_SUPERADMIN_EMAIL"]), (Ev "APP_URL" "https://hagel-api.onrender.com"))
if ($rail["EMAIL_FROM"]) { $apiEnv += Ev "EMAIL_FROM" $rail["EMAIL_FROM"] }
$workerEnv = $common + $azure + @((Ev "MAIL_MODE" "redirect"), (Ev "MAIL_REDIRECT_TO" $RedirectTo))

# 4. services
$api = Api POST "/v1/services" @{
  type = "web_service"; name = "hagel-api"; ownerId = $Owner; repo = $Repo; branch = $Branch; autoDeploy = "no"; envVars = $apiEnv
  serviceDetails = @{ runtime = "docker"; plan = $WebPlan; region = "frankfurt"; healthCheckPath = "/api/health"; numInstances = 1
    envSpecificDetails = @{ dockerfilePath = "./Dockerfile"; dockerContext = "." }
    disk = @{ name = "hagel-files"; mountPath = "/data"; sizeGB = $DiskGB } }
}
$apiId = $api.service.id
Write-Output ("api created: " + $apiId + " " + $api.service.serviceDetails.url)
$wk = Api POST "/v1/services" @{
  type = "background_worker"; name = "hagel-worker"; ownerId = $Owner; repo = $Repo; branch = $Branch; autoDeploy = "no"; envVars = $workerEnv
  serviceDetails = @{ runtime = "docker"; plan = $WebPlan; region = "frankfurt"; numInstances = 1
    envSpecificDetails = @{ dockerfilePath = "./Dockerfile"; dockerContext = "."; dockerCommand = "npm run worker" } }
}
Write-Output ("worker created: " + $wk.service.id)
Write-Output "DB=$dbId API=$apiId WORKER=$($wk.service.id)"
