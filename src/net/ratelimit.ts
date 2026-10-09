/** Serialises calls so at most one starts per intervalMs (default 1000). Per host key. */
export function rateLimited<T>(_key: string, _fn: () => Promise<T>, _intervalMs?: number): Promise<T> { throw new Error('not implemented'); }
