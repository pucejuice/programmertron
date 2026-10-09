import { describe, expect, it } from 'vitest';
import { defaultWorker } from '../src/core/defaults';
import { buildPlan } from '../src/core/plan';
import { PARITY_40_CSV } from '../src/sample';
import { input, jobsFromCsv, syntheticJobs } from './core-helpers';

describe('days', () => {
  it('40 jobs at 7/day, 1 worker -> 6 days of 7,7,7,7,7,5, each job once', async () => {
    const { jobs } = jobsFromCsv(PARITY_40_CSV);
    const plan = await buildPlan(input(jobs, { dayMode: 'count', jobsPerDay: 7 }));
    expect(plan.routes.map((r) => r.day)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plan.routes.map((r) => r.stops.length).sort((a, b) => b - a)).toEqual([7, 7, 7, 7, 7, 5]);
    const rows = plan.routes.flatMap((r) => r.stops.map((s) => s.row)).sort((a, b) => a - b);
    expect(rows).toEqual(jobs.map((j) => j.row));
    for (const j of jobs) expect(plan.assignments[j.row].day).toBeGreaterThanOrEqual(1);
  });

  it('a single day equals the un-split route', async () => {
    const { jobs } = jobsFromCsv(PARITY_40_CSV);
    const one = await buildPlan(input(jobs, { dayMode: 'count', jobsPerDay: 40 }));
    const none = await buildPlan(input(jobs, { dayMode: 'none' }));
    expect(one.routes).toHaveLength(1);
    expect(one.routes[0].day).toBe(1);
    expect(none.routes[0].day).toBeNull();
    expect(one.routes[0].stops).toEqual(none.routes[0].stops);
    const blank = await buildPlan(input(jobs, { dayMode: 'count', jobsPerDay: null }));
    expect(blank.routes[0].day).toBeNull();
    expect(blank.routes[0].stops).toEqual(none.routes[0].stops);
  });

  it('days are numbered in sweep order around the base', async () => {
    const jobs = syntheticJobs(28, 3);
    const base = { name: 'B', source: 'click' as const, lat: -32.5, lon: 148.5 };
    const plan = await buildPlan(input(jobs, { base, jobsPerDay: 7 }));
    expect(plan.routes).toHaveLength(4);
    const angle = (r: (typeof plan.routes)[0]) => {
      const pts = r.stops.map((s) => jobs[s.row]);
      const la = pts.reduce((a, p) => a + p.lat, 0) / pts.length - base.lat;
      const lo = (pts.reduce((a, p) => a + p.lon, 0) / pts.length - base.lon) * Math.cos((base.lat * Math.PI) / 180);
      const a = Math.atan2(lo, la);
      return a < 0 ? a + 2 * Math.PI : a;
    };
    const angles = plan.routes.map(angle);
    expect([...angles].sort((a, b) => a - b)).toEqual(angles);
  });

  it('locked days are respected and dayOrder renumbers days', async () => {
    const jobs = syntheticJobs(21, 4);
    const first = await buildPlan(input(jobs, { jobsPerDay: 7 }));
    const asg = { ...first.assignments };
    const target = jobs[0].row;
    const day = asg[target].day === 3 ? 2 : 3;
    asg[target] = { ...asg[target], day, lockedDay: true };
    const second = await buildPlan(input(jobs, { jobsPerDay: 7 }, { assignments: asg }));
    expect(second.assignments[target].day).toBe(day);
    const third = await buildPlan(input(jobs, { jobsPerDay: 7 }, { assignments: asg, dayOrder: { 0: [3, 1, 2] } }));
    expect(third.assignments[target].day).toBe(day === 3 ? 1 : 3);
  });

  it('hours mode picks the fewest days that fit', async () => {
    const jobs = syntheticJobs(30, 6).map((j) => ({ ...j, lat: -32.5 + (j.lat + 32.5) / 6, lon: 148.5 + (j.lon - 148.5) / 6 }));
    const s = { dayMode: 'hours' as const, hoursPerDay: 4, minutesPerJob: 20, speedKmh: 60 };
    const plan = await buildPlan(input(jobs, s));
    expect(plan.routes.length).toBeGreaterThanOrEqual(3);
    for (const r of plan.routes) if (r.stops.length > 1) expect(r.hours!).toBeLessThanOrEqual(4 + 1e-9);
    // one fewer day would not fit: a (k-1)-day plan is not what we picked
    expect(plan.routes.length).toBeLessThan(30);
    const one = await buildPlan(input(jobs, { ...s, hoursPerDay: 1000 }));
    expect(one.routes).toHaveLength(1);
    const tiny = await buildPlan(input(jobs.slice(0, 3), { ...s, hoursPerDay: 0.1 }));
    expect(tiny.routes).toHaveLength(3);
    expect(tiny.routes[0].note).toMatch(/single job/i);
  });

  it('hours mode with missing inputs warns and does not split', async () => {
    const plan = await buildPlan(input(syntheticJobs(10, 1), { dayMode: 'hours', hoursPerDay: 4 }));
    expect(plan.routes).toHaveLength(1);
    expect(plan.routes[0].day).toBeNull();
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  it('multiple workers each split into days', async () => {
    const jobs = syntheticJobs(60, 9);
    const plan = await buildPlan(input(jobs, { workers: [defaultWorker(0), defaultWorker(1), defaultWorker(2)], jobsPerDay: 7 }));
    for (const r of plan.routes) expect(r.stops.length).toBeLessThanOrEqual(7);
    expect(plan.routes.flatMap((r) => r.stops)).toHaveLength(60);
    const keys = plan.routes.map((r) => r.worker * 100 + (r.day ?? 0));
    expect([...keys].sort((a, b) => a - b)).toEqual(keys);
  });
});

describe('road mode', () => {
  it('uses the table, and falls back loudly on failure', async () => {
    const jobs = syntheticJobs(14, 2);
    let calls = 0;
    const ok = await buildPlan(input(jobs, { jobsPerDay: 7 }), {
      roadTable: async (pts) => {
        calls++;
        const km = pts.map((_, i) => pts.map((_, j) => (i === j ? 0 : 1 + Math.abs(i - j))));
        return { km, min: km.map((r) => r.map((v) => v * 2)) };
      },
    });
    expect(calls).toBe(ok.routes.length);
    expect(ok.distMode).toBe('road');
    expect(ok.routes[0].stops[0].legMin).toBeDefined();
    const bad = await buildPlan(input(jobs, { jobsPerDay: 7 }), {
      roadTable: async () => {
        throw new Error('boom');
      },
    });
    expect(bad.distMode).toBe('straight');
    expect(bad.warnings.length).toBeGreaterThan(0);
    expect(bad.routes.flatMap((r) => r.stops)).toHaveLength(14);
  });

  it('cancels', async () => {
    await expect(buildPlan(input(syntheticJobs(10, 1)), { isCancelled: () => true })).rejects.toMatchObject({ name: 'CancelledError' });
  });
});
