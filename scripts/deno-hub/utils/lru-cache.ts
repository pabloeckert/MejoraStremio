/**
 * lru-cache.ts — Implementación canónica de caché en memoria acotada (Bounded LRU Cache)
 * con desalojo por antigüedad y soporte estricto de TTL.
 *
 * Previene el desbordamiento de memoria (Out-of-Memory / OOM) en Deno Deploy (512MB RAM límite),
 * reemplazando estructuras Maps infinitas en memoria.
 */

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class BoundedLruCache<K, V> {
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;
  private readonly map = new Map<K, CacheEntry<V>>();

  constructor(maxEntries = 100, defaultTtlMs = 60 * 60 * 1000) {
    this.maxEntries = Math.max(1, maxEntries);
    this.defaultTtlMs = Math.max(1, defaultTtlMs);
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }

    // Re-insertar al final para marcar como recientemente usado (LRU)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  set(key: K, value: V, ttlMs?: number): void {
    const ttl = ttlMs && ttlMs > 0 ? ttlMs : this.defaultTtlMs;
    const expiresAt = Date.now() + ttl;

    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      // Desalojar el elemento más antiguo (primer elemento del Map)
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }

    this.map.set(key, { value, expiresAt });
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
