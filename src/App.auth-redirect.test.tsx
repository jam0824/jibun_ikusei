import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import App from '@/App'

const loginMock = vi.fn()
const isLoggedInMock = vi.fn()
const initializeMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  isLoggedIn: () => isLoggedInMock(),
  login: (...args: unknown[]) => loginMock(...args),
  setNewPassword: vi.fn(),
}))

vi.mock('@/store/app-store', () => ({
  useAppStore: (selector: (state: { initialize: () => void }) => unknown) =>
    selector({
      initialize: initializeMock,
    }),
}))

vi.mock('@/screens/home-screen', () => ({
  HomeScreen: () => <div>home</div>,
}))

describe('App auth redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    isLoggedInMock.mockResolvedValue(false)
    loginMock.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    window.location.hash = ''
  })

  it('returns to the original deep link after login succeeds', async () => {
    window.location.hash = '#/records/activity/search'

    render(<App />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'test@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.location.hash).toBe('#/records/activity/search')
    expect(initializeMock).toHaveBeenCalled()
  })

  it('falls back to home when returnTo is invalid', async () => {
    window.location.hash = '#/login?returnTo=%2F%2Fevil.example.com'

    render(<App />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'test@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.location.hash).toBe('#/')
  })
})
