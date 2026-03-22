import { describe, it, expect } from 'vitest'
import { formatSeconds } from './time-format'

describe('formatSeconds', () => {
  it('0秒を0分と表示する', () => {
    expect(formatSeconds(0)).toBe('0分')
  })

  it('秒を分に変換して表示する', () => {
    expect(formatSeconds(300)).toBe('5分')
  })

  it('59分を時間なしで表示する', () => {
    expect(formatSeconds(3540)).toBe('59分')
  })

  it('60分を1時間0分と表示する', () => {
    expect(formatSeconds(3600)).toBe('1時間0分')
  })

  it('90分を1時間30分と表示する', () => {
    expect(formatSeconds(5400)).toBe('1時間30分')
  })

  it('端数の秒は切り捨てる', () => {
    expect(formatSeconds(3661)).toBe('1時間1分')
  })
})
