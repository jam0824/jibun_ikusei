import { TabTracker } from './tab-tracker'
import type { TabElapsedResult } from './tab-tracker'
import { setupAlarms, handleAlarm } from './alarm-handlers'
import { getTabClassification, setupMessageListener } from './message-handler'
import { recordElapsed } from './record-elapsed'

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
