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

- Node.js 24+
- Rust stable toolchain
- Microsoft WebView2 runtime
- Windows 10 or Windows 11

```powershell
npm install
npm run tauri -- dev
```

Frontend-only preview:

```powershell
npm run dev
```

Production validation:

```powershell
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Project layout

- `ui/`: React dashboard and theme system
- `src-tauri/`: Rust desktop shell and native telemetry
- `src/Horus.App/`: preserved Avalonia prototype; scheduled for removal after migration validation
- `tests/Horus.App.Tests/`: tests belonging to the preserved prototype

## Next modules

1. Windows Event Log live watcher and severity filters
2. Process start/stop flow with resource-spike detection
3. GPU telemetry providers
4. Card-level chart and alert customization
5. Saved dashboard profiles and installer packaging
