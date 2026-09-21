import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from '@tauri-apps/plugin-autostart';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { getCoreSnapshot, getDiskSnapshot, getProcessSnapshot, getWindowsEvents, isTauriRuntime, setMonitoringActive as setNativeMonitoringActive } from './telemetry';
import type { CoreSnapshot, DiskSnapshot, EventFilter, ProcessSnapshot, SystemSnapshot, ThemeSettings, WindowsEventRecord } from './types';

const THEME_KEY = 'horus-theme-v1';
const FRAME_KEY = 'horus-window-frame-v1';
const AUTOSTART_INITIALIZED_KEY = 'horus-autostart-initialized-v1';
const HOST_SPECS_KEY = 'horus-host-specs-visible-v1';
const SETTINGS_BLUR_KEY = 'horus-settings-backdrop-blur-v1';
const HIEROGLYPH_MOTION_KEY = 'horus-hieroglyph-motion-v1';
const HIEROGLYPH_SPEED_KEY = 'horus-hieroglyph-speed-v1';
const DEMO_MODE = import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo');

const POLL_INTERVALS = { core: 1_000, process: 2_000, disk: 15_000, events: 60_000 } as const;
const QUERY_TIMEOUTS = { core: 2_500, process: 4_000, disk: 6_000, events: 10_000 } as const;

const DEFAULT_THEME: ThemeSettings = {
  background: '#050c14', backgroundTransparency: 18, card: '#0a1b2b', heading: '#eaf8ff', info: '#86a4b7', accent: '#20c9f4', chart: '#35e2c2', warning: '#ffbd59', critical: '#ff5577', cardOpacity: 92, glow: 34, radius: 10, gap: 10,
};

const RESIZE_HANDLES = [
  ['North', 'resize-edge resize-n'], ['South', 'resize-edge resize-s'], ['West', 'resize-edge resize-w'], ['East', 'resize-edge resize-e'],
  ['NorthWest', 'resize-edge resize-nw'], ['NorthEast', 'resize-edge resize-ne'], ['SouthWest', 'resize-edge resize-sw'], ['SouthEast', 'resize-edge resize-se'],
] as const;

const EVENT_FILTERS: Array<{ id: EventFilter; label: string }> = [
  { id: 'all', label: 'ALL' }, { id: 'critical', label: 'CRITICAL' }, { id: 'hardware', label: 'HARDWARE' }, { id: 'os', label: 'OS' }, { id: 'app', label: 'APP' },
];

type UpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installing' | 'error';
type TimelineRange = 30 | 60 | 300;
type TimelineSeries = 'cpu' | 'memory' | 'gpu' | 'network';
type QueryKey = keyof typeof POLL_INTERVALS;
type QueryIssue = 'TIMEOUT' | 'ERROR';
type IncidentLevel = 'info' | 'warning' | 'critical' | 'recovery';
interface EventTooltip { record: WindowsEventRecord; top: number; left: number; width: number; above: boolean; }
interface TelemetryPoint { timestampMs: number; cpu: number; memory: number; gpu: number; received: number; transmitted: number; }
interface StorageIoPoint { timestampMs: number; read: number; write: number; }
interface IncidentItem { id: number; timestampMs: number; level: IncidentLevel; code: string; message: string; }

const TIMELINE_RANGES: Array<{ value: TimelineRange; label: string }> = [{ value: 30, label: '30S' }, { value: 60, label: '60S' }, { value: 300, label: '5M' }];
const TIMELINE_SERIES: Array<{ id: TimelineSeries; label: string }> = [{ id: 'cpu', label: 'CPU' }, { id: 'memory', label: 'RAM' }, { id: 'gpu', label: 'GPU' }, { id: 'network', label: 'NET' }];
const QUERY_LABELS: Record<QueryKey, string> = { core: 'CORE', process: 'PROCESS', disk: 'DISK', events: 'EVENT LOG' };
const QUERY_DESCRIPTIONS: Record<QueryKey, string> = { core: 'Live CPU, RAM, GPU or network sample', process: 'Process and storage I/O sample', disk: 'Disk capacity sample', events: 'Windows Event Log sample' };

function loadJson<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? { ...fallback, ...JSON.parse(value) } : fallback; } catch { return fallback; }
}

function formatBytes(value: number, decimals = 1): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(decimals)} ${units[index]}`;
}

function formatUptime(seconds = 0): string {
  const days = Math.floor(seconds / 86400); const hours = Math.floor((seconds % 86400) / 3600); const minutes = Math.floor((seconds % 3600) / 60);
  return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
}

function percent(part = 0, total = 0): number { return total > 0 ? Math.min(100, Math.max(0, (part / total) * 100)) : 0; }

function Sparkline({ values, color = 'var(--chart)' }: { values: number[]; color?: string }) {
  const points = values.length > 1 ? values : [0, 0];
  const coordinates = points.map((value, index) => `${(index / Math.max(1, points.length - 1)) * 100},${46 - Math.min(100, Math.max(0, value)) * 0.4}`).join(' ');
  return <svg className="sparkline" viewBox="0 0 100 50" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="spark-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.32" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs><path className="spark-grid" d="M0 10H100M0 28H100M25 0V50M50 0V50M75 0V50" /><polygon points={`0,50 ${coordinates} 100,50`} fill="url(#spark-fade)" /><polyline points={coordinates} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" /></svg>;
}

function TelemetryTimeline({ samples, range, setRange, enabled, toggleSeries, fault, time }: { samples: TelemetryPoint[]; range: TimelineRange; setRange: (range: TimelineRange) => void; enabled: Record<TimelineSeries, boolean>; toggleSeries: (series: TimelineSeries) => void; fault: boolean; time: Date }) {
  const visible = samples.slice(-range);
  const offset = Math.max(0, range - visible.length);
  const xAt = (index: number) => ((offset + index) / Math.max(1, range - 1)) * 1000;
  const yAt = (value: number) => 66 - Math.min(100, Math.max(0, value)) * .56;
  const pointsFor = (key: 'cpu' | 'memory' | 'gpu') => visible.map((sample, index) => `${xAt(index).toFixed(1)},${yAt(sample[key]).toFixed(1)}`).join(' ');
  const maxNetwork = Math.max(1, ...visible.map((sample) => Math.max(sample.received, sample.transmitted)));
  const barStep = Math.max(1, Math.floor(range / 72));
  const barWidth = Math.max(1.2, Math.min(5, 720 / range));
  const spikes = visible.flatMap((sample, index) => {
    if (index === 0) return [];
    return (['cpu', 'memory', 'gpu'] as const).flatMap((series) => {
      if (!enabled[series]) return [];
      const change = sample[series] - visible[index - 1][series];
      return sample[series] >= 65 && change >= 18 ? [{ series, value: sample[series], timestampMs: sample.timestampMs, x: xAt(index), y: yAt(sample[series]) }] : [];
    });
  }).slice(-3);
  const spikeLabels = spikes.map((spike) => ({ ...spike, left: Math.min(94, Math.max(4, spike.x / 10)), top: Math.max(32, spike.y - 2) })).sort((left, right) => left.left - right.left);
  for (let start = 0; start < spikeLabels.length;) {
    let end = start + 1;
    while (end < spikeLabels.length && spikeLabels[end].left - spikeLabels[end - 1].left < 10) end += 1;
    const count = end - start;
    if (count > 1) {
      const group = spikeLabels.slice(start, end);
      const spacing = 9;
      const center = group.reduce((total, spike) => total + spike.left, 0) / count;
      let first = center - spacing * (count - 1) / 2;
      first = Math.max(4, Math.min(first, 94 - spacing * (count - 1)));
      const alignedTop = Math.max(...group.map((spike) => spike.top));
      group.forEach((spike, index) => { spike.left = first + index * spacing; spike.top = alignedTop; });
    }
    start = end;
  }
  const latest = visible.at(-1);

  return <section className="module telemetry-module">
    <header className="timeline-header"><div><span>TELEMETRY / 05</span><h2>Telemetry Timeline</h2></div><div className="timeline-ranges" aria-label="Telemetry time range">{TIMELINE_RANGES.map((option) => <button key={option.value} className={range === option.value ? 'active' : ''} onClick={() => setRange(option.value)} aria-pressed={range === option.value}>{option.label}</button>)}</div></header>
    <div className="timeline-series" aria-label="Visible telemetry series">{TIMELINE_SERIES.map((series) => <button key={series.id} className={`${series.id} ${enabled[series.id] ? 'active' : ''}`} onClick={() => toggleSeries(series.id)} aria-pressed={enabled[series.id]}><i />{series.label}<small>{series.id === 'network' ? formatBytes(Math.max(latest?.received ?? 0, latest?.transmitted ?? 0)) : `${(latest?.[series.id] ?? 0).toFixed(0)}%`}</small></button>)}<time className="timeline-clock">{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div>
    <div className="timeline-chart" role="img" aria-label={`CPU, memory, GPU and network activity for the last ${range} seconds`}>
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
        <defs><filter id="timeline-glow"><feGaussianBlur stdDeviation="2.2" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
        <g className="timeline-grid"><path d="M0 10H1000M0 38H1000M0 66H1000M0 73H1000M0 92H1000" />{[0, 250, 500, 750, 1000].map((x) => <path d={`M${x} 0V100`} key={x} />)}</g>
        {enabled.network && <g className="network-pulses">{visible.map((sample, index) => index % barStep === 0 ? <g key={sample.timestampMs}><rect className="receive" x={Math.min(998, xAt(index)) - barWidth} y={73 - (sample.received / maxNetwork) * 18} width={barWidth} height={(sample.received / maxNetwork) * 18} /><rect className="transmit" x={Math.min(998, xAt(index)) + .5} y="73" width={barWidth} height={(sample.transmitted / maxNetwork) * 17} /></g> : null)}</g>}
        {enabled.cpu && visible.length > 1 && <polyline className="timeline-line cpu" points={pointsFor('cpu')} />}
        {enabled.memory && visible.length > 1 && <polyline className="timeline-line memory" points={pointsFor('memory')} />}
        {enabled.gpu && visible.length > 1 && <polyline className="timeline-line gpu" points={pointsFor('gpu')} />}
      </svg>
      <div className="timeline-y-axis" aria-hidden="true"><span>100%</span><span>50%</span><span>0%</span></div>
      {spikeLabels.map((spike) => <span className={`spike-label ${spike.series}`} key={`${spike.series}-${spike.timestampMs}`} style={{ left: `${spike.left}%`, top: `${spike.top}%` }}><b>{new Date(spike.timestampMs).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })}</b>{spike.value.toFixed(0)}%</span>)}
      {fault && <span className="query-fault-marker" title="Core telemetry query stalled">/</span>}
      {!visible.length && <span className="timeline-waiting">AWAITING TELEMETRY STREAM</span>}
      <div className="timeline-axis"><span>-{range === 300 ? '5m' : `${range}s`}</span><span>NOW</span></div>
    </div>
  </section>;
}

function StorageIoStream({ samples, fault }: { samples: StorageIoPoint[]; fault: boolean }) {
  const visible = samples.slice(-60);
  const peak = Math.max(1, ...visible.flatMap((sample) => [sample.read, sample.write]));
  const pointsFor = (key: 'read' | 'write') => visible.map((sample, index) => {
    const x = visible.length > 1 ? (index / (visible.length - 1)) * 100 : 100;
    const y = 23 - (sample[key] / peak) * 18;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const latest = visible.at(-1);

  return <div className="storage-io-stream">
    <div className="storage-io-head"><span>STORAGE I/O STREAM</span><div><b className="read">R {formatBytes(latest?.read ?? 0)}</b><b className="write">W {formatBytes(latest?.write ?? 0)}</b></div></div>
    <svg viewBox="0 0 100 26" preserveAspectRatio="none" role="img" aria-label={`Storage read ${formatBytes(latest?.read ?? 0)}, write ${formatBytes(latest?.write ?? 0)} in the latest interval`}>
      <path className="storage-io-grid" d="M0 13H100M25 0V26M50 0V26M75 0V26" />
      {visible.length > 1 && <><polyline className="storage-io-line read" points={pointsFor('read')} /><polyline className="storage-io-line write" points={pointsFor('write')} /></>}
    </svg>
    {fault && <span className="query-fault-marker" title="Process I/O query stalled">/</span>}
  </div>;
}

function formatRate(value: number): string { return `${formatBytes(value)}/s`; }

function MetricRing({ value, label }: { value: number; label: string }) {
  const safeValue = Math.min(100, Math.max(0, value));
  return <div className="metric-ring" style={{ '--ring-value': `${safeValue * 3.6}deg` } as CSSProperties}><div><strong>{safeValue.toFixed(1)}%</strong><span>{label}</span></div></div>;
}

function ModuleHeader({ code, title, meta }: { code: string; title: string; meta?: ReactNode }) {
  return <header className="module-header"><div><span>{code}</span><h2>{title}</h2></div>{meta && <div className="module-meta">{meta}</div>}</header>;
}

function EmptyState({ text }: { text: string }) { return <div className="empty-state"><span>⌁</span><p>{text}</p></div>; }

function incidentSourceClass(code: string): string {
  if (/^(CPU)\b/.test(code)) return 'source-cpu';
  if (/^(RAM|MEMORY)\b/.test(code)) return 'source-memory';
  if (/^(GPU)\b/.test(code)) return 'source-gpu';
  if (/^(NET|NETWORK)\b/.test(code)) return 'source-network';
  return '';
}

function IncidentStream({ incidents }: { incidents: IncidentItem[] }) {
  return <section className="incident-stream" aria-label="Incident stream">
    <header><div><span>DIAGNOSTICS / 08</span><strong>Incident Stream</strong></div><small>{incidents.length ? `${incidents.length} LOGGED` : 'ARMED'}</small></header>
    <div className="incident-feed" aria-live="polite">
      {incidents.length ? incidents.map((incident) => <article className={`incident-packet ${incident.level} ${incidentSourceClass(incident.code)}`} key={incident.id}>
        <i />
        <time>{new Date(incident.timestampMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
        <b>{incident.code}</b>
        <p>{incident.message}</p>
      </article>) : <div className="incident-idle"><i /><span>CHANNEL CLEAR</span><p>Timeouts, telemetry deviations and state changes will appear here.</p></div>}
    </div>
  </section>;
}

function BinaryClock({ time }: { time: Date }) {
  const digits = time.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).replaceAll(':', '').split('').map(Number);
  const bits = [8, 4, 2, 1];
  const labels = ['H', 'H', 'M', 'M', 'S', 'S'];
  return <div className="binary-clock" role="img" aria-label={`Binary clock ${time.toLocaleTimeString()}`}>
    <div className="binary-digits">{digits.map((digit, digitIndex) => <div className="binary-digit" key={`${digitIndex}-${digit}`}>
      {bits.map((bit) => <i className={(digit & bit) !== 0 ? 'active' : ''} key={bit} title={`${bit}`} />)}
      <small>{labels[digitIndex]}</small>
    </div>)}</div>
  </div>;
}

function EyeIcon({ crossed = false }: { crossed?: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" />{crossed && <path d="m4 4 16 16" />}</svg>;
}

function WindowControlIcon({ type }: { type: 'minimize' | 'maximize' | 'close' }) {
  if (type === 'minimize') return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 11.5h10" /></svg>;
  if (type === 'maximize') return <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" /></svg>;
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>;
}

function HostHardware({ snapshot, operatingSystem, visible, time, onToggle }: { snapshot: SystemSnapshot | null; operatingSystem: string; visible: boolean; time: Date; onToggle: () => void }) {
  const memory = snapshot ? formatBytes(snapshot.totalMemoryBytes, 0) : '—';
  const videoMemory = snapshot?.gpuMemoryBytes ? formatBytes(snapshot.gpuMemoryBytes, 0) : '—';
  return <>
    <div className="host-side">
      <div className="host-specs-title"><span>SYSTEM SPECS</span><button className="specs-visibility" onClick={onToggle} title={visible ? 'Hide system specs' : 'Show system specs'} aria-label={visible ? 'Hide system specs' : 'Show system specs'}><EyeIcon crossed={!visible} /></button></div>
      {visible && <div className="host-specs">
      <p className="host-os" title={operatingSystem}>{operatingSystem}</p>
      <p title={snapshot?.cpuModel}>{snapshot?.cpuModel ?? 'CPU telemetry pending'} <b>· RAM {memory}</b></p>
      <p title={snapshot?.gpuModel}>{snapshot?.gpuModel ?? 'GPU telemetry pending'} <b>· VRAM {videoMemory}</b></p>
      </div>}
    </div>
    <BinaryClock time={time} />
  </>;
}

interface SettingsPanelProps { open: boolean; onClose: () => void; theme: ThemeSettings; setTheme: (value: ThemeSettings) => void; decorations: boolean; setDecorations: (value: boolean) => void; settingsBlur: boolean; setSettingsBlur: (value: boolean) => void; hieroglyphMotion: boolean; setHieroglyphMotion: (value: boolean) => void; hieroglyphSpeed: number; setHieroglyphSpeed: (value: number) => void; autostart: boolean; autostartBusy: boolean; onAutostartChange: (value: boolean) => void; }
function SettingsPanel({ open, onClose, theme, setTheme, decorations, setDecorations, settingsBlur, setSettingsBlur, hieroglyphMotion, setHieroglyphMotion, hieroglyphSpeed, setHieroglyphSpeed, autostart, autostartBusy, onAutostartChange }: SettingsPanelProps) {
  const update = <K extends keyof ThemeSettings>(key: K, value: ThemeSettings[K]) => setTheme({ ...theme, [key]: value });
  const colors: Array<[keyof ThemeSettings, string]> = [['background', 'Background'], ['card', 'Surface'], ['heading', 'Headings'], ['info', 'Info text'], ['accent', 'Accent'], ['chart', 'Charts'], ['warning', 'Warnings'], ['critical', 'Critical']];
  return <aside className={`settings-panel ${open ? 'is-open' : ''}`} aria-hidden={!open}>
    <div className="settings-title"><div><span className="eyebrow">CONTROL / APPEARANCE</span><h2>Interface Matrix</h2></div><button className="icon-button" onClick={onClose}>×</button></div>
    <section><h3>Color channels</h3><div className="color-grid">{colors.map(([key, label]) => <label key={key}><span>{label}</span><input type="color" value={String(theme[key])} onChange={(event) => update(key, event.target.value as never)} /></label>)}</div></section>
    <section className="range-stack"><h3>Surface density</h3><label className={decorations ? 'is-disabled' : ''}><span>Background transparency <output>{theme.backgroundTransparency}%</output></span><input type="range" min="0" max="70" value={theme.backgroundTransparency} disabled={decorations} onChange={(event) => update('backgroundTransparency', Number(event.target.value))} /></label><label><span>Surface opacity <output>{theme.cardOpacity}%</output></span><input type="range" min="55" max="100" value={theme.cardOpacity} onChange={(event) => update('cardOpacity', Number(event.target.value))} /></label><label><span>Glow intensity <output>{theme.glow}%</output></span><input type="range" min="0" max="100" value={theme.glow} onChange={(event) => update('glow', Number(event.target.value))} /></label><label><span>Corner radius <output>{theme.radius}px</output></span><input type="range" min="0" max="20" value={theme.radius} onChange={(event) => update('radius', Number(event.target.value))} /></label></section>
    <section className="module-toggles"><h3>Window</h3><label><span>Start with Windows</span><input type="checkbox" checked={autostart} disabled={autostartBusy} onChange={(event) => onAutostartChange(event.target.checked)} /></label><label><span>Windows frame</span><input type="checkbox" checked={decorations} onChange={(event) => setDecorations(event.target.checked)} /></label><label><span>Control Matrix background blur</span><input type="checkbox" checked={settingsBlur} onChange={(event) => setSettingsBlur(event.target.checked)} /></label><label><span>Hieroglyph flow</span><input type="checkbox" checked={hieroglyphMotion} onChange={(event) => setHieroglyphMotion(event.target.checked)} /></label></section>
    <section className="range-stack"><h3>Window chrome</h3><label className={!hieroglyphMotion ? 'is-disabled' : ''}><span>Hieroglyph flow speed <output>{hieroglyphSpeed}%</output></span><input type="range" min="25" max="200" step="5" value={hieroglyphSpeed} disabled={!hieroglyphMotion} onChange={(event) => setHieroglyphSpeed(Number(event.target.value))} /></label></section>
    <div className="settings-actions"><button onClick={() => setTheme(DEFAULT_THEME)}>Reset theme</button></div>
  </aside>;
}

function App() {
  const [coreSnapshot, setCoreSnapshot] = useState<CoreSnapshot | null>(null);
  const [processSnapshot, setProcessSnapshot] = useState<ProcessSnapshot | null>(null);
  const [diskSnapshot, setDiskSnapshot] = useState<DiskSnapshot | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [timeline, setTimeline] = useState<TelemetryPoint[]>([]);
  const [storageIo, setStorageIo] = useState<StorageIoPoint[]>([]);
  const [networkRates, setNetworkRates] = useState({ received: 0, transmitted: 0, peak: 0 });
  const [timelineRange, setTimelineRange] = useState<TimelineRange>(60);
  const [timelineSeries, setTimelineSeries] = useState<Record<TimelineSeries, boolean>>({ cpu: true, memory: true, gpu: true, network: true });
  const [theme, setTheme] = useState<ThemeSettings>(() => loadJson(THEME_KEY, DEFAULT_THEME));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [decorations, setDecorations] = useState(() => localStorage.getItem(FRAME_KEY) !== 'false');
  const [settingsBlur, setSettingsBlur] = useState(() => localStorage.getItem(SETTINGS_BLUR_KEY) !== 'false');
  const [hieroglyphMotion, setHieroglyphMotion] = useState(() => localStorage.getItem(HIEROGLYPH_MOTION_KEY) !== 'false');
  const [hieroglyphSpeed, setHieroglyphSpeed] = useState(() => { const stored = Number(localStorage.getItem(HIEROGLYPH_SPEED_KEY)); return Number.isFinite(stored) && stored >= 25 && stored <= 200 ? stored : 100; });
  const [windowDragging, setWindowDragging] = useState(false);
  const [autostart, setAutostart] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [eventFilter, setEventFilter] = useState<EventFilter>('all');
  const [events, setEvents] = useState<WindowsEventRecord[]>([]);
  const [clockTime, setClockTime] = useState(() => new Date());
  const [appVersion, setAppVersion] = useState('DEV');
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('idle');
  const [updateProgress, setUpdateProgress] = useState(0);
  const [eventTooltip, setEventTooltip] = useState<EventTooltip | null>(null);
  const [hostSpecsVisible, setHostSpecsVisible] = useState(() => localStorage.getItem(HOST_SPECS_KEY) !== 'false');
  const [windowMonitoringActive, setWindowMonitoringActive] = useState(() => !isTauriRuntime());
  const [manualPause, setManualPause] = useState(false);
  const [coreReady, setCoreReady] = useState(() => !isTauriRuntime());
  const [queryIssues, setQueryIssues] = useState<Partial<Record<QueryKey, QueryIssue>>>({});
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const coreInFlight = useRef(false);
  const processInFlight = useRef(false);
  const diskInFlight = useRef(false);
  const eventsInFlight = useRef(false);
  const coreNeedsWarmup = useRef(true);
  const processNeedsWarmup = useRef(true);
  const incidentCounter = useRef(0);
  const incidentCooldowns = useRef(new Map<string, number>());
  const queryIssuesRef = useRef<Partial<Record<QueryKey, QueryIssue>>>({});
  const previousCoreSample = useRef<CoreSnapshot | null>(null);
  const seenCriticalEvents = useRef(new Set<string>());
  const criticalEventsInitialized = useRef(false);
  const previousPulseState = useRef<string | null>(null);
  const monitoringActive = windowMonitoringActive && !manualPause;

  const pushIncident = useCallback((level: IncidentLevel, code: string, message: string, fingerprint = `${code}:${message}`, cooldownMs = 30_000) => {
    const now = Date.now();
    const previous = incidentCooldowns.current.get(fingerprint) ?? 0;
    if (now - previous < cooldownMs) return;
    incidentCooldowns.current.set(fingerprint, now);
    if (incidentCooldowns.current.size > 80) {
      const oldest = [...incidentCooldowns.current.entries()].sort((left, right) => left[1] - right[1]).slice(0, 20);
      oldest.forEach(([key]) => incidentCooldowns.current.delete(key));
    }
    const incident: IncidentItem = { id: ++incidentCounter.current, timestampMs: now, level, code, message };
    setIncidents((current) => [incident, ...current].slice(0, 24));
  }, []);

  const raiseQueryIssue = useCallback((key: QueryKey, issue: QueryIssue) => {
    if (queryIssuesRef.current[key] === issue) return;
    queryIssuesRef.current = { ...queryIssuesRef.current, [key]: issue };
    setQueryIssues(queryIssuesRef.current);
    pushIncident('critical', `${QUERY_LABELS[key]} ${issue}`, `${QUERY_DESCRIPTIONS[key]} ${issue === 'TIMEOUT' ? 'exceeded its response window' : 'failed'}.`, `query-${key}-${issue}`, 0);
  }, [pushIncident]);

  const clearQueryIssue = useCallback((key: QueryKey) => {
    if (!queryIssuesRef.current[key]) return;
    const next = { ...queryIssuesRef.current };
    delete next[key];
    queryIssuesRef.current = next;
    setQueryIssues(next);
    pushIncident('recovery', `${QUERY_LABELS[key]} RECOVERED`, `${QUERY_DESCRIPTIONS[key]} restored.`, `query-${key}-recovered`, 0);
  }, [pushIncident]);

  const snapshot = useMemo<SystemSnapshot | null>(() => coreSnapshot ? {
    ...coreSnapshot,
    diskReadBytes: processSnapshot?.diskReadBytes ?? 0,
    diskWriteBytes: processSnapshot?.diskWriteBytes ?? 0,
    processCount: processSnapshot?.processCount ?? 0,
    topProcesses: processSnapshot?.topProcesses ?? [],
    disks: diskSnapshot?.disks ?? [],
  } : null, [coreSnapshot, diskSnapshot, processSnapshot]);

  useEffect(() => {
    if (!DEMO_MODE) return;
    const now = Date.now();
    const samples = Array.from({ length: 60 }, (_, index) => ({
      timestampMs: now - (59 - index) * 1_000,
      cpu: Math.max(8, Math.min(96, 42 + Math.sin(index / 4) * 18 + (index === 48 ? 38 : 0))),
      memory: 62 + Math.sin(index / 9) * 4,
      gpu: Math.max(4, Math.min(92, 28 + Math.sin(index / 5) * 22 + (index === 53 ? 45 : 0))),
      received: 420_000 + Math.abs(Math.sin(index / 3)) * 3_800_000,
      transmitted: 180_000 + Math.abs(Math.cos(index / 4)) * 1_200_000,
    }));
    setCoreSnapshot({ timestampMs: now, hostName: 'HORUS-TEST-RIG', operatingSystem: 'Windows 11 Pro 24H2', uptimeSeconds: 284_440, cpuPercent: 47.6, logicalCpuCount: 16, perCpuPercent: [32, 58, 41, 69, 24, 51, 36, 63, 44, 71, 29, 55, 38, 61, 34, 49], cpuModel: 'AMD Ryzen 7 5700X3D 8-Core Processor', gpuModel: 'NVIDIA GeForce RTX 5070', gpuMemoryBytes: 12 * 1024 ** 3, gpuPercent: 54.2, totalMemoryBytes: 32 * 1024 ** 3, usedMemoryBytes: 20.4 * 1024 ** 3, totalSwapBytes: 8 * 1024 ** 3, usedSwapBytes: 1.7 * 1024 ** 3, receivedBytes: 3_820_000, transmittedBytes: 860_000 });
    setNetworkRates({ received: 3_820_000, transmitted: 860_000, peak: 7_460_000 });
    setProcessSnapshot({ timestampMs: now, diskReadBytes: 38_400_000, diskWriteBytes: 12_700_000, processCount: 187, topProcesses: [
      { pid: 8420, name: 'Cyberpunk2077.exe', cpuPercent: 18.7, memoryBytes: 6.8 * 1024 ** 3, diskReadBytes: 18_200_000, diskWriteBytes: 4_200_000 },
      { pid: 2216, name: 'chrome.exe', cpuPercent: 7.4, memoryBytes: 2.1 * 1024 ** 3, diskReadBytes: 4_800_000, diskWriteBytes: 1_100_000 },
      { pid: 10932, name: 'Discord.exe', cpuPercent: 3.2, memoryBytes: 730 * 1024 ** 2, diskReadBytes: 1_600_000, diskWriteBytes: 620_000 },
      { pid: 4664, name: 'explorer.exe', cpuPercent: 1.1, memoryBytes: 288 * 1024 ** 2, diskReadBytes: 420_000, diskWriteBytes: 180_000 },
    ] });
    setDiskSnapshot({ timestampMs: now, disks: [
      { name: 'NVMe System', mountPoint: 'C:\\', totalBytes: 953.9 * 1024 ** 3, availableBytes: 341.2 * 1024 ** 3 },
      { name: 'Game Array', mountPoint: 'D:\\', totalBytes: 1.81 * 1024 ** 4, availableBytes: 722.5 * 1024 ** 3 },
    ] });
    setHistory(samples.map((sample) => sample.cpu));
    setTimeline(samples);
    setStorageIo(samples.map((sample, index) => ({ timestampMs: sample.timestampMs, read: 8_000_000 + Math.abs(Math.sin(index / 4)) * 42_000_000, write: 3_000_000 + Math.abs(Math.cos(index / 5)) * 18_000_000 })));
    setEvents([
      { id: 'demo-warning', kind: 'warning', category: 'hardware', eventId: '4101', channel: 'System', source: 'Display', summary: 'Display driver stopped responding and recovered.', message: 'Display driver response briefly exceeded the expected interval.', timestamp: new Date(now - 92_000).toISOString(), count: 2 },
      { id: 'demo-critical', kind: 'critical', category: 'os', eventId: '41', channel: 'System', source: 'Kernel-Power', summary: 'The system restarted without a clean shutdown.', message: 'Test critical event generated for the HORUS diagnostics preview.', timestamp: new Date(now - 420_000).toISOString(), count: 1 },
      { id: 'demo-application', kind: 'warning', category: 'app', eventId: '1000', channel: 'Application', source: 'HORUS', summary: 'Application warning reported by HORUS.', message: 'Native telemetry channels initialized successfully.', timestamp: new Date(now - 18_000).toISOString(), count: 1 },
    ]);
    incidentCounter.current = 3;
    setIncidents([
      { id: 3, timestampMs: now - 31_000, level: 'critical', code: 'CORE TIMEOUT', message: 'Live telemetry sample exceeded its response window.' },
      { id: 2, timestampMs: now - 44_000, level: 'warning', code: 'GPU DEVIATION', message: 'Load jumped 34 points to 87%.' },
      { id: 1, timestampMs: now - 58_000, level: 'info', code: 'SYNCING', message: 'Telemetry baselines are being synchronized.' },
    ]);
    setCoreReady(true);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const hexToRgb = (hex: string) => { const normalized = hex.replace('#', ''); return `${parseInt(normalized.slice(0, 2), 16)}, ${parseInt(normalized.slice(2, 4), 16)}, ${parseInt(normalized.slice(4, 6), 16)}`; };
    root.style.setProperty('--background', theme.background); root.style.setProperty('--background-rgb', hexToRgb(theme.background)); root.style.setProperty('--background-alpha', String(decorations ? 1 : 1 - theme.backgroundTransparency / 100)); root.style.setProperty('--surface-rgb', hexToRgb(theme.card)); root.style.setProperty('--surface-opacity', String(theme.cardOpacity / 100)); root.style.setProperty('--heading', theme.heading); root.style.setProperty('--info', theme.info); root.style.setProperty('--accent', theme.accent); root.style.setProperty('--chart', theme.chart); root.style.setProperty('--warning', theme.warning); root.style.setProperty('--critical', theme.critical); root.style.setProperty('--glow-alpha', String(theme.glow / 100)); root.style.setProperty('--radius', `${theme.radius}px`);
    localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  }, [decorations, theme]);

  useEffect(() => { localStorage.setItem(FRAME_KEY, String(decorations)); if (isTauriRuntime()) void invoke('set_window_frame', { decorations }).catch((error) => console.error('Window frame could not be updated:', error)); }, [decorations]);
  useEffect(() => { localStorage.setItem(SETTINGS_BLUR_KEY, String(settingsBlur)); }, [settingsBlur]);
  useEffect(() => { localStorage.setItem(HIEROGLYPH_MOTION_KEY, String(hieroglyphMotion)); }, [hieroglyphMotion]);
  useEffect(() => { localStorage.setItem(HIEROGLYPH_SPEED_KEY, String(hieroglyphSpeed)); }, [hieroglyphSpeed]);
  useEffect(() => { localStorage.setItem(HOST_SPECS_KEY, String(hostSpecsVisible)); }, [hostSpecsVisible]);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    void isAutostartEnabled().then(async (enabled) => {
      if (!enabled && localStorage.getItem(AUTOSTART_INITIALIZED_KEY) !== 'true') {
        await enableAutostart();
        enabled = true;
      }
      localStorage.setItem(AUTOSTART_INITIALIZED_KEY, 'true');
      setAutostart(enabled);
    }).catch((error) => console.error('Autostart state could not be read:', error));
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setClockTime(new Date()), 1_000);
    if (isTauriRuntime()) void getVersion().then(setAppVersion).catch((error) => console.error('App version could not be read:', error));
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    const timer = window.setTimeout(() => {
      setUpdatePhase('checking');
      void check().then((update) => {
        if (disposed) return;
        setAvailableUpdate(update);
        setUpdatePhase(update ? 'available' : 'current');
      }).catch((error) => {
        if (!disposed) setUpdatePhase('error');
        console.error('Update check failed:', error);
      });
    }, 2_500);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    const appWindow = getCurrentWindow();
    const applyState = (active: boolean) => { if (!disposed) setWindowMonitoringActive(active); };
    const syncWindowState = async () => applyState(await appWindow.isVisible() && !await appWindow.isMinimized());
    void listen<boolean>('monitoring-state', (event) => applyState(event.payload)).then((unlisten) => disposed ? unlisten() : unlisteners.push(unlisten));
    void appWindow.onResized(() => { void syncWindowState(); }).then((unlisten) => disposed ? unlisten() : unlisteners.push(unlisten));
    void syncWindowState();
    return () => { disposed = true; unlisteners.forEach((unlisten) => unlisten()); };
  }, []);
  useEffect(() => {
    coreNeedsWarmup.current = true;
    processNeedsWarmup.current = true;
    previousCoreSample.current = null;
    if (!DEMO_MODE) setNetworkRates({ received: 0, transmitted: 0, peak: 0 });
    setCoreReady(!isTauriRuntime());
    if (monitoringActive && isTauriRuntime()) {
      setCoreSnapshot(null);
      setProcessSnapshot(null);
      setHistory([]);
      setTimeline([]);
      setStorageIo([]);
    }
    void setNativeMonitoringActive(monitoringActive).catch((error) => console.error('Monitoring state could not be updated:', error));
  }, [monitoringActive]);
  useEffect(() => {
    if (!monitoringActive || DEMO_MODE) return;
    let cancelled = false;
    let timer: number | undefined;
    const run = async () => {
      if (coreInFlight.current) { timer = window.setTimeout(run, 250); return; }
      coreInFlight.current = true;
      const started = performance.now();
      const timeout = window.setTimeout(() => {
        if (!cancelled) raiseQueryIssue('core', 'TIMEOUT');
      }, QUERY_TIMEOUTS.core);
      try {
        const next = await getCoreSnapshot();
        if (cancelled) return;
        clearQueryIssue('core');
        setTelemetryError(next ? null : 'Browser preview — native telemetry waits for the desktop runtime');
        if (next) {
          if (coreNeedsWarmup.current) {
            coreNeedsWarmup.current = false;
          } else {
            const previous = previousCoreSample.current;
            const memory = percent(next.usedMemoryBytes, next.totalMemoryBytes);
            if (next.cpuPercent >= 95) pushIncident('warning', 'CPU SATURATION', `Processor load reached ${next.cpuPercent.toFixed(0)}%.`, 'anomaly-cpu-high', 60_000);
            if (memory >= 92) pushIncident('critical', 'MEMORY PRESSURE', `RAM utilization reached ${memory.toFixed(0)}%.`, 'anomaly-memory-high', 60_000);
            if (next.gpuPercent >= 95) pushIncident('warning', 'GPU SATURATION', `Graphics load reached ${next.gpuPercent.toFixed(0)}%.`, 'anomaly-gpu-high', 60_000);
            if (previous) {
              const elapsedSeconds = Math.max(0.25, (next.timestampMs - previous.timestampMs) / 1_000);
              const received = next.receivedBytes / elapsedSeconds;
              const transmitted = next.transmittedBytes / elapsedSeconds;
              setNetworkRates((current) => ({ received, transmitted, peak: Math.max(current.peak, received) }));
              const previousMemory = percent(previous.usedMemoryBytes, previous.totalMemoryBytes);
              const deviations = [
                { label: 'CPU', value: next.cpuPercent, change: next.cpuPercent - previous.cpuPercent },
                { label: 'RAM', value: memory, change: memory - previousMemory },
                { label: 'GPU', value: next.gpuPercent, change: next.gpuPercent - previous.gpuPercent },
              ];
              deviations.forEach((deviation) => {
                if (deviation.value >= 70 && deviation.change >= 30) pushIncident('warning', `${deviation.label} DEVIATION`, `Load jumped ${deviation.change.toFixed(0)} points to ${deviation.value.toFixed(0)}%.`, `anomaly-${deviation.label.toLowerCase()}-jump`, 45_000);
              });
              const network = next.receivedBytes + next.transmittedBytes;
              const previousNetwork = previous.receivedBytes + previous.transmittedBytes;
              if (network > 5 * 1024 * 1024 && network > Math.max(previousNetwork * 5, 1)) pushIncident('warning', 'NETWORK DEVIATION', `Interval traffic spiked to ${formatBytes(network)}.`, 'anomaly-network-jump', 45_000);
            }
            setCoreSnapshot(next);
            setCoreReady(true);
            setHistory((current) => [...current.slice(-59), next.cpuPercent]);
            setTimeline((current) => [...current.slice(-299), { timestampMs: next.timestampMs, cpu: next.cpuPercent, memory: percent(next.usedMemoryBytes, next.totalMemoryBytes), gpu: next.gpuPercent, received: next.receivedBytes, transmitted: next.transmittedBytes }]);
          }
          previousCoreSample.current = next;
        }
      } catch (error) {
        if (!cancelled && String(error) !== 'MONITORING_PAUSED') {
          setTelemetryError(error instanceof Error ? error.message : String(error));
          raiseQueryIssue('core', 'ERROR');
        }
      } finally {
        window.clearTimeout(timeout);
        coreInFlight.current = false;
        if (!cancelled) timer = window.setTimeout(run, Math.max(0, POLL_INTERVALS.core - (performance.now() - started)));
      }
    };
    void run();
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [clearQueryIssue, monitoringActive, pushIncident, raiseQueryIssue]);
  useEffect(() => {
    if (!monitoringActive || DEMO_MODE) return;
    let cancelled = false;
    let timer: number | undefined;
    const run = async () => {
      if (processInFlight.current) { timer = window.setTimeout(run, 250); return; }
      processInFlight.current = true;
      const started = performance.now();
      const timeout = window.setTimeout(() => { if (!cancelled) raiseQueryIssue('process', 'TIMEOUT'); }, QUERY_TIMEOUTS.process);
      try {
        const next = await getProcessSnapshot();
        if (cancelled) return;
        clearQueryIssue('process');
        if (next) {
          if (processNeedsWarmup.current) {
            processNeedsWarmup.current = false;
          } else {
            setProcessSnapshot(next);
            setStorageIo((current) => [...current.slice(-59), { timestampMs: next.timestampMs, read: next.diskReadBytes, write: next.diskWriteBytes }]);
          }
        }
      } catch (error) {
        if (!cancelled && String(error) !== 'MONITORING_PAUSED') raiseQueryIssue('process', 'ERROR');
      } finally {
        window.clearTimeout(timeout);
        processInFlight.current = false;
        if (!cancelled) timer = window.setTimeout(run, Math.max(0, POLL_INTERVALS.process - (performance.now() - started)));
      }
    };
    void run();
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [clearQueryIssue, monitoringActive, raiseQueryIssue]);
  useEffect(() => {
    if (!monitoringActive || DEMO_MODE) return;
    let cancelled = false;
    let timer: number | undefined;
    const run = async () => {
      if (diskInFlight.current) { timer = window.setTimeout(run, 250); return; }
      diskInFlight.current = true;
      const started = performance.now();
      const timeout = window.setTimeout(() => { if (!cancelled) raiseQueryIssue('disk', 'TIMEOUT'); }, QUERY_TIMEOUTS.disk);
      try {
        const next = await getDiskSnapshot();
        if (cancelled) return;
        clearQueryIssue('disk');
        if (next) setDiskSnapshot(next);
      } catch (error) {
        if (!cancelled && String(error) !== 'MONITORING_PAUSED') raiseQueryIssue('disk', 'ERROR');
      } finally {
        window.clearTimeout(timeout);
        diskInFlight.current = false;
        if (!cancelled) timer = window.setTimeout(run, Math.max(0, POLL_INTERVALS.disk - (performance.now() - started)));
      }
    };
    void run();
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [clearQueryIssue, monitoringActive, raiseQueryIssue]);
  useEffect(() => {
    if (!monitoringActive || DEMO_MODE) return;
    let cancelled = false;
    let timer: number | undefined;
    const run = async () => {
      if (eventsInFlight.current) { timer = window.setTimeout(run, 250); return; }
      eventsInFlight.current = true;
      const started = performance.now();
      const timeout = window.setTimeout(() => { if (!cancelled) raiseQueryIssue('events', 'TIMEOUT'); }, QUERY_TIMEOUTS.events);
      try {
        const next = await getWindowsEvents();
        if (cancelled) return;
        setEvents(next);
        clearQueryIssue('events');
        const critical = next.filter((record) => record.kind === 'critical');
        if (criticalEventsInitialized.current) {
          critical.filter((record) => !seenCriticalEvents.current.has(record.id)).slice(0, 4).forEach((record) => {
            const summary = record.message.replace(/\s+/g, ' ').trim();
            pushIncident('critical', 'WINDOWS CRITICAL', `${record.source}: ${summary.slice(0, 96)}${summary.length > 96 ? '…' : ''}`, `event-${record.id}`, 0);
          });
        }
        critical.forEach((record) => seenCriticalEvents.current.add(record.id));
        criticalEventsInitialized.current = true;
      } catch (error) {
        if (!cancelled && String(error) !== 'MONITORING_PAUSED') {
          console.error('Windows events could not be read:', error);
          raiseQueryIssue('events', 'ERROR');
        }
      } finally {
        window.clearTimeout(timeout);
        eventsInFlight.current = false;
        if (!cancelled) timer = window.setTimeout(run, Math.max(0, POLL_INTERVALS.events - (performance.now() - started)));
      }
    };
    void run();
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [clearQueryIssue, monitoringActive, pushIncident, raiseQueryIssue]);

  const memoryPercent = percent(snapshot?.usedMemoryBytes, snapshot?.totalMemoryBytes);
  const diskTotal = snapshot?.disks.reduce((sum, disk) => sum + disk.totalBytes, 0) ?? 0;
  const diskUsed = snapshot?.disks.reduce((sum, disk) => sum + disk.totalBytes - disk.availableBytes, 0) ?? 0;
  const sortedDisks = useMemo(() => [...(snapshot?.disks ?? [])].sort((left, right) => (left.mountPoint || left.name).localeCompare(right.mountPoint || right.name)), [snapshot?.disks]);
  const filteredEvents = useMemo(() => events.filter((event) => eventFilter === 'all' || (eventFilter === 'critical' ? event.kind === 'critical' : event.category === eventFilter)), [eventFilter, events]);
  const eventFilterCount = useCallback((filter: EventFilter) => events.reduce((total, event) => {
    const matches = filter === 'all' || (filter === 'critical' ? event.kind === 'critical' : event.category === filter);
    return total + (matches ? event.count : 0);
  }, 0), [events]);
  const updateLabel = updatePhase === 'available' && availableUpdate ? `UPDATE v${availableUpdate.version}`
    : updatePhase === 'downloading' ? `DOWNLOADING ${updateProgress}%`
      : updatePhase === 'installing' ? 'INSTALLING UPDATE'
        : updatePhase === 'checking' ? 'CHECKING UPDATE'
          : `VERSION v${appVersion}`;
  const activeIssue = (Object.entries(queryIssues) as Array<[QueryKey, QueryIssue]>)[0];
  const pulseState = manualPause ? 'PAUSED' : !windowMonitoringActive ? 'SUSPENDED' : !coreReady ? 'SYNCING' : activeIssue ? 'ABNORMAL' : snapshot ? 'NOMINAL' : 'STANDBY';
  const pulseDetail = manualPause ? 'MANUAL CONTROL' : !windowMonitoringActive ? 'TRAY / MINIMIZED' : activeIssue ? `${QUERY_LABELS[activeIssue[0]]} ${activeIssue[1]}` : null;
  const telemetryOnline = pulseState === 'NOMINAL';
  const topbarStatus = !monitoringActive ? 'MONITORING PAUSED' : pulseState === 'SYNCING' ? 'TELEMETRY SYNCING' : pulseState === 'ABNORMAL' ? 'TELEMETRY ABNORMAL' : snapshot ? 'TELEMETRY ONLINE' : 'TELEMETRY STANDBY';

  useEffect(() => {
    if (previousPulseState.current === null) {
      previousPulseState.current = pulseState;
      return;
    }
    if (previousPulseState.current === pulseState) return;
    previousPulseState.current = pulseState;
    if (pulseState === 'SYNCING') pushIncident('info', 'SYNCING', 'Telemetry baselines are being synchronized.', 'pulse-syncing', 0);
    if (pulseState === 'ABNORMAL') pushIncident('critical', 'ABNORMAL', pulseDetail ? `${pulseDetail} requires attention.` : 'A monitoring channel requires attention.', 'pulse-abnormal', 0);
    if (pulseState === 'NOMINAL') pushIncident('recovery', 'NOMINAL', 'All active monitoring channels are responding.', 'pulse-nominal', 0);
    if (pulseState === 'PAUSED') pushIncident('info', 'PAUSED', 'All telemetry queries were paused from System Pulse.', 'pulse-paused', 0);
    if (pulseState === 'SUSPENDED') pushIncident('info', 'SUSPENDED', 'Polling paused while HORUS is minimized or in the tray.', 'pulse-suspended', 0);
  }, [pulseDetail, pulseState, pushIncident]);

  const handleUpdate = async () => {
    if (!isTauriRuntime() || updatePhase === 'downloading' || updatePhase === 'installing' || updatePhase === 'checking') return;
    try {
      let update = availableUpdate;
      if (!update) {
        setUpdatePhase('checking');
        update = await check();
        setAvailableUpdate(update);
        if (!update) { setUpdatePhase('current'); return; }
        setUpdatePhase('available');
        return;
      }
      let downloaded = 0;
      let contentLength = 0;
      setUpdateProgress(0);
      setUpdatePhase('downloading');
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') contentLength = event.data.contentLength ?? 0;
        if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          setUpdateProgress(contentLength > 0 ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : 0);
        }
        if (event.event === 'Finished') setUpdatePhase('installing');
      });
    } catch (error) {
      setUpdatePhase('error');
      console.error('Update installation failed:', error);
    }
  };

  const handleAutostartChange = async (enabled: boolean) => {
    if (!isTauriRuntime() || autostartBusy) return;
    setAutostartBusy(true);
    try {
      if (enabled) await enableAutostart();
      else await disableAutostart();
      localStorage.setItem(AUTOSTART_INITIALIZED_KEY, 'true');
      setAutostart(await isAutostartEnabled());
    } catch (error) {
      console.error('Autostart setting could not be updated:', error);
      setAutostart(await isAutostartEnabled().catch(() => autostart));
    } finally {
      setAutostartBusy(false);
    }
  };

  const showEventTooltip = (target: HTMLElement, record: WindowsEventRecord) => {
    const rect = target.getBoundingClientRect();
    const width = Math.min(440, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const above = window.innerHeight - rect.bottom < 190;
    setEventTooltip({ record, top: above ? rect.top - 8 : rect.bottom + 8, left, width, above });
  };

  const handleWindowDrag = async (event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !isTauriRuntime()) return;
    setWindowDragging(true);
    try { await getCurrentWindow().startDragging(); }
    finally { setWindowDragging(false); }
  };

  return <div className={`app-shell ${decorations ? '' : 'frameless'}`}>
    {!decorations && <>{RESIZE_HANDLES.map(([direction, className]) => <div key={direction} className={className} onMouseDown={(event) => { if (event.button === 0 && isTauriRuntime()) void getCurrentWindow().startResizeDragging(direction); }} />)}<div className="window-chrome"><button className={`drag-zone ${windowDragging ? 'is-dragging' : ''}`} aria-label="Move window" onMouseDown={(event) => void handleWindowDrag(event)}><span className={`hieroglyph-track ${!hieroglyphMotion || windowDragging ? 'is-paused' : ''}`} style={{ '--hieroglyph-duration': `${48 * 100 / hieroglyphSpeed}s` } as CSSProperties} aria-hidden="true"><img src="/hieroglyphics.png" alt="" /><img src="/hieroglyphics.png" alt="" /></span></button><div className="window-controls"><button className="chrome-action minimize-window" onClick={() => { setWindowMonitoringActive(false); if (isTauriRuntime()) void getCurrentWindow().minimize(); }} aria-label="Minimize window" title="Minimize"><WindowControlIcon type="minimize" /></button><button className="chrome-action maximize-window" onClick={() => isTauriRuntime() && void getCurrentWindow().toggleMaximize()} aria-label="Maximize window" title="Maximize"><WindowControlIcon type="maximize" /></button><button className="chrome-action close-window" onClick={() => { setWindowMonitoringActive(false); if (isTauriRuntime()) void getCurrentWindow().hide(); }} aria-label="Close window" title="Close"><WindowControlIcon type="close" /></button></div></div></>}
    <div className="ambient-grid" />
    <header className="topbar"><div className="brand-block"><div className="brand-mark" tabIndex={0} aria-describedby="brand-origin"><img className="brand-icon" src="/teoh-alt02-transparent.png" alt="HORUS emblem" /><div className="brand-popover" id="brand-origin" role="tooltip"><img src="/teoh-alt02-transparent.png" alt="" /><p>It was made on Earth by two entitiy named İsmail and Codex</p></div></div><div className="brand-copy"><h1>HORUS</h1><span className="eyebrow">REAL-TIME SYSTEM OBSERVATORY</span></div></div><div className="topbar-status"><div><span className={`live-dot ${telemetryOnline ? 'online' : ''} ${pulseState === 'ABNORMAL' ? 'abnormal' : ''}`} />{topbarStatus}</div><button className="settings-trigger" onClick={() => setSettingsOpen(true)}>CONTROL MATRIX</button></div></header>
    <main>
      <section className="pulse-ribbon"><div className={`pulse-title ${pulseState.toLowerCase()}`}><button className={`pulse-beacon ${telemetryOnline ? 'online' : ''}`} type="button" onClick={() => setManualPause((paused) => !paused)} aria-label={manualPause ? 'Resume all telemetry queries' : 'Pause all telemetry queries'} aria-pressed={manualPause} title={manualPause ? 'Resume monitoring' : 'Pause monitoring'}><svg viewBox="0 0 12 12" aria-hidden="true">{manualPause ? <path d="M3 1.7 10 6 3 10.3Z" /> : <path d="M2.5 2h2.2v8H2.5zm4.8 0h2.2v8H7.3z" />}</svg></button><div><span>SYSTEM PULSE</span><strong>{pulseState}</strong>{pulseDetail && <small>{pulseDetail}</small>}</div></div><div className="pulse-reading host"><div className="host-copy"><span>HOST</span><strong>{snapshot?.hostName ?? '—'}</strong></div><HostHardware snapshot={snapshot} operatingSystem={snapshot?.operatingSystem ?? telemetryError ?? 'Awaiting native runtime'} visible={hostSpecsVisible} time={clockTime} onToggle={() => setHostSpecsVisible((visible) => !visible)} /></div><div className="pulse-reading"><span>UPTIME</span><strong>{snapshot ? formatUptime(snapshot.uptimeSeconds) : '—'}</strong><small>{snapshot?.processCount ?? 0} active processes</small></div><div className="pulse-reading"><span>SYSTEM LOAD</span><strong>{snapshot ? `${snapshot.cpuPercent.toFixed(0)}%` : '—'}</strong><small>{snapshot?.logicalCpuCount ?? 0} logical processors</small></div></section>
      <section className="command-surface">
        <div className="performance-grid">
          <section className="module cpu-module"><ModuleHeader code="PERF / 01" title="CPU Matrix" meta={<span>{snapshot?.logicalCpuCount ?? 0} CORES</span>} /><div className="cpu-layout"><MetricRing value={snapshot?.cpuPercent ?? 0} label="TOTAL LOAD" /><div className="core-grid">{(snapshot?.perCpuPercent ?? []).slice(0, 16).map((value, index) => <i key={index} title={`CPU ${index + 1}: ${value.toFixed(0)}%`} style={{ '--core-load': `${value}%` } as CSSProperties} />)}</div></div></section>
          <section className="module memory-module"><ModuleHeader code="PERF / 02" title="Memory Field" meta={<span>{snapshot ? formatBytes(snapshot.totalMemoryBytes) : '—'} TOTAL</span>} /><div className="memory-layout"><div className="memory-value"><strong>{snapshot ? `${memoryPercent.toFixed(0)}%` : '—'}</strong><span>pressure</span></div><div className="segmented-bar"><i style={{ width: `${memoryPercent}%` }} /></div><div className="data-pairs"><span>Used<strong>{snapshot ? formatBytes(snapshot.usedMemoryBytes) : '—'}</strong></span><span>Available<strong>{snapshot ? formatBytes(snapshot.totalMemoryBytes - snapshot.usedMemoryBytes) : '—'}</strong></span><span>Swap<strong>{snapshot ? formatBytes(snapshot.usedSwapBytes) : '—'}</strong></span><span>Total<strong>{snapshot ? formatBytes(snapshot.totalMemoryBytes) : '—'}</strong></span></div></div></section>
          <section className="module network-module"><ModuleHeader code="I/O / 03" title="Network Stream" meta={<span>LIVE INTERVAL</span>} /><div className="network-layout"><div><span className="direction peak">◆</span><span>PEAK</span><strong>{snapshot ? formatRate(networkRates.peak) : '—'}</strong></div><div><span className="direction down">↓</span><span>RECEIVED</span><strong>{snapshot ? formatRate(networkRates.received) : '—'}</strong></div><div><span className="direction up">↑</span><span>TRANSMITTED</span><strong>{snapshot ? formatRate(networkRates.transmitted) : '—'}</strong></div><div className="traffic-line"><i /><i /><i /><i /><i /><i /></div></div></section>
        </div>
        <div className="storage-row">
          <section className="module storage-module"><ModuleHeader code="STORAGE / 04" title="Storage Array" meta={<span>{diskTotal ? 'LIVE ARRAY' : 'AWAITING DATA'}</span>} /><StorageIoStream samples={storageIo} fault={Boolean(queryIssues.process)} /><div className="array-utilization"><span>ARRAY UTILIZATION</span><strong>{diskTotal ? `${percent(diskUsed, diskTotal).toFixed(0)}%` : '—'}</strong></div><div className="disk-grid">{sortedDisks.length ? sortedDisks.map((disk) => { const used = percent(disk.totalBytes - disk.availableBytes, disk.totalBytes); return <div className="disk-row" key={`${disk.name}-${disk.mountPoint}`}><div><strong>{disk.mountPoint || disk.name}</strong><span>{formatBytes(disk.totalBytes - disk.availableBytes)} / {formatBytes(disk.totalBytes)}</span></div><div className="thin-bar"><i style={{ width: `${used}%` }} /></div><b>{used.toFixed(0)}%</b></div>; }) : <EmptyState text="No storage telemetry received." />}</div></section>
          <TelemetryTimeline samples={timeline} range={timelineRange} setRange={setTimelineRange} enabled={timelineSeries} toggleSeries={(series) => setTimelineSeries((current) => ({ ...current, [series]: !current[series] }))} fault={Boolean(queryIssues.core)} time={clockTime} />
        </div>
        <div className="operations-grid">
          <section className="module process-module"><ModuleHeader code="ACTIVITY / 06" title="Process Flow" meta={<span>{snapshot?.processCount ?? 0} ACTIVE</span>} /><div className="process-list"><div className="list-head"><span>PROCESS</span><span>CPU</span><span>MEMORY</span><span>PID</span></div>{snapshot?.topProcesses.length ? snapshot.topProcesses.map((process) => <div className="process-row" key={process.pid}><span><i />{process.name}</span><strong>{process.cpuPercent.toFixed(1)}%</strong><strong>{formatBytes(process.memoryBytes)}</strong><code>{process.pid}</code></div>) : <EmptyState text="Native process stream is waiting for the desktop runtime." />}</div><IncidentStream incidents={incidents} /></section>
          <section className="module events-module">
            <ModuleHeader code="WINDOWS / 07" title="System Events" meta={<span>CURATED EVENT LOG</span>} />
            <div className="event-filters" role="tablist" aria-label="Event category">
              {EVENT_FILTERS.map((filter) => <button key={filter.id} className={`${filter.id} ${eventFilter === filter.id ? 'active' : ''}`} onClick={() => { setEventFilter(filter.id); setEventTooltip(null); }} role="tab" aria-selected={eventFilter === filter.id}><span>{filter.label}</span><strong>{eventFilterCount(filter.id)}</strong></button>)}
            </div>
            <div className="event-list" onScroll={() => setEventTooltip(null)}>
              {filteredEvents.length ? filteredEvents.map((record) => <article className={`event-row ${record.kind} ${record.category}`} key={record.id} tabIndex={0} onMouseEnter={(event) => showEventTooltip(event.currentTarget, record)} onMouseLeave={() => setEventTooltip(null)} onFocus={(event) => showEventTooltip(event.currentTarget, record)} onBlur={() => setEventTooltip(null)}>
                <i />
                <div className="event-copy"><div className="event-identity"><strong>{record.summary}</strong><span>{record.category.toUpperCase()} · ID {record.eventId}</span></div><p>{record.source}</p></div>
                <div className="event-trailing">{record.count > 1 && <b>×{record.count}</b>}<time>{new Date(record.timestamp).toLocaleString()}</time></div>
              </article>) : <div className="event-empty"><span>NO RECENT RECORDS</span><strong>{EVENT_FILTERS.find((filter) => filter.id === eventFilter)?.label} channel is clear</strong><p>HORUS is watching the curated Windows Event Log channels. New matching records will appear automatically.</p></div>}
            </div>
          </section>
        </div>
      </section>
    </main>
    <footer><span>HORUS NATIVE TELEMETRY BUS</span><div className="footer-status"><button className={`update-trigger ${updatePhase === 'available' ? 'has-update' : ''}`} onClick={() => void handleUpdate()} disabled={updatePhase === 'checking' || updatePhase === 'downloading' || updatePhase === 'installing'}>{updateLabel}</button><span>{snapshot ? `LAST SAMPLE ${new Date(snapshot.timestampMs).toLocaleTimeString()}` : 'NO NATIVE SAMPLE'}</span></div></footer>
    {eventTooltip && <aside className={`event-tooltip ${eventTooltip.above ? 'above' : ''}`} style={{ top: eventTooltip.top, left: eventTooltip.left, width: eventTooltip.width }} role="tooltip"><div><span>{eventTooltip.record.kind.toUpperCase()} · {eventTooltip.record.category.toUpperCase()} · ID {eventTooltip.record.eventId}</span><time>{new Date(eventTooltip.record.timestamp).toLocaleString()}</time></div><strong>{eventTooltip.record.summary}</strong><small>{eventTooltip.record.source} · {eventTooltip.record.channel}{eventTooltip.record.count > 1 ? ` · ×${eventTooltip.record.count}` : ''}</small><p>{eventTooltip.record.message}</p></aside>}
    {settingsOpen && <button className={`settings-backdrop ${settingsBlur ? 'is-blurred' : ''}`} aria-label="Close settings" onClick={() => setSettingsOpen(false)} />}
    <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} theme={theme} setTheme={setTheme} decorations={decorations} setDecorations={setDecorations} settingsBlur={settingsBlur} setSettingsBlur={setSettingsBlur} hieroglyphMotion={hieroglyphMotion} setHieroglyphMotion={setHieroglyphMotion} hieroglyphSpeed={hieroglyphSpeed} setHieroglyphSpeed={setHieroglyphSpeed} autostart={autostart} autostartBusy={autostartBusy} onAutostartChange={(enabled) => void handleAutostartChange(enabled)} />
  </div>;
}

export default App;
