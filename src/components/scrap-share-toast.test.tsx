import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ScrapShareToast } from '@/components/scrap-share-toast'
import { useAppStore } from '@/store/app-store'

describe('ScrapShareToast', () => {
  beforeEach(() => {
    useAppStore.setState({ scrapShareMessage: undefined })
  })

  it('renders nothing when there is no share message', () => {
    const { container } = render(<ScrapShareToast />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the saved message', () => {
    useAppStore.setState({
      scrapShareMessage: { tone: 'success', text: '記事を保存しました。' },
    })

    render(<ScrapShareToast />)

    expect(screen.getByText('記事を保存しました。')).toBeInTheDocument()
  })

  it('clears the message when the close button is pressed', () => {
    useAppStore.setState({
      scrapShareMessage: { tone: 'warning', text: '保存済みの記事です。' },
    })

    render(<ScrapShareToast />)

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))

    expect(useAppStore.getState().scrapShareMessage).toBeUndefined()
  })
})
