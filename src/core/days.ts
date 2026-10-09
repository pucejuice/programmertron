import type { LatLon } from '../types';
import { balancedCapacities, balancedKMeans } from './cluster';
import type { DistFn } from './route';
import { matrixDist, nearestNeighbour, routeLength, straightMatrix, twoOptLimited } from './route';

export interface DaySplitOptions {
  mode: 'none' | 'count' | 'hours';
  jobsPerDay?: number | null;
  hoursPerDay?: number | null;
  minutesPerJob?: number | null;
  speedKmh?: number | null;
  seed: number;
  /** fixedDay[i] = 1-based day for point i (locked), or null. */
  fixedDay?: (number | null)[];
}

/** Estimated hours for a route: km / speed + jobs * minutesPerJob / 60. */
export function estimateHours(km: number, jobs: number, minutesPerJob: number, speedKmh: number): number {
  return km / speedKmh + (jobs * minutesPerJob) / 60;
}

/** base -> NN + capped 2-opt over pts -> base, straight-line km. */
export function estimateRoundTripKm(base: LatLon, pts: LatLon[]): number {
  if (pts.length === 0) return 0;
  const all = [base, ...pts, base];
  const N = all.length;
  const dist = matrixDist(straightMatrix(all), N);
  const end = N - 1;
  let order = nearestNeighbour(pts.length, dist);
  order = twoOptLimited(order, dist, end, 20).order;
  return routeLength(order, dist, end);
}

function posInt(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Split one worker's jobs into days. Returns 1-based day number per point (all 1 when
 * mode is 'none' or jobsPerDay blank). Count mode: ceil(n / jobsPerDay) days, each at most
 * jobsPerDay (40 at 7 -> 7,7,7,7,7,5). Days numbered in sweep order around base (unless
 * locked days are given: then day numbers are kept as the locks define them).
 */
export function splitDays(points: LatLon[], base: LatLon, opts: DaySplitOptions): number[] {
  const n = points.length;
  if (n === 0) return [];
  const ones = () => new Array(n).fill(1);
  const fixedGroups: (number | null)[] = new Array(n).fill(null);
  let maxFixed = 0;
  if (opts.fixedDay) {
    for (let i = 0; i < n; i++) {
      const d = opts.fixedDay[i];
      if (d !== null && d !== undefined && Number.isInteger(d) && d >= 1) {
        fixedGroups[i] = d - 1;
        if (d > maxFixed) maxFixed = d;
      }
    }
  }
  const hasFixed = maxFixed > 0;

  const run = (k: number, caps: number[]): number[] => {
    const kk = Math.max(k, maxFixed);
    const capacities = caps.slice();
    const jp = Math.max(...capacities, 1);
    while (capacities.length < kk) capacities.push(jp);
    const g = balancedKMeans(points, {
      k: kk,
      capacities,
      fixed: hasFixed ? fixedGroups : undefined,
      seed: opts.seed,
      origin: base,
      renumberBySweep: !hasFixed,
    });
    return g.map((x) => x + 1);
  };

  if (opts.mode === 'count') {
    const jpd = posInt(opts.jobsPerDay);
    if (jpd === null) return ones();
    const per = Math.floor(jpd);
    const k = Math.ceil(n / per);
    if (k === 1 && !hasFixed) return ones();
    const caps: number[] = [];
    for (let d = 0; d < k; d++) caps.push(d < k - 1 ? per : n - per * (k - 1));
    return run(k, caps);
  }

  if (opts.mode === 'hours') {
    const hours = posInt(opts.hoursPerDay);
    const mpj = posInt(opts.minutesPerJob);
    const speed = posInt(opts.speedKmh);
    if (hours === null || mpj === null || speed === null) return ones();
    const cache = new Map<number, { ok: boolean; days: number[] }>();
    const attempt = (k: number) => {
      let r = cache.get(k);
      if (r) return r;
      const days = k === 1 && !hasFixed ? ones() : run(k, balancedCapacities(n, k));
      let ok = true;
      const nDays = days.reduce((a, b) => Math.max(a, b), 0);
      const groups: LatLon[][] = Array.from({ length: nDays }, () => []);
      days.forEach((d, i) => groups[d - 1].push(points[i]));
      for (const g of groups) {
        if (g.length <= 1) continue;
        const km = estimateRoundTripKm(base, g);
        if (estimateHours(km, g.length, mpj, speed) > hours) {
          ok = false;
          break;
        }
      }
      r = { ok, days };
      cache.set(k, r);
      return r;
    };
    const lower = Math.min(n, Math.max(1, maxFixed, Math.ceil((n * mpj) / 60 / hours)));
    let hi = lower;
    let lo = lower - 1;
    while (!attempt(hi).ok && hi < n) {
      lo = hi;
      hi = Math.min(n, hi * 2);
    }
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (attempt(mid).ok) hi = mid;
      else lo = mid;
    }
    return attempt(hi).days;
  }

  return ones();
}

export type { DistFn };
