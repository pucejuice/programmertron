import type { DayRoute, Plan, Settings } from '../src/types';
import { defaultSettings } from '../src/core/defaults';

/** Hand-built plan for the 5-row fixture: P002,P001,P003,P005 routed; P004 (row 3) not. */
export function fixturePlan(): { plan: Plan; settings: Settings } {
  const settings = defaultSettings();
  const route: DayRoute = {
    worker: 0,
    day: null,
    start: { lat: -33.8975, lon: 151.2375 },
    end: null,
    stops: [
      { row: 1, seq: 1, legKm: 4.5, cumKm: 4.5 },
      { row: 0, seq: 2, legKm: 4.4, cumKm: 8.9 },
      { row: 2, seq: 3, legKm: 0, cumKm: 8.9 },
      { row: 4, seq: 4, legKm: 11.123456, cumKm: 20.023456 },
    ],
    returnKm: 0,
    totalKm: 20.023456,
    kmBefore2opt: 20.023456,
    kmAfter2opt: 20.023456,
  };
  const plan: Plan = {
    routes: [route],
    notRouted: [3],
    distMode: 'straight',
    warnings: [],
    assignments: {
      0: { worker: 0, day: null, lockedWorker: false, lockedDay: false },
      1: { worker: 0, day: null, lockedWorker: true, lockedDay: false },
      2: { worker: 0, day: null, lockedWorker: false, lockedDay: false },
      4: { worker: 0, day: null, lockedWorker: false, lockedDay: false },
    },
    centroid: { lat: -33.8975, lon: 151.2375 },
  };
  return { plan, settings };
}
