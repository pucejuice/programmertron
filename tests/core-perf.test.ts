import { describe, expect, it } from 'vitest';
import { defaultWorker } from '../src/core/defaults';
import { buildPlan } from '../src/core/plan';
import { input, syntheticJobs } from './core-helpers';

describe('performance', () => {
  it('250 jobs, 4 workers, 7/day in under 3 s', async () => {
    const jobs = syntheticJobs(250, 21);
    const t0 = Date.now();
    const plan = await buildPlan(input(jobs, { workers: [0, 1, 2, 3].map(defaultWorker), jobsPerDay: 7 }));
    const dt = Date.now() - t0;
    expect(plan.routes.flatMap((r) => r.stops)).toHaveLength(250);
    expect(dt).toBeLessThan(3000);
  });

  it('2,000 jobs complete', async () => {
    const jobs = syntheticJobs(2000, 33);
    const plan = await buildPlan(input(jobs, { workers: [0, 1, 2, 3, 4].map(defaultWorker), jobsPerDay: 7, twoOptTimeLimitMs: 2000 }));
    expect(plan.routes.flatMap((r) => r.stops)).toHaveLength(2000);
  }, 120_000);

  it('2,000 jobs in one un-split route complete (time-limited 2-opt)', async () => {
    const jobs = syntheticJobs(2000, 34);
    const plan = await buildPlan(input(jobs, { dayMode: 'none', twoOptTimeLimitMs: 1500 }));
    expect(plan.routes).toHaveLength(1);
    expect(plan.routes[0].stops).toHaveLength(2000);
    expect(plan.routes[0].kmAfter2opt).toBeLessThanOrEqual(plan.routes[0].kmBefore2opt);
  }, 120_000);
});
