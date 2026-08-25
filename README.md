# HORUS

HORUS is a modern, security-first Windows hardware monitor built with .NET 10 and Avalonia UI.

## Current capabilities

- Automatic CPU discovery through Windows WMI/CIM
- Live total and per-logical-processor load readings
- Session minimum and maximum tracking
- Persistent user settings
- Optional per-user startup with Windows
- English-only user interface

## Security principles

- User-mode data collection is the default.
- Windows APIs, PDH/Performance Counters, WMI/CIM, ETW, and official GPU vendor APIs are preferred.
- Privileged services are optional and isolated from the desktop application.
- Any future kernel driver must expose narrowly scoped operations, support HVCI, and follow Microsoft's signing and certification process.
- HORUS never displays fabricated sensor readings. Unsupported measurements are shown as unavailable.

## Development

Requirements:

- .NET SDK 10
- Windows 10 or Windows 11

```powershell
dotnet restore HORUS.slnx
dotnet build HORUS.slnx
dotnet run --project src/Horus.App/Horus.App.csproj
```

## Status

HORUS is in early development. CPU load monitoring is functional; additional hardware providers and tray sensor support are planned.
