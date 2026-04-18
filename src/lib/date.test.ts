import { afterEach, describe, expect, it } from 'vitest'

import { getDayKey, getWeekKey } from './date'

const originalTz = process.env.TZ

afterEach(() => {
  if (originalTz === undefined) {
    delete process.env.TZ
    return
  }
  process.env.TZ = originalTz
})

describe('date helpers', () => {
  it('derives JST day keys regardless of the host timezone', () => {
    const timestamp = '2026-04-18T00:30:00+09:00'

    process.env.TZ = 'UTC'
    expect(getDayKey(timestamp)).toBe('2026-04-18')

    process.env.TZ = 'America/Los_Angeles'
    expect(getDayKey(timestamp)).toBe('2026-04-18')
  })

  it('derives JST ISO week keys regardless of the host timezone', () => {
    const timestamp = '2027-01-04T00:30:00+09:00'

    process.env.TZ = 'UTC'
    expect(getWeekKey(timestamp)).toBe('2027-W01')

    process.env.TZ = 'America/Los_Angeles'
    expect(getWeekKey(timestamp)).toBe('2027-W01')
  })
})
