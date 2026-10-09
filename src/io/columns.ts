/** Header normalisation: trim + lower-case. */
export function normHeader(_h: string): string { throw new Error('not implemented'); }

/** First header matching lat|latitude and long|lon|lng|longitude. null if missing. Never guesses otherwise. */
export function detectLatLon(_headers: string[]): { lat: number | null; lon: number | null } { throw new Error('not implemented'); }

/** All column indexes whose header matches 'assigned to' | 'worker' | 'crew' | 'tech'. */
export function detectWorkerColumns(_headers: string[]): number[] { throw new Error('not implemented'); }

/** Index of a header named MANUAL_SEQ (case-insensitive, trimmed), or null. */
export function detectManualSeq(_headers: string[]): number | null { throw new Error('not implemented'); }
