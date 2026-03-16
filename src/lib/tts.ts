const audioCache = new Map<string, string>()

export async function playAudioUrl(cacheKey: string, audioUrl: string) {
  audioCache.set(cacheKey, audioUrl)
  const audio = new Audio(audioUrl)
  audio.preload = 'auto'
  await audio.play()
}

export function getCachedAudio(cacheKey: string) {
  return audioCache.get(cacheKey)
}

export function playWithSpeechSynthesis(text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    throw new Error('Speech synthesis is not supported.')
  }

  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'ja-JP'
  utterance.rate = 1.02
  window.speechSynthesis.speak(utterance)
}
