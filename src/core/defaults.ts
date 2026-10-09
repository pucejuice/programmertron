import type { Settings, WorkerConfig } from '../types';

export const WORKER_COLORS = [
  '#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e',
  '#17becf', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22',
];

export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export function defaultWorker(i: number): WorkerConfig {
  return { name: `Worker ${i + 1}`, color: WORKER_COLORS[i % WORKER_COLORS.length], base: null, capacity: null };
}

export function defaultSettings(): Settings {
  return {
    simpleMode: false,
    workers: [defaultWorker(0)],
    base: null,
    startOverride: null,
    endMode: 'base',
    endPoint: null,
    dayMode: 'count',
    jobsPerDay: 7,
    hoursPerDay: null,
    minutesPerJob: null,
    speedKmh: null,
    twoOpt: true,
    twoOptTimeLimitMs: 5000,
    tileUrl: OSM_TILE_URL,
    roadServerUrl: '',
    roadServerConfirmed: false,
    seed: 42,
  };
}
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
