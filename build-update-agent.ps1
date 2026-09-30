$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir = Join-Path $ProjectRoot "update-agent-build"
$BundleFile = Join-Path $BuildDir "update-agent-bundle.js"
$SeaConfig = Join-Path $BuildDir "sea-config.json"
$SeaBlob = Join-Path $BuildDir "sea-prep.blob"
$OutputExe = Join-Path $ProjectRoot "EDC-Update-Agent.exe"
$NodeExe = (Get-Command node.exe).Source

Write-Host ""
Write-Host "===== EDC Update Agent EXE Build =====" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $NodeExe)) {
    throw "node.exe를 찾을 수 없습니다."
}

Write-Host "[1/5] Build directory 준비..."
if (Test-Path $BuildDir) {
    Remove-Item $BuildDir -Recurse -Force
}
New-Item -ItemType Directory -Path $BuildDir | Out-Null

Write-Host "[2/5] Update Agent bundling..."
& npx --yes esbuild `
    (Join-Path $ProjectRoot "update-agent\server.js") `
    --bundle `
    --platform=node `
    --format=cjs `
    --outfile=$BundleFile

if ($LASTEXITCODE -ne 0) {
    throw "esbuild bundling 실패"
}

Write-Host "[3/5] SEA blob 생성..."
$SeaConfigContent = @{
    main = $BundleFile
    output = $SeaBlob
    disableExperimentalSEAWarning = $true
    useSnapshot = $false
    useCodeCache = $false
} | ConvertTo-Json

Set-Content -Path $SeaConfig -Value $SeaConfigContent -Encoding UTF8

& node --experimental-sea-config=$SeaConfig

if ($LASTEXITCODE -ne 0) {
    throw "SEA blob 생성 실패"
}

Write-Host "[4/5] Node executable 복사..."
if (Test-Path $OutputExe) {
    Remove-Item $OutputExe -Force
}

Copy-Item $NodeExe $OutputExe -Force

Write-Host "[5/5] SEA blob 주입..."
& npx --yes postject `
    $OutputExe `
    NODE_SEA_BLOB `
    $SeaBlob `
    --sentinel-fuse "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"

if ($LASTEXITCODE -ne 0) {
    throw "postject 주입 실패"
}

Write-Host ""
Write-Host "===== Build 완료 =====" -ForegroundColor Green
Write-Host ""
Write-Host "EXE: $OutputExe"
Write-Host ""

Get-Item $OutputExe | Select-Object Name, Length, LastWriteTime
