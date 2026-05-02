import { describe, expect, it } from 'vitest'
import {
  buildScrapArticleDraft,
  canonicalizeScrapUrl,
  resolveScrapSharePayload,
} from '@/lib/scrap-article'

describe('scrap article utilities', () => {
  it('uses url before text and title when resolving Android share payloads', () => {
    const result = resolveScrapSharePayload({
      title: 'Readable title https://title.example.com/post',
      text: 'Text https://text.example.com/post',
      url: 'https://Example.com/articles/123#comments',
    })

    expect(result.ok).toBe(true)
    expect(result.url).toBe('https://example.com/articles/123#comments')
    expect(result.canonicalUrl).toBe('https://example.com/articles/123')
    expect(result.title).toBe('Readable title https://title.example.com/post')
    expect(result.domain).toBe('example.com')
  })

  it('extracts the first URL from text when url is empty', () => {
    const result = resolveScrapSharePayload({
      title: 'あとで読む',
      text: 'この記事よさそう https://developer.chrome.com/docs/capabilities/web-apis/web-share-target?hl=ja',
      url: '',
    })

    expect(result.ok).toBe(true)
    expect(result.url).toBe(
      'https://developer.chrome.com/docs/capabilities/web-apis/web-share-target?hl=ja',
    )
    expect(result.title).toBe('あとで読む')
    expect(result.domain).toBe('developer.chrome.com')
  })

  it('falls back to text without the URL and then domain for title', () => {
    expect(
      resolveScrapSharePayload({
        text: '保存したい記事 https://example.com/read',
      }),
    ).toMatchObject({
      ok: true,
      title: '保存したい記事',
    })

    expect(
      resolveScrapSharePayload({
        text: 'https://example.com/read',
      }),
    ).toMatchObject({
      ok: true,
      title: 'example.com',
    })
  })

  it('rejects missing and non-http URLs', () => {
    expect(resolveScrapSharePayload({ title: 'no url', text: 'hello' })).toEqual({
      ok: false,
      reason: 'URLを読み取れませんでした。URLを貼り付けて追加してください。',
    })
    expect(resolveScrapSharePayload({ url: 'ftp://example.com/file' })).toEqual({
      ok: false,
      reason: '保存できるURLではありません。',
    })
  })

  it('canonicalizes URLs for duplicate detection', () => {
    expect(canonicalizeScrapUrl(' HTTPS://Example.COM/articles/?utm_source=test#section ')).toEqual({
      url: 'https://example.com/articles/?utm_source=test#section',
      canonicalUrl: 'https://example.com/articles?utm_source=test',
      domain: 'example.com',
    })
  })

  it('creates JST timestamped drafts', () => {
    const draft = buildScrapArticleDraft(
      {
        url: 'https://example.com/read',
        title: 'Example',
        memo: 'あとで見る',
        addedFrom: 'manual',
      },
      {
        id: 'scrap_fixed',
        now: new Date('2026-05-01T00:00:00.000Z'),
      },
    )

    expect(draft).toMatchObject({
      id: 'scrap_fixed',
      url: 'https://example.com/read',
      canonicalUrl: 'https://example.com/read',
      title: 'Example',
      domain: 'example.com',
      memo: 'あとで見る',
      status: 'unread',
      addedFrom: 'manual',
      createdAt: '2026-05-01T09:00:00+09:00',
      updatedAt: '2026-05-01T09:00:00+09:00',
    })
  })
})
