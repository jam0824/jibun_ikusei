import { TabTracker } from './tab-tracker'
import type { TabElapsedResult } from './tab-tracker'
import { setupAlarms, handleAlarm } from './alarm-handlers'
import {
  clearTabClassification,
  clearTabPageInfo,
  getTabClassification,
  getTabPageInfo,
  setupMessageListener,
} from './message-handler'
import { recordElapsed } from './record-elapsed'
import { logError } from '@ext/lib/activity-logger'
import {
  sendBrowserHeartbeatToLilyDesktop,
  sendBrowserPageChangedToLilyDesktop,
  sendChromeAudibleTabsToLilyDesktop,
  type BrowserActionLogTrigger,
} from '@ext/lib/lily-desktop-bridge'
import { timeAccumulator } from './shared-instances'

self.addEventListener('error', (event) => {
  logError(event.error ?? event.message, 'service-worker:error').catch(() => {})
})

self.addEventListener('unhandledrejection', (event) => {
  logError(event.reason, 'service-worker:unhandledrejection').catch(() => {})
})

const tabTracker = new TabTracker()
let hadAudibleTabs = false

function normalizeAudibleDomain(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    const hostname = parsed.hostname.toLowerCase()
    return hostname.startsWith('www.') ? hostname.slice(4) : hostname
  } catch {
    return null
  }
}

async function collectAudibleTabsSnapshot(): Promise<Array<{ tabId: number; domain: string }>> {
  const tabs = await chrome.tabs.query({ audible: true })
  return tabs.flatMap((tab) => {
    if (tab.id == null || !tab.url) return []
    const domain = normalizeAudibleDomain(tab.url)
    if (!domain) return []
    return [{ tabId: tab.id, domain }]
  })
}

function isTrackableHttpUrl(url?: string | null): url is string {
  return Boolean(url && (url.startsWith('http://') || url.startsWith('https://')))
}

function extractBrowserDomain(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.hostname
  } catch {
    return null
  }
}

function buildBrowserMetadata(tabId: number, trigger: BrowserActionLogTrigger, elapsedSeconds?: number) {
  const classification = getTabClassification(tabId)
  return {
    trigger,
    ...(typeof elapsedSeconds === 'number' ? { elapsedSeconds } : {}),
    category: classification?.category ?? null,
    isGrowth: classification?.isGrowth ?? null,
    cacheKey: classification?.cacheKey ?? null,
  }
}

async function sendBrowserPageChangedForTab(
  tab: chrome.tabs.Tab,
  trigger: Exclude<BrowserActionLogTrigger, 'flush'>,
): Promise<void> {
  if (tab.id == null || tab.incognito || !isTrackableHttpUrl(tab.url)) {
    return
  }

  const pageInfo = getTabPageInfo(tab.id)
  const url = pageInfo?.url ?? tab.url
  const domain = pageInfo?.domain ?? extractBrowserDomain(url)
  if (!domain) {
    return
  }

  await sendBrowserPageChangedToLilyDesktop({
    tabId: tab.id,
    url,
    domain,
    title: pageInfo?.title ?? tab.title ?? null,
    ...buildBrowserMetadata(tab.id, trigger),
  })
}

async function sendBrowserHeartbeatForElapsed(result: TabElapsedResult | null): Promise<void> {
  if (!result || result.elapsedSeconds <= 0) {
    return
  }

  const pageInfo = getTabPageInfo(result.tabId)
  let url = pageInfo?.url ?? result.url
  let domain = pageInfo?.domain ?? result.domain
  let title = pageInfo?.title ?? null
  let incognito = false

  try {
    const tab = await chrome.tabs.get(result.tabId)
    url = pageInfo?.url ?? tab.url ?? url
    domain = pageInfo?.domain ?? extractBrowserDomain(url) ?? domain
    title = pageInfo?.title ?? tab.title ?? title
    incognito = tab.incognito ?? false
  } catch {
    // Tab may have been closed. Fall back to the tracked context.
  }

  if (incognito || !isTrackableHttpUrl(url) || !domain) {
    return
  }

  await sendBrowserHeartbeatToLilyDesktop({
    tabId: result.tabId,
    url,
    domain,
    title,
    ...buildBrowserMetadata(result.tabId, 'flush', result.elapsedSeconds),
  })
}

export async function syncAudibleTabsSnapshot(): Promise<void> {
  try {
    const audibleTabs = await collectAudibleTabsSnapshot()
    const hasAudibleTabs = audibleTabs.length > 0

    if (hasAudibleTabs) {
      await sendChromeAudibleTabsToLilyDesktop(audibleTabs)
    } else if (hadAudibleTabs) {
      await sendChromeAudibleTabsToLilyDesktop([])
    }

    hadAudibleTabs = hasAudibleTabs
  } catch {
    // Ignore — tabs API or bridge send may fail
  }
}

/** Record elapsed time from tab tracker result, using classification data */
async function handleElapsed(result: TabElapsedResult | null) {
  if (!result || !result.domain) return
  const classification = getTabClassification(result.tabId)
  await recordElapsed(
    { tabId: result.tabId, domain: result.domain, url: result.url, elapsedSeconds: result.elapsedSeconds },
    classification,
  )
}

// Listen for PAGE_INFO messages from content scripts
setupMessageListener()

// Tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId)
    if (!tab.url) return
    const result = tabTracker.onTabActivated(activeInfo.tabId, tab.url)
    await handleElapsed(result)
    await sendBrowserPageChangedForTab(tab, 'tab_activated')
  } catch {
    // Tab may have been closed
  }
})

// Tab URL change / audible state change
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  try {
    if (changeInfo.url) {
      const result = tabTracker.onUrlChanged(tabId, changeInfo.url)
      await handleElapsed(result)
      if (tab.active) {
        await sendBrowserPageChangedForTab(tab, 'url_changed')
      }
    }
    if (changeInfo.url || 'audible' in changeInfo) {
      await syncAudibleTabsSnapshot()
    }
  } catch {
    // Ignore
  }
})

chrome.tabs.onRemoved.addListener(async (tabId) => {
  clearTabClassification(tabId)
  clearTabPageInfo(tabId)
  await syncAudibleTabsSnapshot()
})

// Window focus change
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    const result = tabTracker.onWindowBlur()
    await handleElapsed(result)
  } else {
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId })
      if (tab?.id && tab.url) {
        tabTracker.onWindowFocus(tab.id, tab.url)
        await sendBrowserPageChangedForTab(tab, 'window_focus')
      }
    } catch {
      // Ignore
    }
  }
})

// On service worker startup, request PAGE_INFO from active tabs
// to rebuild the in-memory tabClassifications map
export async function recoverClassifications(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    for (const tab of tabs) {
      if (tab.id && tab.url?.startsWith('http')) {
        chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_PAGE_INFO' }).catch(() => {
          // Content script may not be injected (e.g. on restricted pages)
        })
      }
    }
  } catch {
    // Ignore — tabs API may fail during startup
  }
}
recoverClassifications()

// On service worker startup, resume tracking for the currently active tab.
// When Chrome terminates and restarts the SW, tabTracker loses its state.
// Without this, browsing time is not recorded until the next tab/URL event.
export async function recoverTabTracking(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id && tab.url?.startsWith('http')) {
      tabTracker.onWindowFocus(tab.id, tab.url)
    }
  } catch {
    // Ignore — tabs API may fail during startup
  }
}
recoverTabTracking()
syncAudibleTabsSnapshot()

// Popup requests a flush before reading progress, so displayed time is up-to-date
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'FLUSH_AND_GET_PROGRESS') return
  ;(async () => {
    const result = tabTracker.flush()
    await handleElapsed(result)
    await sendBrowserHeartbeatForElapsed(result)
    await timeAccumulator.getDailyProgress()
    sendResponse({ ok: true })
  })().catch(() => sendResponse({ ok: false }))
  return true
})

// Periodic flush via alarm (every 30 seconds) — only create if not already running
// Set up periodic sync and daily reset alarms
// Wrapped in IIFE because top-level await is not available in the build target
;(async () => {
  if (!await chrome.alarms.get('flush-tracker'))
    chrome.alarms.create('flush-tracker', { periodInMinutes: 0.5 })
  await setupAlarms()
})()

// Dispatch all alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'flush-tracker') {
    const result = tabTracker.flush()
    await handleElapsed(result)
    await sendBrowserHeartbeatForElapsed(result)
    await syncAudibleTabsSnapshot()
  } else {
    await handleAlarm(alarm)
  }
})
