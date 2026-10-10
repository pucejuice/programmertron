// All state-changing operations. UI modules call these; they call core/io/net.
import { centroid, haversineKm } from '../core/geo';
import { defaultWorker } from '../core/defaults';
import { CancelledError } from '../core/plan';
import { assignmentsFromWorkerColumn, extractJobs } from '../io/jobs';
import { detectManualSeq, detectLatLon } from '../io/columns';
import { listXlsxSheets, parseCsv, parseXlsx } from '../io/parse';
import { parsePlanFile, serializePlanFile } from '../io/planfile';
import { lookupBaseTown } from '../net/base';
import { PARITY_40_CSV } from '../sample';
import type { Assignments, Base, BaseSource, ColumnMapping, LatLon, Plan, PlanInput, Settings, Table } from '../types';
import { startRoute, RouteCancelled, type RouteRun } from '../worker/client';
import { chooseLatLon, chooseSheet } from './dialogs';
import { downloadBlob } from './dom';
import { indexPlan, jobMap, routesOfWorker } from './planutil';
import {
  baseCacheKV, clearHistory, getState, loadSaved, notify, pushUndo, resetAll, setState, undo as undoState, redo as redoState,
  type AppState, type PickMode,
} from './state';

export const fetchFn: typeof fetch = fetch.bind(globalThis);

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------- loading ----------

export async function loadFile(file: File): Promise<void> {
  const name = file.name;
  const lower = name.toLowerCase();
  try {
    if (lower.endsWith('.json')) {
      await applyPlanFile(await file.text());
    } else if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
      await ingest(parseCsv(await file.text(), name), name);
    } else if (lower.endsWith('.xlsx')) {
      const buf = await file.arrayBuffer();
      const sheets = listXlsxSheets(buf);
      if (sheets.length === 0) throw new Error('That workbook has no sheets.');
      let sheet = sheets[0];
      if (sheets.length > 1) {
        const chosen = await chooseSheet(sheets);
        if (chosen === null) return;
        sheet = chosen;
      }
      await ingest(parseXlsx(buf, sheet), name);
    } else {
      notify('Please load a .csv or .xlsx file (or a saved .json plan).', 'warn');
    }
  } catch (e) {
    notify(`Could not read ${name}: ${errText(e)}`, 'error');
  }
}

export async function loadSample(): Promise<void> {
  try {
    await ingest(parseCsv(PARITY_40_CSV, 'sample-40-jobs.csv'), 'sample-40-jobs.csv');
  } catch (e) {
    notify(`Could not load the sample: ${errText(e)}`, 'error');
  }
}

async function ingest(table: Table, fileName: string): Promise<void> {
  if (table.headers.length === 0 || table.rows.length === 0) {
    notify('That file has no data rows.', 'warn');
    return;
  }
  const det = detectLatLon(table.headers);
  let lat = det.lat;
  let lon = det.lon;
  if (lat === null || lon === null) {
    const picked = await chooseLatLon(table.headers, det);
    if (!picked) return;
    lat = picked.lat;
    lon = picked.lon;
  }
  const mapping: ColumnMapping = { lat, lon, label: 0, worker: null, manualSeq: detectManualSeq(table.headers) };
  const extracted = extractJobs(table, mapping);
  const s = getState();
  clearHistory();
  setState({
    table,
    mapping,
    extracted,
    fileName,
    assignments: {},
    dayOrder: {},
    pins: {},
    plan: null,
    planStale: false,
    selection: [],
    highlightRow: null,
    settings: {
      ...s.settings,
      base: null,
      startOverride: null,
      endPoint: null,
      endMode: s.settings.endMode === 'point' ? 'base' : s.settings.endMode,
      workers: s.settings.workers.map((w) => ({ ...w, base: null })),
    },
    tab: 'load',
    notice: null,
  });
  void lookupBase();
}

export function setLabelColumn(label: number): void {
  const s = getState();
  if (!s.table || !s.mapping) return;
  const mapping = { ...s.mapping, label };
  setState({ mapping, extracted: extractJobs(s.table, mapping) });
}

/** Accept the offer to use a worker column as the initial assignment. */
export function useWorkerColumn(column: number): void {
  const s = getState();
  if (!s.table || !s.mapping || !s.extracted) return;
  const res = assignmentsFromWorkerColumn(s.table, s.extracted, column);
  if (res.names.length === 0) {
    notify('That column has no values to use.', 'warn');
    return;
  }
  if (res.names.length > 10) {
    notify(`That column has ${res.names.length} different names; the app supports at most 10 workers.`, 'warn');
    return;
  }
  pushUndo();
  const workers = res.names.map((n, i) => ({ ...(s.settings.workers[i] ?? defaultWorker(i)), name: n }));
  const assignments: Assignments = {};
  for (const [k, a] of Object.entries(res.assignments)) assignments[Number(k)] = { ...a, lockedWorker: true };
  setState({
    mapping: { ...s.mapping, worker: column },
    assignments,
    dayOrder: {},
    pins: {},
    plan: null,
    planStale: false,
    settings: { ...s.settings, workers, simpleMode: false },
    notice: { kind: 'info', text: `Using "${s.table.headers[column]}" for the initial worker assignment. Press Route.` },
  });
}

// ---------- settings ----------

export function updateSettings(patch: Partial<Settings>, affectsPlan = true): void {
  const s = getState();
  setState({ settings: { ...s.settings, ...patch }, planStale: s.planStale || (affectsPlan && s.plan !== null) });
}

export function setWorkerCount(n: number): void {
  const s = getState();
  const count = Math.max(1, Math.min(10, Math.round(n)));
  const cur = s.settings.workers;
  if (count === cur.length) return;
  const workers = count > cur.length ? [...cur, ...Array.from({ length: count - cur.length }, (_, i) => defaultWorker(cur.length + i))] : cur.slice(0, count);
  if (count > cur.length) {
    updateSettings({ workers });
    return;
  }
  const assignments: Assignments = {};
  for (const [k, a] of Object.entries(s.assignments)) if (a.worker < count && a.lockedWorker) assignments[Number(k)] = a;
  setState({ settings: { ...s.settings, workers }, assignments, plan: null, planStale: false, dayOrder: {}, pins: {}, selection: [] });
  clearHistory();
}

export function updateWorker(i: number, patch: Partial<Settings['workers'][number]>, affectsPlan = true): void {
  const s = getState();
  const workers = s.settings.workers.map((w, k) => (k === i ? { ...w, ...patch } : w));
  // Names and colours are display only: the plan itself does not change.
  updateSettings({ workers }, affectsPlan);
}

// ---------- base ----------

let lookupToken = 0;
let lookupPromise: Promise<void> = Promise.resolve();

export function makeBase(p: LatLon, name: string, source: BaseSource): Base {
  const jobs = getState().extracted?.jobs ?? [];
  const base: Base = { lat: p.lat, lon: p.lon, name, source };
  if (jobs.length) {
    try {
      base.distFromCentroidKm = haversineKm(centroid(jobs), p);
    } catch {
      /* display only */
    }
  }
  return base;
}

/** Town lookup: sends only the centroid of the loaded jobs. Cached. Runs once per dataset. */
export function lookupBase(): Promise<void> {
  const jobs = getState().extracted?.jobs ?? [];
  if (jobs.length === 0) return Promise.resolve();
  const token = ++lookupToken;
  setState({ baseStatus: 'looking' });
  const c = centroid(jobs);
  const apply = (b: Base) => {
    if (token !== lookupToken) return;
    const s = getState();
    const cur = s.settings.base;
    if (cur && cur.source !== 'town' && cur.source !== 'centroid') {
      setState({ baseStatus: 'done' });
      return;
    }
    setState({ baseStatus: 'done', settings: { ...s.settings, base: b }, planStale: s.planStale || s.plan !== null });
  };
  lookupPromise = lookupBaseTown(c, fetchFn, baseCacheKV)
    .then(apply)
    .catch((e) => apply({ ...c, name: 'Centroid of the jobs', source: 'centroid', note: `Town lookup failed (${errText(e)}); using the centroid as the base.` }));
  return lookupPromise;
}

export function setBase(base: Base | null): void {
  updateSettings({ base });
}

export function setPickMode(p: PickMode | null): void {
  setState({ pickMode: p });
}

// ---------- routing ----------

let current: RouteRun | null = null;

export function cancelRoute(): void {
  current?.cancel();
}

export function validateSettings(s: AppState): string | null {
  const set = s.settings;
  if (set.simpleMode) return null;
  if (set.dayMode === 'count' && set.jobsPerDay !== null && (!Number.isInteger(set.jobsPerDay) || set.jobsPerDay < 1)) {
    return 'Jobs per day must be a whole number, 1 or more (or blank for no split).';
  }
  if (set.dayMode === 'hours') {
    const { hoursPerDay: h, minutesPerJob: m, speedKmh: v } = set;
    if (h === null || !(h > 0)) return 'Hours mode: enter the hours per day (more than 0).';
    if (m === null || !(m >= 0)) return 'Hours mode: enter the minutes per job (0 or more).';
    if (v === null || !(v > 0)) return 'Hours mode: enter the average speed in km/h (more than 0).';
  }
  if (set.endMode === 'point' && !set.endPoint) return 'End point: enter or pick a location, or choose another end option.';
  const caps = set.workers.map((w) => w.capacity);
  if (caps.every((c) => c !== null)) {
    const total = caps.reduce<number>((a, c) => a + (c as number), 0);
    const n = s.extracted?.jobs.length ?? 0;
    if (total < n) return `The worker capacities add up to ${total}, but there are ${n} jobs to route.`;
  }
  return null;
}

/**
 * The core applies dayOrder on top of a fresh split, so locked day numbers (which the user
 * sees in the permuted numbering) are translated back to the fresh numbering first.
 */
function toFreshDays(a: Assignments, dayOrder: Record<number, number[]>, all = false): Assignments {
  if (Object.keys(dayOrder).length === 0) return a;
  const out: Assignments = {};
  for (const [k, v] of Object.entries(a)) {
    const order = dayOrder[v.worker];
    out[Number(k)] = (all || v.lockedDay) && v.day !== null && order?.[v.day - 1] !== undefined ? { ...v, day: order[v.day - 1] } : v;
  }
  return out;
}

/**
 * Re-route. only === null: full re-run (including automatic worker grouping).
 * keepDays: after a manual change, keep every job's current day so only the moved jobs move.
 */
export async function runRoute(only: number[] | null, keepDays = false): Promise<boolean> {
  const s = getState();
  if (s.busy) return false;
  if (!s.extracted || s.extracted.jobs.length === 0) {
    notify('There are no jobs with a valid location to route.', 'warn');
    return false;
  }
  const bad = validateSettings(s);
  if (bad) {
    setState({ tab: 'setup' });
    notify(bad, 'error');
    return false;
  }
  setState({ busy: { message: 'Preparing...', done: 0, total: 1 }, notice: null });
  // The base lookup is quick and cached; give it a moment so the plan uses the town.
  if (s.baseStatus === 'looking') {
    setState({ busy: { message: 'Looking up the nearest town...', done: 0, total: 1 } });
    await Promise.race([lookupPromise, wait(6000)]);
  }
  const st = getState();
  const full = only === null;
  const locked: Assignments = {};
  for (const [k, a] of Object.entries(st.assignments)) if (a.lockedWorker || a.lockedDay) locked[Number(k)] = a;
  // Stops ordered by hand keep that order (as MANUAL_SEQ anchors); other jobs are routed around them.
  const pins = st.pins;
  const jobs = Object.keys(pins).length ? st.extracted!.jobs.map((j) => (pins[j.row] !== undefined ? { ...j, manualSeq: pins[j.row] } : j)) : st.extracted!.jobs;
  const input: PlanInput = {
    jobs,
    notRouted: st.extracted!.notRouted,
    settings: st.settings,
    assignments: full ? locked : toFreshDays(st.assignments, st.dayOrder, keepDays),
    onlyWorkers: full ? null : only,
    previous: full ? null : st.plan,
    dayOrder: full ? {} : st.dayOrder,
    keepDays: !full && keepDays,
  };
  const run = startRoute(input, (p) => setState({ busy: { message: p.message, done: p.done, total: p.total } }));
  current = run;
  try {
    const plan = await run.promise;
    setState({
      plan,
      assignments: plan.assignments,
      dayOrder: full ? {} : st.dayOrder,
      planStale: false,
      busy: null,
      highlightRow: null,
      notice: plan.warnings.length ? { kind: 'warn', text: plan.warnings.join(' ') } : null,
    });
    return true;
  } catch (e) {
    const cancelled = e instanceof RouteCancelled || e instanceof CancelledError;
    setState({ busy: null });
    notify(cancelled ? 'Routing cancelled. The previous plan is unchanged.' : `Routing failed: ${errText(e)}`, cancelled ? 'info' : 'error');
    return false;
  } finally {
    current = null;
  }
}

// ---------- manual changes ----------

function rollback(revert: () => ReturnType<ReturnType<typeof pushUndo>>): void {
  const snap = revert();
  setState({ assignments: snap.assignments, dayOrder: snap.dayOrder, pins: snap.pins, plan: snap.plan, planStale: snap.planStale });
}

/** Assign jobs to a worker (and optionally a day). Locks them, then re-routes the affected workers. */
export async function reassign(rows: number[], worker: number, day: number | null = null): Promise<void> {
  const s = getState();
  if (s.busy) return;
  if (s.settings.simpleMode) {
    notify('Simple (old program) mode has one worker and no days. Untick it to assign jobs by hand.', 'warn');
    return;
  }
  const jobs = jobMap(s.extracted);
  const valid = rows.filter((r) => jobs.has(r));
  if (valid.length === 0 || worker < 0 || worker >= s.settings.workers.length) return;
  const affected = new Set<number>([worker]);
  const next: Assignments = { ...s.assignments };
  for (const r of valid) {
    const old = s.assignments[r];
    if (old) affected.add(old.worker);
    const same = old?.worker === worker;
    next[r] = {
      worker,
      day: day ?? (same ? old.day : null),
      lockedWorker: true,
      lockedDay: day !== null ? true : same ? old.lockedDay : false,
    };
  }
  const pins = { ...s.pins };
  for (const r of valid) delete pins[r];
  const revert = pushUndo();
  setState({ assignments: next, pins, selection: [] });
  if (!s.plan) {
    notify(`${valid.length} job${valid.length === 1 ? '' : 's'} locked to ${s.settings.workers[worker].name}. Press Route.`);
    return;
  }
  const ok = await runRoute([...affected].sort((a, b) => a - b), true);
  if (!ok) rollback(revert);
}

export function unlockRows(rows: number[]): void {
  const s = getState();
  const next: Assignments = { ...s.assignments };
  let changed = false;
  const pins = { ...s.pins };
  for (const r of rows) {
    const a = next[r];
    if (a && (a.lockedWorker || a.lockedDay)) {
      next[r] = { ...a, lockedWorker: false, lockedDay: false };
      changed = true;
    }
    if (pins[r] !== undefined) {
      delete pins[r];
      changed = true;
    }
  }
  if (!changed) return;
  pushUndo();
  setState({ assignments: next, pins, plan: s.plan ? { ...s.plan, assignments: next } : null });
}

export function unlockAll(): void {
  unlockRows(Object.keys(getState().assignments).map(Number));
}

/**
 * Move one job by hand to a worker and day (day null = the worker's only route when days are
 * not split). `index` is the position in that day's stop list (without the moved job): the whole
 * day is then pinned in the order shown. index null = the router finds the best spot.
 */
export async function moveStop(row: number, worker: number, day: number | null, index: number | null): Promise<void> {
  const s = getState();
  if (s.busy || !s.plan) return;
  if (s.settings.simpleMode) {
    notify('Simple (old program) mode has one worker and no days. Untick it on the Setup tab to move jobs by hand.', 'warn');
    return;
  }
  if (!jobMap(s.extracted).has(row) || worker < 0 || worker >= s.settings.workers.length) return;
  const from = indexPlan(s.plan).get(row);
  const fromWorker = from?.route.worker ?? s.assignments[row]?.worker ?? worker;
  const sameDay = !!from && from.route.worker === worker && from.route.day === day;
  if (sameDay && index === null) return;

  const assignments: Assignments = { ...s.assignments, [row]: { worker, day, lockedWorker: true, lockedDay: day !== null } };
  const pins = { ...s.pins };
  delete pins[row];
  if (index !== null) {
    const target = s.plan.routes.find((r) => r.worker === worker && r.day === day);
    const order = (target?.stops ?? []).map((st) => st.row).filter((r) => r !== row);
    order.splice(Math.max(0, Math.min(index, order.length)), 0, row);
    // Pin and lock the whole day so a re-split cannot move these jobs and the order holds.
    order.forEach((r, i) => {
      pins[r] = i + 1;
      assignments[r] = { worker, day, lockedWorker: true, lockedDay: day !== null };
    });
    if (sameDay && order.every((r, i) => target?.stops[i]?.row === r)) return;
  }
  const revert = pushUndo();
  setState({ assignments, pins, selection: [] });
  const ok = await runRoute([...new Set([fromWorker, worker])].sort((a, b) => a - b), true);
  if (!ok) rollback(revert);
}

/** Drop the hand-set order of one day and let the router re-optimise it (jobs stay in that day). */
export async function unpinDay(worker: number, day: number | null): Promise<void> {
  const s = getState();
  if (s.busy || !s.plan) return;
  const route = s.plan.routes.find((r) => r.worker === worker && r.day === day);
  if (!route) return;
  const pins = { ...s.pins };
  let changed = false;
  for (const st of route.stops) if (pins[st.row] !== undefined) { delete pins[st.row]; changed = true; }
  if (!changed) return;
  const revert = pushUndo();
  setState({ pins });
  const ok = await runRoute([worker], true);
  if (!ok) rollback(revert);
}

/** Reorder days of one worker: day `from` moves to position `to` (both 1-based, as displayed). */
export async function moveDay(worker: number, from: number, to: number): Promise<void> {
  const s = getState();
  if (s.busy || from === to || !s.plan) return;
  const shown = routesOfWorker(s.plan, worker).map((r) => r.day ?? 1).sort((a, b) => a - b);
  const fromIdx = shown.indexOf(from);
  const toIdx = shown.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) return;
  const [m] = shown.splice(fromIdx, 1);
  shown.splice(toIdx, 0, m);
  const cur = s.dayOrder[worker];
  const order = shown.map((d) => cur?.[d - 1] ?? d);
  const revert = pushUndo();
  setState({ dayOrder: { ...s.dayOrder, [worker]: order } });
  const ok = await runRoute([worker], true);
  if (!ok) rollback(revert);
}

export function undo(): void {
  if (!getState().busy) undoState();
}
export function redo(): void {
  if (!getState().busy) redoState();
}

// ---------- plan file ----------

export function savePlanFile(): void {
  const s = getState();
  if (!s.table || !s.mapping) return;
  const text = serializePlanFile({
    table: s.table,
    mapping: s.mapping,
    settings: s.settings,
    assignments: s.assignments,
    dayOrder: s.dayOrder,
    pins: s.pins,
    plan: s.plan,
  });
  downloadBlob(new Blob([text], { type: 'application/json' }), `${s.fileName.replace(/\.[^.]+$/, '') || 'jobs'}.plan.json`);
}

export async function applyPlanFile(text: string): Promise<void> {
  const f = parsePlanFile(text);
  const s = getState();
  const extracted = extractJobs(f.table, f.mapping);
  clearHistory();
  setState({
    table: f.table,
    mapping: f.mapping,
    extracted,
    fileName: f.table.sourceName ?? 'plan.json',
    // Network settings stay as they are on this machine: a file must not switch on a tile or road server.
    settings: { ...f.settings, tileUrl: s.settings.tileUrl, roadServerUrl: s.settings.roadServerUrl, roadServerConfirmed: s.settings.roadServerConfirmed },
    assignments: f.plan ? f.plan.assignments : f.assignments,
    dayOrder: f.dayOrder ?? {},
    pins: f.pins ?? {},
    plan: f.plan,
    planStale: false,
    selection: [],
    highlightRow: null,
    notice: { kind: 'info', text: 'Plan file loaded.' },
  });
  if (!f.settings.base) void lookupBase();
}

// ---------- start-up / reset ----------

export function restore(): void {
  const d = loadSaved();
  if (!d || !d.table || !d.mapping) return;
  let extracted = null;
  try {
    extracted = extractJobs(d.table, d.mapping);
  } catch {
    return;
  }
  const settings = { ...getState().settings, ...d.settings };
  setState({
    table: d.table,
    mapping: d.mapping,
    extracted,
    fileName: d.fileName,
    settings,
    assignments: d.plan ? d.plan.assignments : d.assignments,
    dayOrder: d.dayOrder ?? {},
    pins: d.pins ?? {},
    plan: d.plan,
    planStale: d.planStale,
    notice: { kind: 'info', text: 'Restored your last session from this browser.' },
  });
  if (!settings.base) void lookupBase();
}

export function clearAllData(): void {
  lookupToken++;
  resetAll();
}

export type { Plan };
