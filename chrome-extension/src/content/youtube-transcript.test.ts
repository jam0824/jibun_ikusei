import { describe, expect, it, vi } from 'vitest'

import {
  collectYouTubeTranscript,
  createYouTubeTranscriptMonitor,
  parseYouTubeCaptionXml,
} from './youtube-transcript'

function buildPlayerResponse(trackOverrides: Array<Record<string, unknown>>) {
  return {
    videoDetails: {
      title: 'TypeScript Deep Dive',
      author: 'Lily Channel',
    },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: trackOverrides.map((track) => ({
          baseUrl: 'https://example.com/captions',
          languageCode: 'ja',
          ...track,
        })),
      },
    },
  }
}

describe('parseYouTubeCaptionXml', () => {
  it('caption XML を segment 配列に正規化する', () => {
    const segments = parseYouTubeCaptionXml(
      '<transcript><text start="0" dur="1.2">Hello</text><text start="12.5" dur="2.0">Second line</text></transcript>',
    )

    expect(segments).toEqual([
      { startSeconds: 0, text: 'Hello' },
      { startSeconds: 12.5, text: 'Second line' },
    ])
  })
})

describe('collectYouTubeTranscript', () => {
  it('手動字幕を自動字幕より優先する', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('manual-track')) {
        return new Response('<transcript><text start="0">manual text</text></transcript>')
      }
      return new Response('<transcript><text start="0">auto text</text></transcript>')
    })

    const transcript = await collectYouTubeTranscript({
      url: 'https://www.youtube.com/watch?v=abc123',
      playerResponse: buildPlayerResponse([
        { baseUrl: 'https://example.com/auto-track', kind: 'asr' },
        { baseUrl: 'https://example.com/manual-track' },
      ]),
      occurredAt: '2026-04-11T21:05:06+09:00',
      fetchImpl,
    })

    expect(transcript?.transcriptSource).toBe('manual')
    expect(transcript?.languageCode).toBe('ja')
    expect(transcript?.segments).toEqual([{ startSeconds: 0, text: 'manual text' }])
  })

  it('手動字幕がないときは自動字幕にフォールバックする', async () => {
    const transcript = await collectYouTubeTranscript({
      url: 'https://www.youtube.com/watch?v=abc123',
      playerResponse: buildPlayerResponse([
        { baseUrl: 'https://example.com/auto-track', kind: 'asr', languageCode: 'en' },
      ]),
      occurredAt: '2026-04-11T21:05:06+09:00',
      fetchImpl: async () => new Response('<transcript><text start="0">auto text</text></transcript>'),
    })

    expect(transcript?.transcriptSource).toBe('auto')
    expect(transcript?.languageCode).toBe('en')
    expect(transcript?.segments).toEqual([{ startSeconds: 0, text: 'auto text' }])
  })

  it('字幕がなければ null を返す', async () => {
    const transcript = await collectYouTubeTranscript({
      url: 'https://www.youtube.com/watch?v=abc123',
      playerResponse: { videoDetails: { title: 'No Captions', author: 'Lily Channel' } },
      occurredAt: '2026-04-11T21:05:06+09:00',
      fetchImpl: async () => new Response(''),
    })

    expect(transcript).toBeNull()
  })
})

describe('createYouTubeTranscriptMonitor', () => {
  it('動画ごとに 1 回だけ送信し、SPA 遷移後は別動画を再送できる', async () => {
    let currentUrl = 'https://www.youtube.com/watch?v=video-1'
    const playerResponses: Record<string, unknown> = {
      'https://www.youtube.com/watch?v=video-1': buildPlayerResponse([
        { baseUrl: 'https://example.com/video-1-track' },
      ]),
      'https://www.youtube.com/watch?v=video-2': buildPlayerResponse([
        { baseUrl: 'https://example.com/video-2-track' },
      ]),
    }

    const sendMessage = vi.fn(async (_payload: unknown) => undefined)
    const monitor = createYouTubeTranscriptMonitor({
      getUrl: () => currentUrl,
      getPlayerResponse: () => playerResponses[currentUrl],
      fetchImpl: async (input: RequestInfo | URL) => {
        if (String(input).includes('video-1-track')) {
          return new Response('<transcript><text start="0">video 1</text></transcript>')
        }
        return new Response('<transcript><text start="0">video 2</text></transcript>')
      },
      now: () => new Date('2026-04-11T12:05:06+09:00'),
      sendMessage,
    })

    await monitor.handlePlaybackStart()
    await monitor.handlePlaybackStart()

    currentUrl = 'https://www.youtube.com/watch?v=video-2'
    monitor.handleUrlChange(currentUrl)
    await monitor.handlePlaybackStart()

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      videoId: 'video-1',
      transcriptSource: 'manual',
    })
    expect(sendMessage.mock.calls[1]?.[0]).toMatchObject({
      videoId: 'video-2',
      transcriptSource: 'manual',
    })
  })
})
