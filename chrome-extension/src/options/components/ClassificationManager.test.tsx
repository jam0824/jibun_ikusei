import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ClassificationManager } from './ClassificationManager'
import type { ClassificationCacheEntry } from '@ext/types/browsing'

function makeEntry(
  cacheKey: string,
  category: string,
  isGrowth: boolean,
  source: 'ai' | 'manual' = 'ai',
): ClassificationCacheEntry {
  return {
    result: {
      category: category as ClassificationCacheEntry['result']['category'],
      isGrowth,
      confidence: 0.9,
      suggestedQuestTitle: '',
      suggestedSkill: '',
      cacheKey,
    },
    source,
    createdAt: '2026-03-20T00:00:00.000Z',
    expiresAt: '2026-04-20T00:00:00.000Z',
  }
}

describe('ClassificationManager', () => {
  const mockCache: Record<string, ClassificationCacheEntry> = {
    'learn.com:/tutorial': makeEntry('learn.com:/tutorial', '学習', true),
    'game.com:/play': makeEntry('game.com:/play', '娯楽', false),
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

  describe('ページネーション', () => {
    const PAGE_SIZE = 20

    function makeLargeCache(count: number): Record<string, ClassificationCacheEntry> {
      const cache: Record<string, ClassificationCacheEntry> = {}
      for (let i = 1; i <= count; i++) {
        const key = `site${i}.com:/page`
        cache[key] = makeEntry(key, '学習', true)
      }
      return cache
    }

    it('20件以下ならページネーションを表示しない', async () => {
      await chrome.storage.local.set({ classificationCache: makeLargeCache(PAGE_SIZE) })

      await act(async () => {
        render(<ClassificationManager />)
      })

      expect(screen.queryByText(/ページ/)).not.toBeInTheDocument()
    })

    it('21件以上なら最初の20件だけ表示しページネーションが出る', async () => {
      await chrome.storage.local.set({ classificationCache: makeLargeCache(25) })

      await act(async () => {
        render(<ClassificationManager />)
      })

      // テーブルの行数は20（thead除く）
      const rows = screen.getAllByRole('row')
      expect(rows.length).toBe(PAGE_SIZE + 1) // +1 for header row

      // ページネーションが表示されている
      expect(screen.getByText('1 / 2 ページ')).toBeInTheDocument()
    })

    it('「次へ」ボタンで次のページに移動できる', async () => {
      await chrome.storage.local.set({ classificationCache: makeLargeCache(25) })

      await act(async () => {
        render(<ClassificationManager />)
      })

      // 1ページ目にsite1がある
      expect(screen.getByText('site1.com:/page')).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(screen.getByText('次へ'))
      })

      // 2ページ目に移動し、残り5件が表示される
      expect(screen.getByText('2 / 2 ページ')).toBeInTheDocument()
      const rows = screen.getAllByRole('row')
      expect(rows.length).toBe(5 + 1) // 5 items + header
    })

    it('最初のページでは「前へ」が無効、最後のページでは「次へ」が無効', async () => {
      await chrome.storage.local.set({ classificationCache: makeLargeCache(25) })

      await act(async () => {
        render(<ClassificationManager />)
      })

      expect(screen.getByText('前へ')).toBeDisabled()
      expect(screen.getByText('次へ')).not.toBeDisabled()

      await act(async () => {
        fireEvent.click(screen.getByText('次へ'))
      })

      expect(screen.getByText('前へ')).not.toBeDisabled()
      expect(screen.getByText('次へ')).toBeDisabled()
    })
  })

  describe('検索フィルタ', () => {
    it('ドメイン名で絞り込みができる', async () => {
      await act(async () => {
        render(<ClassificationManager />)
      })

      const searchInput = screen.getByPlaceholderText('ドメインで検索…')

      await act(async () => {
        fireEvent.change(searchInput, { target: { value: 'learn' } })
      })

      expect(screen.getByText('learn.com:/tutorial')).toBeInTheDocument()
      expect(screen.queryByText('game.com:/play')).not.toBeInTheDocument()
    })

    it('検索結果が0件の場合はメッセージを表示する', async () => {
      await act(async () => {
        render(<ClassificationManager />)
      })

      const searchInput = screen.getByPlaceholderText('ドメインで検索…')

      await act(async () => {
        fireEvent.change(searchInput, { target: { value: 'nonexistent' } })
      })

      expect(screen.getByText('該当する分類データがありません')).toBeInTheDocument()
    })

    it('検索時にページネーションがリセットされる', async () => {
      // 25件のうち5件がlearnを含む
      const cache: Record<string, ClassificationCacheEntry> = {}
      for (let i = 1; i <= 25; i++) {
        const domain = i <= 5 ? `learn${i}.com` : `other${i}.com`
        const key = `${domain}:/page`
        cache[key] = makeEntry(key, '学習', true)
      }
      await chrome.storage.local.set({ classificationCache: cache })

      await act(async () => {
        render(<ClassificationManager />)
      })

      // まず2ページ目に移動
      await act(async () => {
        fireEvent.click(screen.getByText('次へ'))
      })
      expect(screen.getByText('2 / 2 ページ')).toBeInTheDocument()

      // 検索するとページが1に戻る
      const searchInput = screen.getByPlaceholderText('ドメインで検索…')
      await act(async () => {
        fireEvent.change(searchInput, { target: { value: 'learn' } })
      })

      // 5件なのでページネーションは不要
      expect(screen.queryByText(/ページ/)).not.toBeInTheDocument()
      const rows = screen.getAllByRole('row')
      expect(rows.length).toBe(5 + 1)
    })
  })
})
