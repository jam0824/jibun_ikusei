import { getLocal, setLocal } from '@ext/lib/storage'
import type { ExtensionSettings } from '@ext/types/settings'
import type { DailyProgress, WeeklyReport } from '@ext/types/browsing'
import { sendToastToActiveTab } from '@ext/lib/notifications'
import { timeAccumulator, syncQueue, classificationCache, apiClient } from './shared-instances'
import { evaluateProgress } from './quest-evaluator'
import { generateWeeklyReport } from './weekly-report-generator'

export function setupAlarms(): void {
  // Periodic sync every 5 minutes
  chrome.alarms.create('periodic-sync', { periodInMinutes: 5 })

  // Daily reset check every minute (checks date boundary)
  chrome.alarms.create('daily-reset-check', { periodInMinutes: 1 })

  // Weekly report generation check every hour
  chrome.alarms.create('weekly-report-gen', { periodInMinutes: 60 })
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
    case 'weekly-report-gen':
      await handleWeeklyReportGen()
      break
  }
}

async function handlePeriodicSync(): Promise<void> {
  try {
    // 1. Evaluate progress and generate quest events
    await evaluateAndEnqueue()

    // 2. Only replay if sync is enabled and server URL is configured
    const settings = await getLocal<ExtensionSettings>('extensionSettings')
    if (!settings?.syncEnabled || !settings?.serverBaseUrl) return

    // 3. Replay queued requests (including newly enqueued ones)
    await syncQueue.replay(async (req) => {
      if (req.method === 'PUT') {
        await apiClient.putUser(req.body as Record<string, unknown>)
      } else if (req.method === 'POST' && req.path === '/quests') {
        await apiClient.postQuest(req.body as Record<string, unknown>)
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

  const settings = await getLocal<ExtensionSettings>('extensionSettings')
  const notificationsEnabled = settings?.notificationsEnabled ?? true

  for (const event of events) {
    // Send toast notification
    if (notificationsEnabled) {
      await sendToastToActiveTab(event).catch(() => {})
    }

    // Enqueue Quest + Completion pair for XP events
    if (event.type === 'good_quest' || event.type === 'bad_quest') {
      // Look up classification cache for quest title and context
      let title = ''
      let domain = ''
      let browsingCategory = ''

      if (event.topCacheKey) {
        const cached = await classificationCache.get(event.topCacheKey)
        if (cached) {
          title = cached.result.suggestedQuestTitle
          browsingCategory = cached.result.category
          domain = cached.result.cacheKey.split(':')[0]
        } else {
          // Fallback: extract domain from domainTimes
          const entry = progress.domainTimes[event.topCacheKey]
          if (entry) {
            domain = entry.domain
            browsingCategory = entry.category
          }
        }
      }

      if (!title) {
        title = domain ? `${domain} での閲覧` : '閲覧活動'
      }

      const questId = crypto.randomUUID()
      const completionId = crypto.randomUUID()
      const now = new Date().toISOString()

      // Step A: Enqueue quest creation
      await syncQueue.enqueue({
        path: '/quests',
        method: 'POST',
        body: {
          id: questId,
          title,
          description: `${domain || '不明なサイト'} での閲覧（自動記録）`,
          questType: 'one_time',
          xpReward: event.xp,
          category: browsingCategory || undefined,
          source: 'browsing',
          domain: domain || undefined,
          browsingCategory: browsingCategory || undefined,
          browsingType: event.type === 'good_quest' ? 'good' : 'bad',
          skillMappingMode: 'fixed',
          status: 'completed',
          privacyMode: 'normal',
          pinned: false,
        },
      })

      // Step B: Enqueue completion creation
      await syncQueue.enqueue({
        path: '/completions',
        method: 'POST',
        body: {
          id: completionId,
          questId,
          clientRequestId: completionId,
          userXpAwarded: event.xp,
          completedAt: now,
          skillResolutionStatus: 'not_needed',
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

function getWeekKey(): string {
  const now = new Date()
  const jan1 = new Date(now.getFullYear(), 0, 1)
  const days = Math.floor((now.getTime() - jan1.getTime()) / (24 * 60 * 60 * 1000))
  const weekNum = Math.ceil((days + jan1.getDay() + 1) / 7)
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

async function handleWeeklyReportGen(): Promise<void> {
  // Only generate on Monday (day 1)
  if (new Date().getDay() !== 1) return

  const weekKey = getWeekKey()
  const existing = await getLocal<WeeklyReport>('weeklyReport')
  if (existing?.weekKey === weekKey) return // Already generated this week

  const history = (await getLocal<DailyProgress[]>('dailyProgressHistory')) ?? []
  const report = generateWeeklyReport(history, weekKey)
  await setLocal('weeklyReport', report)
}
