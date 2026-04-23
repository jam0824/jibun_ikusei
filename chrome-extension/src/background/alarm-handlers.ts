import { flushActivityLogs, logActivity, logError } from '@ext/lib/activity-logger'
import {
  BROWSING_SYNC_BACKLOG_KEY,
  LEGACY_BROWSING_SYNCED_DATES_KEY,
  progressToSyncEntry,
  sortSyncEntries,
} from '@ext/lib/browsing-sync'
import { isLoggedIn } from '@ext/lib/auth'
import { sendBrowsingSystemMessageToLilyDesktop } from '@ext/lib/lily-desktop-bridge'
import { getLocal, removeLocal, setLocal } from '@ext/lib/storage'
import { sendToastToActiveTab } from '@ext/lib/notifications'
import type {
  BrowsingTimeSyncBacklog,
  BrowsingTimeSyncEntry,
  DailyProgress,
  DomainTimeEntry,
  WeeklyReport,
} from '@ext/types/browsing'
import type { ExtensionSettings } from '@ext/types/settings'
import { evaluateProgress } from './quest-evaluator'
import { apiClient, classificationCache, syncQueue, timeAccumulator } from './shared-instances'
import { generateWeeklyReport } from './weekly-report-generator'

const PERIODIC_SYNC_INTERVAL_MINUTES = 1
const DAILY_RESET_CHECK_INTERVAL_MINUTES = 1
const WEEKLY_REPORT_INTERVAL_MINUTES = 60

async function ensureRecurringAlarm(name: string, periodInMinutes: number): Promise<void> {
  const existing = await chrome.alarms.get(name)
  if (existing?.periodInMinutes === periodInMinutes) {
    return
  }

  // Replace stale schedules on startup so existing users pick up new cadences.
  if (existing) {
    await chrome.alarms.clear(name)
  }
  chrome.alarms.create(name, { periodInMinutes })
}

export async function setupAlarms(): Promise<void> {
  await ensureRecurringAlarm('periodic-sync', PERIODIC_SYNC_INTERVAL_MINUTES)
  await ensureRecurringAlarm('daily-reset-check', DAILY_RESET_CHECK_INTERVAL_MINUTES)
  await ensureRecurringAlarm('weekly-report-gen', WEEKLY_REPORT_INTERVAL_MINUTES)
}

export async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  switch (alarm.name) {
    case 'periodic-sync':
      await handlePeriodicSync()
      break
    case 'daily-reset-check':
      await timeAccumulator.getDailyProgress()
      break
    case 'weekly-report-gen':
      await handleWeeklyReportGen()
      break
  }
}

async function handlePeriodicSync(): Promise<void> {
  try {
    await evaluateAndEnqueue()

    const settings = await getLocal<ExtensionSettings>('extensionSettings')
    if (!settings?.syncEnabled || !settings?.serverBaseUrl) return
    if (!await isLoggedIn()) return

    await syncBrowsingTimes().catch((err) => logError(err, 'alarm:sync-browsing-times').catch(() => {}))
    await flushActivityLogs(apiClient).catch(() => {})

    await syncQueue.replay(async (req) => {
      if (req.method === 'PUT') {
        await apiClient.putUser(req.body as Record<string, unknown>)
      } else if (req.path === '/browsing-event') {
        const body = req.body as {
          quest: Record<string, unknown>
          completion: Record<string, unknown>
        }
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
    if (notificationsEnabled) {
      await sendToastToActiveTab(event).catch(() => {})
    }

    if (event.type === 'good_quest') {
      await logActivity('xp.gain', 'xp', { xp: event.xp, domain: event.domain, type: 'browsing_reward' })
    } else if (event.type === 'bad_quest') {
      await logActivity('xp.penalty', 'xp', { xp: event.xp, domain: event.domain, type: 'browsing_penalty' })
    } else if (event.type === 'warning') {
      await logActivity('browsing.warning', 'browsing', { domain: event.domain })
    }

    if (event.type === 'warning') {
      if (notificationsEnabled) {
        const warningEntry = resolveWarningDomainEntry(progress, event.domain)
        await sendBrowsingSystemMessageToLilyDesktop({
          browsingType: 'warning',
          xp: event.xp,
          domain: event.domain,
          category: warningEntry?.category,
        })
      }
      continue
    }

    if (event.type !== 'good_quest' && event.type !== 'bad_quest') {
      continue
    }

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
        const entry = progress.domainTimes[event.topCacheKey]
        if (entry) {
          domain = entry.domain
          browsingCategory = entry.category
        }
      }
    }

    const messageTitle = title || undefined
    if (!title) {
      title = domain ? `${domain} での閲覧` : '閲覧活動'
    }

    const questId = crypto.randomUUID()
    const completionId = crypto.randomUUID()
    const completedAt = new Date().toISOString()

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
          completedAt,
          skillResolutionStatus: 'not_needed',
        },
      },
    })
    await sendBrowsingSystemMessageToLilyDesktop({
      browsingType: event.type === 'good_quest' ? 'good' : 'bad',
      xp: event.xp,
      title: messageTitle,
      domain: domain || undefined,
      category: browsingCategory || undefined,
    })
  }

  await timeAccumulator.updateProgress((currentProgress) => {
    for (const event of events) {
      if (event.type === 'good_quest') {
        currentProgress.goodQuestsCleared += 1
        currentProgress.xpGained += event.xp
        currentProgress.lastGoodRewardAtSeconds = currentProgress.goodBrowsingSeconds
      } else if (event.type === 'bad_quest') {
        currentProgress.badQuestsTriggered += 1
        currentProgress.xpLost += Math.abs(event.xp)
        currentProgress.lastBadPenaltyAtSeconds = currentProgress.badBrowsingSeconds
      } else if (event.type === 'warning' && event.domain) {
        if (!currentProgress.warningShownDomains.includes(event.domain)) {
          currentProgress.warningShownDomains.push(event.domain)
        }
      }
    }
  })
}

function resolveWarningDomainEntry(
  progress: DailyProgress,
  domain?: string,
): DomainTimeEntry | undefined {
  if (!domain) return undefined

  let topEntry: DomainTimeEntry | undefined
  for (const entry of Object.values(progress.domainTimes)) {
    if (entry.domain !== domain) continue
    if (!entry.isBlocklisted || entry.isGrowth) continue
    if (!topEntry || entry.totalSeconds > topEntry.totalSeconds) {
      topEntry = entry
    }
  }

  return topEntry
}

export async function syncBrowsingTimes(): Promise<void> {
  const settings = await getLocal<ExtensionSettings>('extensionSettings')
  if (!settings?.syncEnabled || !settings?.serverBaseUrl) return

  const today = await timeAccumulator.getDailyProgress()
  const backlog = (await getLocal<BrowsingTimeSyncBacklog>(BROWSING_SYNC_BACKLOG_KEY)) ?? {}
  const historicalEntries = sortSyncEntries(Object.values(backlog))
  const entries = [...historicalEntries, progressToSyncEntry(today)]

  if (entries.length === 0) return

  await apiClient.postBrowsingTimes({ entries })
  await logActivity('browsing-time.sync', 'sync', { entryCount: entries.length })

  if (historicalEntries.length > 0) {
    const remainingBacklog = { ...backlog }
    for (const entry of historicalEntries) {
      delete remainingBacklog[entry.date]
    }
    await setLocal(BROWSING_SYNC_BACKLOG_KEY, remainingBacklog)
  }

  await removeLocal(LEGACY_BROWSING_SYNCED_DATES_KEY)
}

function getWeekKey(): string {
  const now = new Date()
  const jan1 = new Date(now.getFullYear(), 0, 1)
  const days = Math.floor((now.getTime() - jan1.getTime()) / (24 * 60 * 60 * 1000))
  const weekNum = Math.ceil((days + jan1.getDay() + 1) / 7)
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

async function handleWeeklyReportGen(): Promise<void> {
  if (new Date().getDay() !== 1) return

  const weekKey = getWeekKey()
  const existing = await getLocal<WeeklyReport>('weeklyReport')
  if (existing?.weekKey === weekKey) return

  const history = (await getLocal<DailyProgress[]>('dailyProgressHistory')) ?? []
  const report = generateWeeklyReport(history, weekKey)
  await setLocal('weeklyReport', report)
}
