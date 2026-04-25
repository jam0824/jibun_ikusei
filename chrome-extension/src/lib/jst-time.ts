const JST_OFFSET_MS = 9 * 60 * 60 * 1000

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

/** Return a Date-parseable RFC3339 timestamp in JST, preserving the same instant. */
export function toJstIsoString(date = new Date()): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS)
  const year = jst.getUTCFullYear()
  const month = pad(jst.getUTCMonth() + 1)
  const day = pad(jst.getUTCDate())
  const hours = pad(jst.getUTCHours())
  const minutes = pad(jst.getUTCMinutes())
  const seconds = pad(jst.getUTCSeconds())
  const milliseconds = pad(jst.getUTCMilliseconds(), 3)

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}+09:00`
}
