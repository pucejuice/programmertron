import type { DistanceTable, LatLon, RoadTableProvider } from '../types';
import type { FetchFn } from './base';
import { osrmTableUrl } from './endpoints';

function matrix(m: unknown, n: number, what: string, scale: number): number[][] {
  if (!Array.isArray(m) || m.length !== n) throw new Error(`Road server returned no ${what} table.`);
  return m.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== n) throw new Error(`Road server returned a malformed ${what} table.`);
    return row.map((v: unknown) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error(`Road server has no ${what} between some of the points (unreachable).`);
      }
      return v / scale;
    });
  });
}

/** Provider fetching an OSRM table (km, minutes) from the user's server. Throws on failure. */
export function osrmProvider(serverUrl: string, fetchFn: FetchFn): RoadTableProvider {
  return async (points: LatLon[]): Promise<DistanceTable> => {
    const res = await fetchFn(osrmTableUrl(serverUrl, points), { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Road server returned HTTP ${res.status}.`);
    const json = (await res.json()) as { code?: string; message?: string; distances?: unknown; durations?: unknown };
    if (json.code !== 'Ok') throw new Error(`Road server error: ${json.code ?? 'unknown'}${json.message ? ` (${json.message})` : ''}.`);
    return {
      km: matrix(json.distances, points.length, 'distance', 1000),
      min: matrix(json.durations, points.length, 'duration', 60),
    };
  };
}
