// @vitest-environment jsdom
//
// What a Card says about the tools its run used (ADR 0033), through the open
// vocabulary that names them (ADR 0035). The trail is one element for the whole
// life of a run, so what is pinned here is mostly what does NOT change as the
// run moves through its phases, plus the two places it deliberately does.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { RunToolStep } from '../../graph/types'
import { RunToolTrail, TOOL_TRAIL_FIRST_STEPS } from './RunToolTrail'

afterEach(cleanup)

function theTrail(): HTMLDetailsElement {
  const disclosure = document.querySelector('details.tool-trail')
  if (!(disclosure instanceof HTMLDetailsElement)) throw new Error('no trail on screen')
  return disclosure
}

// What a reader does to the trail. jsdom has no disclosure activation
// behaviour, so the state and the notification are both raised by hand; the
// component sees exactly what a real click gives it.
function setTrailOpen(open: boolean): void {
  const disclosure = theTrail()
  act(() => {
    disclosure.open = open
    disclosure.dispatchEvent(new Event('toggle'))
  })
}

const steps: RunToolStep[] = [
  { kind: 'search', detail: 'electron 40 release notes' },
  { kind: 'read', detail: 'https://www.example.test/notes', title: 'Electron 40' },
  { kind: 'read', detail: 'https://www.other.test/a/deep/path?q=1' },
]

const manySteps = Array.from({ length: TOOL_TRAIL_FIRST_STEPS + 7 }, (_, index): RunToolStep => ({
  kind: 'read',
  detail: `https://www.example.test/page-${index}`,
  title: `Page ${index}`,
}))

describe('the trail of what a run looked up', () => {
  it('is open and complete while the run works, in the tense of a thing still happening', () => {
    // A lookup is the answer beginning to exist, so it streams like the answer
    // does. Hiding it behind a count leaves the reader watching a pulse.
    render(<RunToolTrail steps={steps} running selected={false} />)

    expect(screen.getByText('Looking up 3 things')).toBeInTheDocument()
    expect(theTrail().open).toBe(true)
    expect(screen.getAllByRole('listitem')).toHaveLength(steps.length)
    expect(screen.getByText('electron 40 release notes')).toBeVisible()
  })

  it('draws each new step as it arrives, past the settled default and uncapped', () => {
    const { rerender } = render(
      <RunToolTrail steps={manySteps.slice(0, 2)} running selected={false} />,
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(2)

    rerender(<RunToolTrail steps={manySteps} running selected={false} />)

    expect(screen.getAllByRole('listitem')).toHaveLength(manySteps.length)
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument()
  })

  it('folds to a count once the answer has landed', () => {
    render(<RunToolTrail steps={steps} running={false} selected={false} />)

    expect(screen.getByText('Looked up 3 things')).toBeInTheDocument()
    expect(theTrail().open).toBe(false)
  })

  it('folds itself when the run lands, and keeps every row it drew', () => {
    // The answer is the point once it exists, so the trail gets out of the way.
    // Only the fold: the rows stay, so it is a movement, not a vanishing, and
    // the list must not shrink to the settled default part-way through it.
    const { rerender } = render(<RunToolTrail steps={manySteps} running selected={false} />)

    rerender(<RunToolTrail steps={manySteps} running={false} selected={false} />)

    expect(theTrail().open).toBe(false)
    expect(screen.getAllByRole('listitem')).toHaveLength(manySteps.length)

    // The next opening is the one that starts from the top again.
    setTrailOpen(true)
    expect(screen.getAllByRole('listitem')).toHaveLength(TOOL_TRAIL_FIRST_STEPS + 1)
  })

  it('builds no rows on a settled Card until the reader asks, and keeps them after', () => {
    // A drawn trail is most of a Card's DOM and the Board mounts hundreds of
    // Cards; folded is the state nearly all of them stay in.
    render(<RunToolTrail steps={steps} running={false} selected={false} />)

    expect(screen.queryAllByRole('listitem')).toHaveLength(0)

    setTrailOpen(true)
    expect(screen.getAllByRole('listitem')).toHaveLength(steps.length)

    // Closing keeps them: the animation has to have something to close over.
    setTrailOpen(false)
    expect(screen.getAllByRole('listitem')).toHaveLength(steps.length)
  })

  it('counts one thing as one thing, in either tense', () => {
    const { rerender } = render(<RunToolTrail steps={steps.slice(0, 1)} running selected={false} />)

    expect(screen.getByText('Looking up 1 thing')).toBeInTheDocument()

    rerender(<RunToolTrail steps={steps.slice(0, 1)} running={false} selected={false} />)

    expect(screen.getByText('Looked up 1 thing')).toBeInTheDocument()
  })

  it('names a page by its title, and by its host when there is none', () => {
    render(<RunToolTrail steps={steps} running={false} selected={false} />)
    setTrailOpen(true)

    expect(screen.getByText('Electron 40')).toBeInTheDocument()
    // A bare address is provenance, not a label. The host is the readable part.
    expect(screen.getByText('other.test')).toBeInTheDocument()
    expect(screen.queryByText(/deep\/path/)).not.toBeInTheDocument()
  })

  it('lets the reader open a page, live or settled, and always away from the Board', () => {
    const opened = vi.fn()
    vi.stubGlobal('open', opened)

    render(<RunToolTrail steps={steps} running selected={false} />)

    // The line itself is the press now, so the address it would have linked
    // lives one press in, in the drawer (founder decision 2026-08-18).
    fireEvent.click(screen.getByText('Electron 40'))
    fireEvent.click(screen.getByText('other.test'))

    const links = screen.getAllByRole('link')
    // The search is a question, not a place. Only the two pages are links.
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', 'https://www.example.test/notes')
    expect(links[0]).toHaveAttribute('target', '_blank')
    expect(links[0]).toHaveAttribute('rel', 'noreferrer')

    // `target` alone is a request the host may answer by navigating this window.
    // A Board replaced by a web page is the one outcome this must never have.
    fireEvent.click(links[0])
    expect(opened).toHaveBeenCalledWith(
      'https://www.example.test/notes',
      '_blank',
      'noopener,noreferrer',
    )

    vi.unstubAllGlobals()
  })

  it('refuses to link a page address that is not an http address', () => {
    render(
      <RunToolTrail
        steps={[{ kind: 'read', detail: 'javascript:alert(1)', title: 'Looks fine' }]}
        running={false}
        selected={false}
      />,
    )
    setTrailOpen(true)

    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByText('Looks fine')).toBeInTheDocument()
  })

  it('still shows a step the provider reported without saying what it was given', () => {
    render(
      <RunToolTrail
        steps={[{ kind: 'search', detail: '' }, { kind: 'read', detail: '' }]}
        running
        selected={false}
      />,
    )

    expect(screen.getByText('Searched the web')).toBeInTheDocument()
    expect(screen.getByText('Read a page')).toBeInTheDocument()
  })

  it('shows a step recorded by a build that knew a tool this one does not', () => {
    // A Run written by a later Eido is a record of what happened, not a broken
    // file. It gets a truthful line and no link, because what an unrecognised
    // tool's detail means is exactly what this build does not know (ADR 0035).
    render(
      <RunToolTrail
        steps={[
          { kind: 'run-code', detail: 'https://www.example.test/notebook', title: 'Ran a notebook' },
          { kind: 'ask-a-model', detail: '' },
        ]}
        running={false}
        selected={false}
      />,
    )
    setTrailOpen(true)

    expect(screen.getByText('Looked up 2 things')).toBeInTheDocument()
    expect(screen.getByText('Ran a notebook')).toBeInTheDocument()
    expect(screen.getByText('Used a tool')).toBeInTheDocument()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('opens on the first few and hands the rest over on one press', () => {
    // The default is small because a Card that grew a row per tool would weigh
    // on a Board that keeps hundreds mounted. It is a default, not a ceiling:
    // the reader who asks gets everything, and the count above never lied.
    render(<RunToolTrail steps={manySteps} running={false} selected={false} />)
    setTrailOpen(true)

    expect(screen.getByText(`Looked up ${manySteps.length} things`)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(TOOL_TRAIL_FIRST_STEPS + 1)
    expect(screen.queryByText(`Page ${TOOL_TRAIL_FIRST_STEPS}`)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'and 7 more' }))

    expect(screen.getAllByRole('listitem')).toHaveLength(manySteps.length)
    expect(screen.getByText(`Page ${manySteps.length - 1}`)).toBeInTheDocument()
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument()
  })

  it('starts each opening from the top of the trail again', () => {
    render(<RunToolTrail steps={manySteps} running={false} selected={false} />)
    setTrailOpen(true)
    fireEvent.click(screen.getByRole('button', { name: 'and 7 more' }))

    setTrailOpen(false)
    setTrailOpen(true)

    expect(screen.getAllByRole('listitem')).toHaveLength(TOOL_TRAIL_FIRST_STEPS + 1)
  })

  it('says nothing about a bound it is inside', () => {
    render(<RunToolTrail steps={steps} running={false} selected={false} />)
    setTrailOpen(true)

    expect(screen.queryByText(/more$/)).not.toBeInTheDocument()
  })
})

// What the model was working out between its lookups (#966), and the chevron
// every row now offers. Steps stay never-page-text: a thinking passage is the
// model's own words, and what a row opens to is the step itself in full.
describe('thinking rows and the pressable row', () => {
  const passage =
    'Two of these are resellers, so the DOP register decides it.\nThe consortium list is the primary source.'
  const mixed: RunToolStep[] = [
    { kind: 'search', detail: 'best pistachio suppliers in Sicily' },
    { kind: 'thinking', detail: passage },
    { kind: 'search', detail: 'Bronte DOP consortium member list' },
  ]

  // The row itself is the control, so it is found by what it says rather than
  // by a chevron's name: a reader presses the line, not a glyph on the end of
  // it, and a test that reached for the glyph would be testing the sign.
  function pressableRows() {
    return screen.getAllByRole('button').filter((row) => row.hasAttribute('aria-expanded'))
  }
  function rowSaying(fragment: string | RegExp) {
    return screen.getAllByRole('button').find((row) =>
      typeof fragment === 'string'
        ? row.textContent?.includes(fragment)
        : fragment.test(row.textContent ?? ''),
    )!
  }

  // Observed on a real Board 2026-08-18: a thinking row read
  // `**Investigating Xcode's Latest**`, asterisks and all. Models write their
  // reasoning in markdown; the trail is one line of small plain type and does
  // not typeset it. The marks come off, the words stay, and only what wraps
  // something is touched, so a search's own asterisk is never eaten.
  // Folding the trail folds what is inside it. A row's drawer is the row's own
  // state, so without this the next opening would start with yesterday's
  // passages already spread out (founder decision 2026-08-18).
  it('folds every opened row when the trail is folded and opened again', () => {
    render(<RunToolTrail steps={mixed} running={false} selected={false} />)
    setTrailOpen(true)

    fireEvent.click(rowSaying('Two of these are resellers'))
    expect(screen.getByText(/consortium list is the primary source/)).toBeInTheDocument()

    setTrailOpen(false)
    setTrailOpen(true)

    expect(screen.queryByText(/consortium list is the primary source/)).not.toBeInTheDocument()
    expect(pressableRows().every((row) => row.getAttribute('aria-expanded') === 'false')).toBe(true)
  })

  // Observed on a real Board 2026-08-18: a research run cancelled before its
  // first lookup folded to "Looked up 1 thing" above one thinking row. The
  // count exists to say how many places an answer rests on; with no lookups
  // there is no such number, and borrowing the row count says a thing that did
  // not happen.
  it('drops the number when the trail is all thinking and no lookup', () => {
    const { rerender } = render(
      <RunToolTrail
        steps={[{ kind: 'thinking', detail: 'Researching pricing shifts' }]}
        running
        selected={false}
      />,
    )
    expect(screen.getByText('Working it out')).toBeInTheDocument()
    expect(screen.queryByText(/Looking up/)).not.toBeInTheDocument()

    rerender(
      <RunToolTrail
        steps={[{ kind: 'thinking', detail: 'Researching pricing shifts' }]}
        running={false}
        selected={false}
      />,
    )
    expect(screen.getByText('Worked it out')).toBeInTheDocument()

    // One real lookup and the number is the point again, and it still counts
    // only the lookup.
    rerender(
      <RunToolTrail
        steps={[
          { kind: 'thinking', detail: 'Researching pricing shifts' },
          { kind: 'search', detail: 'agentic pricing' },
        ]}
        running={false}
        selected={false}
      />,
    )
    expect(screen.getByText('Looked up 1 thing')).toBeInTheDocument()
  })

  it('takes the markdown marks off a thinking row without eating the words', () => {
    render(
      <RunToolTrail
        steps={[
          { kind: 'thinking', detail: "**Investigating Xcode's Latest**\n\nA `plan_id` and 2 * 3." },
          { kind: 'search', detail: 'site:apple.com xcode * release' },
        ]}
        running
        selected={false}
      />,
    )

    expect(screen.getByText("Investigating Xcode's Latest")).toBeInTheDocument()
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument()

    fireEvent.click(rowSaying("Investigating Xcode's Latest"))

    // A bare underscore inside a word and a lone asterisk between spaces are
    // not emphasis, so they survive the pass unharmed.
    expect(screen.getByText(/plan_id and 2 \* 3\./)).toBeInTheDocument()
    // The search's line is the model's literal instruction, untouched.
    expect(screen.getByText('site:apple.com xcode * release')).toBeInTheDocument()
  })

  it('shows a thinking row collapsed to its first line, interleaved where it happened', () => {
    render(<RunToolTrail steps={mixed} running selected={false} />)

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toHaveTextContent('Two of these are resellers, so the DOP register decides it.')
    // The rest of the passage waits until the row is pressed.
    expect(screen.queryByText(/consortium list is the primary source/)).not.toBeInTheDocument()
  })

  it('opens to the full passage on a press of the line, and closes on another', () => {
    render(<RunToolTrail steps={mixed} running selected={false} />)

    const row = rowSaying('Two of these are resellers')
    expect(row).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/consortium list is the primary source/)).toBeInTheDocument()

    // Closing folds the drawer but keeps it built: the closing animation needs
    // something to close over.
    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(/consortium list is the primary source/)).toBeInTheDocument()
  })

  it('presses anywhere on a search row, opening to the whole question', () => {
    // Every row that has more to show is one real button, so the keyboard
    // reaches the whole line exactly as the pointer does, and the press lands
    // on the icon and the words alike rather than on a glyph at the end.
    render(<RunToolTrail steps={mixed} running selected={false} />)

    const rows = pressableRows()
    expect(rows).toHaveLength(mixed.length)

    const search = rowSaying('best pistachio suppliers')
    fireEvent.click(search)
    expect(search).toHaveAttribute('aria-expanded', 'true')
  })

  it('moves a page address into the drawer, where it is the whole address', () => {
    // A line cannot both open a page and open itself, so the link is the
    // opened address rather than the host the line had room for.
    render(
      <RunToolTrail
        steps={[{ kind: 'read', detail: 'https://example.test/a/deep/page', title: 'A page' }]}
        running
        selected={false}
      />,
    )

    const row = rowSaying('A page')
    expect(row.tagName).toBe('BUTTON')
    fireEvent.click(row)

    const link = screen.getByRole('link', { name: 'https://example.test/a/deep/page' })
    expect(link).toHaveAttribute('href', 'https://example.test/a/deep/page')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('keeps thinking rows out of the folded count, which tallies lookups', () => {
    render(<RunToolTrail steps={mixed} running={false} selected={false} />)

    expect(screen.getByText('Looked up 2 things')).toBeInTheDocument()
  })

  it('reopens a settled trail with its thinking rows intact', () => {
    // The steps are the saved record; a Board closed and reopened renders the
    // same rows from them.
    render(<RunToolTrail steps={mixed} running={false} selected={false} />)
    setTrailOpen(true)

    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(
      screen.getByText('Two of these are resellers, so the DOP register decides it.'),
    ).toBeInTheDocument()
  })
})

// A run long enough to fill the model's window writes itself a handoff note
// and carries on (#1036). The trail says so, because a run that quietly threw
// away most of its own history would be misreporting how it reached its answer.
describe('a run that had to write itself a note', () => {
  const note =
    'What this run was asked for\n  Compare pistachio suppliers.\n\nWhat has been established\n  Two are resellers.'

  function rowSaying(fragment: string) {
    return screen.getAllByRole('button').find((row) => row.textContent?.includes(fragment))!
  }

  const withCompaction: RunToolStep[] = [
    { kind: 'search', detail: 'best pistachio suppliers in Sicily' },
    { kind: 'compaction', detail: note },
    { kind: 'search', detail: 'Bronte DOP consortium member list' },
  ]

  it('says the same plain thing every time, whatever the note said', () => {
    render(<RunToolTrail steps={withCompaction} running={false} selected={false} />)
    setTrailOpen(true)

    expect(screen.getByText('Conversation recapped')).toBeVisible()
    // The note is behind the row, not on it.
    expect(screen.queryByText(/Two are resellers/)).not.toBeInTheDocument()
  })

  it('draws Lucide square-text, copied because the pinned Lucide lacks it', () => {
    // `SquareText` is re-created locally rather than imported, so nothing but
    // this catches a drift from the published glyph. The geometry is the whole
    // point of the copy: a rounded square holding three lines of differing
    // length. Delete this the day lucide-react carries the icon itself.
    render(<RunToolTrail steps={withCompaction} running={false} selected={false} />)
    setTrailOpen(true)

    const row = screen.getByText('Conversation recapped').closest('.tool-trail__step-line')!
    const icon = row.querySelector('svg')!
    expect(icon.querySelector('rect')).not.toBeNull()
    expect([...icon.querySelectorAll('path')].map((path) => path.getAttribute('d'))).toEqual([
      'M7 8h8',
      'M7 12h10',
      'M7 16h6',
    ])
  })

  it('opens to the note the run wrote', () => {
    render(<RunToolTrail steps={withCompaction} running={false} selected={false} />)
    setTrailOpen(true)

    fireEvent.click(rowSaying('Conversation recapped'))
    expect(screen.getByText(/Two are resellers/)).toBeInTheDocument()
  })

  it('is not counted as a lookup, because it looked nothing up', () => {
    render(<RunToolTrail steps={withCompaction} running={false} selected={false} />)

    expect(screen.getByText('Looked up 2 things')).toBeInTheDocument()
  })

  it('is never a link: a note is not a place', () => {
    render(<RunToolTrail steps={[{ kind: 'compaction', detail: note }]} running={false} selected={false} />)
    setTrailOpen(true)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
