import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiKeySettings } from './ApiKeySettings'

const fetchMock = vi.fn()
globalThis.fetch = fetchMock

describe('ApiKeySettings', () => {
  const defaultProps = {
    settings: {
      aiProvider: 'openai' as const,
      openaiApiKey: 'sk-test',
      geminiApiKey: '',
      blocklist: [],
      serverBaseUrl: '',
      syncEnabled: false,
      notificationsEnabled: true,
    },
    onSave: vi.fn(),
  }

  beforeEach(() => {
    fetchMock.mockReset()
    defaultProps.onSave.mockReset()
  })

  it('OpenAIラベルに gpt-5.4-nano を表示する', () => {
    render(<ApiKeySettings {...defaultProps} />)

    expect(screen.getByLabelText('OpenAI (gpt-5.4-nano)')).toBeDefined()
  })

  it('OpenAI接続テストで gpt-5.4-nano を使う', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    render(<ApiKeySettings {...defaultProps} />)
    fireEvent.click(screen.getByText('接続テスト'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce()
    })

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(options.body as string)
    expect(body.model).toBe('gpt-5.4-nano')
  })
})
