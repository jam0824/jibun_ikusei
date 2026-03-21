import { ClassificationCache } from '@ext/lib/classification-cache'
import { classifyPage } from '@ext/lib/ai-classifier'
import { getLocal } from '@ext/lib/storage'
import { createDefaultSettings } from '@ext/types/settings'
import type { ExtensionSettings } from '@ext/types/settings'
import type { ClassificationResult, PageInfo } from '@ext/types/browsing'

const classificationCache = new ClassificationCache()

// In-memory map of tab ID → classification result
// Rebuilt naturally when content scripts send PAGE_INFO after service worker restart
const tabClassifications = new Map<number, ClassificationResult>()

export function getTabClassification(tabId: number): ClassificationResult | undefined {
  return tabClassifications.get(tabId)
}

export function clearTabClassification(tabId: number): void {
  tabClassifications.delete(tabId)
}

export async function handlePageInfo(tabId: number, pageInfo: PageInfo): Promise<void> {
  const settings = (await getLocal<ExtensionSettings>('extensionSettings')) ?? createDefaultSettings()

  // 1. Check classification cache
  const cacheKey = buildCacheKey(pageInfo)
  const cached = await classificationCache.get(cacheKey)
  if (cached) {
    tabClassifications.set(tabId, cached.result)
    return
  }

  // 2. Run AI classification (falls back to 'その他' if no API key)
  const result = await classifyPage(pageInfo, settings)

  // 3. Cache the result
  await classificationCache.set(cacheKey, result, 'ai')

  // 4. Store in memory for this tab
  tabClassifications.set(tabId, result)
}

export function setupMessageListener(): void {
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.type === 'PAGE_INFO' && sender.tab?.id != null) {
      handlePageInfo(sender.tab.id, message.payload as PageInfo).catch(() => {
        // Classification failure is non-fatal — tab will use default (その他)
      })
    }
  })
}

function buildCacheKey(pageInfo: PageInfo): string {
  try {
    const pathname = new URL(pageInfo.url).pathname
    return `${pageInfo.domain}:${pathname}`
  } catch {
    return `${pageInfo.domain}:/`
  }
}
