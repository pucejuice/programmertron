// The ONLY place outbound URLs are built. Tests assert nothing else can be constructed.
import type { LatLon } from '../types';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

/**
 * Overpass QL for place=town|city|village around one point. POST body. Exactly one coordinate
 * pair. The point is rounded to 3 dp (about 100 m): a 100 km search does not need more, and
 * it sends less.
 */
export function overpassQuery(centroid: LatLon, radiusM: number): string {
  const r = Math.round(radiusM);
  return `[out:json][timeout:25];(node["place"~"^(town|city|village)$"](around:${r},${centroid.lat.toFixed(3)},${centroid.lon.toFixed(3)}););out body;`;
}

/** The form-encoded POST body for the Overpass request. */
export function overpassBody(centroid: LatLon, radiusM: number): string {
  return 'data=' + encodeURIComponent(overpassQuery(centroid, radiusM));
}

/** Nominatim search URL for a typed address (format=jsonv2, limit=5). */
export function nominatimSearchUrl(query: string): string {
  return `${NOMINATIM_BASE}/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`;
}

/** Nominatim reverse URL for one point. */
export function nominatimReverseUrl(p: LatLon): string {
  return `${NOMINATIM_BASE}/reverse?format=jsonv2&lat=${p.lat.toFixed(5)}&lon=${p.lon.toFixed(5)}`;
}

/** The OSRM project's public demo server: light use only, car profile, worldwide. */
export const OSRM_DEMO_URL = 'https://router.project-osrm.org';

/** OSRM table URL: {server}/table/v1/driving/{lon,lat;...}?annotations=distance,duration */
export function osrmTableUrl(server: string, pts: LatLon[]): string {
  const base = server.trim().replace(/\/+$/, '');
  const coords = pts.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  return `${base}/table/v1/driving/${coords}?annotations=distance,duration`;
}

function isLocalHost(h: string): boolean {
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

function parseUrl(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

/** Hostnames a tile template can resolve to ({s} expands to a, b, c). */
function tileHosts(tileUrl: string): string[] {
  if (!tileUrl) return [];
  const variants = tileUrl.includes('{s}') ? ['a', 'b', 'c'].map((s) => tileUrl.split('{s}').join(s)) : [tileUrl];
  const hosts: string[] = [];
  for (const v of variants) {
    // Placeholders in the path are not valid in a URL host, but are fine after the host.
    const u = parseUrl(v.replace(/\{[a-z]\}/g, 'x'));
    if (u && u.protocol === 'https:') hosts.push(u.hostname);
  }
  return hosts;
}

/** Host is the tile host, Overpass, Nominatim or the user's OSRM host. */
export function isAllowedUrl(url: string, opts: { tileUrl: string; roadServerUrl: string }): boolean {
  const u = parseUrl(url);
  if (!u || u.username || u.password) return false;
  const fixed = [new URL(OVERPASS_URL).hostname, new URL(NOMINATIM_BASE).hostname, ...tileHosts(opts.tileUrl)];
  if (u.protocol === 'https:' && fixed.includes(u.hostname)) return true;
  const osrm = opts.roadServerUrl ? parseUrl(opts.roadServerUrl.trim()) : null;
  if (osrm && u.host === osrm.host) {
    if (u.protocol === 'https:' && osrm.protocol === 'https:') return true;
    if (u.protocol === 'http:' && osrm.protocol === 'http:' && isLocalHost(u.hostname)) return true;
  }
  return false;
}
