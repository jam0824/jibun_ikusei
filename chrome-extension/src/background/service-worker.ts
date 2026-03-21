import { TabTracker } from './tab-tracker'
import { TimeAccumulator } from './time-accumulator'
import { setupAlarms, handleAlarm } from './alarm-handlers'

const tabTracker = new TabTracker()
const timeAccumulator = new TimeAccumulator()

/** Record elapsed time from tab tracker result */
async function recordElapsed(result: ReturnType<TabTracker['onTabActivated']>) {
  if (!result || result.elapsedSeconds <= 0 || !result.domain) return
  // For now, treat all browsing as unclassified (isGrowth=false, isBlocklisted=false)
  // Classification will be integrated in Phase 2
  await timeAccumulator.addTime(
    result.domain,
    `${result.domain}:${new URL(result.url).pathname}`,
    result.elapsedSeconds,
    false,
    false,
  )
}

// Tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId)
    if (!tab.url) return
    const result = tabTracker.onTabActivated(activeInfo.tabId, tab.url)
    await recordElapsed(result)
  } catch {
    // Tab may have been closed
  }
})

// Tab URL change
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return
  try {
    const result = tabTracker.onUrlChanged(tabId, changeInfo.url)
    await recordElapsed(result)
  } catch {
    // Ignore
  }
})

// Window focus change
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    const result = tabTracker.onWindowBlur()
    await recordElapsed(result)
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
    await recordElapsed(result)
  } else {
    await handleAlarm(alarm)
  }
})
