import { TabTracker } from './tab-tracker'
import type { TabElapsedResult } from './tab-tracker'
import { setupAlarms, handleAlarm } from './alarm-handlers'
import { getTabClassification, setupMessageListener } from './message-handler'
import { recordElapsed } from './record-elapsed'
import { logError } from '@ext/lib/activity-logger'
import { sendChromeAudibleTabsToLilyDesktop } from '@ext/lib/lily-desktop-bridge'
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
  } catch {
    // Tab may have been closed
  }
})

// Tab URL change / audible state change
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  try {
    if (changeInfo.url) {
      const result = tabTracker.onUrlChanged(tabId, changeInfo.url)
      await handleElapsed(result)
    }
    if (changeInfo.url || 'audible' in changeInfo) {
      await syncAudibleTabsSnapshot()
    }
  } catch {
    // Ignore
  }
})

chrome.tabs.onRemoved.addListener(async () => {
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
    await syncAudibleTabsSnapshot()
  } else {
    await handleAlarm(alarm)
  }
})
