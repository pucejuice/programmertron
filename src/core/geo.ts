import type { LatLon } from '../types';

export const EARTH_RADIUS_KM = 6371;

/** Haversine great-circle distance, Earth radius 6371 km (parity with the old program). */
export function haversineKm(a: LatLon, b: LatLon): number {
  const toRad = Math.PI / 180;
  const la1 = a.lat * toRad;
  const la2 = b.lat * toRad;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const h = s1 * s1 + Math.cos(la1) * Math.cos(la2) * s2 * s2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Arithmetic mean of lats and of lons. */
export function centroid(pts: LatLon[]): LatLon {
  if (pts.length === 0) return { lat: 0, lon: 0 };
  let la = 0;
  let lo = 0;
  for (const p of pts) {
    la += p.lat;
    lo += p.lon;
  }
  return { lat: la / pts.length, lon: lo / pts.length };
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parse a lat/lon pair from cells. Returns null when blank, non-numeric, |lat|>90, |lon|>180
 * or exactly (0,0).
 */
export function parseLocation(lat: unknown, lon: unknown): LatLon | null {
  const la = toNumber(lat);
  const lo = toNumber(lon);
  if (la === null || lo === null) return null;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  if (la === 0 && lo === 0) return null;
  return { lat: la, lon: lo };
}

/** Bearing-like angle of p around origin, radians in [0, 2π), 0 = north, clockwise. Used for sweep order. */
export function sweepAngle(origin: LatLon, p: LatLon): number {
  const dy = p.lat - origin.lat;
  const dx = (p.lon - origin.lon) * Math.cos((origin.lat * Math.PI) / 180);
  let a = Math.atan2(dx, dy);
  if (a < 0) a += 2 * Math.PI;
  if (a >= 2 * Math.PI) a = 0;
  return a;
}
