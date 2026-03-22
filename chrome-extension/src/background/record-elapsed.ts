import { timeAccumulator } from './shared-instances'
import { getLocal } from '@ext/lib/storage'
import { buildCacheKey } from '@ext/lib/cache-key'
import type { ExtensionSettings } from '@ext/types/settings'
import type { ClassificationResult } from '@ext/types/browsing'

/** Extract hostname from a URL or strip www. from a domain */
function normalizeDomain(input: string): string {
  try {
    const url = new URL(input)
    const hostname = url.hostname
    return hostname.startsWith('www.') ? hostname.slice(4) : hostname
  } catch {
    return input.startsWith('www.') ? input.slice(4) : input
  }
}

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
  const domain = normalizeDomain(info.domain)
  const isBlocklisted = classification
    ? (settings?.blocklist?.some((blocked) => {
        const base = normalizeDomain(blocked)
        return domain === base || domain.endsWith('.' + base)
      }) ?? false)
    : false

  await timeAccumulator.addTime(
    info.domain,
    classification?.cacheKey ?? buildCacheKey({ domain: info.domain, url: info.url, title: '' }),
    info.elapsedSeconds,
    isGrowth,
    isBlocklisted,
    classification?.category ?? 'その他',
  )
}
