import { invoke } from '@tauri-apps/api/core';
import type { SystemSnapshot, WindowsEventRecord } from './types';

export function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

export async function getSystemSnapshot(): Promise<SystemSnapshot | null> {
  if (!isTauriRuntime()) return null;
  return invoke<SystemSnapshot>('get_system_snapshot');
}

export async function getWindowsEvents(): Promise<WindowsEventRecord[]> {
  if (!isTauriRuntime()) return [];
  return invoke<WindowsEventRecord[]>('get_windows_events');
}
