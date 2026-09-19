# HORUS Command Deck

HORUS is a real-time Windows telemetry and diagnostics dashboard built with Tauri, Rust, React and TypeScript. It presents native system data in a compact command-deck interface designed for an always-visible secondary display.

## Highlights

- CPU load with per-logical-processor activity
- RAM, swap, GPU and storage monitoring
- Live network receive, transmit and session peak rates
- Multi-series telemetry timeline with spike markers
- Top-process CPU and memory activity
- Filtered Windows Event Log viewer
- Incident Stream for timeouts, anomalies, critical events and recovery states
- Automatic polling suspension while minimized or in the system tray
- Host hardware summary, binary clock and persistent appearance settings
- Optional frameless window with custom controls and an adjustable animated hieroglyph strip
- Windows autostart, single-instance behavior, tray controls and signed updater support

## Sampling schedule

| Channel | Interval |
| --- | ---: |
| CPU, RAM, GPU and network | 1 second |
| Processes and storage I/O | 2 seconds |
| Disk capacity | 15 seconds |
| Windows Event Log | 60 seconds |

HORUS prevents overlapping requests. A stalled query is surfaced in the interface and Incident Stream instead of silently building a queue.

## Development

Requirements:

- Windows 10 or Windows 11
- Node.js 24+ and pnpm 11+
- Rust stable toolchain
- Microsoft WebView2 Runtime

```powershell
pnpm install
pnpm run desktop:dev
```

Frontend-only development:

```powershell
pnpm run dev
```

The browser preview waits for the native Tauri runtime. A development-only presentation dataset is available at `http://127.0.0.1:1420/?demo=1`; production builds never use demo telemetry.

## Validation and packaging

```powershell
pnpm run build
cargo test --manifest-path src-tauri/Cargo.toml --locked
pnpm run desktop:build
```

The packaging script creates a versioned NSIS installer in `installer/`. Official updater releases also require the generated signature and `latest.json`:

- `HORUS_<version>_x64-setup.exe`
- `HORUS_<version>_x64-setup.exe.sig`
- `latest.json`

Updater signing credentials stay outside the repository in the Windows user's `.tauri` directory. Official files are published together in a GitHub Release tagged `v<version>`.

## Desktop behavior

Closing the window hides HORUS in the system tray. Double-click the tray icon or launch HORUS again to restore it. Use **Quit** from the tray menu to exit completely. Native telemetry pauses while the window is hidden or minimized and resumes with a fresh baseline when it becomes visible.

## Project layout

- `ui/` — React interface, charts and persisted UI preferences
- `src-tauri/` — Rust telemetry, Windows integration and desktop shell
- `scripts/` — Windows packaging and asset utilities
- `installer/` — current local NSIS installer and updater manifest
- `src/Horus.App/` — preserved Avalonia prototype
- `tests/Horus.App.Tests/` — tests for the preserved prototype
