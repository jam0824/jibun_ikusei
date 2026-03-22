import { timeAccumulator } from './shared-instances'
import { getLocal } from '@ext/lib/storage'
import { buildCacheKey } from '@ext/lib/cache-key'
import type { ExtensionSettings } from '@ext/types/settings'
import type { ClassificationResult } from '@ext/types/browsing'

interface ElapsedInfo {
  tabId: number
  domain: string
  url: string
  elapsedSeconds: number
}

export async function recordElapsed(
  info: ElapsedInfo,
  classification: ClassificationResult | undefined,
): Promise<void> {
  if (info.elapsedSeconds <= 0 || !info.domain) return

  const isGrowth = classification?.isGrowth ?? false

  const settings = await getLocal<ExtensionSettings>('extensionSettings')
  // Don't count as blocklisted until classification is confirmed
  const isBlocklisted = classification
    ? (settings?.blocklist?.includes(info.domain) ?? false)
    : false

  await timeAccumulator.addTime(
    info.domain,
    classification?.cacheKey ?? buildCacheKey({ domain: info.domain, url: info.url, title: '' }),
    info.elapsedSeconds,
    isGrowth,
    isBlocklisted,
  )
}
