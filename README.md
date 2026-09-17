# HORUS Command Deck

HORUS is a modular Windows monitoring dashboard built with Tauri, React, TypeScript and Rust.

## Current prototype

- Live CPU and per-logical-processor utilization
- Live memory and swap utilization
- Disk capacity overview
- Network receive/transmit activity
- Top process CPU and memory usage
- Responsive half-screen dashboard
- Drag-and-drop card ordering
- Four card size presets
- Per-card visibility controls
- Persistent layout and appearance settings
- Custom colors, opacity, glow, radius and grid spacing
- Optional Windows frame with custom frameless controls
- Windows Event Log card prepared for the native event watcher

The interface never fabricates telemetry. Browser preview mode shows unavailable values until the Tauri desktop runtime is connected.

## Development

Requirements:

- Node.js 24+ and pnpm 11+
- Rust stable toolchain
- Microsoft WebView2 runtime
- Windows 10 or Windows 11

```powershell
pnpm install
pnpm run desktop:dev
```

Frontend-only preview:

```powershell
pnpm run dev
```

Production validation:

```powershell
pnpm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Windows installer:

```powershell
pnpm run desktop:build
```

The versioned NSIS installer is copied to the repository's `installer/` folder.
The build also creates the updater signature and `latest.json`. Publish all three
files in a GitHub Release tagged `v<version>` so installed clients can discover,
verify and apply the update in place:

- `HORUS_<version>_x64-setup.exe`
- `HORUS_<version>_x64-setup.exe.sig`
- `latest.json`

Updater signing credentials are kept outside the repository in the current
Windows user's `.tauri` directory and are protected with Windows DPAPI. Back up
the private key securely; future releases must use the same updater key.
The original bundle output remains under `src-tauri/target/release/bundle/nsis/`.
After installation, HORUS can be launched from its Windows shortcut. Closing the
window keeps HORUS in the system tray; double-click the tray icon or launch the
shortcut again to bring the dashboard back. Use **Quit** in the tray menu to exit
the application completely.

## Project layout

- `ui/`: React dashboard and theme system
- `src-tauri/`: Rust desktop shell and native telemetry
- `src/Horus.App/`: preserved Avalonia prototype; scheduled for removal after migration validation
- `tests/Horus.App.Tests/`: tests belonging to the preserved prototype

## Next modules

1. Process start/stop flow with resource-spike detection
2. GPU telemetry providers
3. Card-level chart and alert customization
4. Saved dashboard profiles
