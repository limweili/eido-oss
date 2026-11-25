// @vitest-environment jsdom

import type { NodeProps } from '@xyflow/react'
import { cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoCardNode } from './memoCardNode'

describe('memoCardNode', () => {
  afterEach(cleanup)

  it('isolates rich Card content from React Flow geometry while preserving semantics', () => {
    const renderCard = vi.fn()
    function Card(props: NodeProps) {
      renderCard(props)
      return <div>{props.id}</div>
    }
    const MemoCard = memoCardNode(Card)
    const data = { selectedCardCount: 0 }
    const initial = {
      id: 'long-result',
      data,
      selected: false,
      dragging: false,
      positionAbsoluteX: 10,
      positionAbsoluteY: 20,
    } as unknown as NodeProps
    const view = render(<MemoCard {...initial} />)

    view.rerender(
      <MemoCard
        {...({
          ...initial,
          dragging: true,
          positionAbsoluteX: 320,
          positionAbsoluteY: 480,
        } as NodeProps)}
      />,
    )
    expect(renderCard).toHaveBeenCalledTimes(1)

    view.rerender(
      <MemoCard {...({ ...initial, selected: true } as NodeProps)} />,
    )
    // React Flow's wrapper selected class owns the immediate paint-only ring.
    // The rich Card keeps its previous semantic selection and render identity.
    expect(renderCard).toHaveBeenCalledTimes(1)
    expect(renderCard.mock.lastCall?.[0].selected).toBe(false)

    view.rerender(
      <MemoCard {...({
        ...initial,
        selected: true,
        data: { selectedCardCount: 1, semanticSelected: true },
      } as NodeProps)} />,
    )
    expect(renderCard).toHaveBeenCalledTimes(2)
    expect(renderCard.mock.lastCall?.[0].selected).toBe(true)
  })

  it('remounts same-id Card state only when its Idea semantic scope changes', () => {
    const mounted = vi.fn()
    const unmounted = vi.fn()
    const rendered = vi.fn()
    function Card({ id }: NodeProps) {
      rendered()
      useEffect(() => {
        mounted()
        return () => unmounted()
      }, [])
      return <div>{id}</div>
    }
    const MemoCard = memoCardNode(Card)
    const ideaAData = {
      selectedCardCount: 0,
      semanticScopeKey: '6:idea-a:same-card',
    }
    const initial = {
      id: 'same-card',
      data: ideaAData,
      selected: false,
      dragging: false,
      positionAbsoluteX: 10,
      positionAbsoluteY: 20,
    } as unknown as NodeProps
    const view = render(<MemoCard {...initial} />)
    expect(mounted).toHaveBeenCalledOnce()
    expect(unmounted).not.toHaveBeenCalled()
    expect(rendered).toHaveBeenCalledOnce()

    view.rerender(
      <MemoCard
        {...({
          ...initial,
          dragging: true,
          positionAbsoluteX: 420,
          positionAbsoluteY: 260,
        } as NodeProps)}
      />,
    )
    expect(mounted).toHaveBeenCalledOnce()
    expect(unmounted).not.toHaveBeenCalled()
    expect(rendered).toHaveBeenCalledOnce()

    view.rerender(
      <MemoCard
        {...({
          ...initial,
          data: {
            selectedCardCount: 0,
            semanticScopeKey: '6:idea-b:same-card',
          },
        } as NodeProps)}
      />,
    )
    expect(mounted).toHaveBeenCalledTimes(2)
    expect(unmounted).toHaveBeenCalledOnce()
    expect(rendered).toHaveBeenCalledTimes(2)
  })
})
