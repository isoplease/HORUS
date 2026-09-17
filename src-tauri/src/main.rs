#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    path::PathBuf,
    process::Command,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use sysinfo::{Disks, Networks, ProcessesToUpdate, System};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

struct TelemetryState {
    system: Mutex<System>,
    networks: Mutex<Networks>,
    disks: Mutex<Disks>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessSample {
    pid: u32,
    name: String,
    cpu_percent: f32,
    memory_bytes: u64,
    disk_read_bytes: u64,
    disk_write_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiskSample {
    name: String,
    mount_point: String,
    total_bytes: u64,
    available_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowsEventRecord {
    id: String,
    kind: String,
    source: String,
    message: String,
    timestamp: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemSnapshot {
    timestamp_ms: u128,
    host_name: String,
    operating_system: String,
    uptime_seconds: u64,
    cpu_percent: f32,
    logical_cpu_count: usize,
    per_cpu_percent: Vec<f32>,
    total_memory_bytes: u64,
    used_memory_bytes: u64,
    total_swap_bytes: u64,
    used_swap_bytes: u64,
    received_bytes: u64,
    transmitted_bytes: u64,
    process_count: usize,
    top_processes: Vec<ProcessSample>,
    disks: Vec<DiskSample>,
}

#[tauri::command]
fn get_system_snapshot(state: tauri::State<'_, TelemetryState>) -> Result<SystemSnapshot, String> {
    let mut system = state
        .system
        .lock()
        .map_err(|_| "Telemetry state is unavailable".to_string())?;
    system.refresh_cpu_usage();
    system.refresh_memory();
    system.refresh_processes(ProcessesToUpdate::All, true);

    let logical_cpu_count = system.cpus().len();
    let cpu_divisor = logical_cpu_count.max(1) as f32;
    let mut top_processes = system
        .processes()
        .iter()
        .map(|(pid, process)| {
            let disk = process.disk_usage();
            ProcessSample {
                pid: pid.as_u32(),
                name: process.name().to_string_lossy().into_owned(),
                cpu_percent: (process.cpu_usage() / cpu_divisor).clamp(0.0, 100.0),
                memory_bytes: process.memory(),
                disk_read_bytes: disk.read_bytes,
                disk_write_bytes: disk.written_bytes,
            }
        })
        .collect::<Vec<_>>();
    top_processes.sort_by(|left, right| {
        right
            .cpu_percent
            .total_cmp(&left.cpu_percent)
            .then_with(|| right.memory_bytes.cmp(&left.memory_bytes))
    });
    top_processes.truncate(7);

    let mut networks = state
        .networks
        .lock()
        .map_err(|_| "Network telemetry state is unavailable".to_string())?;
    networks.refresh(true);
    let received_bytes = networks.values().map(|network| network.received()).sum();
    let transmitted_bytes = networks.values().map(|network| network.transmitted()).sum();

    let mut disks = state
        .disks
        .lock()
        .map_err(|_| "Storage telemetry state is unavailable".to_string())?;
    disks.refresh(true);
    let disk_samples = disks
        .iter()
        .map(|disk| DiskSample {
            name: disk.name().to_string_lossy().into_owned(),
            mount_point: disk.mount_point().to_string_lossy().into_owned(),
            total_bytes: disk.total_space(),
            available_bytes: disk.available_space(),
        })
        .collect();

    Ok(SystemSnapshot {
        timestamp_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_millis(),
        host_name: System::host_name().unwrap_or_else(|| "Unknown host".to_string()),
        operating_system: System::long_os_version()
            .unwrap_or_else(|| "Unknown Windows version".to_string()),
        uptime_seconds: System::uptime(),
        cpu_percent: system.global_cpu_usage().clamp(0.0, 100.0),
        logical_cpu_count,
        per_cpu_percent: system.cpus().iter().map(|cpu| cpu.cpu_usage()).collect(),
        total_memory_bytes: system.total_memory(),
        used_memory_bytes: system.used_memory(),
        total_swap_bytes: system.total_swap(),
        used_swap_bytes: system.used_swap(),
        received_bytes,
        transmitted_bytes,
        process_count: system.processes().len(),
        top_processes,
        disks: disk_samples,
    })
}

fn decode_utf16_le(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() % 2 != 0 {
        return Err("Windows Event Log returned malformed Unicode output".to_string());
    }
    let words = bytes
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect::<Vec<_>>();
    String::from_utf16(&words)
        .map(|value| value.trim_start_matches('\u{feff}').to_string())
        .map_err(|error| format!("Windows Event Log output could not be decoded: {error}"))
}

fn extract_tag_text(source: &str, tag: &str) -> Option<String> {
    let opening = format!("<{tag}");
    let start = source.find(&opening)?;
    let content_start = source[start..].find('>')? + start + 1;
    let closing = format!("</{tag}>");
    let content_end = source[content_start..].find(&closing)? + content_start;
    Some(source[content_start..content_end].to_string())
}

fn extract_attribute(source: &str, tag: &str, attribute: &str) -> Option<String> {
    let opening = format!("<{tag} ");
    let start = source.find(&opening)?;
    let tag_end = source[start..].find('>')? + start;
    let element = &source[start..tag_end];
    for quote in ['\'', '"'] {
        let needle = format!("{attribute}={quote}");
        if let Some(value_start) = element.find(&needle) {
            let value_start = value_start + needle.len();
            let value_end = element[value_start..].find(quote)? + value_start;
            return Some(element[value_start..value_end].to_string());
        }
    }
    None
}

fn clean_event_message(value: &str) -> String {
    let decoded = value
        .replace("&#13;", " ")
        .replace("&#10;", " ")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&");
    let normalized = decoded.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() > 260 {
        format!("{}…", normalized.chars().take(259).collect::<String>())
    } else {
        normalized
    }
}

fn parse_windows_events(xml: &str, channel: &str) -> Vec<WindowsEventRecord> {
    xml.split("<Event ")
        .skip(1)
        .filter_map(|event| {
            let level = extract_tag_text(event, "Level")?;
            let event_id = extract_tag_text(event, "EventID").unwrap_or_else(|| "0".to_string());
            let record_id =
                extract_tag_text(event, "EventRecordID").unwrap_or_else(|| event_id.clone());
            let source =
                extract_attribute(event, "Provider", "Name").unwrap_or_else(|| channel.to_string());
            let timestamp = extract_attribute(event, "TimeCreated", "SystemTime")?;
            let message = extract_tag_text(event, "Message")
                .map(|value| clean_event_message(&value))
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| format!("Windows event {event_id}"));
            let kind = if channel == "Application" {
                "application"
            } else {
                match level.trim() {
                    "1" => "critical",
                    "2" => "error",
                    "3" => "warning",
                    _ => return None,
                }
            };
            Some(WindowsEventRecord {
                id: format!("{channel}-{record_id}"),
                kind: kind.to_string(),
                source,
                message,
                timestamp,
            })
        })
        .collect()
}

fn query_windows_event_log(channel: &str, count: usize) -> Result<Vec<WindowsEventRecord>, String> {
    let system_root = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .ok_or_else(|| "Windows system directory is unavailable".to_string())?;
    let executable = system_root.join("System32").join("wevtutil.exe");
    let count_arg = format!("/c:{count}");
    let mut command = Command::new(executable);
    command.args([
        "qe",
        channel,
        "/q:*[System[(Level=1 or Level=2 or Level=3)]]",
        count_arg.as_str(),
        "/rd:true",
        "/f:RenderedXml",
        "/uni:true",
    ]);
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let output = command
        .output()
        .map_err(|error| format!("Windows Event Log could not be queried: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Windows Event Log query failed for {channel}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(parse_windows_events(
        &decode_utf16_le(&output.stdout)?,
        channel,
    ))
}

#[tauri::command]
fn get_windows_events() -> Result<Vec<WindowsEventRecord>, String> {
    let mut events = query_windows_event_log("System", 40)?;
    events.extend(query_windows_event_log("Application", 20)?);
    events.sort_by(|left, right| right.timestamp.cmp(&left.timestamp));
    events.truncate(60);
    Ok(events)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rendered_windows_event_xml() {
        let xml = "<Event xmlns='event'><System><Provider Name='Disk'/><EventID>7</EventID><Level>3</Level><TimeCreated SystemTime='2026-09-17T08:15:00Z'/><EventRecordID>42</EventRecordID></System><RenderingInfo><Message>Disk warning&#13;&#10;Check cable &amp; retry.</Message></RenderingInfo></Event>";
        let events = parse_windows_events(xml, "System");

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "System-42");
        assert_eq!(events[0].kind, "warning");
        assert_eq!(events[0].source, "Disk");
        assert_eq!(events[0].message, "Disk warning Check cable & retry.");
        assert_eq!(events[0].timestamp, "2026-09-17T08:15:00Z");
    }

    #[test]
    fn decodes_utf16_event_output() {
        let input = "\u{feff}<Event>ok</Event>";
        let bytes = input
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>();

        assert_eq!(decode_utf16_le(&bytes).unwrap(), "<Event>ok</Event>");
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn set_window_frame(window: tauri::WebviewWindow, decorations: bool) -> Result<(), String> {
    window
        .set_decorations(decorations)
        .map_err(|error| error.to_string())?;
    window
        .set_shadow(decorations)
        .map_err(|error| error.to_string())?;
    window
        .set_resizable(true)
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn main() {
    let mut system = System::new_all();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    system.refresh_cpu_usage();
    system.refresh_processes(ProcessesToUpdate::All, true);

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(TelemetryState {
            system: Mutex::new(system),
            networks: Mutex::new(Networks::new_with_refreshed_list()),
            disks: Mutex::new(Disks::new_with_refreshed_list()),
        })
        .invoke_handler(tauri::generate_handler![
            get_system_snapshot,
            get_windows_events,
            set_window_frame
        ])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Open HORUS", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("application icon").clone())
                .tooltip("HORUS Command Deck")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "hide" => hide_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::DoubleClick {
                            button: MouseButton::Left,
                            ..
                        }
                    ) {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running HORUS");
}
