import { SyncQueue } from '@ext/lib/sync-queue'
import { createApiClient } from '@ext/lib/api-client'
import { TimeAccumulator } from './time-accumulator'

const syncQueue = new SyncQueue()
const apiClient = createApiClient()
const timeAccumulator = new TimeAccumulator()

export function setupAlarms(): void {
  // Periodic sync every 5 minutes
  chrome.alarms.create('periodic-sync', { periodInMinutes: 5 })

  // Daily reset check every minute (checks date boundary)
  chrome.alarms.create('daily-reset-check', { periodInMinutes: 1 })
}

export async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  switch (alarm.name) {
    case 'periodic-sync':
      await handlePeriodicSync()
      break
    case 'daily-reset-check':
      // getDailyProgress handles date boundary reset automatically
      await timeAccumulator.getDailyProgress()
      break
  }
}

async function handlePeriodicSync(): Promise<void> {
  try {
    await syncQueue.replay(async (req) => {
      if (req.method === 'PUT') {
        await apiClient.putUser(req.body as Record<string, unknown>)
      } else if (req.method === 'POST') {
        await apiClient.postCompletion(req.body as Record<string, unknown>)
      }
    })
  } catch {
    // Will retry on next alarm
  }
}
