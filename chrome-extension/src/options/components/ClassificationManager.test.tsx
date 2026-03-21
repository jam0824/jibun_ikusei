import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ClassificationManager } from './ClassificationManager'
import type { ClassificationCacheEntry } from '@ext/types/browsing'

describe('ClassificationManager', () => {
  const mockCache: Record<string, ClassificationCacheEntry> = {
    'learn.com:/tutorial': {
      result: {
        category: '学習',
        isGrowth: true,
        confidence: 0.95,
        suggestedQuestTitle: 'チュートリアル',
        suggestedSkill: 'TypeScript',
        cacheKey: 'learn.com:/tutorial',
      },
      source: 'ai',
      createdAt: '2026-03-20T00:00:00.000Z',
      expiresAt: '2026-04-20T00:00:00.000Z',
    },
    'game.com:/play': {
      result: {
        category: '娯楽',
        isGrowth: false,
        confidence: 0.8,
        suggestedQuestTitle: 'ゲームプレイ',
        suggestedSkill: '',
        cacheKey: 'game.com:/play',
      },
      source: 'ai',
      createdAt: '2026-03-20T00:00:00.000Z',
      expiresAt: '2026-04-20T00:00:00.000Z',
    },
  }

  beforeEach(async () => {
    await chrome.storage.local.set({ classificationCache: mockCache })
  })

  it('キャッシュされた分類結果の一覧を表示する', async () => {
    await act(async () => {
      render(<ClassificationManager />)
    })

    expect(screen.getByText('learn.com:/tutorial')).toBeInTheDocument()
    expect(screen.getByText('game.com:/play')).toBeInTheDocument()
  })

  it('各エントリのカテゴリとソースを表示する', async () => {
    await act(async () => {
      render(<ClassificationManager />)
    })

    // セレクトの値としてカテゴリが表示されている
    const selects = screen.getAllByRole('combobox')
    const values = selects.map((s) => (s as HTMLSelectElement).value)
    expect(values).toContain('学習')
    expect(values).toContain('娯楽')

    // ソース表示
    const aiLabels = screen.getAllByText('AI')
    expect(aiLabels.length).toBe(2)
  })

  it('カテゴリを変更して保存できる', async () => {
    await act(async () => {
      render(<ClassificationManager />)
    })

    // game.com の行のセレクトを変更
    const selects = screen.getAllByRole('combobox')
    const gameSelect = selects.find((s) => (s as HTMLSelectElement).value === '娯楽')
    expect(gameSelect).toBeDefined()

    await act(async () => {
      fireEvent.change(gameSelect!, { target: { value: '学習' } })
    })

    // 保存ボタンをクリック
    const saveButtons = screen.getAllByText('保存')
    await act(async () => {
      fireEvent.click(saveButtons[saveButtons.length - 1])
    })

    // ストレージが更新されていること
    const stored = await chrome.storage.local.get('classificationCache')
    const cache = stored.classificationCache as Record<string, ClassificationCacheEntry>
    expect(cache['game.com:/play'].result.category).toBe('学習')
    expect(cache['game.com:/play'].result.isGrowth).toBe(true)
    expect(cache['game.com:/play'].source).toBe('manual')
  })

  it('キャッシュが空の場合はメッセージを表示する', async () => {
    await chrome.storage.local.set({ classificationCache: {} })

    await act(async () => {
      render(<ClassificationManager />)
    })

    expect(screen.getByText('分類データがまだありません')).toBeInTheDocument()
  })
})
