import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createUrlChangeDetector } from './spa-navigation'

describe('SPA navigation detection', () => {
  it('URLが変わった時にコールバックを呼ぶ', () => {
    const callback = vi.fn()
    const detector = createUrlChangeDetector('https://example.com/page1', callback)

    detector.check('https://example.com/page2')
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('URLが同じ場合はコールバックを呼ばない', () => {
    const callback = vi.fn()
    const detector = createUrlChangeDetector('https://example.com/page1', callback)

    detector.check('https://example.com/page1')
    expect(callback).not.toHaveBeenCalled()
  })

  it('連続した異なるURL変更を検知する', () => {
    const callback = vi.fn()
    const detector = createUrlChangeDetector('https://example.com/page1', callback)

    detector.check('https://example.com/page2')
    detector.check('https://example.com/page3')
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('同じURLへの連続チェックは1回だけ呼ぶ', () => {
    const callback = vi.fn()
    const detector = createUrlChangeDetector('https://example.com/page1', callback)

    detector.check('https://example.com/page2')
    detector.check('https://example.com/page2')
    expect(callback).toHaveBeenCalledTimes(1)
  })
})
