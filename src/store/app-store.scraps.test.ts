import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getIdToken: vi.fn().mockResolvedValue('test-token'),
}))

import { hydratePersistedState } from '@/domain/logic'
import type { PersistedAppState, ScrapArticle } from '@/domain/types'
import * as api from '@/lib/api-client'
import * as storage from '@/lib/storage'
import { useAppStore } from '@/store/app-store'

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

function createScrap(overrides: Partial<ScrapArticle> = {}): ScrapArticle {
  return {
    id: 'scrap_existing',
    url: 'https://example.com/read',
    canonicalUrl: 'https://example.com/read',
    title: 'Existing',
    domain: 'example.com',
    status: 'unread',
    addedFrom: 'manual',
    createdAt: '2026-05-01T09:00:00+09:00',
    updatedAt: '2026-05-01T09:00:00+09:00',
    ...overrides,
  }
}

describe('app store scraps', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetStore()
    vi.spyOn(storage, 'persistState').mockImplementation(() => undefined)
    vi.spyOn(api, 'postScrap').mockImplementation(async (scrap) => scrap)
    vi.spyOn(api, 'putScrap').mockResolvedValue({} as ScrapArticle)
    vi.spyOn(api, 'deleteScrap').mockResolvedValue({ deleted: 'scrap_existing' })
  })

  it('saves a manual scrap locally and posts it to the API', async () => {
    const result = await useAppStore.getState().saveScrapArticle({
      url: 'https://Example.com/read#top',
      title: 'Manual title',
      memo: '読む',
      addedFrom: 'manual',
    })

    expect(result.ok).toBe(true)
    expect(result.scrap).toMatchObject({
      title: 'Manual title',
      memo: '読む',
      canonicalUrl: 'https://example.com/read',
      addedFrom: 'manual',
      status: 'unread',
    })
    expect(useAppStore.getState().scrapArticles).toHaveLength(1)
    expect(api.postScrap).toHaveBeenCalledWith(expect.objectContaining({
      canonicalUrl: 'https://example.com/read',
    }))
    expect(storage.persistState).toHaveBeenCalled()
  })

  it('does not create a duplicate when canonicalUrl already exists', async () => {
    resetStore({ scrapArticles: [createScrap()] })

    const result = await useAppStore.getState().saveScrapArticle({
      url: 'https://example.com/read/',
      title: 'Duplicate title',
      addedFrom: 'android-share',
    })

    expect(result).toMatchObject({
      ok: true,
      duplicate: true,
      scrap: { id: 'scrap_existing' },
    })
    expect(useAppStore.getState().scrapArticles).toHaveLength(1)
    expect(api.postScrap).not.toHaveBeenCalled()
  })

  it('keeps the local scrap when API posting fails', async () => {
    vi.spyOn(api, 'postScrap').mockRejectedValue(new Error('network'))

    const result = await useAppStore.getState().saveScrapArticle({
      url: 'https://example.com/fail',
      title: 'Network fail',
      addedFrom: 'manual',
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('保存できませんでした。通信状態を確認してもう一度お試しください。')
    expect(result.scrap?.title).toBe('Network fail')
    expect(useAppStore.getState().scrapArticles).toHaveLength(1)
  })

  it('updates read, unread, archived, and delete states', async () => {
    resetStore({ scrapArticles: [createScrap()] })

    expect(useAppStore.getState().setScrapArticleStatus('scrap_existing', 'read').ok).toBe(true)
    expect(useAppStore.getState().scrapArticles[0].status).toBe('read')
    expect(useAppStore.getState().scrapArticles[0].readAt).toMatch(/\+09:00$/)

    expect(useAppStore.getState().setScrapArticleStatus('scrap_existing', 'unread').ok).toBe(true)
    expect(useAppStore.getState().scrapArticles[0].status).toBe('unread')
    expect(useAppStore.getState().scrapArticles[0].readAt).toBeUndefined()

    expect(useAppStore.getState().setScrapArticleStatus('scrap_existing', 'archived').ok).toBe(true)
    expect(useAppStore.getState().scrapArticles[0].status).toBe('archived')
    expect(useAppStore.getState().scrapArticles[0].archivedAt).toMatch(/\+09:00$/)

    expect(useAppStore.getState().deleteScrapArticle('scrap_existing').ok).toBe(true)
    expect(useAppStore.getState().scrapArticles).toHaveLength(0)
  })

  it('saves pending Android share data and clears sessionStorage', async () => {
    window.sessionStorage.setItem(
      'scrap.pendingShare',
      JSON.stringify({
        title: 'Shared title',
        text: '本文 https://example.com/shared',
        url: '',
      }),
    )

    const result = await useAppStore.getState().consumePendingScrapShare()

    expect(result.ok).toBe(true)
    expect(useAppStore.getState().scrapArticles[0]).toMatchObject({
      title: 'Shared title',
      addedFrom: 'android-share',
      canonicalUrl: 'https://example.com/shared',
    })
    expect(window.sessionStorage.getItem('scrap.pendingShare')).toBeNull()
  })
})
