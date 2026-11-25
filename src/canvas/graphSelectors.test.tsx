// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSourceContextSnapshot } from '../brain/sourceContext'
import { useGraph } from '../graph/store'
import type { Card, FollowUpMessage, Output, OutputVersion, SavedBoard } from '../graph/types'
import {
  resetSourceChangeStatusDerivationCountForTests,
  sourceChangeStatusDerivationCountForTests,
  sourceGroupMemberProjectionVisitCountForTests,
  sourceFollowUpProjectionBuildCountForTests,
  sourceFollowUpProjectionVisitCountForTests,
  useSourceChangeStatus,
} from './graphSelectors'

const LONG_SOURCE_TEXT = 'privacy-safe source material. '
  .repeat(38_889)
  .slice(0, 1_050_000)

function boardWith(source: Card): SavedBoard {
  return {
    version: 1,
    cards: [source],
    connections: [],
    outputs: [],
    runs: [],
    updatedAt: '',
  }
}

function sourceVersion(source: Card): OutputVersion {
  return {
    id: 'downstream-version',
    number: 1,
    text: 'Downstream answer',
    createdAt: '2026-08-20T00:00:00.000Z',
    fromRunId: 'downstream-run',
    sourceContext: createSourceContextSnapshot(boardWith(source), [
      { cardId: source.id },
    ]),
  }
}

describe('source-change selector isolation', () => {
  let source: Card
  let version: OutputVersion

  beforeEach(() => {
    source = {
      id: 'long-source',
      kind: 'note',
      blocks: [{ id: 'long-source-block', text: LONG_SOURCE_TEXT }],
      position: { x: 0, y: 0 },
    }
    version = sourceVersion(source)
    useGraph.setState({
      cards: [source],
      connections: [],
      outputs: [],
      runs: [],
      compactionSummaries: [],
      selection: null,
      selectedCardIds: [],
      saveState: 'saved',
      hydrated: false,
      keyPromptOpen: false,
    })
    resetSourceChangeStatusDerivationCountForTests()
  })

  afterEach(cleanup)

  it('derives once across position commits and again when referenced content changes', () => {
    const view = renderHook(() => useSourceChangeStatus(version))

    expect(view.result.current).toBeNull()
    expect(sourceChangeStatusDerivationCountForTests()).toBe(1)

    act(() => {
      for (let step = 1; step <= 30; step += 1) {
        useGraph.getState().moveCard(
          source.id,
          { x: step * 7, y: step * 3 },
          {
            recordHistory: false,
          },
        )
      }
    })

    expect(view.result.current).toBeNull()
    expect(sourceChangeStatusDerivationCountForTests()).toBe(1)

    for (let chunk = 1; chunk <= 30; chunk += 1) {
      version = { ...version, text: `Streaming downstream answer ${chunk}` }
      view.rerender()
    }

    expect(view.result.current).toBeNull()
    expect(sourceChangeStatusDerivationCountForTests()).toBe(1)

    act(() => {
      useGraph.setState((state) => ({
        cards: state.cards.map((card) =>
          card.id === source.id
            ? {
                ...card,
                blocks: [{ ...card.blocks[0], text: `${LONG_SOURCE_TEXT}!` }],
              }
            : card,
        ),
      }))
    })

    expect(view.result.current?.changes).toEqual([
      expect.objectContaining({ cardId: source.id, reason: 'changed' }),
    ])
    expect(sourceChangeStatusDerivationCountForTests()).toBe(2)

    act(() => {
      useGraph.setState((state) => ({
        cards: state.cards.map((card) => card.id === source.id
          ? { ...card, title: 'Renamed long source' }
          : card),
      }))
    })

    expect(view.result.current?.changes[0]).toMatchObject({
      cardId: source.id,
      label: 'Renamed long source',
      reason: 'changed',
    })
    expect(sourceChangeStatusDerivationCountForTests()).toBe(3)
  })

  it('tracks a compressed Group, its Result member, and both chosen outputs', () => {
    const group: Card = {
      id: 'source-group',
      kind: 'group',
      blocks: [{ id: 'source-group-block', text: 'Grouped source' }],
      compressionPrompt: 'Compress this group.',
      position: { x: 0, y: 0 },
    }
    const member: Card = {
      id: 'member-result',
      kind: 'result',
      blocks: [{ id: 'member-result-block', text: '' }],
      groupId: group.id,
      position: { x: 40, y: 40 },
    }
    const memberVersion: OutputVersion = {
      id: 'member-version',
      number: 1,
      text: 'Member answer',
      createdAt: '2026-08-20T00:00:00.000Z',
      fromRunId: 'member-run',
    }
    const digestVersion: OutputVersion = {
      id: 'digest-version',
      number: 1,
      text: 'Group digest',
      createdAt: '2026-08-20T00:00:00.000Z',
      fromRunId: 'digest-run',
      digestKey: 'digest:one',
    }
    const outputs: Output[] = [
      {
        id: 'member-output',
        resultCardId: member.id,
        chosenVersionId: memberVersion.id,
        versions: [memberVersion],
      },
      {
        id: 'group-output',
        resultCardId: group.id,
        chosenVersionId: digestVersion.id,
        versions: [digestVersion],
      },
    ]
    const groupedBoard: SavedBoard = {
      version: 1,
      cards: [group, member],
      connections: [],
      outputs,
      runs: [],
      updatedAt: '',
    }
    const groupedVersion: OutputVersion = {
      id: 'grouped-downstream-version',
      number: 1,
      text: 'Downstream answer',
      createdAt: '2026-08-20T00:00:00.000Z',
      fromRunId: 'grouped-downstream-run',
      sourceContext: createSourceContextSnapshot(groupedBoard, [
        {
          cardId: group.id,
          groupMode: 'compress',
        },
      ]),
    }
    useGraph.setState({ cards: [group, member], outputs })
    resetSourceChangeStatusDerivationCountForTests()

    const view = renderHook(() => useSourceChangeStatus(groupedVersion))
    expect(view.result.current).toBeNull()
    expect(sourceChangeStatusDerivationCountForTests()).toBe(1)

    act(() => {
      for (let step = 1; step <= 30; step += 1) {
        useGraph.setState((state) => ({
          cards: state.cards.map((card) =>
            card.id === member.id
              ? { ...card, position: { x: 40 + step, y: 40 + step } }
              : card,
          ),
        }))
      }
    })
    expect(sourceChangeStatusDerivationCountForTests()).toBe(1)

    act(() => {
      useGraph.setState((state) => ({
        outputs: state.outputs.map((output) =>
          output.id === 'group-output'
            ? {
                ...output,
                versions: output.versions.map((candidate) =>
                  candidate.id === digestVersion.id
                    ? { ...candidate, text: 'Changed group digest' }
                    : candidate,
                ),
              }
            : output,
        ),
      }))
    })
    expect(view.result.current?.changes[0]).toMatchObject({
      cardId: group.id,
      reason: 'changed',
    })
    expect(sourceChangeStatusDerivationCountForTests()).toBe(2)

    act(() => {
      useGraph.setState((state) => ({
        outputs: state.outputs.map((output) =>
          output.id === 'member-output'
            ? {
                ...output,
                versions: output.versions.map((candidate) =>
                  candidate.id === memberVersion.id
                    ? { ...candidate, text: 'Changed member answer' }
                    : candidate,
                ),
              }
            : output,
        ),
      }))
    })
    expect(sourceChangeStatusDerivationCountForTests()).toBe(3)
  })

  it('ignores unsettled follow-up writes until downstream source material settles', () => {
    const result: Card = {
      id: 'follow-up-source-result',
      kind: 'result',
      blocks: [{ id: 'follow-up-source-result-block', text: '' }],
      position: { x: 0, y: 0 },
    }
    const chosen: OutputVersion = {
      id: 'follow-up-source-version',
      number: 1,
      text: 'Original result',
      createdAt: '2026-08-20T00:00:00.000Z',
      fromRunId: 'follow-up-source-run',
      followUpThread: { messages: [] },
    }
    const output: Output = {
      id: 'follow-up-source-output',
      resultCardId: result.id,
      chosenVersionId: chosen.id,
      versions: [chosen],
    }
    const sourceBoard: SavedBoard = {
      version: 1,
      cards: [result],
      connections: [],
      outputs: [output],
      runs: [],
      updatedAt: '',
    }
    const downstream: OutputVersion = {
      id: 'follow-up-downstream-version',
      number: 1,
      text: 'Downstream answer',
      createdAt: '2026-08-20T00:00:00.000Z',
      fromRunId: 'follow-up-downstream-run',
      sourceContext: createSourceContextSnapshot(sourceBoard, [{ cardId: result.id }]),
    }
    useGraph.setState({ cards: [result], outputs: [output] })
    resetSourceChangeStatusDerivationCountForTests()

    const view = renderHook(() => useSourceChangeStatus(downstream))
    expect(view.result.current).toBeNull()
    expect(sourceChangeStatusDerivationCountForTests()).toBe(1)

    const setReply = (text: string, status: 'complete' | 'streaming' | 'failed') => {
      useGraph.setState((state) => ({
        outputs: state.outputs.map((candidateOutput) => candidateOutput.id === output.id
          ? {
              ...candidateOutput,
              versions: candidateOutput.versions.map((candidate) => candidate.id === chosen.id
                ? {
                    ...candidate,
                    followUpThread: {
                      collapsed: true,
                      messages: [{
                        id: 'follow-up-reply',
                        role: 'assistant',
                        text,
                        status,
                        createdAt: '2026-08-20T00:00:01.000Z',
                      }],
                    },
                  }
                : candidate),
            }
          : candidateOutput),
      }))
    }

    act(() => {
      for (let chunk = 1; chunk <= 30; chunk += 1) {
        setReply('streaming token '.repeat(chunk), 'streaming')
      }
      setReply('failed response is excluded', 'failed')
      setReply('   \n  ', 'complete')
    })

    expect(view.result.current).toBeNull()
    expect(sourceChangeStatusDerivationCountForTests()).toBe(1)

    act(() => setReply('Settled downstream discussion.', 'complete'))
    expect(view.result.current?.changes[0]).toMatchObject({
      cardId: result.id,
      reason: 'changed',
    })
    expect(sourceChangeStatusDerivationCountForTests()).toBe(2)
  })

  it('does not revisit a pathological settled discussion on position-only commits', () => {
    const result: Card = {
      id: 'pathological-follow-up-source',
      kind: 'result',
      blocks: [{ id: 'pathological-follow-up-source-block', text: '' }],
      position: { x: 0, y: 0 },
    }
    const chosen: OutputVersion = {
      id: 'pathological-follow-up-version',
      number: 1,
      text: 'Original result',
      createdAt: '2026-08-20T00:00:00.000Z',
      fromRunId: 'pathological-follow-up-run',
      followUpThread: {
        messages: Array.from({ length: 30_000 }, (_, index) => ({
          id: `pathological-follow-up-${index}`,
          role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
          text: `Privacy-safe settled message ${index}.`,
          status: 'complete' as const,
          createdAt: '2026-08-20T00:00:01.000Z',
        })),
      },
    }
    const output: Output = {
      id: 'pathological-follow-up-output',
      resultCardId: result.id,
      chosenVersionId: chosen.id,
      versions: [chosen],
    }
    const sourceBoard: SavedBoard = {
      version: 1,
      cards: [result],
      connections: [],
      outputs: [output],
      runs: [],
      updatedAt: '',
    }
    const downstream: OutputVersion = {
      id: 'pathological-follow-up-downstream',
      number: 1,
      text: 'Downstream answer',
      createdAt: '2026-08-20T00:00:02.000Z',
      fromRunId: 'pathological-follow-up-downstream-run',
      sourceContext: createSourceContextSnapshot(sourceBoard, [{ cardId: result.id }]),
    }
    useGraph.setState({ cards: [result], outputs: [output] })
    resetSourceChangeStatusDerivationCountForTests()

    const view = renderHook(() => useSourceChangeStatus(downstream))
    expect(view.result.current).toBeNull()
    expect(sourceFollowUpProjectionBuildCountForTests()).toBe(1)
    expect(sourceFollowUpProjectionVisitCountForTests()).toBe(30_000)

    act(() => {
      for (let step = 1; step <= 30; step += 1) {
        useGraph.getState().moveCard(
          result.id,
          { x: step * 7, y: step * 3 },
          { recordHistory: false },
        )
      }
    })

    expect(view.result.current).toBeNull()
    expect(sourceChangeStatusDerivationCountForTests()).toBe(1)
    expect(sourceFollowUpProjectionBuildCountForTests()).toBe(1)
    expect(sourceFollowUpProjectionVisitCountForTests()).toBe(30_000)

    act(() => {
      useGraph.setState((state) => ({
        outputs: state.outputs.map((candidateOutput) => candidateOutput.id === output.id
          ? {
              ...candidateOutput,
              versions: candidateOutput.versions.map((candidate) => candidate.id === chosen.id
                ? { ...candidate, text: 'Changed chosen result text' }
                : candidate),
            }
          : candidateOutput),
      }))
    })
    expect(view.result.current?.changes[0]).toMatchObject({
      cardId: result.id,
      reason: 'changed',
    })
    expect(sourceChangeStatusDerivationCountForTests()).toBe(2)
    expect(sourceFollowUpProjectionBuildCountForTests()).toBe(1)
    expect(sourceFollowUpProjectionVisitCountForTests()).toBe(30_000)

    act(() => {
      useGraph.setState((state) => ({
        outputs: state.outputs.map((candidateOutput) => candidateOutput.id === output.id
          ? {
              ...candidateOutput,
              versions: candidateOutput.versions.map((candidate) => candidate.id === chosen.id
                ? {
                    ...candidate,
                    followUpThread: {
                      ...candidate.followUpThread,
                      messages: candidate.followUpThread!.messages.map((message, index) => index === 29_999
                        ? { ...message, text: 'Changed final settled message.' }
                        : message),
                    },
                  }
                : candidate),
            }
          : candidateOutput),
      }))
    })
    expect(sourceChangeStatusDerivationCountForTests()).toBe(3)
    expect(sourceFollowUpProjectionBuildCountForTests()).toBe(2)
    expect(sourceFollowUpProjectionVisitCountForTests()).toBe(60_000)
  })

  it('does not revisit a large Group source on repeated real geometry commits', () => {
    const group: Card = {
      id: 'large-source-group',
      kind: 'group',
      blocks: [],
      title: 'Large source group',
      position: { x: 0, y: 0 },
      size: { width: 40_000, height: 400 },
    }
    const members: Card[] = Array.from({ length: 30_000 }, (_, index) => ({
      id: `large-source-member-${index}`,
      kind: 'note',
      blocks: [{ id: `large-source-member-block-${index}`, text: `Member ${index}` }],
      groupId: group.id,
      position: { x: index, y: 0 },
    }))
    const cards = [group, ...members]
    const sourceBoard: SavedBoard = {
      version: 1,
      cards,
      connections: [],
      outputs: [],
      runs: [],
      updatedAt: '',
    }
    const downstream: OutputVersion = {
      id: 'large-group-downstream-version',
      number: 1,
      text: 'Downstream answer',
      createdAt: '2026-08-20T00:00:00.000Z',
      fromRunId: 'large-group-downstream-run',
      sourceContext: createSourceContextSnapshot(sourceBoard, [{ cardId: group.id, groupMode: 'full' }]),
    }
    useGraph.setState({ cards, outputs: [], connections: [], runs: [], boardChangeSeq: 0, lastBoardChange: null })
    resetSourceChangeStatusDerivationCountForTests()

    const view = renderHook(() => useSourceChangeStatus(downstream))
    expect(view.result.current).toBeNull()
    expect(sourceGroupMemberProjectionVisitCountForTests()).toBe(30_000)

    act(() => {
      for (let step = 1; step <= 30; step += 1) {
        useGraph.getState().moveCard(
          members[0]!.id,
          { x: step * 7, y: step * 3 },
          { recordHistory: false },
        )
      }
    })

    expect(view.result.current).toBeNull()
    expect(sourceChangeStatusDerivationCountForTests()).toBe(1)
    expect(sourceGroupMemberProjectionVisitCountForTests()).toBe(30_000)
  })

  it('keeps a settled follow-up prefix cold while the final streaming row grows', () => {
    const result: Card = {
      id: 'streaming-follow-up-result',
      kind: 'result',
      blocks: [{ id: 'streaming-follow-up-result-block', text: '' }],
      position: { x: 0, y: 0 },
    }
    const messages: FollowUpMessage[] = Array.from({ length: 30_000 }, (_, index) => ({
      id: `settled-follow-up-${index}`,
      role: 'assistant' as const,
      text: `Settled message ${index}.`,
      status: 'complete' as const,
      createdAt: '2026-08-20T00:00:00.000Z',
    }))
    messages.push({
      id: 'streaming-follow-up-row',
      role: 'assistant',
      text: 'partial',
      status: 'streaming',
      createdAt: '2026-08-20T00:00:00.000Z',
    })
    const chosen: OutputVersion = {
      id: 'streaming-follow-up-version',
      number: 1,
      text: 'Original result',
      createdAt: '2026-08-20T00:00:00.000Z',
      fromRunId: 'streaming-follow-up-run',
      followUpThread: { messages },
    }
    const output: Output = {
      id: 'streaming-follow-up-output',
      resultCardId: result.id,
      chosenVersionId: chosen.id,
      versions: [chosen],
    }
    const sourceBoard: SavedBoard = {
      version: 1,
      cards: [result],
      connections: [],
      outputs: [output],
      runs: [],
      updatedAt: '',
    }
    const downstream: OutputVersion = {
      id: 'streaming-follow-up-downstream',
      number: 1,
      text: 'Downstream answer',
      createdAt: '2026-08-20T00:00:00.000Z',
      fromRunId: 'streaming-follow-up-downstream-run',
      sourceContext: createSourceContextSnapshot(sourceBoard, [{ cardId: result.id }]),
    }
    useGraph.setState({
      cards: [result],
      outputs: [output],
      connections: [],
      runs: [],
      boardChangeSeq: 0,
      lastBoardChange: null,
    })
    resetSourceChangeStatusDerivationCountForTests()

    const view = renderHook(() => useSourceChangeStatus(downstream))
    expect(view.result.current).toBeNull()
    expect(sourceFollowUpProjectionBuildCountForTests()).toBe(1)
    expect(sourceFollowUpProjectionVisitCountForTests()).toBe(30_001)

    act(() => {
      for (let chunk = 1; chunk <= 30; chunk += 1) {
        useGraph.getState().appendFollowUpChunk(
          chosen.id,
          'streaming-follow-up-row',
          ` chunk ${chunk}`,
        )
      }
    })

    expect(view.result.current).toBeNull()
    expect(sourceChangeStatusDerivationCountForTests()).toBe(1)
    expect(sourceFollowUpProjectionBuildCountForTests()).toBe(1)
    expect(sourceFollowUpProjectionVisitCountForTests()).toBe(30_001)
  })
})
