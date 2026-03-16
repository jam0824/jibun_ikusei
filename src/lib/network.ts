export class OfflineFeatureError extends Error {
  constructor(feature: string) {
    super(`${feature}はオフラインでは利用できません。ネットワーク接続を確認してください。`)
    this.name = 'OfflineFeatureError'
  }
}

export function isOffline() {
  return typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine
}

export function createOfflineError(feature: string) {
  return new OfflineFeatureError(feature)
}

export function getOfflineMessage(feature: string) {
  return createOfflineError(feature).message
}
