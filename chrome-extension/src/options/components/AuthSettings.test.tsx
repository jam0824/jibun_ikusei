import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    fetchMock.mockReset()
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: true })
    defaultProps.onSave.mockReset()
  })

  describe('接続確認', () => {
    it('接続確認ボタンが表示される', () => {
      render(<AuthSettings {...defaultProps} />)
      expect(screen.getByText('接続確認')).toBeDefined()
    })

    it('サーバーに接続成功したとき成功メッセージを表示する', async () => {
      await setLocal('authState', createMockAuthState())
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response)

      render(<AuthSettings {...defaultProps} />)
      fireEvent.click(screen.getByText('接続確認'))

      await waitFor(() => {
        expect(screen.getByText(/接続 OK/)).toBeDefined()
      })
    })

    it('401 が返ったとき未認証メッセージを表示する', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as Response)

      render(<AuthSettings {...defaultProps} />)
      fireEvent.click(screen.getByText('接続確認'))

      await waitFor(() => {
        expect(screen.getByText(/ログイン情報が有効ではありません/)).toBeDefined()
      })
    })

    it('ネットワークエラーのとき接続失敗メッセージを表示する', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network Error'))

      render(<AuthSettings {...defaultProps} />)
      fireEvent.click(screen.getByText('接続確認'))

      await waitFor(() => {
        expect(screen.getByText(/サーバーに接続できません/)).toBeDefined()
      })
    })

    it('serverBaseUrl が空のとき確認せずエラーメッセージを表示する', () => {
      render(<AuthSettings {...defaultProps} serverBaseUrl="" />)
      fireEvent.click(screen.getByText('接続確認'))

      expect(fetchMock).not.toHaveBeenCalled()
      expect(screen.getByText('サーバー URL を入力してください')).toBeDefined()
    })

    it('確認中はボタンが無効になる', async () => {
      fetchMock.mockImplementationOnce(() => new Promise(() => {}))

      render(<AuthSettings {...defaultProps} />)
      const button = screen.getByText('接続確認')
      fireEvent.click(button)

      await waitFor(() => {
        expect(screen.getByText('接続確認中...')).toBeDefined()
      })
    })
  })

  describe('同期状態クリア', () => {
    it('URL 変更保存時に CLEAR_SYNC_STATE を送ってから保存する', async () => {
      render(<AuthSettings {...defaultProps} />)

      fireEvent.change(screen.getByPlaceholderText('https://api.example.com'), {
        target: { value: 'https://new.example.com' },
      })
      fireEvent.click(screen.getByText('URL 保存'))

      await waitFor(() => {
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'CLEAR_SYNC_STATE' })
      })
      expect(defaultProps.onSave).toHaveBeenCalledWith('https://new.example.com', '')
    })

    it('ログアウト時に CLEAR_SYNC_STATE を送り authToken を空で保存する', async () => {
      await setLocal('authState', createMockAuthState())

      render(<AuthSettings {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('ログアウト')).toBeDefined()
      })

      fireEvent.click(screen.getByText('ログアウト'))

      await waitFor(() => {
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'CLEAR_SYNC_STATE' })
      })
      expect(defaultProps.onSave).toHaveBeenCalledWith('https://api.example.com', '')
    })
  })
})
