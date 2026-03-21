import { describe, expect, it, vi } from 'vitest'
import type { QuestEvent } from '@ext/background/quest-evaluator'

// Mock chrome.tabs and chrome.notifications
vi.mock('webextension-polyfill', () => ({}))

// We need to test eventToToast which is not exported, so we test via sendToastToActiveTab
// Instead, let's test the message content by importing the module and checking behavior
import { sendToastToActiveTab } from '@ext/lib/notifications'

describe('notifications', () => {
  it('初回報酬で「学習クエスト達成です」メッセージを送る', async () => {
    const mockTab = { id: 1 }
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([mockTab as chrome.tabs.Tab])
    const sendMessageSpy = vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue(undefined)

    const event: QuestEvent = { type: 'good_quest', xp: 2, isFirstReward: true }
    await sendToastToActiveTab(event)

    expect(sendMessageSpy).toHaveBeenCalledWith(1, {
      type: 'SHOW_TOAST',
      payload: {
        text: 'Lily: 学習クエスト達成です。+2 XP 獲得しました。',
        variant: 'good',
      },
    })
  })

  it('追加報酬で「集中が続いていますね」メッセージを送る', async () => {
    const mockTab = { id: 1 }
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([mockTab as chrome.tabs.Tab])
    const sendMessageSpy = vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue(undefined)

    const event: QuestEvent = { type: 'good_quest', xp: 2, isFirstReward: false }
    await sendToastToActiveTab(event)

    expect(sendMessageSpy).toHaveBeenCalledWith(1, {
      type: 'SHOW_TOAST',
      payload: {
        text: 'Lily: 集中が続いていますね。さらに +2 XP です。',
        variant: 'good',
      },
    })
  })

  it('バッドクエストのメッセージを送る', async () => {
    const mockTab = { id: 1 }
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([mockTab as chrome.tabs.Tab])
    const sendMessageSpy = vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue(undefined)

    const event: QuestEvent = { type: 'bad_quest', xp: -5 }
    await sendToastToActiveTab(event)

    expect(sendMessageSpy).toHaveBeenCalledWith(1, {
      type: 'SHOW_TOAST',
      payload: {
        text: 'Lily: 少し長く滞在しすぎたかもしれません。今回は -5 XP です。',
        variant: 'bad',
      },
    })
  })
})
