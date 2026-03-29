import { getLocal, setLocal } from '@ext/lib/storage'
import type { ExtensionSettings } from '@ext/types/settings'
import type { BrowsingTimeSyncEntry, DailyProgress, WeeklyReport } from '@ext/types/browsing'
import { sendToastToActiveTab } from '@ext/lib/notifications'
import { timeAccumulator, syncQueue, classificationCache, apiClient } from './shared-instances'
import { evaluateProgress } from './quest-evaluator'
import { generateWeeklyReport } from './weekly-report-generator'
import { logActivity, flushActivityLogs, logError } from '@ext/lib/activity-logger'
import { isLoggedIn } from '@ext/lib/auth'

export async function setupAlarms(): Promise<void> {
  // Only create each alarm if it doesn't already exist.
  // chrome.alarms.create() replaces an existing alarm of the same name,
  // resetting its timer. Since the service worker restarts on every tab event,
  // unconditionally calling create() would prevent alarms from ever firing.
  if (!await chrome.alarms.get('periodic-sync'))
    chrome.alarms.create('periodic-sync', { periodInMinutes: 5 })
  if (!await chrome.alarms.get('daily-reset-check'))
    chrome.alarms.create('daily-reset-check', { periodInMinutes: 1 })
  if (!await chrome.alarms.get('weekly-report-gen'))
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

    // 2. Only replay if sync is enabled, server URL is configured, and user is logged in
    const settings = await getLocal<ExtensionSettings>('extensionSettings')
    if (!settings?.syncEnabled || !settings?.serverBaseUrl) return
    if (!await isLoggedIn()) return

    // 3. Sync browsing time data to backend
    await syncBrowsingTimes().catch((err) => logError(err, 'alarm:sync-browsing-times').catch(() => {}))

    // 4. Flush activity logs to backend
    await flushActivityLogs(apiClient).catch(() => {})

    // 5. Replay queued requests (including newly enqueued ones)
    await syncQueue.replay(async (req) => {
      if (req.method === 'PUT') {
        await apiClient.putUser(req.body as Record<string, unknown>)
      } else if (req.path === '/browsing-event') {
        // Atomic: Quest then Completion — if either fails, both retry
        const body = req.body as { quest: Record<string, unknown>; completion: Record<string, unknown> }
        await apiClient.postQuest(body.quest)
        await apiClient.postCompletion(body.completion)
      } else if (req.method === 'POST' && req.path === '/quests') {
        await apiClient.postQuest(req.body as Record<string, unknown>)
      } else if (req.method === 'POST') {
        await apiClient.postCompletion(req.body as Record<string, unknown>)
      }
    })
  } catch (err) {
    logError(err, 'alarm:periodic-sync').catch(() => {})
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

    // Log activity for all event types
    if (event.type === 'good_quest') {
      await logActivity('xp.gain', 'xp', { xp: event.xp, domain: event.domain, type: 'browsing_reward' })
    } else if (event.type === 'bad_quest') {
      await logActivity('xp.penalty', 'xp', { xp: event.xp, domain: event.domain, type: 'browsing_penalty' })
    } else if (event.type === 'warning') {
      await logActivity('browsing.warning', 'browsing', { domain: event.domain })
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

      // Enqueue Quest + Completion as a single atomic entry
      // If Quest POST fails, Completion won't be attempted; both retry together
      await syncQueue.enqueue({
        path: '/browsing-event',
        method: 'POST',
        body: {
          quest: {
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
          completion: {
            id: completionId,
            questId,
            clientRequestId: completionId,
            userXpAwarded: event.xp,
            completedAt: now,
            skillResolutionStatus: 'not_needed',
          },
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

function progressToSyncEntry(progress: DailyProgress): BrowsingTimeSyncEntry {
  const domains: BrowsingTimeSyncEntry['domains'] = {}
  let totalSeconds = 0

  for (const entry of Object.values(progress.domainTimes)) {
    if (entry.isBlocklisted) continue
    const existing = domains[entry.domain]
    if (existing) {
      existing.totalSeconds += entry.totalSeconds
    } else {
      domains[entry.domain] = {
        totalSeconds: entry.totalSeconds,
        category: entry.category,
        isGrowth: entry.isGrowth,
      }
    }
    totalSeconds += entry.totalSeconds
  }

  return { date: progress.date, domains, totalSeconds }
}

export async function syncBrowsingTimes(): Promise<void> {
  const settings = await getLocal<ExtensionSettings>('extensionSettings')
  if (!settings?.syncEnabled || !settings?.serverBaseUrl) return

  const today = await timeAccumulator.getDailyProgress()
  const history = (await getLocal<DailyProgress[]>('dailyProgressHistory')) ?? []
  const syncedDates = (await getLocal<string[]>('browsingTimeSyncedDates')) ?? []

  const entries: BrowsingTimeSyncEntry[] = []

  // Always send today's data (overwrite is fine)
  entries.push(progressToSyncEntry(today))

  // Send unsynced historical days
  for (const day of history) {
    if (!syncedDates.includes(day.date)) {
      entries.push(progressToSyncEntry(day))
    }
  }

  if (entries.length === 0) return

  await apiClient.postBrowsingTimes({ entries })
  await logActivity('browsing-time.sync', 'sync', { entryCount: entries.length })

  // Mark historical days as synced (not today — always re-send)
  const newSyncedDates = [
    ...new Set([...syncedDates, ...history.map((d) => d.date)]),
  ].slice(-14) // Keep last 14 dates
  await setLocal('browsingTimeSyncedDates', newSyncedDates)
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
