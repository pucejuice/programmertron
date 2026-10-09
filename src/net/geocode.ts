import type { FetchFn } from './base';
import { nominatimSearchUrl } from './endpoints';
import { rateLimited } from './ratelimit';

export interface GeocodeHit {
  name: string;
  lat: number;
  lon: number;
}

/**
 * Geocode a typed address via Nominatim. Only called when the user presses Search.
 * Browsers cannot set User-Agent; the Referer header identifies the app.
 */
export async function geocodeAddress(query: string, fetchFn: FetchFn): Promise<GeocodeHit[]> {
  const q = query.trim();
  if (q === '') return [];
  const res = await rateLimited('osm', () =>
    fetchFn(nominatimSearchUrl(q), { headers: { Accept: 'application/json' }, referrerPolicy: 'strict-origin-when-cross-origin' }),
  );
  if (!res.ok) throw new Error(`Address search failed (HTTP ${res.status}).`);
  const json = (await res.json()) as unknown;
  if (!Array.isArray(json)) throw new Error('Address search returned an unexpected answer.');
  const hits: GeocodeHit[] = [];
  for (const r of json as Array<{ display_name?: unknown; lat?: unknown; lon?: unknown }>) {
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    hits.push({ name: typeof r.display_name === 'string' ? r.display_name : `${lat}, ${lon}`, lat, lon });
  }
  return hits;
}

const NUM = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/** Parse "lat, long" (or "lat long") typed by the user. null if invalid. */
export function parseLatLonText(s: string): { lat: number; lon: number } | null {
  const parts = s.trim().split(/\s*,\s*|\s+/);
  if (parts.length !== 2 || !NUM.test(parts[0]) || !NUM.test(parts[1])) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}
