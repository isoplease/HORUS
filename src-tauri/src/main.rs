#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{
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

fn main() {
    let mut system = System::new_all();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    system.refresh_cpu_usage();
    system.refresh_processes(ProcessesToUpdate::All, true);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .manage(TelemetryState {
            system: Mutex::new(system),
            networks: Mutex::new(Networks::new_with_refreshed_list()),
            disks: Mutex::new(Disks::new_with_refreshed_list()),
        })
        .invoke_handler(tauri::generate_handler![get_system_snapshot])
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
