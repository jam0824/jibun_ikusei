import {
  addMinutes,
  addDays,
  differenceInMinutes,
  endOfDay,
  format,
  getISOWeek,
  getISOWeekYear,
  isAfter,
  isBefore,
  isSameDay,
  isToday,
  parseISO,
  startOfISOWeek,
  startOfDay,
  subDays,
  subWeeks,
} from 'date-fns'
import { ja } from 'date-fns/locale'

export function nowIso() {
  return new Date().toISOString()
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
  return isSameDay(parseDate(left), parseDate(right))
}

export function isUndoable(completedAt: string, undoneAt?: string) {
  if (undoneAt) {
    return false
  }

  return differenceInMinutes(new Date(), parseDate(completedAt)) <= 10
}

export function getDayKey(value: string | Date) {
  return format(parseDate(value), 'yyyy-MM-dd')
}

export function getWeekKey(value: string | Date) {
  const date = parseDate(value)
  return `${getISOWeekYear(date)}-W${String(getISOWeek(date)).padStart(2, '0')}`
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
  return value ? isToday(parseDate(value)) : false
}
