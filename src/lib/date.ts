import {
  addMinutes,
  addDays,
  differenceInMinutes,
  endOfDay,
  format,
  isAfter,
  isBefore,
  parseISO,
  startOfISOWeek,
  startOfDay,
  subDays,
  subWeeks,
} from 'date-fns'
import { ja } from 'date-fns/locale'

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function toJstComparableDate(value: string | Date) {
  return new Date(parseDate(value).getTime() + JST_OFFSET_MS)
}

function getUtcIsoWeekInfo(date: Date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayOfWeek = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - dayOfWeek)

  const weekYear = target.getUTCFullYear()
  const yearStart = new Date(Date.UTC(weekYear, 0, 1))
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)

  return { weekYear, week }
}

export function nowIso() {
  return new Date().toISOString()
}

export function toJstIso(value: string | Date = new Date()) {
  const date = parseDate(value)
  const jst = new Date(date.getTime() + JST_OFFSET_MS)
  const year = jst.getUTCFullYear()
  const month = pad2(jst.getUTCMonth() + 1)
  const day = pad2(jst.getUTCDate())
  const hours = pad2(jst.getUTCHours())
  const minutes = pad2(jst.getUTCMinutes())
  const seconds = pad2(jst.getUTCSeconds())
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+09:00`
}

export function parseDate(value: string | Date) {
  return value instanceof Date ? value : parseISO(value)
}

export function formatTime(value: string | Date) {
  return format(parseDate(value), 'HH:mm', { locale: ja })
}

export function formatDate(value: string | Date, pattern = 'M/d') {
  return format(parseDate(value), pattern, { locale: ja })
}

export function formatDateTime(value: string | Date, pattern = 'M/d HH:mm') {
  return format(parseDate(value), pattern, { locale: ja })
}

export function toDateTimeLocalValue(value?: string) {
  if (!value) {
    return ''
  }

  return format(parseDate(value), "yyyy-MM-dd'T'HH:mm")
}

export function fromRelativeOption(
  option: 'now' | 'minus_5m' | 'minus_30m' | 'custom',
  customValue?: string,
) {
  const now = new Date()

  if (option === 'now') {
    return now.toISOString()
  }

  if (option === 'minus_5m') {
    return addMinutes(now, -5).toISOString()
  }

  if (option === 'minus_30m') {
    return addMinutes(now, -30).toISOString()
  }

  return customValue ? new Date(customValue).toISOString() : now.toISOString()
}

export function isSameCalendarDay(left: string | Date, right: string | Date) {
  return getDayKey(left) === getDayKey(right)
}

export function isUndoable(completedAt: string, undoneAt?: string) {
  if (undoneAt) {
    return false
  }

  return differenceInMinutes(new Date(), parseDate(completedAt)) <= 10
}

export function getDayKey(value: string | Date) {
  const jst = toJstComparableDate(value)
  return `${jst.getUTCFullYear()}-${pad2(jst.getUTCMonth() + 1)}-${pad2(jst.getUTCDate())}`
}

export function getWeekKey(value: string | Date) {
  const { weekYear, week } = getUtcIsoWeekInfo(toJstComparableDate(value))
  return `${weekYear}-W${pad2(week)}`
}

export function getWeekDateRange(value: string | Date) {
  const start = startOfISOWeek(parseDate(value))
  const end = endOfDay(addDays(start, 6))
  return { start, end }
}

export function getPreviousWeekDateRange(referenceDate = new Date()) {
  return getWeekDateRange(subWeeks(referenceDate, 1))
}

export function getDateRangeLast7Days() {
  return {
    from: startOfDay(subDays(new Date(), 6)),
    to: endOfDay(new Date()),
  }
}

export function isWithinRange(value: string, start: Date, end: Date) {
  const date = parseDate(value)
  return !isBefore(date, start) && !isAfter(date, end)
}

export function isReminderDue(reminderTime?: string) {
  if (!reminderTime) {
    return false
  }

  const [hours, minutes] = reminderTime.split(':').map(Number)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return false
  }

  const now = new Date()
  const target = new Date()
  target.setHours(hours, minutes, 0, 0)
  return isAfter(now, target)
}

export function isTodayDate(value?: string) {
  return value ? getDayKey(value) === getDayKey(new Date()) : false
}
