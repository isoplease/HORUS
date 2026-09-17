$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot "src-tauri\tauri.conf.json"
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$version = $config.version
$signingKeyPath = Join-Path $env:USERPROFILE ".tauri\horus-updater-v2.key"
$signingPasswordPath = Join-Path $env:USERPROFILE ".tauri\horus-updater-v2.password"

if (-not (Test-Path -LiteralPath $signingKeyPath) -or -not (Test-Path -LiteralPath $signingPasswordPath)) {
    throw "Updater signing credentials were not found in the user .tauri directory."
}

$encryptedPasswordHex = (Get-Content -LiteralPath $signingPasswordPath -Raw).Trim()
$encryptedPasswordBytes = [byte[]]::new($encryptedPasswordHex.Length / 2)
for ($index = 0; $index -lt $encryptedPasswordHex.Length; $index += 2) {
    $encryptedPasswordBytes[$index / 2] = [Convert]::ToByte($encryptedPasswordHex.Substring($index, 2), 16)
}
Add-Type -AssemblyName System.Security
$passwordBytes = [Security.Cryptography.ProtectedData]::Unprotect(
    $encryptedPasswordBytes,
    $null,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
)
$signingPassword = [Text.Encoding]::Unicode.GetString($passwordBytes)
$env:TAURI_SIGNING_PRIVATE_KEY = $signingKeyPath
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $signingPassword
$signingPassword = $null
$passwordBytes = $null

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

    $sourceSignature = Get-Item -LiteralPath "$($sourceInstaller.FullName).sig" -ErrorAction Stop

    $installerDirectory = Join-Path $projectRoot "installer"
    New-Item -ItemType Directory -Path $installerDirectory -Force | Out-Null
    $destination = Join-Path $installerDirectory $sourceInstaller.Name
    $signatureDestination = "$destination.sig"
    Copy-Item -LiteralPath $sourceInstaller.FullName -Destination $destination -Force
    Copy-Item -LiteralPath $sourceSignature.FullName -Destination $signatureDestination -Force

    $signature = (Get-Content -LiteralPath $signatureDestination -Raw).Trim()
    $releaseUrl = "https://github.com/isoplease/HORUS/releases/download/v$version/$($sourceInstaller.Name)"
    $manifest = [ordered]@{
        version = $version
        notes = "HORUS v$version"
        pub_date = (Get-Date).ToUniversalTime().ToString("o")
        platforms = [ordered]@{
            "windows-x86_64" = [ordered]@{
                signature = $signature
                url = $releaseUrl
            }
        }
    } | ConvertTo-Json -Depth 5
    $manifestPath = Join-Path $installerDirectory "latest.json"
    [IO.File]::WriteAllText($manifestPath, $manifest, [Text.UTF8Encoding]::new($false))

    Get-ChildItem -LiteralPath $installerDirectory -File |
        Where-Object {
            ($_.Extension -eq ".exe" -and $_.FullName -ne $destination) -or
            ($_.Name -like "*.exe.sig" -and $_.FullName -ne $signatureDestination)
        } |
        Remove-Item -Force

    Write-Host "Installer copied to: $destination"
    Write-Host "Updater signature copied to: $signatureDestination"
    Write-Host "Updater manifest created at: $manifestPath"
}
finally {
    Pop-Location
}
