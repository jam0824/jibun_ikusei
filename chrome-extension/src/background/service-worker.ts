import { TabTracker } from './tab-tracker'
import type { TabElapsedResult } from './tab-tracker'
import { setupAlarms, handleAlarm } from './alarm-handlers'
import { getTabClassification, setupMessageListener } from './message-handler'
import { recordElapsed } from './record-elapsed'
import { logError } from '@ext/lib/activity-logger'

self.addEventListener('error', (event) => {
  logError(event.error ?? event.message, 'service-worker:error').catch(() => {})
})

self.addEventListener('unhandledrejection', (event) => {
  logError(event.reason, 'service-worker:unhandledrejection').catch(() => {})
})

const tabTracker = new TabTracker()

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

// Tab URL change
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return
  try {
    const result = tabTracker.onUrlChanged(tabId, changeInfo.url)
    await handleElapsed(result)
  } catch {
    // Ignore
  }
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

// Periodic flush via alarm (every 30 seconds)
chrome.alarms.create('flush-tracker', { periodInMinutes: 0.5 })

// Set up periodic sync and daily reset alarms
setupAlarms()

// Dispatch all alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'flush-tracker') {
    const result = tabTracker.flush()
    await handleElapsed(result)
  } else {
    await handleAlarm(alarm)
  }
})
