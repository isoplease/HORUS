import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from '@tauri-apps/plugin-autostart';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { getSystemSnapshot, getWindowsEvents, isTauriRuntime } from './telemetry';
import type { EventKind, SystemSnapshot, ThemeSettings, WindowsEventRecord } from './types';

const THEME_KEY = 'horus-theme-v1';
const FRAME_KEY = 'horus-window-frame-v1';
const AUTOSTART_INITIALIZED_KEY = 'horus-autostart-initialized-v1';

const DEFAULT_THEME: ThemeSettings = {
  background: '#050c14', backgroundTransparency: 18, card: '#0a1b2b', heading: '#eaf8ff', info: '#86a4b7', accent: '#20c9f4', chart: '#35e2c2', warning: '#ffbd59', critical: '#ff5577', cardOpacity: 92, glow: 34, radius: 10, gap: 10,
};

const RESIZE_HANDLES = [
  ['North', 'resize-edge resize-n'], ['South', 'resize-edge resize-s'], ['West', 'resize-edge resize-w'], ['East', 'resize-edge resize-e'],
  ['NorthWest', 'resize-edge resize-nw'], ['NorthEast', 'resize-edge resize-ne'], ['SouthWest', 'resize-edge resize-sw'], ['SouthEast', 'resize-edge resize-se'],
] as const;

const EVENT_FILTERS: Array<{ id: EventKind; label: string }> = [
  { id: 'critical', label: 'Critical' }, { id: 'error', label: 'Error' }, { id: 'warning', label: 'Warnings' }, { id: 'application', label: 'Application' },
];

type UpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installing' | 'error';
interface EventTooltip { record: WindowsEventRecord; top: number; left: number; width: number; above: boolean; }

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
  return <svg className="sparkline" viewBox="0 0 100 50" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="spark-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.32" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs><polygon points={`0,50 ${coordinates} 100,50`} fill="url(#spark-fade)" /><polyline points={coordinates} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" /></svg>;
}

function MetricRing({ value, label }: { value: number; label: string }) {
  const safeValue = Math.min(100, Math.max(0, value));
  return <div className="metric-ring" style={{ '--ring-value': `${safeValue * 3.6}deg` } as CSSProperties}><div><strong>{safeValue.toFixed(0)}%</strong><span>{label}</span></div></div>;
}

function ModuleHeader({ code, title, meta }: { code: string; title: string; meta?: ReactNode }) {
  return <header className="module-header"><div><span>{code}</span><h2>{title}</h2></div>{meta && <div className="module-meta">{meta}</div>}</header>;
}

function EmptyState({ text }: { text: string }) { return <div className="empty-state"><span>⌁</span><p>{text}</p></div>; }

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

interface SettingsPanelProps { open: boolean; onClose: () => void; theme: ThemeSettings; setTheme: (value: ThemeSettings) => void; decorations: boolean; setDecorations: (value: boolean) => void; autostart: boolean; autostartBusy: boolean; onAutostartChange: (value: boolean) => void; }
function SettingsPanel({ open, onClose, theme, setTheme, decorations, setDecorations, autostart, autostartBusy, onAutostartChange }: SettingsPanelProps) {
  const update = <K extends keyof ThemeSettings>(key: K, value: ThemeSettings[K]) => setTheme({ ...theme, [key]: value });
  const colors: Array<[keyof ThemeSettings, string]> = [['background', 'Background'], ['card', 'Surface'], ['heading', 'Headings'], ['info', 'Info text'], ['accent', 'Accent'], ['chart', 'Charts'], ['warning', 'Warnings'], ['critical', 'Critical']];
  return <aside className={`settings-panel ${open ? 'is-open' : ''}`} aria-hidden={!open}>
    <div className="settings-title"><div><span className="eyebrow">CONTROL / APPEARANCE</span><h2>Interface Matrix</h2></div><button className="icon-button" onClick={onClose}>×</button></div>
    <section><h3>Color channels</h3><div className="color-grid">{colors.map(([key, label]) => <label key={key}><span>{label}</span><input type="color" value={String(theme[key])} onChange={(event) => update(key, event.target.value as never)} /></label>)}</div></section>
    <section className="range-stack"><h3>Surface density</h3><label className={decorations ? 'is-disabled' : ''}><span>Background transparency <output>{theme.backgroundTransparency}%</output></span><input type="range" min="0" max="70" value={theme.backgroundTransparency} disabled={decorations} onChange={(event) => update('backgroundTransparency', Number(event.target.value))} /></label><label><span>Surface opacity <output>{theme.cardOpacity}%</output></span><input type="range" min="55" max="100" value={theme.cardOpacity} onChange={(event) => update('cardOpacity', Number(event.target.value))} /></label><label><span>Glow intensity <output>{theme.glow}%</output></span><input type="range" min="0" max="100" value={theme.glow} onChange={(event) => update('glow', Number(event.target.value))} /></label><label><span>Corner radius <output>{theme.radius}px</output></span><input type="range" min="0" max="20" value={theme.radius} onChange={(event) => update('radius', Number(event.target.value))} /></label></section>
    <section className="module-toggles"><h3>Window</h3><label><span>Start with Windows</span><input type="checkbox" checked={autostart} disabled={autostartBusy} onChange={(event) => onAutostartChange(event.target.checked)} /></label><label><span>Windows frame</span><input type="checkbox" checked={decorations} onChange={(event) => setDecorations(event.target.checked)} /></label></section>
    <div className="settings-actions"><button onClick={() => setTheme(DEFAULT_THEME)}>Reset theme</button></div>
  </aside>;
}

function App() {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [theme, setTheme] = useState<ThemeSettings>(() => loadJson(THEME_KEY, DEFAULT_THEME));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [decorations, setDecorations] = useState(() => localStorage.getItem(FRAME_KEY) !== 'false');
  const [autostart, setAutostart] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [eventFilter, setEventFilter] = useState<EventKind>('warning');
  const [events, setEvents] = useState<WindowsEventRecord[]>([]);
  const [clockTime, setClockTime] = useState(() => new Date());
  const [appVersion, setAppVersion] = useState('DEV');
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('idle');
  const [updateProgress, setUpdateProgress] = useState(0);
  const [eventTooltip, setEventTooltip] = useState<EventTooltip | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const hexToRgb = (hex: string) => { const normalized = hex.replace('#', ''); return `${parseInt(normalized.slice(0, 2), 16)}, ${parseInt(normalized.slice(2, 4), 16)}, ${parseInt(normalized.slice(4, 6), 16)}`; };
    root.style.setProperty('--background', theme.background); root.style.setProperty('--background-rgb', hexToRgb(theme.background)); root.style.setProperty('--background-alpha', String(decorations ? 1 : 1 - theme.backgroundTransparency / 100)); root.style.setProperty('--surface-rgb', hexToRgb(theme.card)); root.style.setProperty('--surface-opacity', String(theme.cardOpacity / 100)); root.style.setProperty('--heading', theme.heading); root.style.setProperty('--info', theme.info); root.style.setProperty('--accent', theme.accent); root.style.setProperty('--chart', theme.chart); root.style.setProperty('--warning', theme.warning); root.style.setProperty('--critical', theme.critical); root.style.setProperty('--glow-alpha', String(theme.glow / 100)); root.style.setProperty('--radius', `${theme.radius}px`);
    localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  }, [decorations, theme]);

  useEffect(() => { localStorage.setItem(FRAME_KEY, String(decorations)); if (isTauriRuntime()) void invoke('set_window_frame', { decorations }).catch((error) => console.error('Window frame could not be updated:', error)); }, [decorations]);
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
    let disposed = false;
    const refreshEvents = async () => {
      try {
        const next = await getWindowsEvents();
        if (!disposed) setEvents(next);
      } catch (error) {
        console.error('Windows events could not be read:', error);
      }
    };
    void refreshEvents();
    const timer = window.setInterval(refreshEvents, 15_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => { try { const next = await getSystemSnapshot(); if (disposed) return; setSnapshot(next); setTelemetryError(next ? null : 'Browser preview — native telemetry waits for the desktop runtime'); if (next) setHistory((current) => [...current.slice(-59), next.cpuPercent]); } catch (error) { if (!disposed) setTelemetryError(error instanceof Error ? error.message : String(error)); } };
    void refresh(); const timer = window.setInterval(refresh, 1_000); return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  const memoryPercent = percent(snapshot?.usedMemoryBytes, snapshot?.totalMemoryBytes);
  const diskTotal = snapshot?.disks.reduce((sum, disk) => sum + disk.totalBytes, 0) ?? 0;
  const diskUsed = snapshot?.disks.reduce((sum, disk) => sum + disk.totalBytes - disk.availableBytes, 0) ?? 0;
  const sortedDisks = useMemo(() => [...(snapshot?.disks ?? [])].sort((left, right) => (left.mountPoint || left.name).localeCompare(right.mountPoint || right.name)), [snapshot?.disks]);
  const filteredEvents = useMemo(() => events.filter((event) => event.kind === eventFilter), [eventFilter, events]);
  const updateLabel = updatePhase === 'available' && availableUpdate ? `UPDATE v${availableUpdate.version}`
    : updatePhase === 'downloading' ? `DOWNLOADING ${updateProgress}%`
      : updatePhase === 'installing' ? 'INSTALLING UPDATE'
        : updatePhase === 'checking' ? 'CHECKING UPDATE'
          : `VERSION v${appVersion}`;

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

  return <div className={`app-shell ${decorations ? '' : 'frameless'}`}>
    {!decorations && <>{RESIZE_HANDLES.map(([direction, className]) => <div key={direction} className={className} onMouseDown={(event) => { if (event.button === 0 && isTauriRuntime()) void getCurrentWindow().startResizeDragging(direction); }} />)}<div className="window-chrome"><div className="window-brand"><img src="/teoh-alt1.png" alt="" /></div><button className="drag-zone" onMouseDown={(event) => { if (event.button === 0 && isTauriRuntime()) void getCurrentWindow().startDragging(); }}>HORUS // COMMAND DECK</button><button onClick={() => isTauriRuntime() && void getCurrentWindow().minimize()}>—</button><button onClick={() => isTauriRuntime() && void getCurrentWindow().toggleMaximize()}>□</button><button className="close-window" onClick={() => isTauriRuntime() && void getCurrentWindow().hide()}>×</button></div></>}
    <div className="ambient-grid" />
    <header className="topbar"><div className="brand-block"><div><span className="eyebrow">REAL-TIME SYSTEM OBSERVATORY</span><h1>HORUS</h1></div></div><div className="topbar-status"><div><span className={`live-dot ${snapshot ? 'online' : ''}`} />{snapshot ? 'TELEMETRY ONLINE' : 'TELEMETRY STANDBY'}</div><time>{new Date(snapshot?.timestampMs ?? Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><button className="settings-trigger" onClick={() => setSettingsOpen(true)}>CONTROL MATRIX</button></div></header>
    <main>
      <section className="pulse-ribbon"><div className="pulse-title"><span className={`pulse-beacon ${snapshot ? 'online' : ''}`} /><div><span>SYSTEM PULSE</span><strong>{snapshot ? 'NOMINAL' : 'STANDBY'}</strong></div></div><div className="pulse-reading host"><div className="host-copy"><span>HOST</span><strong>{snapshot?.hostName ?? '—'}</strong><small>{snapshot?.operatingSystem ?? telemetryError ?? 'Awaiting native runtime'}</small></div><BinaryClock time={clockTime} /></div><div className="pulse-reading"><span>UPTIME</span><strong>{snapshot ? formatUptime(snapshot.uptimeSeconds) : '—'}</strong><small>{snapshot?.processCount ?? 0} active processes</small></div><div className="pulse-reading"><span>SYSTEM LOAD</span><strong>{snapshot ? `${snapshot.cpuPercent.toFixed(0)}%` : '—'}</strong><small>{snapshot?.logicalCpuCount ?? 0} logical processors</small></div></section>
      <section className="command-surface">
        <div className="performance-grid">
          <section className="module cpu-module"><ModuleHeader code="PERF / 01" title="CPU Matrix" meta={<span>{snapshot?.logicalCpuCount ?? 0} CORES</span>} /><div className="cpu-layout"><MetricRing value={snapshot?.cpuPercent ?? 0} label="TOTAL LOAD" /><div className="cpu-detail"><strong>{snapshot ? `${snapshot.cpuPercent.toFixed(1)}%` : '—'}</strong><span>aggregate utilization</span><div className="core-grid">{(snapshot?.perCpuPercent ?? []).slice(0, 16).map((value, index) => <i key={index} title={`CPU ${index + 1}: ${value.toFixed(0)}%`} style={{ '--core-load': `${value}%` } as CSSProperties} />)}</div></div><Sparkline values={history} /></div></section>
          <section className="module memory-module"><ModuleHeader code="PERF / 02" title="Memory Field" meta={<span>{snapshot ? formatBytes(snapshot.totalMemoryBytes) : '—'} TOTAL</span>} /><div className="memory-layout"><div className="memory-value"><strong>{snapshot ? `${memoryPercent.toFixed(0)}%` : '—'}</strong><span>pressure</span></div><div className="segmented-bar"><i style={{ width: `${memoryPercent}%` }} /></div><div className="data-pairs"><span>Used<strong>{snapshot ? formatBytes(snapshot.usedMemoryBytes) : '—'}</strong></span><span>Available<strong>{snapshot ? formatBytes(snapshot.totalMemoryBytes - snapshot.usedMemoryBytes) : '—'}</strong></span><span>Swap<strong>{snapshot ? formatBytes(snapshot.usedSwapBytes) : '—'}</strong></span><span>Total<strong>{snapshot ? formatBytes(snapshot.totalMemoryBytes) : '—'}</strong></span></div></div></section>
          <section className="module network-module"><ModuleHeader code="I/O / 03" title="Network Stream" meta={<span>LIVE INTERVAL</span>} /><div className="network-layout"><div><span className="direction down">↓</span><span>RECEIVED</span><strong>{snapshot ? formatBytes(snapshot.receivedBytes) : '—'}</strong></div><div><span className="direction up">↑</span><span>TRANSMITTED</span><strong>{snapshot ? formatBytes(snapshot.transmittedBytes) : '—'}</strong></div><div className="traffic-line"><i /><i /><i /><i /><i /><i /></div></div></section>
        </div>
        <div className="storage-row">
          <section className="module storage-module"><ModuleHeader code="STORAGE / 04" title="Storage Array" meta={<span>{diskTotal ? `${percent(diskUsed, diskTotal).toFixed(0)}% ARRAY UTILIZATION` : 'AWAITING DATA'}</span>} /><div className="disk-grid">{sortedDisks.length ? sortedDisks.map((disk) => { const used = percent(disk.totalBytes - disk.availableBytes, disk.totalBytes); return <div className="disk-row" key={`${disk.name}-${disk.mountPoint}`}><div><strong>{disk.mountPoint || disk.name}</strong><span>{formatBytes(disk.totalBytes - disk.availableBytes)} / {formatBytes(disk.totalBytes)}</span></div><div className="thin-bar"><i style={{ width: `${used}%` }} /></div><b>{used.toFixed(0)}%</b></div>; }) : <EmptyState text="No storage telemetry received." />}</div></section>
        </div>
        <div className="operations-grid">
          <section className="module process-module"><ModuleHeader code="ACTIVITY / 05" title="Process Flow" meta={<span>{snapshot?.processCount ?? 0} ACTIVE</span>} /><div className="process-list"><div className="list-head"><span>PROCESS</span><span>CPU</span><span>MEMORY</span><span>PID</span></div>{snapshot?.topProcesses.length ? snapshot.topProcesses.map((process) => <div className="process-row" key={process.pid}><span><i />{process.name}</span><strong>{process.cpuPercent.toFixed(1)}%</strong><strong>{formatBytes(process.memoryBytes)}</strong><code>{process.pid}</code></div>) : <EmptyState text="Native process stream is waiting for the desktop runtime." />}</div></section>
          <section className="module events-module"><ModuleHeader code="WINDOWS / 06" title="System Events" meta={<span>LIVE EVENT LOG</span>} /><div className="event-filters" role="tablist" aria-label="Event category">{EVENT_FILTERS.map((filter) => <button key={filter.id} className={`${filter.id} ${eventFilter === filter.id ? 'active' : ''}`} onClick={() => { setEventFilter(filter.id); setEventTooltip(null); }} role="tab" aria-selected={eventFilter === filter.id}><span>{filter.label}</span><strong>{events.filter((event) => event.kind === filter.id).length}</strong></button>)}</div><div className="event-list" onScroll={() => setEventTooltip(null)}>{filteredEvents.length ? filteredEvents.map((record) => <article className={`event-row ${record.kind}`} key={record.id} tabIndex={0} onMouseEnter={(event) => showEventTooltip(event.currentTarget, record)} onMouseLeave={() => setEventTooltip(null)} onFocus={(event) => showEventTooltip(event.currentTarget, record)} onBlur={() => setEventTooltip(null)}><i /><div><strong>{record.source}</strong><p>{record.message}</p></div><time>{new Date(record.timestamp).toLocaleString()}</time></article>) : <div className="event-empty"><span>NO RECENT RECORDS</span><strong>{EVENT_FILTERS.find((filter) => filter.id === eventFilter)?.label} channel is clear</strong><p>Windows Event Log is active. New matching records will appear automatically.</p></div>}</div></section>
        </div>
      </section>
    </main>
    <footer><span>HORUS NATIVE TELEMETRY BUS</span><div className="footer-status"><button className={`update-trigger ${updatePhase === 'available' ? 'has-update' : ''}`} onClick={() => void handleUpdate()} disabled={updatePhase === 'checking' || updatePhase === 'downloading' || updatePhase === 'installing'}>{updateLabel}</button><span>{snapshot ? `LAST SAMPLE ${new Date(snapshot.timestampMs).toLocaleTimeString()}` : 'NO NATIVE SAMPLE'}</span></div></footer>
    {eventTooltip && <aside className={`event-tooltip ${eventTooltip.above ? 'above' : ''}`} style={{ top: eventTooltip.top, left: eventTooltip.left, width: eventTooltip.width }} role="tooltip"><div><span>{eventTooltip.record.kind.toUpperCase()}</span><time>{new Date(eventTooltip.record.timestamp).toLocaleString()}</time></div><strong>{eventTooltip.record.source}</strong><p>{eventTooltip.record.message}</p></aside>}
    {settingsOpen && <button className="settings-backdrop" aria-label="Close settings" onClick={() => setSettingsOpen(false)} />}
    <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} theme={theme} setTheme={setTheme} decorations={decorations} setDecorations={setDecorations} autostart={autostart} autostartBusy={autostartBusy} onAutostartChange={(enabled) => void handleAutostartChange(enabled)} />
  </div>;
}

export default App;
