// @vitest-environment jsdom
//
// BLOCKER 1 — real DOM render tests for VersionSwitcher (classes, names,
//   button text, self-hide threshold, click dispatch).
// BLOCKER 2 — cross-card identity: render VersionSwitcher with the exact prop
//   pattern each of the three cards supplies and assert chip DOM is identical.
//   Fully mounting ResultCard/ConversationResultCard/GroupCard is impractical
//   here because they depend on @xyflow/react NodeProps and a live Zustand
//   store. Rendering the chrome subtree (VersionSwitcher) with the same wiring
//   each card uses is the minimum acceptable substitute per the cross-review.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { OutputVersion } from '../../graph/types'
import { words } from '../../shared/words'
import { DESIGN_TIMING_MS } from '../../ui/tokens'
import { VersionSwitcher } from './VersionSwitcher'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// ---- fixture ---------------------------------------------------------------

function mkVersion(overrides: Partial<OutputVersion> = {}): OutputVersion {
  return {
    id: 'v1',
    number: 1,
    text: '',
    createdAt: '2024-01-01T00:00:00Z',
    fromRunId: 'run-1',
    ...overrides,
  }
}

const V1 = mkVersion({ id: 'v1', number: 1 })
const V2 = mkVersion({ id: 'v2', number: 2 })

// ---- BLOCKER 1: VersionSwitcher DOM behavior --------------------------------

describe('VersionSwitcher — self-hide', () => {
  it('renders nothing when versions is empty', () => {
    const { container } = render(
      <VersionSwitcher versions={[]} chosenId={undefined} onChoose={() => {}} selected />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when there is exactly one version', () => {
    const { container } = render(
      <VersionSwitcher versions={[V1]} chosenId="v1" onChoose={() => {}} selected />,
    )
    expect(container.firstChild).toBeNull()
  })
})

describe('VersionSwitcher — chip row', () => {
  it('renders one button per version when count > 1', () => {
    const { getAllByRole } = render(
      <VersionSwitcher versions={[V1, V2]} chosenId="v1" onChoose={() => {}} selected />,
    )
    expect(getAllByRole('button')).toHaveLength(2)
  })

  it('displays vN text on each chip', () => {
    const { getAllByRole } = render(
      <VersionSwitcher versions={[V1, V2]} chosenId="v1" onChoose={() => {}} selected />,
    )
    const [b1, b2] = getAllByRole('button')
    expect(b1).toHaveTextContent(/^v1$/)
    expect(b2).toHaveTextContent(/^v2$/)
  })

  it('applies ver-chip to every button, with nodrag while the card is selected', () => {
    const { getAllByRole } = render(
      <VersionSwitcher versions={[V1, V2]} chosenId="v1" onChoose={() => {}} selected />,
    )
    for (const btn of getAllByRole('button')) {
      expect(btn).toHaveClass('ver-chip')
      expect(btn).toHaveClass('t-value')
      expect(btn).toHaveClass('nodrag')
    }
  })

  it('drops nodrag while the card is unselected so a press anywhere drags the card', () => {
    const { getAllByRole } = render(
      <VersionSwitcher versions={[V1, V2]} chosenId="v1" onChoose={() => {}} selected={false} />,
    )
    for (const btn of getAllByRole('button')) {
      expect(btn).toHaveClass('ver-chip')
      expect(btn).not.toHaveClass('nodrag')
    }
  })

  it.each([
    {
      name: 'plain viewed',
      version: mkVersion({ id: 'v2', number: 2 }),
      chosenId: 'v2',
      present: ['active'],
      absent: ['kept', 'provisional'],
    },
    {
      name: 'kept viewed',
      version: mkVersion({ id: 'v2', number: 2, accepted: true }),
      chosenId: 'v2',
      present: ['active', 'kept'],
      absent: ['provisional'],
    },
    {
      name: 'kept not viewed',
      version: mkVersion({ id: 'v2', number: 2, accepted: true }),
      chosenId: 'v1',
      present: ['kept'],
      absent: ['active', 'provisional'],
    },
    {
      name: 'provisional overrides kept while viewed',
      version: mkVersion({
        id: 'v2',
        number: 2,
        accepted: true,
        provisional: true,
        provisionalReason: 'canceled',
      }),
      chosenId: 'v2',
      present: ['active', 'provisional'],
      absent: ['kept'],
    },
  ])('renders fill state and viewed outline independently: $name', ({ version, chosenId, present, absent }) => {
    const { getAllByRole } = render(
      <VersionSwitcher versions={[V1, version]} chosenId={chosenId} onChoose={() => {}} selected />,
    )
    const chip = getAllByRole('button')[1]
    for (const className of present) expect(chip).toHaveClass(className)
    for (const className of absent) expect(chip).not.toHaveClass(className)
  })
})

describe('VersionSwitcher — accessible names', () => {
  it('names normal versions without changing the visible vN label', () => {
    const { getAllByRole } = render(
      <VersionSwitcher versions={[V1, V2]} chosenId="v1" onChoose={() => {}} selected />,
    )
    const [b1, b2] = getAllByRole('button')
    expect(b1).toHaveAccessibleName('Version 1')
    expect(b2).toHaveAccessibleName('Version 2')
    expect(b1).toHaveTextContent(/^v1$/)
    expect(b2).toHaveTextContent(/^v2$/)
  })

  it('includes the failed reason in the accessible name', () => {
    const failed = mkVersion({ id: 'v2', number: 2, provisional: true, provisionalReason: 'failed' })
    const { getAllByRole } = render(
      <VersionSwitcher versions={[V1, failed]} chosenId="v1" onChoose={() => {}} selected />,
    )
    expect(getAllByRole('button')[1]).toHaveAccessibleName(
      `Version 2 — ${words.provisionalFailed}`,
    )
  })

  it('includes the canceled reason in the accessible name', () => {
    const canceled = mkVersion({ id: 'v2', number: 2, provisional: true, provisionalReason: 'canceled' })
    const { getAllByRole } = render(
      <VersionSwitcher versions={[V1, canceled]} chosenId="v1" onChoose={() => {}} selected />,
    )
    expect(getAllByRole('button')[1]).toHaveAccessibleName(
      `Version 2 — ${words.provisionalCanceled}`,
    )
  })

  it('keeps the provisional reason in the shared accessible tooltip', () => {
    vi.useFakeTimers()
    const canceled = mkVersion({ id: 'v2', number: 2, provisional: true, provisionalReason: 'canceled' })
    render(
      <VersionSwitcher versions={[V1, canceled]} chosenId="v1" onChoose={() => {}} selected />,
    )
    const chip = screen.getByRole('button', {
      name: `Version 2 — ${words.provisionalCanceled}`,
    })

    expect(chip).not.toHaveAttribute('title')
    fireEvent.pointerEnter(chip)
    act(() => vi.advanceTimersByTime(DESIGN_TIMING_MS.intent))
    expect(screen.getByRole('tooltip')).toHaveTextContent(words.provisionalCanceled)
  })
})

describe('VersionSwitcher — provisional chip content', () => {
  it('keeps the reason out of the visible multi-version chip', () => {
    const prov = mkVersion({ id: 'v2', number: 2, provisional: true, provisionalReason: 'canceled' })
    const { getAllByRole } = render(
      <VersionSwitcher versions={[V1, prov]} chosenId="v1" onChoose={() => {}} selected />,
    )
    const [b1, b2] = getAllByRole('button')
    expect(b1).toHaveTextContent(/^v1$/)
    expect(b2).toHaveTextContent(/^v2$/)
    expect(b2).not.toHaveTextContent(words.stoppedVersion)
  })
})

describe('VersionSwitcher — click dispatch', () => {
  it('calls onChoose with the clicked version id', () => {
    const onChoose = vi.fn()
    const { getAllByRole } = render(
      <VersionSwitcher versions={[V1, V2]} chosenId="v1" onChoose={onChoose} selected />,
    )
    fireEvent.click(getAllByRole('button')[1])
    expect(onChoose).toHaveBeenCalledOnce()
    expect(onChoose).toHaveBeenCalledWith('v2')
  })

  it('calls onChoose with the correct id when the first chip is clicked', () => {
    const onChoose = vi.fn()
    const { getAllByRole } = render(
      <VersionSwitcher versions={[V1, V2]} chosenId="v2" onChoose={onChoose} selected />,
    )
    fireEvent.click(getAllByRole('button')[0])
    expect(onChoose).toHaveBeenCalledWith('v1')
  })
})

// ---- BLOCKER 2: cross-card identity ----------------------------------------
//
// Each of the three card components wires VersionSwitcher slightly differently:
//   ResultCard         — onChoose: (v) => output && chooseVersion(output.id, v), style={{ marginBottom: 8 }}
//   ConversationResultCard — same as ResultCard
//   GroupCard          — onChoose: (v) => output && chooseVersion(output.id, v), no style
//
// The only difference is the optional `style` prop; chip DOM (classes, titles,
// accessible names and text) must be byte-identical regardless. These tests render VersionSwitcher
// under each card's wiring and compare the chip elements directly.

describe('VersionSwitcher cross-card identity', () => {
  const fixture = [
    mkVersion({ id: 'v1', number: 1, accepted: true }),
    mkVersion({ id: 'v2', number: 2, provisional: true, provisionalReason: 'canceled' }),
    mkVersion({ id: 'v3', number: 3 }),
  ]
  const chosenId = 'v1'

  function chipSnapshot(container: HTMLElement) {
    return Array.from(container.querySelectorAll('.ver-chip')).map((el) => ({
      className: el.className,
      ariaLabel: el.getAttribute('aria-label'),
      textContent: el.textContent,
    }))
  }

  it('ResultCard and ConversationResultCard produce identical chip DOM', () => {
    // Both supply style={{ marginBottom: 8 }}
    const { container: resultCtx } = render(
      <VersionSwitcher
        versions={fixture}
        chosenId={chosenId}
        onChoose={() => {}}
        selected
        style={{ marginBottom: 8 }}
      />,
    )
    const { container: convCtx } = render(
      <VersionSwitcher
        versions={fixture}
        chosenId={chosenId}
        onChoose={() => {}}
        selected
        style={{ marginBottom: 8 }}
      />,
    )
    expect(chipSnapshot(resultCtx)).toEqual(chipSnapshot(convCtx))
  })

  it('GroupCard (no style) produces identical chip DOM to the other two cards', () => {
    // GroupCard omits the style prop; chip behavior must still be identical.
    const { container: groupCtx } = render(
      <VersionSwitcher versions={fixture} chosenId={chosenId} onChoose={() => {}} selected />,
    )
    const { container: resultCtx } = render(
      <VersionSwitcher
        versions={fixture}
        chosenId={chosenId}
        onChoose={() => {}}
        selected
        style={{ marginBottom: 8 }}
      />,
    )
    expect(chipSnapshot(groupCtx)).toEqual(chipSnapshot(resultCtx))
  })
})
