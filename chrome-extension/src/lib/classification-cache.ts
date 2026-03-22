import { getLocal, setLocal } from '@ext/lib/storage'
import type { ClassificationCacheEntry, ClassificationResult } from '@ext/types/browsing'

const STORAGE_KEY = 'classificationCache'
const TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

type CacheStore = Record<string, ClassificationCacheEntry>

export class ClassificationCache {
  /** Get a cached classification result. Returns null if not found or expired. */
  async get(cacheKey: string): Promise<ClassificationCacheEntry | null> {
    const store = await this.loadStore()
    const entry = store[cacheKey]
    if (!entry) return null

    // Check TTL
    if (new Date(entry.expiresAt).getTime() <= Date.now()) {
      delete store[cacheKey]
      await this.saveStore(store)
      return null
    }

    return entry
  }

  /** Store a classification result in the cache. */
  async set(
    cacheKey: string,
    result: ClassificationResult,
    source: 'ai' | 'manual' | 'server',
  ): Promise<void> {
    const store = await this.loadStore()
    const now = new Date()
    store[cacheKey] = {
      result,
      source,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
    }
    await this.saveStore(store)
  }

  /** Remove a cached classification entry. */
  async delete(cacheKey: string): Promise<void> {
    const store = await this.loadStore()
    delete store[cacheKey]
    await this.saveStore(store)
  }

  private async loadStore(): Promise<CacheStore> {
    return (await getLocal<CacheStore>(STORAGE_KEY)) ?? {}
  }

  private async saveStore(store: CacheStore): Promise<void> {
    await setLocal(STORAGE_KEY, store)
  }
}
