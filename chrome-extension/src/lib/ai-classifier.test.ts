import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyPage } from '@ext/lib/ai-classifier'
import type { PageInfo } from '@ext/types/browsing'
import type { ExtensionSettings } from '@ext/types/settings'

function mockSettings(overrides: Partial<ExtensionSettings> = {}): ExtensionSettings {
  return {
    aiProvider: 'openai',
    openaiApiKey: 'sk-test',
    blocklist: [],
    serverBaseUrl: '',
    syncEnabled: false,
    notificationsEnabled: true,
    ...overrides,
  }
}

function mockPageInfo(overrides: Partial<PageInfo> = {}): PageInfo {
  return {
    domain: 'example.com',
    url: 'https://example.com/learn/typescript',
    title: 'TypeScript入門ガイド',
    ...overrides,
  }
}

describe('ai-classifier', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends correct OpenAI request with JSON schema', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            category: '学習',
            isGrowth: true,
            confidence: 0.95,
            suggestedQuestTitle: 'TypeScript学習',
            suggestedSkill: 'プログラミング',
          }),
        }),
        { status: 200 },
      ),
    )

    const result = await classifyPage(mockPageInfo(), mockSettings())

    expect(result.category).toBe('学習')
    expect(result.isGrowth).toBe(true)
    expect(result.confidence).toBe(0.95)
    expect(result.suggestedQuestTitle).toBe('TypeScript学習')
    expect(result.suggestedSkill).toBe('プログラミング')
    expect(result.cacheKey).toBe('example.com:/learn/typescript')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('openai.com')
    expect(options.method).toBe('POST')

    const body = JSON.parse(options.body as string)
    expect(body.model).toBe('gpt-5.4')
    expect(body.text?.format?.type).toBe('json_schema')
  })

  it('sends correct Gemini request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      category: '仕事',
                      isGrowth: true,
                      confidence: 0.88,
                      suggestedQuestTitle: 'ビジネス資料閲覧',
                      suggestedSkill: 'ビジネス',
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const result = await classifyPage(
      mockPageInfo({ title: 'ビジネス戦略ガイド' }),
      mockSettings({ aiProvider: 'gemini', geminiApiKey: 'gm-test' }),
    )

    expect(result.category).toBe('仕事')
    expect(result.isGrowth).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('gemini-2.5-flash')
    expect(url).toContain('gm-test')
  })

  it('retries on 500 error and then succeeds', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'server error' }), { status: 500 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              category: '学習',
              isGrowth: true,
              confidence: 0.9,
              suggestedQuestTitle: 'テスト',
              suggestedSkill: 'テスト',
            }),
          }),
          { status: 200 },
        ),
      )

    const result = await classifyPage(mockPageInfo(), mockSettings())
    expect(result.category).toBe('学習')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to その他 when AI completely fails', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('error', { status: 400 }))
      .mockResolvedValueOnce(new Response('error', { status: 400 }))
      .mockResolvedValueOnce(new Response('error', { status: 400 }))

    const result = await classifyPage(mockPageInfo(), mockSettings())
    expect(result.category).toBe('その他')
    expect(result.isGrowth).toBe(false)
    expect(result.confidence).toBe(0)
  })

  it('falls back when no API key is configured', async () => {
    const result = await classifyPage(
      mockPageInfo(),
      mockSettings({ openaiApiKey: undefined }),
    )
    expect(result.category).toBe('その他')
    expect(result.isGrowth).toBe(false)
  })

  it('parses OpenAI output from response.output array', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    category: '健康',
                    isGrowth: true,
                    confidence: 0.85,
                    suggestedQuestTitle: '健康記事閲覧',
                    suggestedSkill: '健康管理',
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const result = await classifyPage(mockPageInfo(), mockSettings())
    expect(result.category).toBe('健康')
    expect(result.suggestedSkill).toBe('健康管理')
  })
})
