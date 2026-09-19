import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ShareCard, { SHARE_CARD_WIDTH } from '../features/reader/components/share/ShareCard'
import { EXCERPT_MAX_CHARS, NOTE_MAX_CHARS, QUOTE_MAX_CHARS } from '../features/reader/components/share/share-text'

const base = {
  text: '白君确实有招蜂引蝶的资本',
  title: '不平静的日常',
  author: '惰天使',
  chapter: '第三十二章',
}

describe('ShareCard', () => {
  it('renders excerpt, attribution, author and watermark', () => {
    render(<ShareCard {...base} />)
    expect(screen.getByText(base.text)).toBeTruthy()
    expect(screen.getByText(/不平静的日常/)).toBeTruthy()
    expect(screen.getByText(/第三十二章/)).toBeTruthy()
    expect(screen.getByText('惰天使')).toBeTruthy()
    expect(screen.getByText('Bookdock')).toBeTruthy()
  })

  it('degrades the attribution when chapter is null', () => {
    render(<ShareCard {...base} chapter={null} />)
    expect(screen.getByText('不平静的日常')).toBeTruthy()
    expect(screen.queryByText(/第三十二章/)).toBeNull()
  })

  it('hides the author line when author is empty', () => {
    const { container } = render(<ShareCard {...base} author="" />)
    const attribution = screen.getByText(/不平静的日常/).closest('div')!
    expect(attribution.querySelectorAll('p')).toHaveLength(1)
    expect(container).toBeTruthy()
  })

  it('truncates over-limit excerpts for display', () => {
    render(<ShareCard {...base} text={'长'.repeat(EXCERPT_MAX_CHARS + 50)} />)
    expect(screen.getByText(`${'长'.repeat(EXCERPT_MAX_CHARS)}……`)).toBeTruthy()
  })

  it('truncates idea notes and quoted excerpts at their separate limits', () => {
    render(
      <ShareCard
        {...base}
        text={'原'.repeat(QUOTE_MAX_CHARS + 1)}
        note={'想'.repeat(NOTE_MAX_CHARS + 1)}
        authorName="愚者"
      />,
    )
    expect(screen.getByText(`${'想'.repeat(NOTE_MAX_CHARS)}……`)).toBeTruthy()
    expect(screen.getByText(`${'原'.repeat(QUOTE_MAX_CHARS)}……`)).toBeTruthy()
  })

  it('renders at the fixed card width', () => {
    const { container } = render(<ShareCard {...base} />)
    expect((container.firstElementChild as HTMLElement).style.width).toBe(`${SHARE_CARD_WIDTH}px`)
  })

  it('renders the idea layout: identity row, note body, small quote', () => {
    render(
      <ShareCard
        {...base}
        text="荥阳"
        note="四百年前楚汉也在这拉锯"
        authorName="愚者"
        writtenAt="写于 2024/5/30"
      />,
    )
    expect(screen.getByText('四百年前楚汉也在这拉锯')).toBeTruthy()
    expect(screen.getByText('愚者')).toBeTruthy()
    expect(screen.getByText('写于 2024/5/30')).toBeTruthy()
    expect(screen.getByText('愚')).toBeTruthy() // avatar first-char placeholder
    expect(screen.getByText('荥阳')).toBeTruthy() // quoted excerpt
  })

  it('hides the quote block on an idea card without excerpt text', () => {
    const { container } = render(
      <ShareCard {...base} text="" note="纯想法" authorName="愚者" />,
    )
    expect(screen.getByText('纯想法')).toBeTruthy()
    expect(container.querySelector('[data-kind="idea"]')).toBeTruthy()
    expect(screen.queryByText(base.text)).toBeNull()
  })

  it('renders the calendar template with guillemets around the title', () => {
    const { container } = render(<ShareCard {...base} template="calendar" />)
    expect(container.querySelector('[data-template="calendar"]')).toBeTruthy()
    expect(screen.getByText(/不平静的日常/)).toBeTruthy()
    expect(screen.getByText('惰天使')).toBeTruthy()
  })

  it('calendar idea card omits the identity header', () => {
    const { container } = render(<ShareCard {...base} template="calendar" note="想法" authorName="愚者" writtenAt="写于 2024/5/30" />)
    expect(container.querySelector('[data-kind="idea"]')).toBeTruthy()
    expect(screen.queryByText('愚者')).toBeNull()
    expect(screen.queryByText(/写于/)).toBeNull()
  })

  it('ink idea card uses the Chinese-numeral date and drops the avatar', () => {
    render(
      <ShareCard {...base} template="ink" note="想法" authorName="愚者" writtenAtCn="写于二〇二四年五月三十日" />,
    )
    expect(screen.getByText('写于二〇二四年五月三十日')).toBeTruthy()
    expect(screen.getByText('愚者')).toBeTruthy()
    expect(screen.queryByText('愚')).toBeNull() // no first-char avatar circle
  })

  it('brocade idea card shows the identity exactly once (no footer repeat)', () => {
    render(<ShareCard {...base} template="brocade" note="想法" authorName="愚者" writtenAt="写于 2024/5/30" />)
    expect(screen.getAllByText('愚者')).toHaveLength(1)
    expect(screen.queryByText(/愚者 · 写于/)).toBeNull()
  })

  it('renders the brand per prefs: Bookdock / 书坞 / hidden', () => {
    const { rerender } = render(<ShareCard {...base} brand="en" />)
    expect(screen.getByText('Bookdock')).toBeTruthy()
    rerender(<ShareCard {...base} brand="zh" />)
    expect(screen.getByText('书坞')).toBeTruthy()
    rerender(<ShareCard {...base} brand="off" />)
    expect(screen.queryByText('Bookdock')).toBeNull()
    expect(screen.queryByText('书坞')).toBeNull()
  })

  it('classic idea card stacks the avatar above the name', () => {
    const { container } = render(
      <ShareCard {...base} note="想法" authorName="愚者" writtenAt="写于 2024/5/30" />,
    )
    expect(container.querySelector('[data-identity="stacked"]')).toBeTruthy()
  })

  it('renders the ink template with a vertical title and chapter attribution', () => {
    const { container } = render(<ShareCard {...base} template="ink" />)
    expect(container.querySelector('[data-template="ink"]')).toBeTruthy()
    expect(screen.getByText('不平静的日常')).toBeTruthy()
    expect(screen.getByText('第三十二章')).toBeTruthy()
  })

  it('renders the brocade template without ink bars', () => {
    const { container } = render(<ShareCard {...base} template="brocade" />)
    expect(container.querySelector('[data-template="brocade"]')).toBeTruthy()
    expect(screen.getByText('不平静的日常')).toBeTruthy()
  })

  it('renders the letter template with title · chapter attribution', () => {
    render(<ShareCard {...base} template="letter" />)
    expect(screen.getByText(/不平静的日常/)).toBeTruthy()
    expect(screen.getByText(/第三十二章/)).toBeTruthy()
  })

  it('applies background colors and font stack to the card root', () => {
    const { container } = render(<ShareCard {...base} background="black" fontStack='"KaiTi", serif' />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.background).toBe('rgb(28, 25, 23)')
    expect(root.style.fontFamily).toContain('KaiTi')
  })
})
