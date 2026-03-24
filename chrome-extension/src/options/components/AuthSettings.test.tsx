import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { setLocal } from '@ext/lib/storage'
import { createMockAuthState } from '@ext/test/helpers'
import { AuthSettings } from './AuthSettings'

const fetchMock = vi.fn()
globalThis.fetch = fetchMock

describe('AuthSettings', () => {
  const defaultProps = {
    serverBaseUrl: 'https://api.example.com',
    syncEnabled: true,
    onSave: vi.fn(),
  }

  beforeEach(() => {
    fetchMock.mockClear()
  })

  describe('疎通確認ボタン', () => {
    it('疎通確認ボタンが表示される', () => {
      render(<AuthSettings {...defaultProps} />)
      expect(screen.getByText('疎通確認')).toBeDefined()
    })

    it('サーバーに接続成功したとき成功メッセージを表示する', async () => {
      await setLocal('authState', createMockAuthState())
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response)

      render(<AuthSettings {...defaultProps} />)
      fireEvent.click(screen.getByText('疎通確認'))

      await waitFor(() => {
        expect(screen.getByText(/接続OK/)).toBeDefined()
      })
    })

    it('401が返ったときサーバー到達可能・未認証メッセージを表示する', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as Response)

      render(<AuthSettings {...defaultProps} />)
      fireEvent.click(screen.getByText('疎通確認'))

      await waitFor(() => {
        expect(screen.getByText(/サーバーには接続できていますが、ログインが必要です/)).toBeDefined()
      })
    })

    it('ネットワークエラーのとき接続失敗メッセージを表示する', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network Error'))

      render(<AuthSettings {...defaultProps} />)
      fireEvent.click(screen.getByText('疎通確認'))

      await waitFor(() => {
        expect(screen.getByText(/サーバーに接続できません/)).toBeDefined()
      })
    })

    it('serverBaseUrlが空のとき確認せずエラーメッセージを表示する', async () => {
      render(<AuthSettings {...defaultProps} serverBaseUrl="" />)
      fireEvent.click(screen.getByText('疎通確認'))

      expect(fetchMock).not.toHaveBeenCalled()
      expect(screen.getByText(/サーバーURLを入力してください/)).toBeDefined()
    })

    it('確認中はボタンが無効になる', async () => {
      fetchMock.mockImplementationOnce(() => new Promise(() => {})) // 永遠にpending

      render(<AuthSettings {...defaultProps} />)
      const button = screen.getByText('疎通確認')
      fireEvent.click(button)

      await waitFor(() => {
        expect(screen.getByText('確認中...')).toBeDefined()
      })
    })
  })
})
