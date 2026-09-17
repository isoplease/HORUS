export interface ProcessSample {
  pid: number;
  name: string;
  cpuPercent: number;
  memoryBytes: number;
  diskReadBytes: number;
  diskWriteBytes: number;
}

export interface DiskSample {
  name: string;
  mountPoint: string;
  totalBytes: number;
  availableBytes: number;
}

export type EventKind = 'critical' | 'error' | 'warning' | 'application';

export interface WindowsEventRecord {
  id: string;
  kind: EventKind;
  source: string;
  message: string;
  timestamp: string;
}

export interface SystemSnapshot {
  timestampMs: number;
  hostName: string;
  operatingSystem: string;
  uptimeSeconds: number;
  cpuPercent: number;
  logicalCpuCount: number;
  perCpuPercent: number[];
  totalMemoryBytes: number;
  usedMemoryBytes: number;
  totalSwapBytes: number;
  usedSwapBytes: number;
  receivedBytes: number;
  transmittedBytes: number;
  processCount: number;
  topProcesses: ProcessSample[];
  disks: DiskSample[];
}

export interface ThemeSettings {
  background: string;
  backgroundTransparency: number;
  card: string;
  heading: string;
  info: string;
  accent: string;
  chart: string;
  warning: string;
  critical: string;
  cardOpacity: number;
  glow: number;
  radius: number;
  gap: number;
}
