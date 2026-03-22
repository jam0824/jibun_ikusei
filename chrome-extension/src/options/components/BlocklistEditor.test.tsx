import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BlocklistEditor } from './BlocklistEditor'

describe('BlocklistEditor', () => {
  it('フルURLを入力してもドメインのみが保存される', () => {
    const onSave = vi.fn()
    render(<BlocklistEditor blocklist={[]} onSave={onSave} />)

    const input = screen.getByPlaceholderText('例: twitter.com')
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/' } })
    fireEvent.click(screen.getByText('追加'))

    expect(onSave).toHaveBeenCalledWith(['www.youtube.com'])
  })

  it('プロトコルなしのドメインはそのまま保存される', () => {
    const onSave = vi.fn()
    render(<BlocklistEditor blocklist={[]} onSave={onSave} />)

    const input = screen.getByPlaceholderText('例: twitter.com')
    fireEvent.change(input, { target: { value: 'twitter.com' } })
    fireEvent.click(screen.getByText('追加'))

    expect(onSave).toHaveBeenCalledWith(['twitter.com'])
  })

  it('パス付きURLでもドメインのみ抽出される', () => {
    const onSave = vi.fn()
    render(<BlocklistEditor blocklist={[]} onSave={onSave} />)

    const input = screen.getByPlaceholderText('例: twitter.com')
    fireEvent.change(input, { target: { value: 'https://x.com/home' } })
    fireEvent.click(screen.getByText('追加'))

    expect(onSave).toHaveBeenCalledWith(['x.com'])
  })

  it('大文字入力は小文字に正規化される', () => {
    const onSave = vi.fn()
    render(<BlocklistEditor blocklist={[]} onSave={onSave} />)

    const input = screen.getByPlaceholderText('例: twitter.com')
    fireEvent.change(input, { target: { value: 'YouTube.COM' } })
    fireEvent.click(screen.getByText('追加'))

    expect(onSave).toHaveBeenCalledWith(['youtube.com'])
  })

  it('重複するドメインは追加されない', () => {
    const onSave = vi.fn()
    render(<BlocklistEditor blocklist={['youtube.com']} onSave={onSave} />)

    const input = screen.getByPlaceholderText('例: twitter.com')
    fireEvent.change(input, { target: { value: 'youtube.com' } })
    fireEvent.click(screen.getByText('追加'))

    expect(onSave).not.toHaveBeenCalled()
  })

  it('既存のフルURL登録も表示時にドメインに正規化される', () => {
    const onSave = vi.fn()
    render(<BlocklistEditor blocklist={['https://www.youtube.com/', 'x.com']} onSave={onSave} />)

    // 正規化されたドメインが表示される
    expect(screen.getByText('www.youtube.com')).toBeDefined()
    expect(screen.getByText('x.com')).toBeDefined()
  })
})
