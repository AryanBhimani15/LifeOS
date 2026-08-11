/**
 * Fixed-window rate limiting.
 *
 * LIMITATION — READ THIS BEFORE DEPLOYING:
 * The default store is in-process memory. That is correct for local development
 * and a single-instance deployment, but it does NOT hold across a horizontally
 * scaled deployment (each instance keeps its own counters) and it resets on
 * restart. Swap in a shared store via `setRateLimitStore` before running more
 * than one instance. The interface is deliberately small so a Redis-backed
 * implementation is a drop-in.
 *
 * Documented in docs/security.md rather than left as a surprise.
 */

export interface RateLimitStore {
  /** Increments the counter for `key` and returns the new count plus window expiry. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

interface Entry {
  count: number;
  resetAt: number;
}

class MemoryStore implements RateLimitStore {
  private readonly buckets = new Map<string, Entry>();
  private lastSweep = Date.now();

  async hit(key: string, windowMs: number) {
    const now = Date.now();
    this.sweep(now);

    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      return fresh;
    }

    existing.count += 1;
    return existing;
  }

  /**
   * Drops expired buckets. Without this the map grows unbounded — one entry per
   * distinct key forever, which is a slow memory leak on a login endpoint where
   * the key contains an attacker-controlled email address.
   */
  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, entry] of this.buckets) {
      if (entry.resetAt <= now) this.buckets.delete(key);
    }
  }
}

let store: RateLimitStore = new MemoryStore();

export function setRateLimitStore(next: RateLimitStore) {
  store = next;
}

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function consumeRateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions,
): Promise<RateLimitResult> {
  const { count, resetAt } = await store.hit(key, windowMs);
  const allowed = count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
  };
}

/** Tuned per endpoint class; AI calls cost real money and quota, so they are tightest. */
export const RATE_LIMITS = {
  auth: { limit: 8, windowMs: 15 * 60 * 1000 },
  /**
   * Coarse bucket shared by all anonymous callers when forwarded headers are
   * not trusted. Deliberately generous: it exists to bound total abuse, not to
   * throttle individuals. A tight shared limit is a denial-of-service on
   * everyone else — see `registerIdentity` for the control that actually stops
   * targeted abuse.
   */
  anonymous: { limit: 240, windowMs: 60 * 60 * 1000 },
  /** Per-email signup limit, applied after the body is parsed. */
  registerIdentity: { limit: 5, windowMs: 60 * 60 * 1000 },
  read: { limit: 300, windowMs: 60 * 1000 },
  write: { limit: 120, windowMs: 60 * 1000 },
  ai: { limit: 20, windowMs: 60 * 60 * 1000 },
  search: { limit: 60, windowMs: 60 * 1000 },
  export: { limit: 3, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, RateLimitOptions>;
