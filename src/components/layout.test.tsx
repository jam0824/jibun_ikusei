import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { BottomNav } from '@/components/layout'

function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function renderBottomNav(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationDisplay />
      <Routes>
        <Route
          path="*"
          element={
            <div>
              <BottomNav />
            </div>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('BottomNav', () => {
  it('renders the four primary destinations and does not render skills as a primary tab', () => {
    renderBottomNav('/growth')

    expect(screen.getByRole('link', { name: 'ホーム' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'クエスト' })).toHaveAttribute('href', '/quests')
    expect(screen.getByRole('link', { name: '成長' })).toHaveAttribute('href', '/growth')
    expect(screen.getByRole('link', { name: '記録' })).toHaveAttribute('href', '/records')
    expect(screen.queryByRole('link', { name: 'スキル' })).not.toBeInTheDocument()
  })

  it('opens the add action sheet and closes it on outside click, escape, and selection', () => {
    renderBottomNav()

    fireEvent.click(screen.getByRole('button', { name: '追加メニューを開く' }))

    expect(screen.getByRole('button', { name: /クエスト追加/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /食事登録/ })).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('追加メニューを閉じる'))
    expect(screen.queryByRole('button', { name: /クエスト追加/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '追加メニューを開く' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: /クエスト追加/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '追加メニューを開く' }))
    fireEvent.click(screen.getByRole('button', { name: /食事登録/ }))

    expect(screen.getByTestId('location')).toHaveTextContent('/meal')
    expect(screen.queryByRole('button', { name: /クエスト追加/ })).not.toBeInTheDocument()
  })
})
