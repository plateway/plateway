const cache = new Map<string, Promise<unknown>>();

export class ServiceError extends Error {
  constructor(
    public service: string,
    message: string,
  ) {
    super(message);
  }
}

async function once(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * JSON fetch with one retry and an in-memory cache, so switching mode or
 * reordering jobs does not hit the free services again for the same question.
 */
export function getJson<T>(url: string, init?: RequestInit, opts: { timeoutMs?: number; retries?: number } = {}): Promise<T> {
  const key = url + (init?.body ? `#${String(init.body)}` : '');
  const hit = cache.get(key);
  if (hit) return hit as Promise<T>;
  const run = (async () => {
    const retries = opts.retries ?? 1;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await once(url, init, opts.timeoutMs ?? 30_000);
      } catch (err) {
        lastErr = err;
        if (attempt < retries) await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
      }
    }
    throw lastErr;
  })();
  cache.set(key, run);
  run.catch(() => cache.delete(key));
  return run as Promise<T>;
}
