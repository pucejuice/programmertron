import { describe, expect, it } from 'vitest';
import { balancedKMeans } from '../src/core/cluster';
import { defaultWorker } from '../src/core/defaults';
import { buildPlan } from '../src/core/plan';
import type { Assignments } from '../src/types';
import { input, syntheticJobs } from './core-helpers';

const workers = (k: number) => Array.from({ length: k }, (_, i) => defaultWorker(i));

describe('workers', () => {
  it('every job in exactly one worker, balanced within 1', async () => {
    for (const [n, k] of [[40, 3], [41, 4], [250, 4], [7, 5]]) {
      const jobs = syntheticJobs(n, n);
      const plan = await buildPlan(input(jobs, { workers: workers(k), dayMode: 'none' }));
      const counts = new Array(k).fill(0);
      const seen = new Set<number>();
      for (const r of plan.routes) for (const s of r.stops) {
        expect(seen.has(s.row)).toBe(false);
        seen.add(s.row);
        counts[r.worker]++;
      }
      expect(seen.size).toBe(n);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      for (const j of jobs) expect(plan.assignments[j.row].worker).toBe(plan.routes.find((r) => r.stops.some((s) => s.row === j.row))!.worker);
    }
  });

  it('locked jobs keep their worker on re-run, others stay balanced', async () => {
    const jobs = syntheticJobs(60, 5);
    const first = await buildPlan(input(jobs, { workers: workers(3), dayMode: 'none' }));
    const locked: Assignments = {};
    // lock 6 jobs to worker (their row % 3), deliberately ignoring geography
    for (const j of jobs.slice(0, 6)) {
      locked[j.row] = { worker: j.row % 3, day: null, lockedWorker: true, lockedDay: false };
    }
    const second = await buildPlan(input(jobs, { workers: workers(3), dayMode: 'none' }, { assignments: { ...first.assignments, ...locked } }));
    for (const j of jobs.slice(0, 6)) {
      expect(second.assignments[j.row].worker).toBe(j.row % 3);
      expect(second.assignments[j.row].lockedWorker).toBe(true);
    }
    const counts = [0, 0, 0];
    for (const j of jobs) counts[second.assignments[j.row].worker]++;
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('respects per-worker capacities and never drops points', async () => {
    const jobs = syntheticJobs(30, 2);
    const ws = workers(3);
    ws[0].capacity = 5;
    ws[1].capacity = 10;
    const plan = await buildPlan(input(jobs, { workers: ws, dayMode: 'none' }));
    const counts = [0, 0, 0];
    for (const j of jobs) counts[plan.assignments[j.row].worker]++;
    expect(counts).toEqual([5, 10, 15]);
    const tooSmall = await buildPlan(input(jobs, { workers: [{ ...ws[0], capacity: 3 }, { ...ws[1], capacity: 3 }], dayMode: 'none' }));
    expect(Object.keys(tooSmall.assignments)).toHaveLength(30);
  });

  it('clustering is deterministic and splits two obvious blobs', () => {
    const pts = [
      ...Array.from({ length: 10 }, (_, i) => ({ lat: -30 + i * 0.001, lon: 150 })),
      ...Array.from({ length: 10 }, (_, i) => ({ lat: -34 + i * 0.001, lon: 151 })),
    ];
    const a = balancedKMeans(pts, { k: 2, seed: 9, origin: { lat: -32, lon: 150.5 } });
    const b = balancedKMeans(pts, { k: 2, seed: 9, origin: { lat: -32, lon: 150.5 } });
    expect(a).toEqual(b);
    expect(new Set(a.slice(0, 10)).size).toBe(1);
    expect(new Set(a.slice(10)).size).toBe(1);
    expect(a[0]).not.toBe(a[10]);
  });

  it('onlyWorkers re-routes just those workers and copies the rest', async () => {
    const jobs = syntheticJobs(40, 8);
    const s = { workers: workers(2), dayMode: 'none' as const };
    const first = await buildPlan(input(jobs, s));
    const second = await buildPlan(input(jobs, s, { assignments: first.assignments, onlyWorkers: [1], previous: first }));
    expect(second.routes.find((r) => r.worker === 0)).toBe(first.routes.find((r) => r.worker === 0));
    expect(second.routes.map((r) => r.worker)).toEqual([0, 1]);
  });
});
