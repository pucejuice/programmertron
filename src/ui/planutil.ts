import type { DayRoute, LatLon, Plan, Stop } from '../types';

export interface RowInfo {
  route: DayRoute;
  stop: Stop;
}

export function indexPlan(plan: Plan | null): Map<number, RowInfo> {
  const m = new Map<number, RowInfo>();
  if (!plan) return m;
  for (const route of plan.routes) for (const stop of route.stops) m.set(stop.row, { route, stop });
  return m;
}

export function colLetter(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function fmtKm(n: number): string {
  return `${n.toFixed(1)} km`;
}

export function fmtHours(h: number): string {
  const mins = Math.round(h * 60);
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
}

export function fmtPoint(p: LatLon): string {
  return `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
}

export function routesOfWorker(plan: Plan | null, worker: number): DayRoute[] {
  return plan ? plan.routes.filter((r) => r.worker === worker) : [];
}

export function baseName(fileName: string): string {
  const n = fileName.replace(/\.[^.]+$/, '');
  return n || 'jobs';
}

import type { ExtractedJobs, Job } from '../types';

const jobMaps = new WeakMap<ExtractedJobs, Map<number, Job>>();

/** row -> Job, cached per extraction. */
export function jobMap(ex: ExtractedJobs | null): Map<number, Job> {
  if (!ex) return new Map();
  let m = jobMaps.get(ex);
  if (!m) {
    m = new Map(ex.jobs.map((j) => [j.row, j]));
    jobMaps.set(ex, m);
  }
  return m;
}
