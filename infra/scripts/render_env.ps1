# Lists the environment variables of a Render service WITHOUT their values (names only; for connection strings: scheme and host only).
param([Parameter(Mandatory = $true)][string]$ServiceId, [string]$Out = "")
$key = $env:RENDER_API_KEY
if (-not $key) { $key = [Environment]::GetEnvironmentVariable("RENDER_API_KEY", "User") }
if (-not $key) { Write-Output "NO_KEY"; exit 2 }
$h = @{ Authorization = "Bearer $key"; Accept = "application/json" }
$vars = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$ServiceId/env-vars" -Headers $h
$lines = foreach ($v in $vars) {
  $e = $v.envVar; $val = [string]$e.value
  if ($val -match '^[a-z]+://') { $shown = ($val -replace '^([a-z]+://)[^@/]*@', '$1***@') -replace '(/[^/?]*)\?.*$', '$1' }
  elseif ($e.key -match 'SECRET|KEY|PASSWORD|TOKEN|SAS') { $shown = "<hidden, length " + $val.Length + ">" }
  else { $shown = $val }
  "{0} = {1}" -f $e.key, $shown
}
if ($Out) { Set-Content -Path $Out -Value $lines -Encoding utf8; Write-Output "saved to $Out" } else { $lines }
