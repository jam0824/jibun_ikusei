import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import App from '@/App'
import { SCRAP_SHARE_LANDING_RESET_KEY } from '@/lib/scrap-article'

const loginMock = vi.fn()
const isLoggedInMock = vi.fn()
const initializeMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  isLoggedIn: () => isLoggedInMock(),
  login: (...args: unknown[]) => loginMock(...args),
  setNewPassword: vi.fn(),
}))

vi.mock('@/store/app-store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      initialize: initializeMock,
      consumePendingScrapShare: vi.fn().mockResolvedValue({ ok: false }),
      scrapArticles: [],
      scrapShareMessage: undefined,
      clearScrapShareMessage: vi.fn(),
      setScrapArticleStatus: vi.fn(),
      deleteScrapArticle: vi.fn(),
    }),
}))

vi.mock('@/screens/home-screen', () => ({
  HomeScreen: () => <div>home</div>,
}))

vi.mock('@/screens/growth-screen', () => ({
  GrowthScreen: () => <div>growth</div>,
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
    window.localStorage.removeItem(SCRAP_SHARE_LANDING_RESET_KEY)
  })

  function mockStandalonePwa(matches: boolean) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(display-mode: standalone)' ? matches : false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  }

  it('returns to the original deep link after login succeeds', async () => {
    window.location.hash = '#/growth'

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

    expect(window.location.hash).toBe('#/growth')
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

  it('resets the previous Android share landing route on the next normal PWA launch', async () => {
    isLoggedInMock.mockResolvedValue(true)
    window.location.hash = '#/records/scraps'
    window.localStorage.setItem(SCRAP_SHARE_LANDING_RESET_KEY, '1')

    render(<App />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.location.hash).toBe('#/')
    expect(window.localStorage.getItem(SCRAP_SHARE_LANDING_RESET_KEY)).toBeNull()
  })

  it('resets a stale scraps route on standalone PWA launch even without the share flag', async () => {
    isLoggedInMock.mockResolvedValue(true)
    mockStandalonePwa(true)
    window.location.hash = '#/records/scraps'

    render(<App />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.location.hash).toBe('#/')
  })
})
