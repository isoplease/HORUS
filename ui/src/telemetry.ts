import { invoke } from '@tauri-apps/api/core';
import type { CoreSnapshot, DiskSnapshot, ProcessSnapshot, WindowsEventRecord } from './types';

export function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

export async function getCoreSnapshot(): Promise<CoreSnapshot | null> {
  if (!isTauriRuntime()) return null;
  return invoke<CoreSnapshot>('get_core_snapshot');
}

export async function getProcessSnapshot(): Promise<ProcessSnapshot | null> {
  if (!isTauriRuntime()) return null;
  return invoke<ProcessSnapshot>('get_process_snapshot');
}

export async function getDiskSnapshot(): Promise<DiskSnapshot | null> {
  if (!isTauriRuntime()) return null;
  return invoke<DiskSnapshot>('get_disk_snapshot');
}

export async function getWindowsEvents(): Promise<WindowsEventRecord[]> {
  if (!isTauriRuntime()) return [];
  return invoke<WindowsEventRecord[]>('get_windows_events');
}

export async function setMonitoringActive(active: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke('set_monitoring_active', { active });
}
