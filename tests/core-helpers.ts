import type { Job, PlanInput, Settings } from '../src/types';
import { defaultSettings } from '../src/core/defaults';
import { parseLocation } from '../src/core/geo';
import { mulberry32 } from '../src/core/cluster';

/** Tiny CSV split (no quotes) for the synthetic fixtures; avoids depending on src/io. */
export function jobsFromCsv(csv: string, labelCol = 0, latCol?: number, lonCol?: number) {
  const lines = csv.trim().split('\n');
  const headers = lines[0].split(',');
  const li = latCol ?? headers.findIndex((h) => h.trim().toLowerCase() === 'lat');
  const lo = lonCol ?? headers.findIndex((h) => ['long', 'lon'].includes(h.trim().toLowerCase()));
  const jobs: Job[] = [];
  const notRouted: number[] = [];
  lines.slice(1).forEach((line, row) => {
    const c = line.split(',');
    const loc = parseLocation(c[li], c[lo]);
    if (!loc) notRouted.push(row);
    else jobs.push({ row, label: c[labelCol], lat: loc.lat, lon: loc.lon, manualSeq: null });
  });
  return { jobs, notRouted };
}

/** Seeded random points around rural NSW. */
export function syntheticJobs(n: number, seed = 1): Job[] {
  const rnd = mulberry32(seed);
  const jobs: Job[] = [];
  for (let i = 0; i < n; i++) {
    jobs.push({
      row: i,
      label: `S${i}`,
      lat: -32.5 + (rnd() - 0.5) * 2,
      lon: 148.5 + (rnd() - 0.5) * 2,
      manualSeq: null,
    });
  }
  return jobs;
}

export function input(jobs: Job[], patch: Partial<Settings> = {}, extra: Partial<PlanInput> = {}): PlanInput {
  return {
    jobs,
    notRouted: [],
    settings: { ...defaultSettings(), ...patch },
    assignments: {},
    onlyWorkers: null,
    previous: null,
    ...extra,
  };
}

export function simpleSettings(): Partial<Settings> {
  return { simpleMode: true, twoOpt: false, dayMode: 'none', endMode: 'open' };
}
