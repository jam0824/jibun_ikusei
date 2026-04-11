export type YouTubeTranscriptSource = 'manual' | 'auto'

export type YouTubeTranscriptSegment = {
  startSeconds: number
  text: string
}

export type YouTubeTranscriptPayload = {
  occurredAt: string
  videoId: string
  videoUrl: string
  videoTitle: string
  channelName: string
  languageCode: string
  transcriptSource: YouTubeTranscriptSource
  segments: YouTubeTranscriptSegment[]
}
