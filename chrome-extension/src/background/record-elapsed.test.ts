import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocal } from '@ext/lib/storage'
import type { ClassificationResult } from '@ext/types/browsing'

describe('recordElapsed', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('分類未完了の場合はブロックリストドメインでもotherBrowsingSecondsに加算する', async () => {
    await setLocal('extensionSettings', {
      blocklist: ['game.com'],
    })

    const { recordElapsed } = await import('./record-elapsed')
    const { timeAccumulator } = await import('./shared-instances')

    const addTimeSpy = vi.spyOn(timeAccumulator, 'addTime')

    await recordElapsed({
      tabId: 1,
      domain: 'game.com',
      url: 'https://game.com/play',
      elapsedSeconds: 30,
    }, undefined) // classification = undefined

    expect(addTimeSpy).toHaveBeenCalledWith(
      'game.com',
      'game.com:/play',
      30,
      false,  // isGrowth
      false,  // isBlocklisted — 未分類なのでfalse
    )
  })

  it('分類済みでブロックリストに含まれる場合はbadBrowsingSecondsに加算する', async () => {
    await setLocal('extensionSettings', {
      blocklist: ['game.com'],
    })

    const { recordElapsed } = await import('./record-elapsed')
    const { timeAccumulator } = await import('./shared-instances')

    const addTimeSpy = vi.spyOn(timeAccumulator, 'addTime')

    const classification: ClassificationResult = {
      category: '娯楽',
      isGrowth: false,
      confidence: 0.9,
      suggestedQuestTitle: 'ゲーム',
      suggestedSkill: '',
      cacheKey: 'game.com:/play',
    }

    await recordElapsed({
      tabId: 1,
      domain: 'game.com',
      url: 'https://game.com/play',
      elapsedSeconds: 60,
    }, classification)

    expect(addTimeSpy).toHaveBeenCalledWith(
      'game.com',
      'game.com:/play',
      60,
      false,  // isGrowth
      true,   // isBlocklisted — 分類済みかつブロックリスト
    )
  })

  it('分類済みで成長カテゴリの場合はgoodBrowsingSecondsに加算する', async () => {
    await setLocal('extensionSettings', {
      blocklist: [],
    })

    const { recordElapsed } = await import('./record-elapsed')
    const { timeAccumulator } = await import('./shared-instances')

    const addTimeSpy = vi.spyOn(timeAccumulator, 'addTime')

    const classification: ClassificationResult = {
      category: '学習',
      isGrowth: true,
      confidence: 0.95,
      suggestedQuestTitle: '学習',
      suggestedSkill: 'TypeScript',
      cacheKey: 'learn.com:/tutorial',
    }

    await recordElapsed({
      tabId: 1,
      domain: 'learn.com',
      url: 'https://learn.com/tutorial',
      elapsedSeconds: 120,
    }, classification)

    expect(addTimeSpy).toHaveBeenCalledWith(
      'learn.com',
      'learn.com:/tutorial',
      120,
      true,   // isGrowth
      false,  // isBlocklisted
    )
  })

  it('elapsedSecondsが0以下の場合は何もしない', async () => {
    const { recordElapsed } = await import('./record-elapsed')
    const { timeAccumulator } = await import('./shared-instances')

    const addTimeSpy = vi.spyOn(timeAccumulator, 'addTime')

    await recordElapsed({
      tabId: 1,
      domain: 'example.com',
      url: 'https://example.com/',
      elapsedSeconds: 0,
    }, undefined)

    expect(addTimeSpy).not.toHaveBeenCalled()
  })
})
