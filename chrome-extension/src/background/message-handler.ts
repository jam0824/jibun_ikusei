import { ClassificationCache } from '@ext/lib/classification-cache'
import { classifyPage } from '@ext/lib/ai-classifier'
import { buildCacheKey } from '@ext/lib/cache-key'
import { getLocal } from '@ext/lib/storage'
import { createDefaultSettings } from '@ext/types/settings'
import type { ExtensionSettings } from '@ext/types/settings'
import type { ClassificationResult, ClassificationCacheEntry, PageInfo } from '@ext/types/browsing'

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
    } else if (message.type === 'OPEN_POPUP') {
      const popupUrl = chrome.runtime.getURL('popup.html')
      chrome.tabs.create({ url: popupUrl }).catch(() => {})
    }
  })

  // Sync in-memory tabClassifications when classificationCache is manually corrected
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.classificationCache) return
    const newStore = changes.classificationCache.newValue as Record<string, ClassificationCacheEntry> | undefined
    if (!newStore) return

    for (const [tabId, classification] of tabClassifications) {
      const updated = newStore[classification.cacheKey]
      if (updated && updated.source === 'manual') {
        tabClassifications.set(tabId, updated.result)
      }
    }
  })
}

