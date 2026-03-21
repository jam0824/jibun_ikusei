import { SyncQueue } from '@ext/lib/sync-queue'
import { createApiClient } from '@ext/lib/api-client'
import { TimeAccumulator } from './time-accumulator'
import { evaluateProgress } from './quest-evaluator'
import type { QuestEvent } from './quest-evaluator'

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
    // 1. Evaluate progress and generate quest events
    await evaluateAndEnqueue()

    // 2. Replay queued requests (including newly enqueued ones)
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

async function evaluateAndEnqueue(): Promise<void> {
  const progress = await timeAccumulator.getDailyProgress()
  const events = evaluateProgress(progress, [])

  if (events.length === 0) return

  // Enqueue each XP event as a POST /completions request
  for (const event of events) {
    if (event.type === 'good_quest' || event.type === 'bad_quest') {
      await syncQueue.enqueue({
        path: '/completions',
        method: 'POST',
        body: {
          type: event.type,
          userXpAwarded: event.xp,
          source: 'browsing',
          completedAt: new Date().toISOString(),
        },
      })
    }
  }

  // Update DailyProgress to reflect processed events
  await timeAccumulator.updateProgress((p) => {
    for (const event of events) {
      if (event.type === 'good_quest') {
        p.goodQuestsCleared += 1
        p.xpGained += event.xp
        p.lastGoodRewardAtSeconds = p.goodBrowsingSeconds
      } else if (event.type === 'bad_quest') {
        p.badQuestsTriggered += 1
        p.xpLost += Math.abs(event.xp)
        p.lastBadPenaltyAtSeconds = p.badBrowsingSeconds
      } else if (event.type === 'warning' && event.domain) {
        if (!p.warningShownDomains.includes(event.domain)) {
          p.warningShownDomains.push(event.domain)
        }
      }
    }
  })
}
