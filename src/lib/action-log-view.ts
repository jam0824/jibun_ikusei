import type {
  ActivitySession,
  DailyActivityLog,
  OpenLoop,
  RawEvent,
  WeeklyActivityReview,
} from '@/domain/action-log-types'
import type { AiConfig, UserSettings } from '@/domain/types'
import {
  deleteActionLogRange,
  getActionLogDailyActivityLog,
  getActionLogDailyActivityLogs,
  getActionLogOpenLoops,
  getActionLogRawEvents,
  getActionLogSessions,
  putActionLogSessionHidden,
  putActionLogDailyActivityLog,
  putActionLogWeeklyActivityReview,
  getActionLogWeeklyActivityReview,
  getActionLogWeeklyActivityReviews,
} from '@/lib/api-client'
import { generateDailyActivityLog, generateWeeklyActivityReview } from '@/lib/ai'
import { getDayKey, getWeekKey, parseDate, toJstIso } from '@/lib/date'

export type ActivityLogViewMode = 'session' | 'event'

export interface ActivityDayViewData {
  dateKey: string
  sessions: ActivitySession[]
  rawEvents: RawEvent[]
  dailyLog: DailyActivityLog | null
  openLoops: OpenLoop[]
}

export interface ActivityCalendarDay {
  dateKey: string
  dailyLog: DailyActivityLog | null
}

export interface UsageSummaryItem {
  label: string
  minutes: number
}

export interface ActivityWeekViewData {
  review: WeeklyActivityReview | null
  openLoops: OpenLoop[]
  topApps: UsageSummaryItem[]
  topDomains: UsageSummaryItem[]
}

export interface ActivitySearchResult {
  sessions: ActivitySession[]
  openLoops: OpenLoop[]
}

export interface ActivitySearchParams {
  from: string
  to: string
  keyword: string
  categories?: string[]
  apps?: string[]
  domains?: string[]
  includeOpenLoops?: boolean
  includeHidden?: boolean
}

export interface ActionLogExportBundle {
  rawEvents: RawEvent[]
  sessions: ActivitySession[]
  dailyLogs: DailyActivityLog[]
  weeklyReviews: WeeklyActivityReview[]
  openLoops: OpenLoop[]
  meta: {
    from: string
    to: string
    exportedAt: string
    timezone: 'Asia/Tokyo'
  }
}

function toMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function getTodayDateKeyJst() {
  return getDayKey(new Date())
}

export function getYesterdayDateKeyJst(referenceDate = new Date()) {
  const yesterday = new Date(referenceDate)
  yesterday.setDate(yesterday.getDate() - 1)
  return getDayKey(yesterday)
}

export function getCurrentWeekKeyJst() {
  return getWeekKey(new Date())
}

export function getPreviousWeekKeyJst(referenceDate = new Date()) {
  const previousWeek = new Date(referenceDate)
  previousWeek.setDate(previousWeek.getDate() - 7)
  return getWeekKey(previousWeek)
}

export function getPreviousWeekYearJst(referenceDate = new Date()) {
  return Number(getPreviousWeekKeyJst(referenceDate).slice(0, 4))
}

export function getCurrentMonthKeyJst() {
  return toMonthKey(new Date())
}

export function getCurrentYearJst() {
  return new Date().getFullYear()
}

export async function resolveDefaultReviewYearJst(options?: {
  currentYear?: number
  minYear?: number
}) {
  const currentYear = options?.currentYear ?? getCurrentYearJst()
  const minYear = options?.minYear ?? 2000
  const boundedMinYear = Math.min(minYear, currentYear)

  const currentYearReviews = await getActionLogWeeklyActivityReviews(currentYear)
  if (currentYearReviews.length > 0) {
    return currentYear
  }

  for (let year = currentYear - 1; year >= boundedMinYear; year -= 1) {
    const reviews = await getActionLogWeeklyActivityReviews(year)
    if (reviews.length > 0) {
      return year
    }
  }

  return currentYear
}

export function isMondayJst(referenceDate = new Date()) {
  return referenceDate.getDay() === 1
}

export function normalizeViewMode(value: string | null): ActivityLogViewMode {
  return value === 'event' ? 'event' : 'session'
}

export function normalizeMonthKey(value: string | null) {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : getCurrentMonthKeyJst()
}

export function normalizeYear(value: string | null) {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed >= 2000 && parsed <= 2100) {
    return parsed
  }
  return getCurrentYearJst()
}

export function normalizeWeekKey(value: string | null) {
  return value && /^\d{4}-W\d{2}$/.test(value) ? value : getCurrentWeekKeyJst()
}

export function shiftMonthKey(monthKey: string, delta: number) {
  const [yearText, monthText] = monthKey.split('-')
  const baseDate = new Date(Number(yearText), Number(monthText) - 1 + delta, 1)
  return toMonthKey(baseDate)
}

export function buildMonthDateRange(monthKey: string) {
  const [yearText, monthText] = monthKey.split('-')
  const year = Number(yearText)
  const monthIndex = Number(monthText) - 1
  const start = new Date(year, monthIndex, 1)
  const end = new Date(year, monthIndex + 1, 0)
  return {
    from: toDateKey(start),
    to: toDateKey(end),
  }
}

export function buildMonthDays(monthKey: string, logs: DailyActivityLog[]) {
  const logMap = new Map(logs.map((log) => [log.dateKey, log] as const))
  const [yearText, monthText] = monthKey.split('-')
  const year = Number(yearText)
  const monthIndex = Number(monthText) - 1
  const lastDay = new Date(year, monthIndex + 1, 0).getDate()

  return Array.from({ length: lastDay }, (_, index): ActivityCalendarDay => {
    const dateKey = toDateKey(new Date(year, monthIndex, index + 1))
    return {
      dateKey,
      dailyLog: logMap.get(dateKey) ?? null,
    }
  })
}

export function buildWeekDateRangeFromWeekKey(weekKey: string) {
  const match = /^(?<year>\d{4})-W(?<week>\d{2})$/.exec(weekKey)
  if (!match?.groups) {
    return {
      from: getTodayDateKeyJst(),
      to: getTodayDateKeyJst(),
      year: getCurrentYearJst(),
    }
  }

  const year = Number(match.groups.year)
  const week = Number(match.groups.week)
  const januaryFourth = new Date(year, 0, 4)
  const januaryFourthDay = januaryFourth.getDay() || 7
  const weekOneMonday = new Date(year, 0, 4 - (januaryFourthDay - 1))
  const start = new Date(weekOneMonday)
  start.setDate(weekOneMonday.getDate() + (week - 1) * 7)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)

  return {
    from: toDateKey(start),
    to: toDateKey(end),
    year,
  }
}

function lower(value: string | undefined) {
  return value?.toLowerCase() ?? ''
}

function isWithinDateRange(dateKey: string, from: string, to: string) {
  return dateKey >= from && dateKey <= to
}

function buildSessionSearchText(session: ActivitySession) {
  return [
    session.title,
    session.summary ?? '',
    session.primaryCategory,
    ...session.activityKinds,
    ...session.appNames,
    ...session.domains,
    ...session.projectNames,
    ...session.searchKeywords,
  ]
    .join(' ')
    .toLowerCase()
}

function buildOpenLoopSearchText(openLoop: OpenLoop) {
  return [openLoop.title, openLoop.description ?? '', openLoop.status].join(' ').toLowerCase()
}

function normalizeFilterValues(values: string[] | undefined) {
  return (values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean)
}

function matchesAnyFilter(haystack: string[], filters: string[]) {
  if (filters.length === 0) {
    return true
  }
  const normalized = haystack.map((value) => value.toLowerCase())
  return filters.some((filter) => normalized.includes(filter))
}

function toDurationMinutes(startedAt: string, endedAt: string) {
  const started = parseDate(startedAt).getTime()
  const ended = parseDate(endedAt).getTime()
  return Math.max(0, Math.round((ended - started) / 60000))
}

function buildCategoryDurations(sessions: ActivitySession[]) {
  return sessions.reduce<Record<string, number>>((accumulator, session) => {
    const minutes = toDurationMinutes(session.startedAt, session.endedAt)
    accumulator[session.primaryCategory] = (accumulator[session.primaryCategory] ?? 0) + minutes
    return accumulator
  }, {})
}

function sortSessionsNewestFirst(sessions: ActivitySession[]) {
  return [...sessions].sort((left, right) => right.startedAt.localeCompare(left.startedAt))
}

function sortRawEventsNewestFirst(rawEvents: RawEvent[]) {
  return [...rawEvents].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
}

function sortOpenLoopsNewestFirst(openLoops: OpenLoop[]) {
  return [...openLoops].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function buildUsageSummaries(
  sessions: ActivitySession[],
  selectValues: (session: ActivitySession) => string[],
): UsageSummaryItem[] {
  const totals = new Map<string, number>()

  sessions.forEach((session) => {
    const labels = Array.from(
      new Set(
        selectValues(session)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    )
    if (labels.length === 0) {
      return
    }

    const distributedMinutes = toDurationMinutes(session.startedAt, session.endedAt) / labels.length
    labels.forEach((label) => {
      totals.set(label, (totals.get(label) ?? 0) + distributedMinutes)
    })
  })

  return [...totals.entries()]
    .map(([label, minutes]) => ({
      label,
      minutes: Math.round(minutes),
    }))
    .filter((item) => item.minutes > 0)
    .sort((left, right) => right.minutes - left.minutes || left.label.localeCompare(right.label))
    .slice(0, 5)
}

function buildExportYears(from: string, to: string) {
  const fromYear = Number(from.slice(0, 4))
  const toYear = Number(to.slice(0, 4))
  if (!Number.isFinite(fromYear) || !Number.isFinite(toYear)) {
    return []
  }
  const years: number[] = []
  for (let year = fromYear; year <= toYear; year += 1) {
    years.push(year)
  }
  return years
}

function rangesOverlap(from: string, to: string, candidateFrom: string, candidateTo: string) {
  return !(candidateTo < from || candidateFrom > to)
}

function filterDaySessions(sessions: ActivitySession[], dateKey: string) {
  return sessions.filter((session) => session.dateKey === dateKey)
}

function filterDayRawEvents(rawEvents: RawEvent[], dateKey: string) {
  return rawEvents.filter((event) => getDayKey(event.occurredAt) === dateKey)
}

function filterDayOpenLoops(openLoops: OpenLoop[], dateKey: string) {
  return openLoops.filter((openLoop) => openLoop.dateKey === dateKey)
}

export async function fetchActivityDayView(dateKey: string): Promise<ActivityDayViewData> {
  const [sessions, rawEvents, dailyLog, openLoops] = await Promise.all([
    getActionLogSessions(dateKey, dateKey),
    getActionLogRawEvents(dateKey, dateKey),
    getActionLogDailyActivityLog(dateKey),
    getActionLogOpenLoops(dateKey, dateKey),
  ])

  return {
    dateKey,
    sessions: sortSessionsNewestFirst(filterDaySessions(sessions, dateKey)),
    rawEvents: sortRawEventsNewestFirst(filterDayRawEvents(rawEvents, dateKey)),
    dailyLog: dailyLog?.dateKey === dateKey ? dailyLog : null,
    openLoops: filterDayOpenLoops(openLoops, dateKey),
  }
}

export async function ensurePreviousDayDailyActivityLog(params: {
  aiConfig: AiConfig
  settings: UserSettings
  dateKey: string
  now?: Date
}): Promise<ActivityDayViewData> {
  const dateKey = params.dateKey
  const now = params.now ?? new Date()
  const [sessions, rawEvents, dailyLog, openLoops] = await Promise.all([
    getActionLogSessions(dateKey, dateKey),
    getActionLogRawEvents(dateKey, dateKey),
    getActionLogDailyActivityLog(dateKey),
    getActionLogOpenLoops(dateKey, dateKey),
  ])

  const filteredSessions = sortSessionsNewestFirst(filterDaySessions(sessions, dateKey))
  const filteredRawEvents = sortRawEventsNewestFirst(filterDayRawEvents(rawEvents, dateKey))
  const filteredOpenLoops = filterDayOpenLoops(openLoops, dateKey)
  let resolvedDailyLog = dailyLog?.dateKey === dateKey ? dailyLog : null

  if (!resolvedDailyLog && dateKey === getYesterdayDateKeyJst(now)) {
    const generated = await generateDailyActivityLog({
      aiConfig: params.aiConfig,
      settings: params.settings,
      dateKey,
      sessions: filteredSessions,
      openLoops: filteredOpenLoops,
    })

    resolvedDailyLog = await putActionLogDailyActivityLog({
      id: `daily_${dateKey}`,
      dateKey,
      summary: generated.summary,
      mainThemes: generated.mainThemes,
      noteIds: [],
      openLoopIds: filteredOpenLoops.map((openLoop) => openLoop.id),
      reviewQuestions: generated.reviewQuestions,
      generatedAt: toJstIso(),
    })
  }

  return {
    dateKey,
    sessions: filteredSessions,
    rawEvents: filteredRawEvents,
    dailyLog: resolvedDailyLog,
    openLoops: filteredOpenLoops,
  }
}

export async function fetchActivityCalendarMonth(monthKey: string) {
  const { from, to } = buildMonthDateRange(monthKey)
  const logs = await getActionLogDailyActivityLogs(from, to)
  return buildMonthDays(
    monthKey,
    logs.filter((log) => isWithinDateRange(log.dateKey, from, to)),
  )
}

export async function fetchActivityReviewYear(year: number) {
  const reviews = await getActionLogWeeklyActivityReviews(year)
  return [...reviews].sort((left, right) => left.weekKey.localeCompare(right.weekKey))
}

export async function fetchActivityReviewWeek(weekKey: string): Promise<ActivityWeekViewData> {
  const range = buildWeekDateRangeFromWeekKey(weekKey)
  const [review, openLoops, sessions] = await Promise.all([
    getActionLogWeeklyActivityReview(weekKey),
    getActionLogOpenLoops(range.from, range.to),
    getActionLogSessions(range.from, range.to),
  ])
  const weeklySessions = sessions.filter((session) =>
    isWithinDateRange(session.dateKey, range.from, range.to),
  )

  return {
    review,
    openLoops: openLoops.filter((openLoop) =>
      isWithinDateRange(openLoop.dateKey, range.from, range.to),
    ),
    topApps: buildUsageSummaries(weeklySessions, (session) => session.appNames),
    topDomains: buildUsageSummaries(weeklySessions, (session) => session.domains),
  }
}

export async function ensurePreviousWeekReviewForWeb(params: {
  aiConfig: AiConfig
  settings: UserSettings
  routeScope: 'week' | 'year'
  weekKey?: string
  year?: number
  now?: Date
}): Promise<boolean> {
  const now = params.now ?? new Date()
  if (!isMondayJst(now)) {
    return false
  }

  const previousWeekKey = getPreviousWeekKeyJst(now)
  const previousWeekYear = getPreviousWeekYearJst(now)

  if (params.routeScope === 'week' && params.weekKey !== previousWeekKey) {
    return false
  }

  if (params.routeScope === 'year' && params.year !== previousWeekYear) {
    return false
  }

  const existingReview = await getActionLogWeeklyActivityReview(previousWeekKey)
  if (existingReview) {
    return false
  }

  const range = buildWeekDateRangeFromWeekKey(previousWeekKey)
  const [sessions, openLoops] = await Promise.all([
    getActionLogSessions(range.from, range.to),
    getActionLogOpenLoops(range.from, range.to),
  ])
  const filteredOpenLoops = openLoops.filter((openLoop) =>
    isWithinDateRange(openLoop.dateKey, range.from, range.to),
  )
  const categoryDurations = buildCategoryDurations(sessions)
  const generated = await generateWeeklyActivityReview({
    aiConfig: params.aiConfig,
    settings: params.settings,
    weekKey: previousWeekKey,
    sessions,
    openLoops: filteredOpenLoops,
    categoryDurations,
  })

  await putActionLogWeeklyActivityReview({
    id: `weekly_${previousWeekKey}`,
    weekKey: previousWeekKey,
    summary: generated.summary,
    categoryDurations,
    focusThemes: generated.focusThemes,
    openLoopIds: filteredOpenLoops.map((openLoop) => openLoop.id),
    generatedAt: toJstIso(now),
  })

  return true
}

export async function searchActivityLogs(params: ActivitySearchParams): Promise<ActivitySearchResult> {
  const [sessions, openLoops] = await Promise.all([
    getActionLogSessions(params.from, params.to),
    getActionLogOpenLoops(params.from, params.to),
  ])
  const keyword = lower(params.keyword.trim())
  const categoryFilters = normalizeFilterValues(params.categories)
  const appFilters = normalizeFilterValues(params.apps)
  const domainFilters = normalizeFilterValues(params.domains)
  const includeHidden = params.includeHidden ?? false
  const includeOpenLoops = params.includeOpenLoops ?? true

  const filteredSessions = sortSessionsNewestFirst(
    sessions.filter((session) => {
      if (!includeHidden && session.hidden) {
        return false
      }
      if (keyword && !buildSessionSearchText(session).includes(keyword)) {
        return false
      }
      if (!matchesAnyFilter([session.primaryCategory], categoryFilters)) {
        return false
      }
      if (!matchesAnyFilter(session.appNames, appFilters)) {
        return false
      }
      if (!matchesAnyFilter(session.domains, domainFilters)) {
        return false
      }
      return true
    }),
  )

  const filteredOpenLoops = includeOpenLoops
    ? sortOpenLoopsNewestFirst(
        openLoops.filter((openLoop) => (keyword ? buildOpenLoopSearchText(openLoop).includes(keyword) : true)),
      )
    : []

  return {
    sessions: filteredSessions,
    openLoops: filteredOpenLoops,
  }
}

export async function setActivitySessionHidden(params: {
  sessionId: string
  dateKey: string
  hidden: boolean
}) {
  return putActionLogSessionHidden(params.sessionId, {
    dateKey: params.dateKey,
    hidden: params.hidden,
  })
}

export async function exportActionLogBundle(params: {
  from: string
  to: string
  now?: Date
}): Promise<ActionLogExportBundle> {
  const years = buildExportYears(params.from, params.to)
  const [rawEvents, sessions, dailyLogs, openLoops, weeklyReviewBatches] = await Promise.all([
    getActionLogRawEvents(params.from, params.to),
    getActionLogSessions(params.from, params.to),
    getActionLogDailyActivityLogs(params.from, params.to),
    getActionLogOpenLoops(params.from, params.to),
    Promise.all(years.map((year) => getActionLogWeeklyActivityReviews(year))),
  ])

  const weeklyReviews = weeklyReviewBatches
    .flat()
    .filter((review) => {
      const range = buildWeekDateRangeFromWeekKey(review.weekKey)
      return rangesOverlap(params.from, params.to, range.from, range.to)
    })
    .sort((left, right) => right.weekKey.localeCompare(left.weekKey))

  return {
    rawEvents,
    sessions,
    dailyLogs,
    weeklyReviews,
    openLoops,
    meta: {
      from: params.from,
      to: params.to,
      exportedAt: toJstIso(params.now ?? new Date()),
      timezone: 'Asia/Tokyo',
    },
  }
}

export async function deleteActionLogDateRange(params: {
  from: string
  to: string
  now?: Date
}) {
  if (!canDeleteActionLogRange(params)) {
    throw new Error('Action-log deletion is limited to yesterday or earlier in JST.')
  }
  return deleteActionLogRange(params.from, params.to)
}

export function canDeleteActionLogRange(params: {
  from: string
  to: string
  now?: Date
}) {
  if (!params.from || !params.to || params.to < params.from) {
    return false
  }
  return params.to <= getYesterdayDateKeyJst(params.now ?? new Date())
}
