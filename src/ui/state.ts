// The single store: state, undo/redo, autosave to localStorage.
import { defaultSettings } from '../core/defaults';
import type { Assignments, ColumnMapping, ExtractedJobs, LatLon, Plan, Settings, Table } from '../types';

export type TabId = 'load' | 'setup' | 'plan' | 'export' | 'about';

export interface Notice {
  kind: 'info' | 'warn' | 'error';
  text: string;
}

export interface PickMode {
  label: string;
  onPick: (p: LatLon) => void;
}

export interface AppState {
  table: Table | null;
  mapping: ColumnMapping | null;
  extracted: ExtractedJobs | null;
  fileName: string;
  settings: Settings;
  assignments: Assignments;
  dayOrder: Record<number, number[]>;
  plan: Plan | null;
  /** Settings or data changed since the plan was built. */
  planStale: boolean;
  tab: TabId;
  highlightRow: number | null;
  selection: number[];
  pickMode: PickMode | null;
  busy: { message: string; done: number; total: number } | null;
  baseStatus: 'idle' | 'looking' | 'done';
  notice: Notice | null;
  undoCount: number;
  redoCount: number;
}

export function initialState(): AppState {
  return {
    table: null,
    mapping: null,
    extracted: null,
    fileName: '',
    settings: defaultSettings(),
    assignments: {},
    dayOrder: {},
    plan: null,
    planStale: false,
    tab: 'load',
    highlightRow: null,
    selection: [],
    pickMode: null,
    busy: null,
    baseStatus: 'idle',
    notice: null,
    undoCount: 0,
    redoCount: 0,
  };
}

let state: AppState = initialState();
type Listener = (s: AppState, prev: AppState) => void;
const listeners = new Set<Listener>();

export const getState = (): AppState => state;

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Keys whose change should trigger an autosave. */
const PERSISTED: (keyof AppState)[] = ['table', 'mapping', 'fileName', 'settings', 'assignments', 'dayOrder', 'plan', 'planStale'];

export function setState(patch: Partial<AppState>): void {
  const prev = state;
  state = { ...state, ...patch };
  for (const l of [...listeners]) l(state, prev);
  if (PERSISTED.some((k) => k in patch && patch[k] !== prev[k])) scheduleSave();
}

// ---------- undo / redo of manual changes ----------

export interface Snapshot {
  assignments: Assignments;
  dayOrder: Record<number, number[]>;
  plan: Plan | null;
  planStale: boolean;
}

const MAX_HISTORY = 100;
let undoStack: Snapshot[] = [];
let redoStack: Snapshot[] = [];

const snap = (): Snapshot => ({
  assignments: state.assignments,
  dayOrder: state.dayOrder,
  plan: state.plan,
  planStale: state.planStale,
});

function syncCounts(): void {
  setState({ undoCount: undoStack.length, redoCount: redoStack.length });
}

/** Call before a manual change. Returns a function that drops the entry again (if the change failed). */
export function pushUndo(): () => Snapshot {
  const s = snap();
  undoStack.push(s);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
  syncCounts();
  return () => {
    const i = undoStack.lastIndexOf(s);
    if (i >= 0) undoStack.splice(i, 1);
    syncCounts();
    return s;
  };
}

export function clearHistory(): void {
  undoStack = [];
  redoStack = [];
  syncCounts();
}

export function undo(): void {
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push(snap());
  setState({ ...s, selection: [] });
  syncCounts();
}

export function redo(): void {
  const s = redoStack.pop();
  if (!s) return;
  undoStack.push(snap());
  setState({ ...s, selection: [] });
  syncCounts();
}

export function notify(text: string, kind: Notice['kind'] = 'info'): void {
  setState({ notice: { kind, text } });
}

// ---------- autosave ----------

export const STORAGE_PREFIX = 'jr-';
const SAVE_KEY = 'jr-state';

export interface SavedState {
  v: 1;
  table: Table | null;
  mapping: ColumnMapping | null;
  fileName: string;
  settings: Settings;
  assignments: Assignments;
  dayOrder: Record<number, number[]>;
  plan: Plan | null;
  planStale: boolean;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveWarned = false;

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}

export function saveNow(): void {
  saveTimer = null;
  try {
    const s = state;
    const data: SavedState = {
      v: 1,
      table: s.table,
      mapping: s.mapping,
      fileName: s.fileName,
      settings: s.settings,
      assignments: s.assignments,
      dayOrder: s.dayOrder,
      plan: s.plan,
      planStale: s.planStale,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    if (!saveWarned) {
      saveWarned = true;
      notify('Autosave failed (browser storage is full or blocked). Save a plan file to keep your work.', 'warn');
    }
  }
}

export function loadSaved(): SavedState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SavedState;
    if (!d || d.v !== 1 || !d.settings || !Array.isArray(d.settings.workers) || d.settings.workers.length < 1) return null;
    return d;
  } catch {
    return null;
  }
}

/** Remove every localStorage key that starts with the app prefix. */
export function clearStoredKeys(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
}

export function resetAll(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  clearStoredKeys();
  undoStack = [];
  redoStack = [];
  const fresh = initialState();
  setState({ ...fresh, tab: 'load' });
  // setState scheduled a save of the empty state; drop it so nothing is written.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  clearStoredKeys();
}

/** localStorage-backed KV for the base-town cache (keys live under the 'jr-' prefix). */
export const baseCacheKV = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`${STORAGE_PREFIX}base-${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(`${STORAGE_PREFIX}base-${key}`, value);
    } catch {
      /* ignore */
    }
  },
};
