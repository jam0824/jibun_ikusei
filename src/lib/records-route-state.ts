const LAST_RECORDS_ROUTE_KEY = 'app.records.lastRoute'
const DEFAULT_RECORDS_ROUTE = '/records/quests?range=today'

const RECORDS_ROUTE_PREFIXES = [
  '/records/quests',
  '/records/activity/today',
  '/records/activity/day/',
  '/records/activity/calendar',
  '/records/activity/search',
  '/records/activity/review/year',
  '/records/activity/review/week',
] as const

export function getDefaultRecordsRoute() {
  return DEFAULT_RECORDS_ROUTE
}

export function getLastRecordsRouteStorageKey() {
  return LAST_RECORDS_ROUTE_KEY
}

export function isValidRecordsChildRoute(value: string | null | undefined) {
  if (!value) {
    return false
  }

  return RECORDS_ROUTE_PREFIXES.some((prefix) => value.startsWith(prefix))
}

export function readLastRecordsRoute() {
  if (typeof window === 'undefined') {
    return DEFAULT_RECORDS_ROUTE
  }

  const saved = window.localStorage.getItem(LAST_RECORDS_ROUTE_KEY)
  return isValidRecordsChildRoute(saved) ? saved : DEFAULT_RECORDS_ROUTE
}

export function writeLastRecordsRoute(pathname: string, search = '') {
  if (typeof window === 'undefined') {
    return
  }

  const next = `${pathname}${search}`
  if (!isValidRecordsChildRoute(next)) {
    return
  }

  window.localStorage.setItem(LAST_RECORDS_ROUTE_KEY, next)
}
