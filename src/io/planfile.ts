import type { Assignments, ColumnMapping, Plan, Settings, Table } from '../types';

export interface PlanFile {
  format: 'job-router-plan';
  version: 1;
  savedAt: string;
  table: Table;
  mapping: ColumnMapping;
  settings: Settings;
  assignments: Assignments;
  dayOrder: Record<number, number[]>;
  plan: Plan | null;
}

export function serializePlanFile(p: Omit<PlanFile, 'format' | 'version' | 'savedAt'>): string {
  const file: PlanFile = { format: 'job-router-plan', version: 1, savedAt: new Date().toISOString(), ...p };
  return JSON.stringify(file);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function fail(msg: string): never {
  throw new Error(`Not a valid plan file: ${msg}`);
}

function checkIndex(v: unknown, what: string, nullable: boolean): void {
  if (v === null && nullable) return;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) fail(`mapping.${what} must be a column number.`);
}

/** Validates format/version and basic shape; throws a readable Error otherwise. */
export function parsePlanFile(text: string): PlanFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not a valid plan file: the file is not valid JSON.');
  }
  if (!isObj(raw)) fail('the top level must be an object.');
  if (raw.format !== 'job-router-plan') fail('this is not a Job Router plan file (format field missing or different).');
  if (raw.version !== 1) fail(`unsupported version ${String(raw.version)}; this app reads version 1.`);

  const t = raw.table;
  if (!isObj(t) || !Array.isArray(t.headers) || !Array.isArray(t.rows)) fail('"table" must have headers and rows.');
  if (!t.headers.every((h) => typeof h === 'string')) fail('table headers must all be text.');
  const width = t.headers.length;
  t.rows.forEach((r, i) => {
    if (!Array.isArray(r)) fail(`table row ${i + 1} is not a list of cells.`);
    if (r.length !== width) fail(`table row ${i + 1} has ${r.length} cells but there are ${width} headers.`);
  });

  const m = raw.mapping;
  if (!isObj(m)) fail('"mapping" is missing.');
  checkIndex(m.lat, 'lat', false);
  checkIndex(m.lon, 'lon', false);
  checkIndex(m.label, 'label', false);
  checkIndex(m.worker, 'worker', true);
  checkIndex(m.manualSeq, 'manualSeq', true);
  for (const k of ['lat', 'lon', 'label'] as const) {
    if ((m[k] as number) >= width) fail(`mapping.${k} points past the last column.`);
  }

  const s = raw.settings;
  if (!isObj(s) || !Array.isArray(s.workers) || s.workers.length < 1) fail('"settings" must list at least one worker.');
  if (!s.workers.every((w) => isObj(w) && typeof w.name === 'string')) fail('every worker needs a name.');

  if (!isObj(raw.assignments)) fail('"assignments" is missing.');
  for (const [k, a] of Object.entries(raw.assignments)) {
    if (!isObj(a) || typeof a.worker !== 'number') fail(`assignment for row ${k} is malformed.`);
  }
  if (!isObj(raw.dayOrder)) fail('"dayOrder" is missing.');

  if (raw.plan !== null) {
    const p = raw.plan;
    if (!isObj(p) || !Array.isArray(p.routes) || !Array.isArray(p.notRouted)) fail('"plan" must be null or have routes and notRouted.');
    if (p.distMode !== 'straight' && p.distMode !== 'road') fail('plan.distMode must be "straight" or "road".');
  }
  return raw as unknown as PlanFile;
}
