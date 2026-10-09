import type { Cell, LatLon } from '../types';

/** Numeric value of a cell, or null if blank / non-numeric / non-finite. */
export function cellToNumber(c: unknown): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null;
  if (typeof c !== 'string') return null;
  const t = c.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Validate a location from two cells. null when blank, non-numeric, |lat| > 90, |lon| > 180
 * or exactly (0, 0). Local copy so io/ does not depend on core/.
 */
export function validLocation(latCell: Cell | undefined, lonCell: Cell | undefined): LatLon | null {
  const lat = cellToNumber(latCell);
  const lon = cellToNumber(lonCell);
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

/** Haversine distance in km, Earth radius 6371 km. */
export function distKm(a: LatLon, b: LatLon): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
