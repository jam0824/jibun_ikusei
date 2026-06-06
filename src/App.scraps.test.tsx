import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/lib/auth', () => ({
  isLoggedIn: vi.fn().mockResolvedValue(true),
  getIdToken: vi.fn().mockResolvedValue('test-token'),
  login: vi.fn(),
  setNewPassword: vi.fn(),
}))

vi.mock('recharts', () => ({
  Bar: () => null,
  BarChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Cell: () => null,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

import { AppShellRoutes } from '@/App'
import { hydratePersistedState } from '@/domain/logic'
import type { PersistedAppState, ScrapArticle } from '@/domain/types'
import * as api from '@/lib/api-client'
import { useAppStore } from '@/store/app-store'

function createScrap(overrides: Partial<ScrapArticle> = {}): ScrapArticle {
  return {
    id: 'scrap_1',
    url: 'https://example.com/article',
    canonicalUrl: 'https://example.com/article',
    title: 'Example article',
    domain: 'example.com',
    memo: 'あとで読む',
    status: 'unread',
    addedFrom: 'manual',
    createdAt: '2026-05-01T09:00:00+09:00',
    updatedAt: '2026-05-01T09:00:00+09:00',
    ...overrides,
  }
}

function resetStore(partial: Partial<PersistedAppState> = {}) {
  const base = hydratePersistedState({
    meta: {
      schemaVersion: 1,
      seededSampleData: true,
      ...partial.meta,
    },
    quests: [],
    completions: [],
    skills: [],
    assistantMessages: [],
    personalSkillDictionary: [],
    ...partial,
  })

  useAppStore.setState((state) => ({
    ...state,
    ...base,
    hydrated: true,
    importMode: 'merge',
    currentEffectCompletionId: undefined,
    busyQuestId: undefined,
    connectionState: {
      openai: { status: 'idle' },
      gemini: { status: 'idle' },
    },
    nutritionCache: {},
    fitbitCache: {},
    scrapShareMessage: undefined,
  }))
}

function renderRoute(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AppShellRoutes />
    </MemoryRouter>,
  )
}

describe('scrap article routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(api, 'postScrap').mockImplementation(async (scrap) => scrap)
    vi.spyOn(api, 'putScrap').mockResolvedValue(createScrap())
    vi.spyOn(api, 'deleteScrap').mockResolvedValue({ deleted: 'scrap_1' })
  })

  it('shows scraps from /records/scraps and opens original links externally', () => {
    resetStore({ scrapArticles: [createScrap()] })

    renderRoute('/records/scraps')

    expect(screen.getByRole('heading', { name: 'スクラップ記事' })).toBeInTheDocument()
    expect(screen.getByText('Example article')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Example article/ })
    expect(link).toHaveAttribute('href', 'https://example.com/article')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('adds a scrap from the manual form', async () => {
    resetStore()

    renderRoute('/records/scraps/new')

    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://example.com/manual' },
    })
    fireEvent.change(screen.getByLabelText('タイトル'), {
      target: { value: 'Manual article' },
    })
    fireEvent.change(screen.getByLabelText('メモ'), {
      target: { value: 'あとで読む' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('Manual article')).toBeInTheDocument()
    expect(useAppStore.getState().scrapArticles[0]).toMatchObject({
      title: 'Manual article',
      canonicalUrl: 'https://example.com/manual',
      memo: 'あとで読む',
    })
  })

  it('links to scraps from the records hub', () => {
    resetStore()

    renderRoute('/records')

    expect(screen.getByRole('button', { name: /スクラップ記事/ })).toBeInTheDocument()
  })
})
