// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraph } from '../graph/store'
import { words } from '../shared/words'
import { OverlayProvider } from '../ui/overlays'
import { HighlighterTray } from './HighlighterTray'

const highlightStyles = readFileSync('src/styles/120-highlights.css', 'utf8')
const primitiveStyles = readFileSync('src/styles/005-primitives.css', 'utf8')

describe('Highlighter tray design-system outcomes', () => {
  beforeEach(() => {
    useGraph.setState({
      activeTool: 'highlight',
      highlights: [],
      highlightTags: [
        {
          id: 'tag-1',
          name: 'Important',
          color: 'yellow',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
      activeHighlightTagId: 'tag-1',
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('uses the shared button, popover menu, field, menu-item, and icon-action grammar', async () => {
    const user = userEvent.setup()
    render(<HighlighterTray />)

    const trigger = screen.getByRole('button', { name: /Important/ })
    expect(trigger).toHaveClass('e-button')
    expect(trigger.querySelector('.tag-name')).toHaveClass('t-value')
    await user.click(trigger)

    expect(screen.getByRole('menu', { name: words.highlightTags })).toHaveClass('e-menu')
    expect(screen.getByRole('textbox', { name: words.highlightTagPlaceholder })).toHaveClass('e-field')
    const activeTag = screen.getByRole('menuitem', { name: 'Important' })
    expect(activeTag).toHaveClass('e-menu__item')
    expect(activeTag).toHaveAttribute('aria-current', 'true')
    expect(highlightStyles).toMatch(
      /\.tag-menu-row\.active \.tag-menu-pick\s*\{[^}]*background:\s*var\(--e-ink\);[^}]*color:\s*var\(--e-on-solid\);/s,
    )
    expect(highlightStyles).not.toMatch(/\.tag-menu-pick svg\s*\{[^}]*color:/s)
    expect(highlightStyles).not.toContain('.tb-count')
    expect(
      screen.getByRole('menuitem', { name: `${words.highlightTagOptions}: Important` }),
    ).toHaveClass('e-icon-button', 'e-button--ghost')
  })

  it('closes a searched menu on one Escape and restores the exact trigger focus', async () => {
    const user = userEvent.setup()
    render(<HighlighterTray />)

    const trigger = screen.getByRole('button', { name: /Important/ })
    await user.click(trigger)
    const search = screen.getByRole('textbox', { name: words.highlightTagPlaceholder })
    expect(search).toHaveFocus()
    await user.type(search, 'port')

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu', { name: words.highlightTags })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(useGraph.getState().activeTool).toBe('highlight')
  })

  it('moves from search into the menu-item path with arrow keys', async () => {
    const user = userEvent.setup()
    render(<HighlighterTray />)

    await user.click(screen.getByRole('button', { name: /Important/ }))
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Important' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(
      screen.getByRole('menuitem', { name: `${words.highlightTagOptions}: Important` }),
    ).toHaveFocus()
  })

  it('preserves field editing keys except for the explicit search ArrowDown handoff', async () => {
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <HighlighterTray />
      </OverlayProvider>,
    )

    await user.click(screen.getByRole('button', { name: /Important/ }))
    const search = screen.getByRole<HTMLInputElement>('textbox', {
      name: words.highlightTagPlaceholder,
    })
    await user.type(search, 'port')

    for (const key of ['ArrowUp', 'Home', 'End']) {
      search.focus()
      search.setSelectionRange(2, 2)
      expect(fireEvent.keyDown(search, { key })).toBe(true)
      expect(search).toHaveFocus()
      expect([search.selectionStart, search.selectionEnd]).toEqual([2, 2])
    }

    search.focus()
    expect(fireEvent.keyDown(search, { key: 'ArrowDown' })).toBe(false)
    expect(screen.getByRole('menuitem', { name: 'Important' })).toHaveFocus()

    await user.click(
      screen.getByRole('menuitem', { name: `${words.highlightTagOptions}: Important` }),
    )
    const name = screen.getByRole<HTMLInputElement>('textbox', { name: words.highlightTagName })
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      name.focus()
      name.setSelectionRange(2, 2)
      expect(fireEvent.keyDown(name, { key })).toBe(true)
      expect(name).toHaveFocus()
      expect([name.selectionStart, name.selectionEnd]).toEqual([2, 2])
    }
  })

  it('moves focus into tag options and returns it to the exact options action', async () => {
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <HighlighterTray />
      </OverlayProvider>,
    )

    await user.click(screen.getByRole('button', { name: /Important/ }))
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    const name = screen.getByRole('textbox', { name: words.highlightTagName })
    expect(name).toHaveFocus()

    await user.click(screen.getByRole('menuitem', { name: words.highlightTagBack }))

    expect(
      screen.getByRole('menuitem', { name: `${words.highlightTagOptions}: Important` }),
    ).toHaveFocus()
  })

  it('gives the tag-color radiogroup one tab stop and selects with wrapping arrows', async () => {
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <HighlighterTray />
      </OverlayProvider>,
    )

    await user.click(screen.getByRole('button', { name: /Important/ }))
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    await user.tab()

    const group = screen.getByRole('radiogroup', { name: words.highlightTagColor })
    const yellow = screen.getByRole('radio', { name: words.highlightColorYellow })
    const blue = screen.getByRole('radio', { name: words.highlightColorBlue })
    const radios = screen.getAllByRole('radio')
    expect(group).toHaveClass('e-colour-picker__swatches')
    expect(yellow).toHaveFocus()
    expect(radios.filter((radio) => radio.tabIndex === 0)).toEqual([yellow])
    expect(yellow).not.toHaveAttribute('title')
    vi.useFakeTimers()
    fireEvent.pointerEnter(yellow)
    act(() => vi.advanceTimersByTime(600))
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.keyDown(yellow, { key: 'ArrowRight' })

    expect(blue).toHaveFocus()
    expect(blue).toHaveAttribute('aria-checked', 'true')
    expect(useGraph.getState().highlightTags[0].color).toBe('blue')
    expect(radios.filter((radio) => radio.tabIndex === 0)).toEqual([blue])

    fireEvent.keyDown(blue, { key: 'ArrowLeft' })
    expect(yellow).toHaveFocus()
    expect(useGraph.getState().highlightTags[0].color).toBe('yellow')

    vi.useRealTimers()
    await user.tab()
    expect(document.activeElement).not.toHaveAttribute('role', 'radio')
  })

  it('expands raw swatch targets and reveals every hover-hidden action on coarse pointers', () => {
    expect(primitiveStyles).toMatch(
      /@media \(pointer: coarse\)[\s\S]*\.e-colour-picker__swatch::after\s*\{\s*inset:\s*-12px;/,
    )
    expect(highlightStyles).toMatch(
      /@media \(pointer: coarse\)[\s\S]*\.tag-menu-more,\s*\.highlights-group-head \.e-icon-button,\s*\.highlight-row-actions\s*\{\s*opacity:\s*1;/,
    )
  })

  it('creates a searched tag with the next least-used palette color', async () => {
    const user = userEvent.setup()
    render(<HighlighterTray />)

    await user.click(screen.getByRole('button', { name: /Important/ }))
    await user.type(
      screen.getByRole('textbox', { name: words.highlightTagPlaceholder }),
      'Follow up',
    )
    await user.click(screen.getByRole('menuitem', { name: /Create Follow up/ }))

    const created = useGraph.getState().highlightTags.find((tag) => tag.name === 'Follow up')
    expect(created).toMatchObject({ color: 'green' })
    expect(useGraph.getState().activeHighlightTagId).toBe(created?.id)
    expect(screen.queryByRole('menu', { name: words.highlightTags })).not.toBeInTheDocument()
  })

  it('cancels without mutation, then confirms deletion from tag options', async () => {
    useGraph.setState({
      highlights: [
        {
          id: 'highlight-1',
          cardId: 'note-1',
          tagId: 'tag-1',
          text: 'Marked passage',
          occurrence: 0,
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
    })
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <HighlighterTray />
      </OverlayProvider>,
    )

    const trigger = screen.getByRole('button', { name: /Important/ })
    await user.click(trigger)
    await user.click(
      screen.getByRole('menuitem', { name: `${words.highlightTagOptions}: Important` }),
    )
    await user.click(screen.getByRole('menuitem', { name: /^Delete tag/ }))
    let dialog = await screen.findByRole('dialog', { name: 'Delete this tag?' })
    expect(dialog).toHaveTextContent('Its highlights will be removed too. The text on your cards stays.')
    let backdrop = dialog.parentElement!
    await user.click(screen.getByRole('button', { name: words.cancel }))
    fireEvent.transitionEnd(backdrop, { propertyName: 'opacity' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useGraph.getState().highlightTags.map((tag) => tag.id)).toEqual(['tag-1'])
    expect(useGraph.getState().highlights.map((highlight) => highlight.id)).toEqual(['highlight-1'])

    const deleteAction = screen.getByRole('menuitem', { name: /^Delete tag/ })
    expect(deleteAction).toHaveFocus()
    await user.click(deleteAction)
    dialog = await screen.findByRole('dialog', { name: 'Delete this tag?' })
    backdrop = dialog.parentElement!
    await user.click(screen.getByRole('button', { name: words.deleteHighlightTag }))
    fireEvent.transitionEnd(backdrop, { propertyName: 'opacity' })

    await waitFor(() => expect(useGraph.getState().highlightTags).toEqual([]))
    expect(useGraph.getState().highlights).toEqual([])
    expect(screen.queryByRole('menu', { name: words.highlightTags })).not.toBeInTheDocument()
  })
})
