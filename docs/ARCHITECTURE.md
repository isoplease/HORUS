# HORUS architecture

## Design principles

- Native telemetry is collected in Rust and exposed through narrow Tauri commands.
- The React layer owns presentation, layout and persisted user preferences.
- Unsupported measurements remain unavailable rather than being estimated.
- Cards share one shell contract: identity, visibility, size, order and content.
- Appearance uses semantic color channels so one setting updates the complete interface.

## Card model

The first card sizes are `compact`, `standard`, `wide` and `tall`. Each size maps to the responsive 12-column dashboard grid. Order, visibility and sizes are persisted independently so a hidden card returns to its previous location and size.

## Native boundaries

`get_system_snapshot` currently returns CPU, memory, swap, network, disk and process data. Windows Event Log access will be a separate service with its own bounded event DTO, severity filtering and cancellation lifecycle.

## Migration state

The original Avalonia application remains in the repository during the first review cycle. It should only be removed after the Tauri desktop build, telemetry accuracy and installer behavior are accepted.
