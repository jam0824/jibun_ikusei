import type { QuestEvent } from '@ext/background/quest-evaluator'

export type ToastVariant = 'good' | 'warning' | 'bad' | 'info'

interface ToastPayload {
  text: string
  variant: ToastVariant
}

function eventToToast(event: QuestEvent): ToastPayload | null {
  switch (event.type) {
    case 'good_quest':
      if (event.isFirstReward) {
        return {
          text: 'Lily: 学習クエスト達成です。+2 XP 獲得しました。',
          variant: 'good',
        }
      }
      return {
        text: `Lily: 集中が続いていますね。さらに +${event.xp} XP です。`,
        variant: 'good',
      }
    case 'warning':
      return {
        text: 'Lily: もうすぐ1時間です。このまま続けるか、一度切り上げるか考えてみましょう。',
        variant: 'warning',
      }
    case 'bad_quest':
      return {
        text: `Lily: 少し長く滞在しすぎたかもしれません。今回は ${event.xp} XP です。`,
        variant: 'bad',
      }
    default:
      return null
  }
}

/** Send a classification toast to a specific tab */
export async function sendClassificationToastToTab(
  tabId: number,
  category: string,
  isGrowth: boolean,
): Promise<void> {
  const text = isGrowth
    ? `Lily: 「${category}」ですね。記録を始めます。`
    : `Lily: 「${category}」に分類しました。`

  const payload: ToastPayload = { text, variant: 'info' }

  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SHOW_TOAST', payload })
  } catch {
    // Content script may not be injected — silently ignore for classification toasts
  }
}

/** Send a toast notification to the active tab's content script */
export async function sendToastToActiveTab(event: QuestEvent): Promise<void> {
  const toast = eventToToast(event)
  if (!toast) return

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_TOAST', payload: toast })
    }
  } catch {
    // Content script may not be injected — fall back to system notification
    chrome.notifications.create(`quest-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon-48.png',
      title: '自分育成',
      message: toast.text,
    })
  }
}
