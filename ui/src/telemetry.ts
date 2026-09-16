import { invoke } from '@tauri-apps/api/core';
import type { SystemSnapshot } from './types';

export function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

export async function getSystemSnapshot(): Promise<SystemSnapshot | null> {
  if (!isTauriRuntime()) return null;
  return invoke<SystemSnapshot>('get_system_snapshot');
}
