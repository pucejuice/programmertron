/** Header normalisation: trim + lower-case. */
export function normHeader(h: string): string {
  return String(h ?? '').trim().toLowerCase();
}

const LAT_NAMES = ['lat', 'latitude'];
const LON_NAMES = ['long', 'lon', 'lng', 'longitude'];
const WORKER_NAMES = ['assigned to', 'worker', 'crew', 'tech'];

function firstMatch(headers: string[], names: string[]): number | null {
  const i = headers.findIndex((h) => names.includes(normHeader(h)));
  return i < 0 ? null : i;
}

/** First header matching lat|latitude and long|lon|lng|longitude. null if missing. Never guesses otherwise. */
export function detectLatLon(headers: string[]): { lat: number | null; lon: number | null } {
  return { lat: firstMatch(headers, LAT_NAMES), lon: firstMatch(headers, LON_NAMES) };
}

/** All column indexes whose header matches 'assigned to' | 'worker' | 'crew' | 'tech'. */
export function detectWorkerColumns(headers: string[]): number[] {
  const out: number[] = [];
  headers.forEach((h, i) => {
    if (WORKER_NAMES.includes(normHeader(h))) out.push(i);
  });
  return out;
}

/** Index of a header named MANUAL_SEQ (case-insensitive, trimmed), or null. */
export function detectManualSeq(headers: string[]): number | null {
  return firstMatch(headers, ['manual_seq']);
}
