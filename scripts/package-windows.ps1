$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot "src-tauri\tauri.conf.json"
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$version = $config.version

Push-Location $projectRoot
try {
    & pnpm exec tauri build --bundles nsis
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri build failed with exit code $LASTEXITCODE."
    }

    $bundleDirectory = Join-Path $projectRoot "src-tauri\target\release\bundle\nsis"
    $sourceInstaller = Get-ChildItem -LiteralPath $bundleDirectory -Filter "*_${version}_x64-setup.exe" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $sourceInstaller) {
        throw "No NSIS installer was produced for version $version."
    }

    $installerDirectory = Join-Path $projectRoot "installer"
    New-Item -ItemType Directory -Path $installerDirectory -Force | Out-Null
    $destination = Join-Path $installerDirectory $sourceInstaller.Name
    Copy-Item -LiteralPath $sourceInstaller.FullName -Destination $destination -Force

    Write-Host "Installer copied to: $destination"
}
finally {
    Pop-Location
}
