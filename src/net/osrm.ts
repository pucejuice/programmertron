import type { DistanceTable, LatLon, RoadTableProvider } from '../types';
import type { FetchFn } from './base';
import { OSRM_DEMO_URL, osrmRouteUrl, osrmTableUrl } from './endpoints';
import { rateLimited } from './ratelimit';

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
    const get = () => fetchFn(osrmTableUrl(serverUrl, points), { headers: { Accept: 'application/json' } });
    // The public demo server asks for at most one request per second.
    const res = serverUrl.replace(/\/+$/, '') === OSRM_DEMO_URL ? await rateLimited('osrm-demo', get) : await get();
    if (!res.ok) throw new Error(`Road server returned HTTP ${res.status}.`);
    const json = (await res.json()) as { code?: string; message?: string; distances?: unknown; durations?: unknown };
    if (json.code !== 'Ok') throw new Error(`Road server error: ${json.code ?? 'unknown'}${json.message ? ` (${json.message})` : ''}.`);
    return {
      km: matrix(json.distances, points.length, 'distance', 1000),
      min: matrix(json.durations, points.length, 'duration', 60),
    };
  };
}

/** OSRM accepts a limited number of coordinates per request; longer routes are fetched in parts. */
const MAX_ROUTE_POINTS = 90;

/**
 * Road path through the points in the given order (start, stops..., end), from the user's
 * OSRM server. Returns [lat, lon] pairs to draw on the map. Throws on failure.
 */
export async function osrmRoutePath(serverUrl: string, points: LatLon[], fetchFn: FetchFn): Promise<[number, number][]> {
  const demo = serverUrl.replace(/\/+$/, '') === OSRM_DEMO_URL;
  const out: [number, number][] = [];
  for (let i = 0; i < points.length - 1; i += MAX_ROUTE_POINTS - 1) {
    const part = points.slice(i, i + MAX_ROUTE_POINTS);
    if (part.length < 2) break;
    const get = () => fetchFn(osrmRouteUrl(serverUrl, part), { headers: { Accept: 'application/json' } });
    const res = demo ? await rateLimited('osrm-demo', get) : await get();
    if (!res.ok) throw new Error(`Road server returned HTTP ${res.status}.`);
    const json = (await res.json()) as { code?: string; routes?: { geometry?: { coordinates?: unknown } }[] };
    if (json.code !== 'Ok') throw new Error(`Road server error: ${json.code ?? 'unknown'}.`);
    const coords = json.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) throw new Error('Road server returned no route path.');
    for (const c of coords) {
      if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') throw new Error('Road server returned a malformed route path.');
      out.push([c[1], c[0]]);
    }
  }
  return out;
}
