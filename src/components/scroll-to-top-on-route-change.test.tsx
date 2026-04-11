import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { ScrollToTopOnRouteChange } from '@/components/scroll-to-top-on-route-change'

function renderRouter(initialEntry = '/home') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ScrollToTopOnRouteChange />
      <nav>
        <Link to="/home">home</Link>
        <Link to="/records">records</Link>
        <Link to="/records?tab=week">records-week</Link>
      </nav>
      <Routes>
        <Route path="/home" element={<div>home screen</div>} />
        <Route path="/records" element={<div>records screen</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ScrollToTopOnRouteChange', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
  })

  it('resets scroll position when moving to another screen', async () => {
    const user = userEvent.setup()

    renderRouter()
    vi.mocked(window.scrollTo).mockClear()

    document.documentElement.scrollTop = 240
    document.body.scrollTop = 120

    await user.click(screen.getByRole('link', { name: 'records' }))

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' })
    expect(document.documentElement.scrollTop).toBe(0)
    expect(document.body.scrollTop).toBe(0)
  })

  it('resets scroll position when only search params change', async () => {
    const user = userEvent.setup()

    renderRouter('/records')
    vi.mocked(window.scrollTo).mockClear()

    document.documentElement.scrollTop = 320
    document.body.scrollTop = 180

    await user.click(screen.getByRole('link', { name: 'records-week' }))

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' })
    expect(document.documentElement.scrollTop).toBe(0)
    expect(document.body.scrollTop).toBe(0)
  })
})
