$ErrorActionPreference = "Stop"

$AgentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AgentScript = Join-Path $AgentRoot "update-agent\server.js"

if (-not (Test-Path $AgentScript)) {
    throw "Update Agent 파일을 찾을 수 없습니다: $AgentScript"
}

$env:EDC_CONTAINER_NAME = "edc-ijh"
$env:EDC_IMAGE_REPOSITORY = "ghcr.io/shin482/clinical-data-capture-web-app"
$env:EDC_DATA_VOLUME = "ijh-edc-data"
$env:EDC_PORT = "3000"
$env:UPDATE_AGENT_PORT = "3210"
$env:GHCR_USERNAME = "shin482"

$GhcrTokenFile = Join-Path $AgentRoot "secrets\ghcr-token.dpapi"
$AuthTokenFile = Join-Path $AgentRoot "secrets\auth-token.dpapi"

if (-not (Test-Path $GhcrTokenFile)) {
    throw "GHCR Token 파일이 없습니다: $GhcrTokenFile"
}

if (-not (Test-Path $AuthTokenFile)) {
    throw "Update Agent 인증 토큰 파일이 없습니다: $AuthTokenFile"
}

$secureGhcr = Get-Content $GhcrTokenFile | ConvertTo-SecureString
$secureAuth = Get-Content $AuthTokenFile | ConvertTo-SecureString

$env:GHCR_TOKEN = [System.Net.NetworkCredential]::new("", $secureGhcr).Password
$env:UPDATE_AGENT_AUTH_TOKEN = [System.Net.NetworkCredential]::new("", $secureAuth).Password

Set-Location $AgentRoot

& node $AgentScript
