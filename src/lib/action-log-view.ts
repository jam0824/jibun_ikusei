import type {
  ActivitySession,
  DailyActivityLog,
  OpenLoop,
  RawEvent,
  WeeklyActivityReview,
} from '@/domain/action-log-types'
import {
  getActionLogDailyActivityLog,
  getActionLogDailyActivityLogs,
  getActionLogOpenLoops,
  getActionLogRawEvents,
  getActionLogSessions,
  getActionLogWeeklyActivityReview,
  getActionLogWeeklyActivityReviews,
} from '@/lib/api-client'
import { getDayKey, getWeekKey } from '@/lib/date'

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

export interface ActivityWeekViewData {
  review: WeeklyActivityReview | null
  openLoops: OpenLoop[]
}

export interface ActivitySearchResult {
  sessions: ActivitySession[]
  openLoops: OpenLoop[]
}

export interface ActivitySearchParams {
  from: string
  to: string
  keyword: string
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

export function getCurrentWeekKeyJst() {
  return getWeekKey(new Date())
}

export function getCurrentMonthKeyJst() {
  return toMonthKey(new Date())
}

export function getCurrentYearJst() {
  return new Date().getFullYear()
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

export async function fetchActivityDayView(dateKey: string): Promise<ActivityDayViewData> {
  const [sessions, rawEvents, dailyLog, openLoops] = await Promise.all([
    getActionLogSessions(dateKey, dateKey),
    getActionLogRawEvents(dateKey, dateKey),
    getActionLogDailyActivityLog(dateKey),
    getActionLogOpenLoops(dateKey, dateKey),
  ])

  return {
    dateKey,
    sessions: sessions.filter((session) => session.dateKey === dateKey),
    rawEvents: rawEvents.filter((event) => getDayKey(event.occurredAt) === dateKey),
    dailyLog: dailyLog?.dateKey === dateKey ? dailyLog : null,
    openLoops: openLoops.filter((openLoop) => openLoop.dateKey === dateKey),
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
  const [{ from, to }, review, openLoops] = await Promise.all([
    Promise.resolve(buildWeekDateRangeFromWeekKey(weekKey)),
    getActionLogWeeklyActivityReview(weekKey),
    getActionLogOpenLoops(
      buildWeekDateRangeFromWeekKey(weekKey).from,
      buildWeekDateRangeFromWeekKey(weekKey).to,
    ),
  ])

  return {
    review,
    openLoops: openLoops.filter((openLoop) => isWithinDateRange(openLoop.dateKey, from, to)),
  }
}

export async function searchActivityLogs(params: ActivitySearchParams): Promise<ActivitySearchResult> {
  const [sessions, openLoops] = await Promise.all([
    getActionLogSessions(params.from, params.to),
    getActionLogOpenLoops(params.from, params.to),
  ])

  const keyword = lower(params.keyword.trim())
  if (!keyword) {
    return { sessions, openLoops }
  }

  return {
    sessions: sessions.filter((session) => buildSessionSearchText(session).includes(keyword)),
    openLoops: openLoops.filter((openLoop) => buildOpenLoopSearchText(openLoop).includes(keyword)),
  }
}
