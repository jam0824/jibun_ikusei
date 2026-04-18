import { classifyPage } from '@ext/lib/ai-classifier'
import { buildCacheKey } from '@ext/lib/cache-key'
import { ClassificationCache } from '@ext/lib/classification-cache'
import { sendClassificationToastToTab } from '@ext/lib/notifications'
import { getLocal } from '@ext/lib/storage'
import type { ClassificationCacheEntry, ClassificationResult, PageInfo } from '@ext/types/browsing'
import { createDefaultSettings, type ExtensionSettings } from '@ext/types/settings'
import { clearSyncState, resetExtensionData } from './reset-state'
import { timeAccumulator } from './shared-instances'

const classificationCache = new ClassificationCache()

// Rebuilt naturally when content scripts send PAGE_INFO after service worker restart.
const tabClassifications = new Map<number, ClassificationResult>()
const tabPageInfos = new Map<number, PageInfo>()

export function getTabClassification(tabId: number): ClassificationResult | undefined {
  return tabClassifications.get(tabId)
}

export function getTabPageInfo(tabId: number): PageInfo | undefined {
  return tabPageInfos.get(tabId)
}

export function clearTabClassification(tabId: number): void {
  tabClassifications.delete(tabId)
}

export function clearTabPageInfo(tabId: number): void {
  tabPageInfos.delete(tabId)
}

export async function handlePageInfo(tabId: number, pageInfo: PageInfo): Promise<void> {
  const settings = (await getLocal<ExtensionSettings>('extensionSettings')) ?? createDefaultSettings()
  const notificationsEnabled = settings.notificationsEnabled ?? true
  tabPageInfos.set(tabId, pageInfo)

  const cacheKey = buildCacheKey(pageInfo)
  const cached = await classificationCache.get(cacheKey)
  if (cached) {
    tabClassifications.set(tabId, cached.result)
    if (notificationsEnabled) {
      await sendClassificationToastToTab(tabId, cached.result.category, cached.result.isGrowth).catch(() => {})
    }
    return
  }

  const result = await classifyPage(pageInfo, settings)
  await classificationCache.set(cacheKey, result, 'ai')
  tabClassifications.set(tabId, result)

  if (notificationsEnabled && result.confidence > 0) {
    await sendClassificationToastToTab(tabId, result.category, result.isGrowth).catch(() => {})
  }
}

export function setupMessageListener(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PAGE_INFO' && sender.tab?.id != null) {
      handlePageInfo(sender.tab.id, message.payload as PageInfo).catch(() => {})
      return
    }

    if (message.type === 'OPEN_POPUP') {
      const popupUrl = chrome.runtime.getURL('popup.html')
      chrome.tabs.create({ url: popupUrl }).catch(() => {})
      return
    }

    if (message.type === 'ENSURE_TODAY_PROGRESS') {
      timeAccumulator.getDailyProgress()
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }))
      return true
    }

    if (message.type === 'CLEAR_SYNC_STATE') {
      clearSyncState()
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }))
      return true
    }

    if (message.type === 'RESET_EXTENSION_DATA') {
      resetExtensionData()
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }))
      return true
    }
  })

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.classificationCache) return

    const newStore = changes.classificationCache.newValue as
      | Record<string, ClassificationCacheEntry>
      | undefined

    if (!newStore) {
      tabClassifications.clear()
      return
    }

    for (const [tabId, classification] of tabClassifications) {
      const updated = newStore[classification.cacheKey]
      if (updated && updated.source === 'manual') {
        tabClassifications.set(tabId, updated.result)
      }
    }
  })
}
