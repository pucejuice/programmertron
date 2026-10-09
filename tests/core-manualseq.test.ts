import { describe, expect, it } from 'vitest';
import { buildPlan } from '../src/core/plan';
import { matrixDist, routeLength, sequenceWithAnchors, straightMatrix } from '../src/core/route';
import { input, syntheticJobs } from './core-helpers';

describe('MANUAL_SEQ', () => {
  it('anchored jobs keep their relative order, free jobs are all present', async () => {
    const jobs = syntheticJobs(40, 12);
    // anchors deliberately in a geographically silly order
    const anchorRows = [30, 5, 22, 11, 38];
    anchorRows.forEach((row, i) => (jobs[row].manualSeq = i + 1));
    for (const dayMode of ['none', 'count'] as const) {
      for (const twoOpt of [false, true]) {
        const plan = await buildPlan(input(jobs, { dayMode, jobsPerDay: 40, twoOpt, endMode: 'open' }));
        const stops = plan.routes[0].stops.map((s) => s.row);
        expect(stops).toHaveLength(40);
        expect(new Set(stops).size).toBe(40);
        expect(stops.filter((r) => anchorRows.includes(r))).toEqual(anchorRows);
      }
    }
  });

  it('sequenceWithAnchors improvement does not lengthen and keeps anchors', () => {
    const jobs = syntheticJobs(30, 4);
    const pts = [{ lat: -32.5, lon: 148.5 }, ...jobs, { lat: -32.5, lon: 148.5 }];
    const N = pts.length;
    const dist = matrixDist(straightMatrix(pts), N);
    const anchored = [20, 3, 14];
    const free = Array.from({ length: 30 }, (_, i) => i + 1).filter((x) => !anchored.includes(x));
    for (const end of [null, N - 1]) {
      const a = sequenceWithAnchors(anchored, free, dist, end, false, Infinity);
      const b = sequenceWithAnchors(anchored, free, dist, end, true, Infinity);
      expect(routeLength(b.order, dist, end)).toBeLessThanOrEqual(routeLength(a.order, dist, end) + 1e-9);
      expect(b.order.filter((x) => anchored.includes(x))).toEqual(anchored);
      expect(b.order).toHaveLength(30);
    }
  });
});
