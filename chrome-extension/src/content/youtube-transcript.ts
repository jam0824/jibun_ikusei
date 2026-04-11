import type {
  YouTubeTranscriptPayload,
  YouTubeTranscriptSegment,
  YouTubeTranscriptSource,
} from '@ext/types/youtube-transcript'

type CaptionTrack = {
  baseUrl: string
  languageCode: string
  kind?: string
}

type TranscriptCollectorOptions = {
  url: string
  playerResponse: unknown
  occurredAt: string
  fetchImpl: (input: RequestInfo | URL) => Promise<Response>
  fallbackTitle?: string
  fallbackChannelName?: string
}

type TranscriptMonitorDeps = {
  getUrl: () => string
  getPlayerResponse: () => unknown
  fetchImpl: (input: RequestInfo | URL) => Promise<Response>
  now?: () => Date
  sendMessage: (payload: YouTubeTranscriptPayload) => Promise<unknown>
}

type TranscriptWatcherOptions = {
  windowObj?: Window
  documentObj?: Document
  fetchImpl?: (input: RequestInfo | URL) => Promise<Response>
}

const JST_TIMEZONE = 'Asia/Tokyo'

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function readTextValue(value: unknown): string {
  if (typeof value === 'string') {
    return normalizeWhitespace(value)
  }
  if (!value || typeof value !== 'object') {
    return ''
  }

  const candidate = value as {
    simpleText?: unknown
    runs?: Array<{ text?: unknown }>
  }
  if (typeof candidate.simpleText === 'string') {
    return normalizeWhitespace(candidate.simpleText)
  }
  if (Array.isArray(candidate.runs)) {
    return normalizeWhitespace(
      candidate.runs
        .map((run) => (typeof run?.text === 'string' ? run.text : ''))
        .join(''),
    )
  }
  return ''
}

function safeParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function formatJstOccurredAt(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>

  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}+09:00`
}

function extractCaptionTracks(playerResponse: unknown): CaptionTrack[] {
  if (!playerResponse || typeof playerResponse !== 'object') {
    return []
  }

  const captionTracks = (
    playerResponse as {
      captions?: {
        playerCaptionsTracklistRenderer?: {
          captionTracks?: unknown
        }
      }
    }
  ).captions?.playerCaptionsTracklistRenderer?.captionTracks

  if (!Array.isArray(captionTracks)) {
    return []
  }

  return captionTracks.flatMap((track) => {
    if (!track || typeof track !== 'object') {
      return []
    }

    const candidate = track as {
      baseUrl?: unknown
      languageCode?: unknown
      kind?: unknown
    }

    if (typeof candidate.baseUrl !== 'string' || typeof candidate.languageCode !== 'string') {
      return []
    }

    return [{
      baseUrl: candidate.baseUrl,
      languageCode: candidate.languageCode,
      kind: typeof candidate.kind === 'string' ? candidate.kind : undefined,
    }]
  })
}

function pickPreferredCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const manualTrack = tracks.find((track) => track.kind !== 'asr')
  if (manualTrack) {
    return manualTrack
  }
  return tracks[0] ?? null
}

function extractVideoTitle(
  playerResponse: unknown,
  fallbackTitle?: string,
  videoId?: string,
): string {
  const responseTitle = (
    playerResponse as {
      videoDetails?: {
        title?: unknown
      }
    }
  )?.videoDetails?.title
  if (typeof responseTitle === 'string' && responseTitle.trim()) {
    return responseTitle.trim()
  }

  const normalizedFallback = normalizeWhitespace((fallbackTitle ?? '').replace(/\s*-\s*YouTube$/, ''))
  if (normalizedFallback) {
    return normalizedFallback
  }

  return videoId ? `YouTube Video ${videoId}` : 'YouTube Video'
}

function extractChannelName(playerResponse: unknown, fallbackChannelName?: string): string {
  const responseChannel = (
    playerResponse as {
      videoDetails?: {
        author?: unknown
      }
    }
  )?.videoDetails?.author
  if (typeof responseChannel === 'string' && responseChannel.trim()) {
    return responseChannel.trim()
  }

  const normalizedFallback = normalizeWhitespace(fallbackChannelName ?? '')
  if (normalizedFallback) {
    return normalizedFallback
  }

  return 'Unknown Channel'
}

function parseYouTubeCaptionJson(raw: string): YouTubeTranscriptSegment[] {
  const payload = safeParseJson<{
    events?: Array<{
      tStartMs?: unknown
      segs?: Array<{ utf8?: unknown }>
    }>
  }>(raw)

  if (!payload?.events) {
    return []
  }

  return payload.events.flatMap((event) => {
    if (typeof event?.tStartMs !== 'number' || !Array.isArray(event.segs)) {
      return []
    }

    const text = normalizeWhitespace(
      event.segs
        .map((segment) => (typeof segment?.utf8 === 'string' ? segment.utf8 : ''))
        .join(''),
    )
    if (!text) {
      return []
    }

    return [{
      startSeconds: event.tStartMs / 1000,
      text,
    }]
  })
}

function parseCaptionResponse(raw: string): YouTubeTranscriptSegment[] {
  const trimmed = raw.trim()
  if (!trimmed) {
    return []
  }
  if (trimmed.startsWith('{')) {
    return parseYouTubeCaptionJson(trimmed)
  }
  return parseYouTubeCaptionXml(trimmed)
}

export function parseYouTubeCaptionXml(rawXml: string): YouTubeTranscriptSegment[] {
  const xml = new DOMParser().parseFromString(rawXml, 'text/xml')
  const root = xml.documentElement
  if (!root || root.querySelector('parsererror')) {
    return []
  }

  const nodes = Array.from(root.querySelectorAll('text, p'))

  return nodes.flatMap((node) => {
    const startRaw = node.getAttribute('start')
    if (!startRaw) {
      return []
    }

    const startSeconds = Number.parseFloat(startRaw)
    if (!Number.isFinite(startSeconds)) {
      return []
    }

    const text = normalizeWhitespace(node.textContent ?? '')
    if (!text) {
      return []
    }

    return [{ startSeconds, text }]
  })
}

export function extractYouTubeVideoId(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const hostname = parsed.hostname.toLowerCase()
  if (!hostname.includes('youtube.com')) {
    return null
  }

  if (parsed.pathname === '/watch') {
    const videoId = parsed.searchParams.get('v')
    return videoId?.trim() || null
  }

  if (parsed.pathname.startsWith('/shorts/')) {
    const [, , videoId] = parsed.pathname.split('/')
    return videoId?.trim() || null
  }

  return null
}

export async function collectYouTubeTranscript({
  url,
  playerResponse,
  occurredAt,
  fetchImpl,
  fallbackTitle,
  fallbackChannelName,
}: TranscriptCollectorOptions): Promise<YouTubeTranscriptPayload | null> {
  const videoId = extractYouTubeVideoId(url)
  if (!videoId) {
    return null
  }

  const track = pickPreferredCaptionTrack(extractCaptionTracks(playerResponse))
  if (!track) {
    return null
  }

  const response = await fetchImpl(track.baseUrl)
  if (!response.ok) {
    return null
  }

  const rawTranscript = await response.text()
  const segments = parseCaptionResponse(rawTranscript)
  if (segments.length === 0) {
    return null
  }

  const transcriptSource: YouTubeTranscriptSource = track.kind === 'asr' ? 'auto' : 'manual'

  return {
    occurredAt,
    videoId,
    videoUrl: url,
    videoTitle: extractVideoTitle(playerResponse, fallbackTitle, videoId),
    channelName: extractChannelName(playerResponse, fallbackChannelName),
    languageCode: track.languageCode,
    transcriptSource,
    segments,
  }
}

export function getYouTubePlayerResponse(windowObj: Window = window): unknown {
  const typedWindow = windowObj as Window & {
    ytInitialPlayerResponse?: unknown
    ytplayer?: {
      config?: {
        args?: {
          raw_player_response?: unknown
          player_response?: unknown
        }
      }
    }
  }

  if (typedWindow.ytInitialPlayerResponse) {
    return typedWindow.ytInitialPlayerResponse
  }

  const rawPlayerResponse = typedWindow.ytplayer?.config?.args?.raw_player_response
  if (rawPlayerResponse) {
    return typeof rawPlayerResponse === 'string'
      ? safeParseJson(rawPlayerResponse)
      : rawPlayerResponse
  }

  const playerResponse = typedWindow.ytplayer?.config?.args?.player_response
  if (typeof playerResponse === 'string') {
    return safeParseJson(playerResponse)
  }

  return playerResponse ?? null
}

export function createYouTubeTranscriptMonitor({
  getUrl,
  getPlayerResponse,
  fetchImpl,
  now = () => new Date(),
  sendMessage,
}: TranscriptMonitorDeps) {
  let activeVideoId: string | null = null
  let sentVideoId: string | null = null
  let inFlightVideoId: string | null = null

  function syncVideoId(url: string): string | null {
    const nextVideoId = extractYouTubeVideoId(url)
    if (nextVideoId !== activeVideoId) {
      activeVideoId = nextVideoId
      sentVideoId = null
      inFlightVideoId = null
    }
    return nextVideoId
  }

  return {
    handleUrlChange(url: string) {
      syncVideoId(url)
    },

    async handlePlaybackStart(): Promise<boolean> {
      const url = getUrl()
      const videoId = syncVideoId(url)
      if (!videoId || sentVideoId === videoId || inFlightVideoId === videoId) {
        return false
      }

      inFlightVideoId = videoId
      try {
        const payload = await collectYouTubeTranscript({
          url,
          playerResponse: getPlayerResponse(),
          occurredAt: formatJstOccurredAt(now()),
          fetchImpl,
        })
        if (!payload) {
          return false
        }

        await sendMessage(payload)
        sentVideoId = videoId
        return true
      } finally {
        if (inFlightVideoId === videoId) {
          inFlightVideoId = null
        }
      }
    },
  }
}

export function setupYouTubeTranscriptWatcher({
  windowObj = window,
  documentObj = document,
  fetchImpl = fetch.bind(globalThis),
}: TranscriptWatcherOptions = {}) {
  const sendMessage = async (payload: YouTubeTranscriptPayload) => {
    await chrome.runtime.sendMessage({
      type: 'YOUTUBE_TRANSCRIPT_READY',
      payload,
    }).catch(() => undefined)
  }

  const monitor = createYouTubeTranscriptMonitor({
    getUrl: () => windowObj.location.href,
    getPlayerResponse: () => getYouTubePlayerResponse(windowObj),
    fetchImpl,
    sendMessage,
  })

  let attachedVideo: HTMLVideoElement | null = null

  const onVideoPlay = () => {
    void monitor.handlePlaybackStart()
  }

  const bindCurrentVideo = () => {
    const nextVideo = documentObj.querySelector('video')
    const normalizedVideo = nextVideo instanceof HTMLVideoElement ? nextVideo : null
    if (normalizedVideo === attachedVideo) {
      return
    }

    attachedVideo?.removeEventListener('play', onVideoPlay)
    attachedVideo = normalizedVideo
    attachedVideo?.addEventListener('play', onVideoPlay)

    if (attachedVideo && !attachedVideo.paused && !attachedVideo.ended) {
      void monitor.handlePlaybackStart()
    }
  }

  const observer = new MutationObserver(() => {
    bindCurrentVideo()
  })

  if (documentObj.documentElement) {
    observer.observe(documentObj.documentElement, {
      childList: true,
      subtree: true,
    })
  }

  bindCurrentVideo()
  monitor.handleUrlChange(windowObj.location.href)

  return {
    handleUrlChange(url: string) {
      monitor.handleUrlChange(url)
      bindCurrentVideo()
      if (attachedVideo && !attachedVideo.paused && !attachedVideo.ended) {
        void monitor.handlePlaybackStart()
      }
    },

    disconnect() {
      observer.disconnect()
      attachedVideo?.removeEventListener('play', onVideoPlay)
      attachedVideo = null
    },
  }
}
