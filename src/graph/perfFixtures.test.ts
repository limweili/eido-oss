import { describe, expect, it } from 'vitest'
import {
  createFounderLongNotesBoard,
  createLongResultMotionBoard,
  createPerfBoard,
  createRichCardBenchmarkBoard,
  FOUNDER_LONG_NOTE_FIXTURE,
  LONG_RESULT_MOTION_FIXTURE,
  PERF_BOARD_SIZES,
} from './perfFixtures'
import { createTimelineProjector } from './timeline'
import { FULL_DETAIL_CARD_LIMIT } from '../canvas/boardScene'
import { renderedCardSize } from '../canvas/renderPlanning'

describe('performance fixtures', () => {
  it('creates deterministic synthetic boards at the documented smoke size', () => {
    const first = createPerfBoard('smoke')
    const second = createPerfBoard('smoke')

    expect(first).toEqual(second)
    expect(first.cards).toHaveLength(PERF_BOARD_SIZES.smoke.cards)
    expect(first.connections).toHaveLength(PERF_BOARD_SIZES.smoke.connections)
    expect(first.intentLog).toHaveLength(PERF_BOARD_SIZES.smoke.timelineEvents)
    expect(first.outputs.flatMap((output) => output.versions)).toHaveLength(PERF_BOARD_SIZES.smoke.outputVersions)
    expect(first.runs).toHaveLength(PERF_BOARD_SIZES.smoke.outputVersions)
  })

  it('projects smoke fixture timelines through the projector seam', () => {
    const board = createPerfBoard('smoke')
    const projector = createTimelineProjector(board)

    expect(projector.range).not.toBeNull()
    expect(projector.projectAt(projector.range?.startAt ?? board.updatedAt).eventCount).toBe(
      PERF_BOARD_SIZES.smoke.timelineEvents,
    )
    expect(projector.projectAt(board.updatedAt).cards.length).toBeGreaterThan(0)
  })

  it('creates a rich-text fixture with real-board-scale markdown bodies', () => {
    const board = createPerfBoard('rich')
    const longestCardText = Math.max(...board.cards.map((card) => card.blocks.map((block) => block.text).join('\n').length))
    const longestOutputText = Math.max(...board.outputs.flatMap((output) => output.versions.map((version) => version.text.length)))

    expect(board.cards).toHaveLength(PERF_BOARD_SIZES.rich.cards)
    expect(longestCardText).toBeGreaterThan(50_000)
    expect(longestOutputText).toBeGreaterThan(45_000)
  })

  it('creates the declutter fixture with mixed card sizes and title lengths', () => {
    const board = createPerfBoard('declutter')
    const sizes = new Set(board.cards.map((card) => `${card.size?.width ?? 'auto'}x${card.size?.height ?? 'auto'}`))
    const titleLengths = board.cards.map((card) => card.title?.length ?? 0)

    expect(board.cards).toHaveLength(300)
    expect(sizes.size).toBeGreaterThanOrEqual(4)
    expect(titleLengths.some((length) => length === 0)).toBe(true)
    expect(titleLengths.some((length) => length > 0 && length <= 12)).toBe(true)
    expect(titleLengths.some((length) => length >= 80)).toBe(true)
  })

  it('creates the label-dense fixture with 1,500 tightly packed titled cards', () => {
    const board = createPerfBoard('labelDense')
    const occupiedWidth = Math.max(...board.cards.map((card) => card.position.x))
    const occupiedHeight = Math.max(...board.cards.map((card) => card.position.y))

    expect(board.cards).toHaveLength(1_500)
    expect(board.cards.every((card) => Boolean(card.title?.trim()))).toBe(true)
    expect(occupiedWidth).toBeLessThan(4_000)
    expect(occupiedHeight).toBeLessThan(1_500)
  })

  it('creates the deterministic auto-sized founder long-Note fixture inside one Reading viewport', () => {
    const first = createFounderLongNotesBoard()
    const second = createPerfBoard(FOUNDER_LONG_NOTE_FIXTURE.name)
    const textLengths = first.cards.map((card) => card.blocks.map((block) => block.text).join('\n').length)
    const totalTextWeight = textLengths.reduce((total, length) => total + length, 0)
    const { readingViewport } = FOUNDER_LONG_NOTE_FIXTURE
    const visibleBounds = {
      left: readingViewport.boardCenter.x - readingViewport.width / readingViewport.zoom / 2,
      right: readingViewport.boardCenter.x + readingViewport.width / readingViewport.zoom / 2,
      top: readingViewport.boardCenter.y - readingViewport.height / readingViewport.zoom / 2,
      bottom: readingViewport.boardCenter.y + readingViewport.height / readingViewport.zoom / 2,
    }

    expect(first).toEqual(second)
    expect(first.cards).toHaveLength(FOUNDER_LONG_NOTE_FIXTURE.cardCount)
    expect(first.cards.every((card) => card.kind === 'note' && card.size === undefined)).toBe(true)
    expect(textLengths.every((length) => length > 1_200)).toBe(true)
    expect(totalTextWeight).toBeGreaterThan(FOUNDER_LONG_NOTE_FIXTURE.aggregateTextWeightFloor)
    expect(first.cards.every((card) => {
      const size = renderedCardSize(card)
      return (
        card.position.x >= visibleBounds.left &&
        card.position.x + size.width <= visibleBounds.right &&
        card.position.y >= visibleBounds.top &&
        card.position.y + size.height <= visibleBounds.bottom
      )
    })).toBe(true)
    expect(first.connections).toEqual([])
    expect(first.outputs).toEqual([])
    expect(first.runs).toEqual([])
    expect(first.intentLog).toEqual([])

    const serialized = JSON.stringify(first)
    expect(serialized).not.toMatch(/Users\/|\\Users\\|\.eido|eido-v3-ideas|BEGIN (RSA|OPENSSH) PRIVATE KEY/i)
    expect(first.updatedAt).toBe('2026-06-20T00:00:00.000Z')
  })

  it('creates a deterministic, scalable, privacy-safe rich Card benchmark', () => {
    const first = createRichCardBenchmarkBoard({ ordinaryCardCount: 24 })
    const second = createRichCardBenchmarkBoard({ ordinaryCardCount: 24 })
    const giantNote = first.cards.find((card) => card.id === 'benchmark-giant-note')
    const result = first.cards.find((card) => card.id === 'benchmark-long-result')
    const conversationResult = first.cards.find((card) => card.id === 'benchmark-long-conversation')
    const conversationSource = first.cards.find((card) => card.id === 'benchmark-conversation-source')
    const resultOutput = first.outputs.find((output) => output.resultCardId === result?.id)
    const conversationOutput = first.outputs.find((output) => output.resultCardId === conversationResult?.id)
    const conversationRun = first.runs.find(
      (run) => run.producedVersionId === conversationOutput?.chosenVersionId,
    )
    const imageAssets = first.cards.flatMap((card) => card.assets ?? []).filter((asset) => asset.kind === 'image')

    expect(first).toEqual(second)
    expect(first.cards).toHaveLength(32)
    expect(giantNote?.blocks[0]?.text.length).toBeGreaterThan(60_000)
    expect(resultOutput?.versions.length).toBeGreaterThanOrEqual(4)
    expect(resultOutput?.versions.some((version) => (version.followUpThread?.messages.length ?? 0) >= 16)).toBe(true)
    expect(conversationSource?.kind).toBe('conversation')
    expect(conversationResult?.kind).toBe('result')
    expect(first.connections).toContainEqual(
      expect.objectContaining({
        from: { cardId: conversationSource?.id },
        to: { cardId: conversationResult?.id },
        role: 'feeds',
      }),
    )
    expect(conversationOutput?.versions[0]?.transcript?.length).toBeGreaterThanOrEqual(100)
    expect(conversationRun).toMatchObject({
      askAiCardId: conversationSource?.id,
      kind: 'conversation',
    })
    expect(imageAssets.length).toBeGreaterThanOrEqual(8)
    expect(new Set(imageAssets.map((asset) => `${asset.width}x${asset.height}`)).size).toBeGreaterThanOrEqual(3)
    expect(imageAssets.some((asset) => asset.mimeType === 'image/png')).toBe(true)
    const svgAssets = imageAssets.filter((asset) => asset.mimeType === 'image/svg+xml')
    expect(svgAssets.length).toBeGreaterThanOrEqual(8)
    for (const asset of svgAssets) {
      const decoded = decodeURIComponent(asset.dataUrl.slice(asset.dataUrl.indexOf(',') + 1))
      expect(decoded).toContain(`width="${asset.width}"`)
      expect(decoded).toContain(`height="${asset.height}"`)
    }
    expect(new Set(imageAssets.map((asset) => asset.dataUrl)).size).toBeGreaterThanOrEqual(8)
    expect(first.connections.length).toBeGreaterThan(24)

    expect(first.cards.length).toBeLessThan(FULL_DETAIL_CARD_LIMIT)

    const serialized = JSON.stringify(first)
    expect(serialized).not.toMatch(/Users\/|\.eido|eido-v3-ideas|BEGIN (RSA|OPENSSH) PRIVATE KEY/i)
    expect(first.updatedAt).toBe('2026-06-20T00:00:00.000Z')
  })

  it('loads the canonical rich Card benchmark through the browser fixture name', () => {
    const board = createPerfBoard('richCardBenchmark')

    expect(board.cards.some((card) => card.id === 'benchmark-giant-note')).toBe(true)
    expect(board.cards.some((card) => card.id === 'benchmark-long-result')).toBe(true)
    expect(board.cards.some((card) => card.id === 'benchmark-long-conversation')).toBe(true)
  })

  it('pairs identical long-Result motion geometry with control and stress content', () => {
    const control = createLongResultMotionBoard(false)
    const stress = createPerfBoard(LONG_RESULT_MOTION_FIXTURE.stressName)
    const controlResult = control.cards.find((card) => card.id === LONG_RESULT_MOTION_FIXTURE.resultCardId)
    const stressResult = stress.cards.find((card) => card.id === LONG_RESULT_MOTION_FIXTURE.resultCardId)
    const controlConversation = control.cards.find(
      (card) => card.id === LONG_RESULT_MOTION_FIXTURE.conversationCardId,
    )
    const controlNote = control.cards.find((card) => card.id === LONG_RESULT_MOTION_FIXTURE.noteCardId)
    const stressNote = stress.cards.find((card) => card.id === LONG_RESULT_MOTION_FIXTURE.noteCardId)
    const stressConversation = stress.cards.find(
      (card) => card.id === LONG_RESULT_MOTION_FIXTURE.conversationCardId,
    )
    const controlOutput = control.outputs.find(
      (output) => output.resultCardId === LONG_RESULT_MOTION_FIXTURE.resultCardId,
    )
    const stressOutput = stress.outputs.find(
      (output) => output.resultCardId === LONG_RESULT_MOTION_FIXTURE.resultCardId,
    )
    const controlVersion = controlOutput?.versions.find(
      (version) => version.id === LONG_RESULT_MOTION_FIXTURE.chosenVersionId,
    )
    const stressVersion = stressOutput?.versions.find(
      (version) => version.id === LONG_RESULT_MOTION_FIXTURE.chosenVersionId,
    )
    const controlConversationVersion = control.outputs
      .find((output) => output.resultCardId === LONG_RESULT_MOTION_FIXTURE.conversationCardId)
      ?.versions.find((version) => version.id === LONG_RESULT_MOTION_FIXTURE.conversationVersionId)
    const stressConversationVersion = stress.outputs
      .find((output) => output.resultCardId === LONG_RESULT_MOTION_FIXTURE.conversationCardId)
      ?.versions.find((version) => version.id === LONG_RESULT_MOTION_FIXTURE.conversationVersionId)

    expect(control.cards).toHaveLength(LONG_RESULT_MOTION_FIXTURE.cardCount)
    expect(stress.cards).toHaveLength(LONG_RESULT_MOTION_FIXTURE.cardCount)
    expect(stressResult).toMatchObject({
      id: controlResult?.id,
      position: controlResult?.position,
      size: controlResult?.size,
    })
    expect(stressConversation).toMatchObject({
      id: controlConversation?.id,
      position: controlConversation?.position,
      size: controlConversation?.size,
    })
    expect(stress.cards.map(({ id, kind, position, size }) => ({ id, kind, position, size }))).toEqual(
      control.cards.map(({ id, kind, position, size }) => ({ id, kind, position, size })),
    )
    expect(controlNote?.blocks[0]?.text).toHaveLength(LONG_RESULT_MOTION_FIXTURE.controlTextChars)
    expect(stressNote?.blocks[0]?.text).toHaveLength(LONG_RESULT_MOTION_FIXTURE.noteStressTextChars)
    expect(stressNote?.blocks[0]?.text).toContain('Long Note motion stress')
    expect(stressNote?.blocks[0]?.text).toContain(LONG_RESULT_MOTION_FIXTURE.sentinels.note.start)
    expect(stressNote?.blocks[0]?.text).toContain(LONG_RESULT_MOTION_FIXTURE.sentinels.note.middle)
    expect(stressNote?.blocks[0]?.text).toContain(LONG_RESULT_MOTION_FIXTURE.sentinels.note.end)
    expect(stressNote?.blocks[0]?.text.split('\n\n').length ?? 0).toBeGreaterThan(4_000)
    expect(controlOutput?.chosenVersionId).toBe(LONG_RESULT_MOTION_FIXTURE.chosenVersionId)
    expect(stressOutput?.chosenVersionId).toBe(LONG_RESULT_MOTION_FIXTURE.chosenVersionId)
    expect(controlVersion?.text).toHaveLength(LONG_RESULT_MOTION_FIXTURE.controlTextChars)
    expect(stressVersion?.text).toHaveLength(LONG_RESULT_MOTION_FIXTURE.stressTextChars)
    expect(stressVersion?.text).toContain(LONG_RESULT_MOTION_FIXTURE.sentinels.result.start)
    expect(stressVersion?.text).toContain(LONG_RESULT_MOTION_FIXTURE.sentinels.result.middle)
    expect(stressVersion?.text).toContain(LONG_RESULT_MOTION_FIXTURE.sentinels.result.end)
    expect(stressVersion?.text.split('\n\n').length ?? 0).toBeGreaterThan(4_000)
    expect(controlVersion?.followUpThread?.messages).toHaveLength(LONG_RESULT_MOTION_FIXTURE.followUpCount)
    expect(stressVersion?.followUpThread?.messages).toHaveLength(LONG_RESULT_MOTION_FIXTURE.followUpCount)
    expect(stressVersion?.followUpThread?.messages[0]?.text).toContain(
      LONG_RESULT_MOTION_FIXTURE.sentinels.followUp.start,
    )
    expect(
      stressVersion?.followUpThread?.messages[Math.floor(LONG_RESULT_MOTION_FIXTURE.followUpCount / 2)]?.text,
    ).toContain(LONG_RESULT_MOTION_FIXTURE.sentinels.followUp.middle)
    expect(stressVersion?.followUpThread?.messages[LONG_RESULT_MOTION_FIXTURE.followUpCount - 1]?.text).toContain(
      LONG_RESULT_MOTION_FIXTURE.sentinels.followUp.end,
    )
    expect(stressVersion?.followUpThread?.messages.every((message) => /\S$/.test(message.text))).toBe(true)
    expect(stressVersion?.followUpThread?.messages.map((message) => message.id)).toEqual(
      controlVersion?.followUpThread?.messages.map((message) => message.id),
    )
    expect(controlConversationVersion?.transcript).toHaveLength(LONG_RESULT_MOTION_FIXTURE.transcriptCount)
    expect(stressConversationVersion?.transcript).toHaveLength(LONG_RESULT_MOTION_FIXTURE.transcriptCount)
    expect(stressConversationVersion?.transcript?.map((message) => message.id)).toEqual(
      controlConversationVersion?.transcript?.map((message) => message.id),
    )
    expect(stressConversationVersion?.transcript?.[0]?.text.length).toBeGreaterThan(
      controlConversationVersion?.transcript?.[0]?.text.length ?? 0,
    )
    expect(stressConversationVersion?.transcript?.[0]?.text).toContain(
      LONG_RESULT_MOTION_FIXTURE.sentinels.conversation.start,
    )
    expect(stressConversationVersion?.transcript?.[Math.floor(LONG_RESULT_MOTION_FIXTURE.transcriptCount / 2)]?.text).toContain(
      LONG_RESULT_MOTION_FIXTURE.sentinels.conversation.middle,
    )
    expect(stressConversationVersion?.transcript?.[LONG_RESULT_MOTION_FIXTURE.transcriptCount - 1]?.text).toContain(
      LONG_RESULT_MOTION_FIXTURE.sentinels.conversation.end,
    )
    expect(stressConversationVersion?.transcript?.every((message) => /\S$/.test(message.text))).toBe(true)
    expect(JSON.stringify(stress)).not.toMatch(
      /Users\/|\\Users\\|\.eido|eido-v3-ideas|BEGIN (RSA|OPENSSH) PRIVATE KEY/i,
    )
  })
})
