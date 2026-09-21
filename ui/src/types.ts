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

export type EventSeverity = 'critical' | 'error' | 'warning';
export type EventCategory = 'hardware' | 'os' | 'app';
export type EventFilter = 'all' | 'critical' | EventCategory;

export interface WindowsEventRecord {
  id: string;
  kind: EventSeverity;
  category: EventCategory;
  eventId: string;
  channel: string;
  source: string;
  summary: string;
  message: string;
  timestamp: string;
  count: number;
}

export interface CoreSnapshot {
  timestampMs: number;
  hostName: string;
  operatingSystem: string;
  uptimeSeconds: number;
  cpuPercent: number;
  logicalCpuCount: number;
  perCpuPercent: number[];
  cpuModel: string;
  gpuModel: string;
  gpuMemoryBytes: number;
  gpuPercent: number;
  totalMemoryBytes: number;
  usedMemoryBytes: number;
  totalSwapBytes: number;
  usedSwapBytes: number;
  receivedBytes: number;
  transmittedBytes: number;
}

export interface ProcessSnapshot {
  timestampMs: number;
  diskReadBytes: number;
  diskWriteBytes: number;
  processCount: number;
  topProcesses: ProcessSample[];
}

export interface DiskSnapshot {
  timestampMs: number;
  disks: DiskSample[];
}

export interface SystemSnapshot extends CoreSnapshot, ProcessSnapshot, DiskSnapshot {}

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
