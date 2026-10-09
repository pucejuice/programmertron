import type { Base, LatLon } from '../types';
import { distKm } from '../io/location';
import { OVERPASS_URL, overpassBody } from './endpoints';
import { rateLimited } from './ratelimit';

export type FetchFn = typeof fetch;

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const RADIUS_M = 100_000;
const FALLBACK_NOTE = 'Town lookup failed (offline?); using the centroid of the jobs as base.';

interface Place {
  lat: number;
  lon: number;
  name: string;
  place: string;
  d: number;
}

function centroidBase(c: LatLon, note: string): Base {
  return { lat: c.lat, lon: c.lon, name: 'Centroid of jobs', source: 'centroid', distFromCentroidKm: 0, note };
}

function cacheKey(c: LatLon): string {
  return `jr-base:${c.lat.toFixed(2)},${c.lon.toFixed(2)}`;
}

function townToBase(p: { lat: number; lon: number; name: string }, c: LatLon): Base {
  return { lat: p.lat, lon: p.lon, name: p.name, source: 'town', distFromCentroidKm: distKm(c, p) };
}

function readCache(cache: KV | null, c: LatLon): Base | null {
  if (!cache) return null;
  try {
    const s = cache.get(cacheKey(c));
    if (!s) return null;
    const v = JSON.parse(s) as Partial<Base>;
    if (typeof v.lat !== 'number' || typeof v.lon !== 'number' || typeof v.name !== 'string') return null;
    return townToBase({ lat: v.lat, lon: v.lon, name: v.name }, c);
  } catch {
    return null;
  }
}

/**
 * Nearest place=town|city to the centroid (within 100 km), else nearest place=village.
 * Sends ONLY the centroid. Cached by centroid rounded to 2 dp. On failure/offline returns
 * the centroid as base with a visible note.
 *
 * Browsers forbid setting the User-Agent header from fetch, so we cannot send an identifying
 * one. We send `Accept: application/json` and rely on the Referer header, which the browser
 * sends by default (referrerPolicy 'strict-origin-when-cross-origin' gives the page origin).
 */
export async function lookupBaseTown(centroid: LatLon, fetchFn: FetchFn, cache: KV | null): Promise<Base> {
  const hit = readCache(cache, centroid);
  if (hit) return hit;
  try {
    const res = await rateLimited('osm', () =>
      fetchFn(OVERPASS_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: overpassBody(centroid, RADIUS_M),
        referrerPolicy: 'strict-origin-when-cross-origin',
      }),
    );
    if (!res.ok) throw new Error(`Overpass returned HTTP ${res.status}`);
    const json = (await res.json()) as { elements?: unknown };
    const places: Place[] = [];
    for (const e of Array.isArray(json.elements) ? json.elements : []) {
      const el = e as { lat?: unknown; lon?: unknown; tags?: Record<string, string> };
      if (typeof el.lat !== 'number' || typeof el.lon !== 'number') continue;
      const place = el.tags?.place ?? '';
      if (place !== 'town' && place !== 'city' && place !== 'village') continue;
      const d = distKm(centroid, { lat: el.lat, lon: el.lon });
      if (d > RADIUS_M / 1000) continue;
      places.push({ lat: el.lat, lon: el.lon, place, d, name: el.tags?.name ?? el.tags?.['name:en'] ?? `Unnamed ${place}` });
    }
    const nearest = (list: Place[]) => list.reduce<Place | null>((b, p) => (b === null || p.d < b.d ? p : b), null);
    const best = nearest(places.filter((p) => p.place !== 'village')) ?? nearest(places.filter((p) => p.place === 'village'));
    if (!best) return centroidBase(centroid, 'No town or village found within 100 km; using the centroid of the jobs as base.');
    const base = townToBase(best, centroid);
    try {
      cache?.set(cacheKey(centroid), JSON.stringify({ lat: base.lat, lon: base.lon, name: base.name }));
    } catch {
      /* storage unavailable: carry on without caching */
    }
    return base;
  } catch {
    return centroidBase(centroid, FALLBACK_NOTE);
  }
}
