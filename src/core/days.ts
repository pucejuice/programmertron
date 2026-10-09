import type { LatLon } from '../types';
import type { DistFn } from './route';

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

/**
 * Split one worker's jobs into days. Returns 1-based day number per point (all 1 when
 * mode is 'none' or jobsPerDay blank). Count mode: ceil(n / jobsPerDay) days, each at most
 * jobsPerDay (40 at 7 -> 7,7,7,7,7,5). Days numbered in sweep order around base.
 */
export function splitDays(_points: LatLon[], _base: LatLon, _opts: DaySplitOptions): number[] { throw new Error('not implemented'); }

/** Estimated hours for a route: km / speed + jobs * minutesPerJob / 60. */
export function estimateHours(_km: number, _jobs: number, _minutesPerJob: number, _speedKmh: number): number { throw new Error('not implemented'); }

export type { DistFn };
