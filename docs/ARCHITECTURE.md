# HORUS architecture

## Runtime split

HORUS uses a narrow Tauri boundary. Rust collects native Windows telemetry and exposes typed commands; React renders the dashboard and owns transient visualization state and persisted interface preferences.

Native data is split by cost and cadence:

- Core telemetry: CPU, per-core load, memory, GPU and network
- Process telemetry: process activity and storage I/O
- Capacity telemetry: mounted disk usage
- Event telemetry: bounded, curated Windows Event Log records grouped by channel, provider and event ID

Each channel has its own interval, timeout and in-flight guard. Minimized or tray-hidden windows stop polling and GPU sampling. Restoring the window starts a fresh baseline so paused time does not distort rate calculations.

## Diagnostics model

Query failures, timeouts, recoveries, telemetry deviations and critical Windows events become short Incident Stream records. Source-specific incidents reuse the CPU, RAM, GPU and network colors from the timeline; system-wide severity states retain their nominal, warning and critical colors.

## Interface model

The dashboard is optimized for a secondary display and uses a fixed information hierarchy rather than a configurable card grid. Appearance settings, frame mode, host-spec visibility, backdrop blur and hieroglyph animation preferences are stored locally.

The browser can render a development-only demo dataset when `?demo=1` is present. This path is removed by the production-mode guard and cannot replace native telemetry in packaged builds.

## Windows integration

The desktop shell provides single-instance restore behavior, system tray controls, optional autostart, persistent window placement, a custom frameless title bar and signed updater support. A restrictive content security policy limits webview resources to application assets and Tauri IPC.

## Legacy prototype

The original Avalonia implementation remains under `src/Horus.App/` with its tests under `tests/Horus.App.Tests/`. It is retained only as migration history and is not part of the active Tauri build.
