import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getSystemSnapshot, isTauriRuntime } from './telemetry';
import type { CardId, CardSize, SystemSnapshot, ThemeSettings } from './types';

const CARD_ORDER_KEY = 'horus-card-order-v1';
const CARD_VISIBILITY_KEY = 'horus-card-visibility-v1';
const CARD_SIZE_KEY = 'horus-card-sizes-v1';
const THEME_KEY = 'horus-theme-v1';
const FRAME_KEY = 'horus-window-frame-v1';

const DEFAULT_ORDER: CardId[] = ['pulse', 'cpu', 'memory', 'processes', 'disks', 'network', 'events'];
const CARD_NAMES: Record<CardId, string> = {
  pulse: 'System Pulse',
  cpu: 'CPU Matrix',
  memory: 'Memory Field',
  processes: 'Process Flow',
  disks: 'Storage Array',
  network: 'Network Stream',
  events: 'System Events',
};
const DEFAULT_SIZES: Record<CardId, CardSize> = {
  pulse: 'wide',
  cpu: 'standard',
  memory: 'standard',
  processes: 'wide',
  disks: 'standard',
  network: 'standard',
  events: 'wide',
};
const DEFAULT_THEME: ThemeSettings = {
  background: '#060b14',
  card: '#0b1422',
  heading: '#e8f6ff',
  info: '#7f9bad',
  accent: '#23d5e8',
  chart: '#5be7ff',
  warning: '#ffb84d',
  critical: '#ff4d6d',
  cardOpacity: 88,
  glow: 42,
  radius: 18,
  gap: 14,
};
const SIZE_SEQUENCE: CardSize[] = ['compact', 'standard', 'wide', 'tall'];
const RESIZE_HANDLES = [
  ['North', 'resize-edge resize-n'],
  ['South', 'resize-edge resize-s'],
  ['West', 'resize-edge resize-w'],
  ['East', 'resize-edge resize-e'],
  ['NorthWest', 'resize-edge resize-nw'],
  ['NorthEast', 'resize-edge resize-ne'],
  ['SouthWest', 'resize-edge resize-sw'],
  ['SouthEast', 'resize-edge resize-se'],
] as const;

function loadJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? { ...fallback, ...JSON.parse(value) } : fallback;
  } catch {
    return fallback;
  }
}

function loadOrder(): CardId[] {
  try {
    const value = JSON.parse(localStorage.getItem(CARD_ORDER_KEY) ?? 'null') as unknown;
    if (!Array.isArray(value)) return DEFAULT_ORDER;
    const valid = value.filter((item): item is CardId => typeof item === 'string' && item in CARD_NAMES);
    return [...new Set([...valid, ...DEFAULT_ORDER])];
  } catch {
    return DEFAULT_ORDER;
  }
}

function formatBytes(value: number, decimals = 1): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(decimals)} ${units[index]}`;
}

function formatUptime(seconds = 0): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
}

function percent(part = 0, total = 0): number {
  return total > 0 ? Math.min(100, Math.max(0, (part / total) * 100)) : 0;
}

function Sparkline({ values, color = 'var(--chart)' }: { values: number[]; color?: string }) {
  const points = values.length > 1 ? values : [0, 0];
  const coordinates = points.map((value, index) => {
    const x = (index / Math.max(1, points.length - 1)) * 100;
    const y = 46 - Math.min(100, Math.max(0, value)) * 0.4;
    return `${x},${y}`;
  }).join(' ');
  const area = `0,50 ${coordinates} 100,50`;
  return (
    <svg className="sparkline" viewBox="0 0 100 50" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`fade-${color.replace(/\W/g, '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.32" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#fade-${color.replace(/\W/g, '')})`} />
      <polyline points={coordinates} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

interface CardShellProps {
  id: CardId;
  size: CardSize;
  onResize: () => void;
  onHide: () => void;
  children: ReactNode;
}

function CardShell({ id, size, onResize, onHide, children }: CardShellProps) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <article
      ref={setNodeRef}
      className={`monitor-card card-${size} ${isDragging ? 'is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="card-scan" />
      <header className="card-header">
        <div>
          <span className="eyebrow">MODULE / {id.toUpperCase()}</span>
          <h2>{CARD_NAMES[id]}</h2>
        </div>
        <div className="card-tools">
          <button className="icon-button" onClick={onResize} title="Change module size" aria-label="Change module size">↗</button>
          <button className="icon-button" onClick={onHide} title="Hide module" aria-label="Hide module">−</button>
          <button
            ref={setActivatorNodeRef}
            className="icon-button drag-handle"
            title="Move module"
            aria-label={`Move ${CARD_NAMES[id]}`}
            {...attributes}
            {...listeners}
          >
            ⠿
          </button>
        </div>
      </header>
      <div className="card-content">{children}</div>
    </article>
  );
}

function Gauge({ value, label }: { value: number; label: string }) {
  const safeValue = Math.min(100, Math.max(0, value));
  return (
    <div className="gauge" style={{ '--gauge-value': `${safeValue * 3.6}deg` } as CSSProperties}>
      <div className="gauge-core"><strong>{safeValue.toFixed(0)}</strong><span>{label}</span></div>
    </div>
  );
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  theme: ThemeSettings;
  setTheme: (value: ThemeSettings) => void;
  visibility: Record<CardId, boolean>;
  setVisibility: (value: Record<CardId, boolean>) => void;
  decorations: boolean;
  setDecorations: (value: boolean) => void;
  onResetLayout: () => void;
}

function SettingsPanel(props: SettingsPanelProps) {
  const update = <K extends keyof ThemeSettings>(key: K, value: ThemeSettings[K]) => {
    props.setTheme({ ...props.theme, [key]: value });
  };
  const colors: Array<[keyof ThemeSettings, string]> = [
    ['background', 'Background'], ['card', 'Cards'], ['heading', 'Headings'], ['info', 'Info text'],
    ['accent', 'Accent'], ['chart', 'Charts'], ['warning', 'Warnings'], ['critical', 'Critical'],
  ];
  return (
    <aside className={`settings-panel ${props.open ? 'is-open' : ''}`} aria-hidden={!props.open}>
      <div className="settings-title"><div><span className="eyebrow">CONTROL / APPEARANCE</span><h2>Interface Matrix</h2></div><button className="icon-button" onClick={props.onClose}>×</button></div>
      <section>
        <h3>Color channels</h3>
        <div className="color-grid">
          {colors.map(([key, label]) => <label key={key}><span>{label}</span><input type="color" value={String(props.theme[key])} onChange={(event) => update(key, event.target.value as never)} /></label>)}
        </div>
      </section>
      <section className="range-stack">
        <h3>Surface geometry</h3>
        <label><span>Card opacity <output>{props.theme.cardOpacity}%</output></span><input type="range" min="35" max="100" value={props.theme.cardOpacity} onChange={(e) => update('cardOpacity', Number(e.target.value))} /></label>
        <label><span>Glow intensity <output>{props.theme.glow}%</output></span><input type="range" min="0" max="100" value={props.theme.glow} onChange={(e) => update('glow', Number(e.target.value))} /></label>
        <label><span>Corner radius <output>{props.theme.radius}px</output></span><input type="range" min="0" max="32" value={props.theme.radius} onChange={(e) => update('radius', Number(e.target.value))} /></label>
        <label><span>Grid gap <output>{props.theme.gap}px</output></span><input type="range" min="6" max="28" value={props.theme.gap} onChange={(e) => update('gap', Number(e.target.value))} /></label>
      </section>
      <section>
        <h3>Active modules</h3>
        <div className="module-toggles">
          {DEFAULT_ORDER.map((id) => <label key={id}><span>{CARD_NAMES[id]}</span><input type="checkbox" checked={props.visibility[id]} onChange={(e) => props.setVisibility({ ...props.visibility, [id]: e.target.checked })} /></label>)}
        </div>
      </section>
      <section className="module-toggles">
        <h3>Window</h3>
        <label><span>Windows frame</span><input type="checkbox" checked={props.decorations} onChange={(e) => props.setDecorations(e.target.checked)} /></label>
      </section>
      <div className="settings-actions">
        <button onClick={() => props.setTheme(DEFAULT_THEME)}>Reset theme</button>
        <button onClick={props.onResetLayout}>Reset layout</button>
      </div>
    </aside>
  );
}

function App() {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [order, setOrder] = useState<CardId[]>(loadOrder);
  const [visibility, setVisibility] = useState<Record<CardId, boolean>>(() => loadJson(CARD_VISIBILITY_KEY, Object.fromEntries(DEFAULT_ORDER.map((id) => [id, true])) as Record<CardId, boolean>));
  const [sizes, setSizes] = useState<Record<CardId, CardSize>>(() => loadJson(CARD_SIZE_KEY, DEFAULT_SIZES));
  const [theme, setTheme] = useState<ThemeSettings>(() => loadJson(THEME_KEY, DEFAULT_THEME));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [decorations, setDecorations] = useState(() => localStorage.getItem(FRAME_KEY) !== 'false');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    const root = document.documentElement;
    const hexToRgb = (hex: string) => {
      const normalized = hex.replace('#', '');
      return `${parseInt(normalized.slice(0, 2), 16)}, ${parseInt(normalized.slice(2, 4), 16)}, ${parseInt(normalized.slice(4, 6), 16)}`;
    };
    root.style.setProperty('--background', theme.background);
    root.style.setProperty('--card-rgb', hexToRgb(theme.card));
    root.style.setProperty('--card-opacity', String(theme.cardOpacity / 100));
    root.style.setProperty('--heading', theme.heading);
    root.style.setProperty('--info', theme.info);
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--chart', theme.chart);
    root.style.setProperty('--warning', theme.warning);
    root.style.setProperty('--critical', theme.critical);
    root.style.setProperty('--glow-alpha', String(theme.glow / 100));
    root.style.setProperty('--radius', `${theme.radius}px`);
    root.style.setProperty('--grid-gap', `${theme.gap}px`);
    localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(CARD_VISIBILITY_KEY, JSON.stringify(visibility));
  }, [visibility]);

  useEffect(() => {
    localStorage.setItem(CARD_SIZE_KEY, JSON.stringify(sizes));
  }, [sizes]);

  useEffect(() => {
    localStorage.setItem(FRAME_KEY, String(decorations));
    if (isTauriRuntime()) void getCurrentWindow().setDecorations(decorations);
  }, [decorations]);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const next = await getSystemSnapshot();
        if (disposed) return;
        setSnapshot(next);
        setTelemetryError(next ? null : 'Browser preview — native telemetry waits for the desktop runtime');
        if (next) setHistory((current) => [...current.slice(-59), next.cpuPercent]);
      } catch (error) {
        if (!disposed) setTelemetryError(error instanceof Error ? error.message : String(error));
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 1_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  const visibleOrder = useMemo(() => order.filter((id) => visibility[id]), [order, visibility]);
  const memoryPercent = percent(snapshot?.usedMemoryBytes, snapshot?.totalMemoryBytes);
  const diskTotal = snapshot?.disks.reduce((sum, disk) => sum + disk.totalBytes, 0) ?? 0;
  const diskUsed = snapshot?.disks.reduce((sum, disk) => sum + disk.totalBytes - disk.availableBytes, 0) ?? 0;

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setOrder((current) => {
      const next = arrayMove(current, current.indexOf(active.id as CardId), current.indexOf(over.id as CardId));
      localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(next));
      return next;
    });
  };
  const resize = (id: CardId) => setSizes((current) => {
    const index = SIZE_SEQUENCE.indexOf(current[id]);
    return { ...current, [id]: SIZE_SEQUENCE[(index + 1) % SIZE_SEQUENCE.length] };
  });
  const resetLayout = () => { setOrder(DEFAULT_ORDER); setSizes(DEFAULT_SIZES); setVisibility(Object.fromEntries(DEFAULT_ORDER.map((id) => [id, true])) as Record<CardId, boolean>); };

  const renderCard = (id: CardId) => {
    if (id === 'pulse') return <div className="pulse-grid">
      <div className="status-orb"><span /><strong>{snapshot ? 'NOMINAL' : 'STANDBY'}</strong><small>system state</small></div>
      <div className="pulse-stat"><span>HOST</span><strong>{snapshot?.hostName ?? '—'}</strong><small>{snapshot?.operatingSystem ?? telemetryError ?? 'Awaiting native runtime'}</small></div>
      <div className="pulse-stat"><span>UPTIME</span><strong>{snapshot ? formatUptime(snapshot.uptimeSeconds) : '—'}</strong><small>{snapshot?.processCount ?? 0} active processes</small></div>
      <div className="pulse-stat"><span>LOAD</span><strong>{snapshot ? `${snapshot.cpuPercent.toFixed(0)}%` : '—'}</strong><small>{snapshot?.logicalCpuCount ?? 0} logical processors</small></div>
    </div>;
    if (id === 'cpu') return <div className="metric-layout"><Gauge value={snapshot?.cpuPercent ?? 0} label="CPU %" /><div className="metric-copy"><strong>{snapshot ? `${snapshot.cpuPercent.toFixed(1)}%` : '—'}</strong><span>aggregate utilization</span><div className="core-grid">{(snapshot?.perCpuPercent ?? []).slice(0, 16).map((value, index) => <i key={index} title={`CPU ${index + 1}: ${value.toFixed(0)}%`} style={{ '--core-load': `${value}%` } as CSSProperties} />)}</div></div><Sparkline values={history} /></div>;
    if (id === 'memory') return <div className="memory-stack"><div className="hero-value"><strong>{snapshot ? `${memoryPercent.toFixed(0)}%` : '—'}</strong><span>memory pressure</span></div><div className="segmented-bar"><i style={{ width: `${memoryPercent}%` }} /></div><div className="data-pairs"><span>Used<strong>{snapshot ? formatBytes(snapshot.usedMemoryBytes) : '—'}</strong></span><span>Available<strong>{snapshot ? formatBytes(snapshot.totalMemoryBytes - snapshot.usedMemoryBytes) : '—'}</strong></span><span>Total<strong>{snapshot ? formatBytes(snapshot.totalMemoryBytes) : '—'}</strong></span><span>Swap<strong>{snapshot ? formatBytes(snapshot.usedSwapBytes) : '—'}</strong></span></div></div>;
    if (id === 'processes') return <div className="process-list"><div className="list-head"><span>PROCESS</span><span>CPU</span><span>MEMORY</span><span>PID</span></div>{snapshot?.topProcesses.length ? snapshot.topProcesses.map((process) => <div className="process-row" key={process.pid}><span><i />{process.name}</span><strong>{process.cpuPercent.toFixed(1)}%</strong><strong>{formatBytes(process.memoryBytes)}</strong><code>{process.pid}</code></div>) : <EmptyState text="Native process stream is waiting for the desktop runtime." />}</div>;
    if (id === 'disks') return <div className="disk-stack">{snapshot?.disks.length ? snapshot.disks.map((disk) => { const used = percent(disk.totalBytes - disk.availableBytes, disk.totalBytes); return <div className="disk-row" key={`${disk.name}-${disk.mountPoint}`}><div><strong>{disk.mountPoint || disk.name}</strong><span>{formatBytes(disk.totalBytes - disk.availableBytes)} / {formatBytes(disk.totalBytes)}</span></div><div className="thin-bar"><i style={{ width: `${used}%` }} /></div><b>{used.toFixed(0)}%</b></div>; }) : <EmptyState text="No storage telemetry received." />}<div className="total-line"><span>ARRAY UTILIZATION</span><strong>{diskTotal ? `${percent(diskUsed, diskTotal).toFixed(0)}%` : '—'}</strong></div></div>;
    if (id === 'network') return <div className="network-grid"><div><span className="direction down">↓</span><strong>{snapshot ? formatBytes(snapshot.receivedBytes) : '—'}</strong><small>received / interval</small></div><div><span className="direction up">↑</span><strong>{snapshot ? formatBytes(snapshot.transmittedBytes) : '—'}</strong><small>sent / interval</small></div><div className="network-field"><span /><span /><span /><i /></div></div>;
    return <div className="event-ready"><div className="event-radar"><i /><i /><i /><span /></div><div><span className="eyebrow">WINDOWS EVENT LOG</span><h3>Native event channel prepared</h3><p>Critical, error and selected warning records will appear here. Synthetic events are never shown.</p><div className="event-chips"><span>Critical</span><span>Error</span><span>Warning</span><span>Application</span></div></div></div>;
  };

  return (
    <div className={`app-shell ${decorations ? '' : 'frameless'}`}>
      {!decorations && <>{RESIZE_HANDLES.map(([direction, className]) => <div key={direction} className={className} onMouseDown={(e) => { if (e.button === 0 && isTauriRuntime()) void getCurrentWindow().startResizeDragging(direction); }} />)}<div className="window-chrome"><div className="window-brand">H</div><button className="drag-zone" onMouseDown={(e) => { if (e.button === 0 && isTauriRuntime()) void getCurrentWindow().startDragging(); }}>HORUS // COMMAND DECK</button><button onClick={() => isTauriRuntime() && void getCurrentWindow().minimize()}>—</button><button onClick={() => isTauriRuntime() && void getCurrentWindow().toggleMaximize()}>□</button><button className="close-window" onClick={() => isTauriRuntime() && void getCurrentWindow().hide()}>×</button></div></>}
      <div className="ambient-grid" />
      <header className="topbar">
        <div className="brand-block"><div className="brand-mark"><span>H</span></div><div><span className="eyebrow">REAL-TIME SYSTEM OBSERVATORY</span><h1>HORUS <em>COMMAND DECK</em></h1></div></div>
        <div className="topbar-status"><div><span className={`live-dot ${snapshot ? 'online' : ''}`} />{snapshot ? 'TELEMETRY ONLINE' : 'TELEMETRY STANDBY'}</div><time>{new Date(snapshot?.timestampMs ?? Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><button className="settings-trigger" onClick={() => setSettingsOpen(true)}>CONTROL MATRIX</button></div>
      </header>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visibleOrder} strategy={rectSortingStrategy}>
          <main className="dashboard-grid">
            {visibleOrder.map((id) => <CardShell key={id} id={id} size={sizes[id]} onResize={() => resize(id)} onHide={() => setVisibility((current) => ({ ...current, [id]: false }))}>{renderCard(id)}</CardShell>)}
          </main>
        </SortableContext>
      </DndContext>
      <footer><span>HORUS CORE v0.2</span><span>{telemetryError ?? 'All telemetry channels responding'}</span><span>{visibleOrder.length}/{DEFAULT_ORDER.length} MODULES ACTIVE</span></footer>
      {settingsOpen && <button className="settings-backdrop" aria-label="Close settings" onClick={() => setSettingsOpen(false)} />}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} theme={theme} setTheme={setTheme} visibility={visibility} setVisibility={setVisibility} decorations={decorations} setDecorations={setDecorations} onResetLayout={resetLayout} />
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><span>◇</span><p>{text}</p></div>;
}

export default App;
