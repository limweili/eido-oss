import { expect, test, type Page } from '@playwright/test'
import {
  createLongResultMotionBoard,
  LONG_RESULT_MOTION_FIXTURE,
  type PerfFixtureName,
} from '../graph/perfFixtures'
import { isStressMaxWithinControlEnvelope } from './longResultMotionMetrics'

type MotionPhase = 'boundary' | 'steady' | 'release' | 'postRelease'

type MotionMetrics = {
  p95FrameMs: number
  maxFrameMs: number
  missedFrames: number
  longTaskCount: number
  maxLongTaskMs: number
}

type MotionSample = MotionMetrics & {
  completionMs: number
  cadenceMs: number
  semanticMutationCount: number
  boundary: MotionMetrics
  steady: MotionMetrics
  release: MotionMetrics
  postRelease: MotionMetrics
}

type MarkMotionPhase = (phase: MotionPhase) => Promise<void>

type FixtureSample = {
  pan: MotionSample
  zoom: MotionSample
  noteDrag: MotionSample
  resultDrag: MotionSample
  conversationDrag: MotionSample
}

const MOTION_STORM_MS = 750
const MOTION_STORM_HZ = 500
const MOTION_BOUNDARY_MARK_MS = 120
const DEFAULT_CADENCE_MS = 1_000 / 60

const FIXTURE_WARMUP_ORDER = [
  LONG_RESULT_MOTION_FIXTURE.controlName,
  LONG_RESULT_MOTION_FIXTURE.stressName,
] as const
const fixtureSemanticExpectationCache = new Map<string, FixtureSemanticExpectation>()

function hashString(value: string) {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function expectedSemanticText(
  sourceText: string,
  sentinels: { start: string; middle: string; end: string },
): SemanticTextExpectation {
  // The fixture owns a plain paragraph grammar: blank lines are structural
  // separators, and every other character is literal prose. This gives the
  // verifier an exact rendered-child oracle without importing or duplicating
  // the production Markdown renderer.
  const chunks = sourceText.split('\n\n')
  const renderedText = chunks.join('')
  return {
    sourceTextLength: sourceText.length,
    sourceTextHash: hashString(sourceText),
    renderedTextLength: renderedText.length,
    renderedTextHash: hashString(renderedText),
    chunkCount: chunks.length,
    chunkTextLengths: chunks.map((chunk) => chunk.length),
    chunkTextHashes: chunks.map(hashString),
    sentinels: {
      start: renderedText.includes(sentinels.start),
      middle: renderedText.includes(sentinels.middle),
      end: renderedText.includes(sentinels.end),
    },
  }
}

function expectedFixtureSemanticContent(fixtureName: PerfFixtureName): FixtureSemanticExpectation {
  const cached = fixtureSemanticExpectationCache.get(fixtureName)
  if (cached) return cached
  const stress = fixtureName === LONG_RESULT_MOTION_FIXTURE.stressName
  const board = createLongResultMotionBoard(stress)
  const note = board.cards.find((card) => card.id === LONG_RESULT_MOTION_FIXTURE.noteCardId)
  const resultOutput = board.outputs.find((output) => output.resultCardId === LONG_RESULT_MOTION_FIXTURE.resultCardId)
  const result = resultOutput?.versions.find((version) => version.id === LONG_RESULT_MOTION_FIXTURE.chosenVersionId)
  const conversationOutput = board.outputs.find(
    (output) => output.resultCardId === LONG_RESULT_MOTION_FIXTURE.conversationCardId,
  )
  const conversation = conversationOutput?.versions.find(
    (version) => version.id === LONG_RESULT_MOTION_FIXTURE.conversationVersionId,
  )
  if (!note || !result || !conversation) throw new Error(`Missing expected semantic content for ${fixtureName}`)
  const expected = {
    note: expectedSemanticText(note.blocks[0]?.text ?? '', LONG_RESULT_MOTION_FIXTURE.sentinels.note),
    result: expectedSemanticText(result.text, LONG_RESULT_MOTION_FIXTURE.sentinels.result),
    followUps: (result.followUpThread?.messages ?? []).map((message) => ({
      ...expectedSemanticText(message.text, LONG_RESULT_MOTION_FIXTURE.sentinels.followUp),
      className: `followup-bubble ${message.role}`,
    })),
    transcript: (conversation.transcript ?? []).map((message) => ({
      ...expectedSemanticText(message.text, LONG_RESULT_MOTION_FIXTURE.sentinels.conversation),
      className: `bubble ${message.speakerKind}`,
    })),
  }
  fixtureSemanticExpectationCache.set(fixtureName, expected)
  return expected
}

type CapturedFrame = {
  timestamp: number
  phase: MotionPhase
}

type CapturedLongTask = {
  duration: number
  startTime: number
}

type ViewportSnapshot = {
  x: number
  y: number
  zoom: number
}

type SemanticSnapshot = {
  textLength: number
  textHash: number
  structureHash: number
  styleHash: number
  descendantCount: number
  rowCount: number
  sentinels: { start: boolean; middle: boolean; end: boolean }
  hiddenDescendantCount: number
  rootClassName: string
  inlineStyleCount: number
}

type SemanticTextExpectation = {
  sourceTextLength: number
  sourceTextHash: number
  renderedTextLength: number
  renderedTextHash: number
  chunkCount: number
  chunkTextLengths: number[]
  chunkTextHashes: number[]
  sentinels: { start: boolean; middle: boolean; end: boolean }
}

type SemanticRowExpectation = SemanticTextExpectation & {
  className: string
}

type FixtureSemanticExpectation = {
  note: SemanticTextExpectation
  result: SemanticTextExpectation
  followUps: SemanticRowExpectation[]
  transcript: SemanticRowExpectation[]
}

type FixtureBaseline = {
  viewport: ViewportSnapshot
  note: SemanticSnapshot
  result: SemanticSnapshot
  conversation: SemanticSnapshot
  noteBlockChars: number
  resultTextChars: number
  followUpCount: number
  transcriptCount: number
  terminalFollowUp: boolean
  terminalTranscript: boolean
  dom: {
    noteBody: boolean
    noteRoot: boolean
    resultBody: boolean
    resultRoot: boolean
    transcript: boolean
  }
}

type FixtureReadout = Omit<FixtureBaseline, 'viewport'> & {
  followUpSentinels: { start: boolean; middle: boolean; end: boolean }
  noteBlockHash: number
  resultTextHash: number
  noteMain: SemanticTextExpectation
  resultMain: SemanticTextExpectation
  followUpRows: SemanticRowExpectation[]
  transcriptRows: SemanticRowExpectation[]
  scrollable: {
    note: boolean
    result: boolean
    conversation: boolean
  }
  sameScroll: {
    note: boolean
    result: boolean
    conversation: boolean
  }
  sameBounds: {
    note: boolean
    result: boolean
    conversation: boolean
  }
  destructiveInstrumentation: boolean
}

test('million-character Cards do not add content-proportional pan, zoom, or drag stalls', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.__EIDO_PERF__) && Boolean((window as { __eido?: unknown }).__eido))
  const cadenceMs = await measureIdleFrameMs(page)

  // Warm both content arms through the exact gesture path before comparing
  // them. Each warmup also exercises the real-DOM red paths once.
  for (const fixtureName of FIXTURE_WARMUP_ORDER) {
    await measureFixture(page, fixtureName, cadenceMs, true)
  }
  // Measure both deterministic orders. Warmup order alone is not a
  // counterbalance: each pair below is a real gate comparison in its own
  // fixture-load order.
  const controlAb = await measureFixture(page, LONG_RESULT_MOTION_FIXTURE.controlName, cadenceMs)
  const stressAb = await measureFixture(page, LONG_RESULT_MOTION_FIXTURE.stressName, cadenceMs)
  const stressBa = await measureFixture(page, LONG_RESULT_MOTION_FIXTURE.stressName, cadenceMs)
  const controlBa = await measureFixture(page, LONG_RESULT_MOTION_FIXTURE.controlName, cadenceMs)
  console.log('Counterbalanced Result motion samples', {
    controlAb: roundedFixtureSample(controlAb),
    stressAb: roundedFixtureSample(stressAb),
    stressBa: roundedFixtureSample(stressBa),
    controlBa: roundedFixtureSample(controlBa),
  })
  expectCounterbalancedMotion('AB', controlAb, stressAb, cadenceMs)
  expectCounterbalancedMotion('BA', controlBa, stressBa, cadenceMs)
})

async function measureFixture(
  page: Page,
  fixtureName: PerfFixtureName,
  cadenceMs: number,
  verifySemanticMutations = false,
): Promise<FixtureSample> {
  const loaded = await page.evaluate((name) => window.__EIDO_PERF__?.loadFixture(name), fixtureName)
  expect(loaded).toMatchObject({ cards: LONG_RESULT_MOTION_FIXTURE.cardCount, outputs: 2 })
  const baseline = await prepareMotionFixture(page, fixtureName)
  if (verifySemanticMutations) await exerciseSemanticVerifierRedPaths(page, fixtureName, baseline)
  const pan = await measurePan(page, cadenceMs, baseline.viewport)
  requireNoSemanticMutations(pan, `${fixtureName} pan`)
  await assertCompleteFixtureArm(page, fixtureName, 'pan', baseline)
  const zoom = await measureZoom(page, cadenceMs, baseline.viewport)
  requireNoSemanticMutations(zoom, `${fixtureName} zoom`)
  await assertCompleteFixtureArm(page, fixtureName, 'zoom', baseline)
  const resultDrag = await measureDrag(
    page,
    LONG_RESULT_MOTION_FIXTURE.resultCardId,
    '.result-highlight-root',
    'Result',
    cadenceMs,
  )
  requireNoSemanticMutations(resultDrag, `${fixtureName} Result drag`)
  await assertCompleteFixtureArm(page, fixtureName, 'result drag', baseline)
  const conversationDrag = await measureDrag(
    page,
    LONG_RESULT_MOTION_FIXTURE.conversationCardId,
    '.transcript',
    'Conversation Result',
    cadenceMs,
  )
  requireNoSemanticMutations(conversationDrag, `${fixtureName} Conversation drag`)
  await assertCompleteFixtureArm(page, fixtureName, 'conversation drag', baseline)
  const noteDrag = await measureDrag(
    page,
    LONG_RESULT_MOTION_FIXTURE.noteCardId,
    '.note-render:not(.markdown-card-editor-placeholder)',
    'Note',
    cadenceMs,
  )
  requireNoSemanticMutations(noteDrag, `${fixtureName} Note drag`)
  await assertCompleteFixtureArm(page, fixtureName, 'Note drag', baseline)
  return { pan, zoom, noteDrag, resultDrag, conversationDrag }
}

function requireNoSemanticMutations(sample: MotionSample, label: string) {
  if (sample.semanticMutationCount > 0) {
    throw new Error(`${label}: semantic subtree mutated ${sample.semanticMutationCount} time(s) during the gesture`)
  }
}

async function measurePan(page: Page, cadenceMs: number, viewport: ViewportSnapshot): Promise<MotionSample> {
  await setActiveTool(page, 'pan')
  const before = await viewportTransform(page)
  const sample = await captureFrames(page, cadenceMs, async (markPhase) => {
    const start = { x: 640, y: 500 }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await driveMouseStorm(page, start)
    await expectSemanticVisible(
      page,
      LONG_RESULT_MOTION_FIXTURE.resultCardId,
      '.result-highlight-root',
      'Result text should remain visibly represented while panning',
    )
    await expectSemanticVisible(
      page,
      LONG_RESULT_MOTION_FIXTURE.conversationCardId,
      '.transcript',
      'Conversation text should remain visibly represented while panning',
    )
    await expectSemanticVisible(
      page,
      LONG_RESULT_MOTION_FIXTURE.noteCardId,
      '.note-render:not(.markdown-card-editor-placeholder)',
      'Note text should remain visibly represented while panning',
    )
    expect(await cursorAt(page, start), 'active pan should keep the closed-hand cursor').toBe('grabbing')
    await markPhase('release')
    await page.mouse.up()
    await waitForFrames(page, 2)
    await markPhase('postRelease')
  })
  await expectSemanticOpacity(page, LONG_RESULT_MOTION_FIXTURE.resultCardId, '.result-highlight-root', '1')
  await expectSemanticOpacity(page, LONG_RESULT_MOTION_FIXTURE.conversationCardId, '.transcript', '1')
  await expectSemanticOpacity(
    page,
    LONG_RESULT_MOTION_FIXTURE.noteCardId,
    '.note-render:not(.markdown-card-editor-placeholder)',
    '1',
  )
  const after = await viewportTransform(page)
  expect(Math.hypot(after.x - before.x, after.y - before.y), 'pan gesture must move the viewport').toBeGreaterThan(120)
  await restoreMotionFixtureViewport(page, viewport)
  await setActiveTool(page, 'select')
  return sample
}

async function measureZoom(page: Page, cadenceMs: number, viewport: ViewportSnapshot): Promise<MotionSample> {
  await setActiveTool(page, 'select')
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  const before = await viewportZoom(page)
  const point = { x: 640, y: 500 }
  await page.mouse.move(point.x, point.y)
  await page.keyboard.down('Control')
  let sample: MotionSample
  try {
    sample = await captureFrames(page, cadenceMs, async (markPhase) => {
      for (let step = 0; step < 24; step += 1) {
        await page.mouse.wheel(0, -2)
        await waitForFrames(page, 1)
        if (step === 3) await markPhase('steady')
      }
      await expectSemanticVisible(
        page,
        LONG_RESULT_MOTION_FIXTURE.resultCardId,
        '.result-highlight-root',
        'Result text should remain visibly represented while zooming',
      )
      await expectSemanticVisible(
        page,
        LONG_RESULT_MOTION_FIXTURE.conversationCardId,
        '.transcript',
        'Conversation text should remain visibly represented while zooming',
      )
      await expectSemanticVisible(
        page,
        LONG_RESULT_MOTION_FIXTURE.noteCardId,
        '.note-render:not(.markdown-card-editor-placeholder)',
        'Note text should remain visibly represented while zooming',
      )
      await markPhase('release')
      await page.keyboard.up('Control')
      await waitForFrames(page, 2)
      await markPhase('postRelease')
    })
  } finally {
    await page.keyboard.up('Control')
  }
  const after = await viewportZoom(page)
  expect(Math.abs(after - before), 'continuous Ctrl-wheel gesture must change viewport zoom').toBeGreaterThan(0.05)
  await restoreMotionFixtureViewport(page, viewport)
  return sample
}

async function measureDrag(
  page: Page,
  cardId: string,
  semanticSelector: string,
  label: string,
  cadenceMs: number,
): Promise<MotionSample> {
  await setActiveTool(page, 'select')
  const before = await cardPosition(page, cardId)
  const head = page.locator(nodeSelector(cardId)).locator('.card-head')
  const box = await head.boundingBox()
  if (!box) throw new Error(`Missing long ${label} drag target`)
  // The head padding is draggable; its title and controls intentionally block drag.
  const start = { x: box.x + box.width / 2, y: box.y + 3 }
  const sample = await captureFrames(page, cadenceMs, async (markPhase) => {
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await driveMouseStorm(page, start)
    await expectSemanticVisible(
      page,
      cardId,
      semanticSelector,
      `${label} text should remain visibly represented while dragging`,
    )
    await markPhase('release')
    await page.mouse.up()
    await waitForFrames(page, 2)
    await markPhase('postRelease')
  })
  await page.keyboard.press('Escape')
  await waitForFrames(page, 1)
  await expectSemanticOpacity(page, cardId, semanticSelector, '1')
  const after = await cardPosition(page, cardId)
  expect(Math.hypot(after.x - before.x, after.y - before.y), `drag gesture must move the ${label}`).toBeGreaterThan(100)
  return sample
}

async function driveMouseStorm(page: Page, from: { x: number; y: number }) {
  await page.evaluate(
    async ({ durationMs, frequencyHz, origin, boundaryMarkMs }) => {
      const startedAt = performance.now()
      let dispatched = 0
      let steadyMarked = false
      await new Promise<void>((resolve) => {
        const tick = () => {
          const elapsed = performance.now() - startedAt
          const target = Math.floor((Math.min(elapsed, durationMs) * frequencyHz) / 1_000)
          if (!steadyMarked && elapsed >= Math.min(boundaryMarkMs, durationMs / 2)) {
            steadyMarked = true
            const state = (window as unknown as { __EIDO_LONG_RESULT_MOTION__?: { phase?: MotionPhase } })
              .__EIDO_LONG_RESULT_MOTION__
            if (state) {
              state.phase = 'steady'
              ;(state as unknown as { phaseMarks?: Array<{ at: number; phase: MotionPhase }> }).phaseMarks?.push({
                at: performance.now(),
                phase: 'steady',
              })
            }
          }
          while (dispatched < target) {
            dispatched += 1
            window.dispatchEvent(new MouseEvent('mousemove', {
              bubbles: true,
              cancelable: true,
              view: window,
              buttons: 1,
              clientX: origin.x + dispatched * 0.4,
              clientY: origin.y + dispatched * 0.12,
            }))
          }
          if (elapsed >= durationMs) resolve()
          else setTimeout(tick, 1)
        }
        tick()
      })
    },
    {
      durationMs: MOTION_STORM_MS,
      frequencyHz: MOTION_STORM_HZ,
      origin: from,
      boundaryMarkMs: MOTION_BOUNDARY_MARK_MS,
    },
  )
}

async function prepareMotionFixture(page: Page, fixtureName: PerfFixtureName): Promise<FixtureBaseline> {
  await setActiveTool(page, 'select')
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    delete (window as unknown as { __EIDO_LONG_NOTE_DOM__?: unknown }).__EIDO_LONG_NOTE_DOM__
    delete (window as unknown as { __EIDO_LONG_RESULT_DOM__?: unknown }).__EIDO_LONG_RESULT_DOM__
    delete (window as unknown as { __EIDO_LONG_CONVERSATION_DOM__?: unknown }).__EIDO_LONG_CONVERSATION_DOM__
  })
  await page.waitForFunction(() => {
    const store = (window as unknown as {
      __eido?: { getState: () => { selection: unknown; selectedCardIds: string[] } }
    }).__eido
    const state = store?.getState()
    return state?.selection === null && state.selectedCardIds.length === 0
  })
  const viewport = await frameMotionFixture(page)
  for (const cardId of [
    LONG_RESULT_MOTION_FIXTURE.noteCardId,
    LONG_RESULT_MOTION_FIXTURE.resultCardId,
    LONG_RESULT_MOTION_FIXTURE.conversationCardId,
  ]) {
    await page.locator(nodeSelector(cardId)).waitFor({ state: 'visible', timeout: 30_000 })
  }
  await waitForFrames(page, 4)
  await preparePassiveNote(page)
  await preparePassiveResult(page)
  await preparePassiveConversation(page)
  const baseline = await captureSemanticBaseline(page, fixtureName, viewport)
  expect(baseline.note.sentinels).toEqual({ start: true, middle: true, end: true })
  expect(baseline.result.sentinels).toEqual({ start: true, middle: true, end: true })
  expect(baseline.conversation.sentinels).toEqual({ start: true, middle: true, end: true })
  return baseline
}

async function exerciseSemanticVerifierRedPaths(
  page: Page,
  fixtureName: PerfFixtureName,
  baseline: FixtureBaseline,
) {
  for (const mutation of [
    'text-character-truncation',
    'ancestor-hide',
    'ancestor-restyle',
    'row-loss',
    'detach-reinsert',
  ] as const) {
    const sample = await captureFrames(page, DEFAULT_CADENCE_MS, async () => {
      await mutateSemanticFixture(page, mutation)
      await waitForFrames(page, 2)
      await restoreSemanticFixtureMutation(page)
    })
    let rejected = false
    try {
      requireNoSemanticMutations(sample, `${mutation} negative`)
    } catch {
      rejected = true
    }
    expect(sample.semanticMutationCount, `${mutation} must be observed by captureFrames`).toBeGreaterThan(0)
    expect(rejected, `${mutation} must make the gesture verifier red`).toBe(true)
    await assertCompleteFixtureArm(page, fixtureName, `${mutation} restored`, baseline)
  }
}

type SemanticMutationKind =
  | 'text-character-truncation'
  | 'ancestor-hide'
  | 'ancestor-restyle'
  | 'row-loss'
  | 'detach-reinsert'

async function mutateSemanticFixture(page: Page, kind: SemanticMutationKind) {
  await page.evaluate(({ kind, resultId, middleSentinel }) => {
    const resultRoot = document.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${resultId}"] .result-highlight-root`,
    )
    if (!resultRoot) throw new Error('Missing Result semantic root for verifier red path')
    const mutationState = (value: unknown) => {
      ;(window as unknown as { __EIDO_LONG_SEMANTIC_MUTATION__?: unknown }).__EIDO_LONG_SEMANTIC_MUTATION__ = value
    }
    if (kind === 'text-character-truncation') {
      const resultText = resultRoot.querySelector<HTMLElement>('.result-text')
      if (!resultText) throw new Error('Missing main Result text for character red path')
      const walker = document.createTreeWalker(resultText, NodeFilter.SHOW_TEXT)
      let target: Text | null = null
      let current: Node | null = walker.nextNode()
      while (current) {
        if (current.nodeValue?.includes(middleSentinel)) {
          target = current as Text
          break
        }
        current = walker.nextNode()
      }
      if (!target) throw new Error('Missing Result middle sentinel text node for character red path')
      const marker = target.data.indexOf(middleSentinel)
      const start = Math.max(0, marker - 40)
      const end = Math.min(target.data.length, marker + middleSentinel.length + 40)
      mutationState({ kind, target, originalData: target.data })
      target.data = target.data.substring(0, start) + target.data.substring(end)
      return
    }
    if (kind === 'row-loss') {
      const rows = resultRoot.querySelectorAll<HTMLElement>('.followup-bubble')
      const row = rows[rows.length - 1]
      if (!row || !row.parentElement) throw new Error('Missing follow-up row for structure red path')
      mutationState({ kind, target: row, parent: row.parentElement, nextSibling: row.nextSibling })
      row.remove()
      return
    }
    if (kind === 'detach-reinsert') {
      const parent = resultRoot.parentElement
      if (!parent) throw new Error('Missing Result semantic parent for detach red path')
      mutationState({ kind, target: resultRoot, parent, nextSibling: resultRoot.nextSibling })
      resultRoot.remove()
      return
    }
    const target = kind === 'ancestor-hide'
      ? resultRoot.closest<HTMLElement>('.card')
      : resultRoot.closest<HTMLElement>('.react-flow__node')
    if (!target) throw new Error(`Missing Result ancestor for ${kind} red path`)
    mutationState({ kind, target, originalStyle: target.getAttribute('style') })
    if (kind === 'ancestor-hide') target.style.visibility = 'hidden'
    else target.style.fontSize = '1px'
  }, {
    kind,
    resultId: LONG_RESULT_MOTION_FIXTURE.resultCardId,
    middleSentinel: LONG_RESULT_MOTION_FIXTURE.sentinels.result.middle,
  })
}

async function restoreSemanticFixtureMutation(page: Page) {
  await page.evaluate(() => {
    const runtime = window as unknown as {
      __EIDO_LONG_SEMANTIC_MUTATION__?: {
        kind: SemanticMutationKind
        target: Node
        originalData?: string
        originalStyle?: string | null
        parent?: HTMLElement
        nextSibling?: ChildNode | null
      }
      __EIDO_LONG_NOTE_DOM__?: { body: HTMLElement; scrollTop: number }
      __EIDO_LONG_RESULT_DOM__?: { body: HTMLElement; scrollTop: number }
      __EIDO_LONG_CONVERSATION_DOM__?: { transcript: HTMLElement; scrollTop: number }
    }
    const mutation = runtime.__EIDO_LONG_SEMANTIC_MUTATION__
    if (!mutation) throw new Error('Missing semantic mutation restoration state')
    if (mutation.kind === 'text-character-truncation') {
      ;(mutation.target as Text).data = mutation.originalData ?? ''
    } else if (mutation.kind === 'row-loss' || mutation.kind === 'detach-reinsert') {
      mutation.parent?.insertBefore(mutation.target, mutation.nextSibling ?? null)
    } else {
      const target = mutation.target as HTMLElement
      if (mutation.originalStyle === null || mutation.originalStyle === undefined) target.removeAttribute('style')
      else target.setAttribute('style', mutation.originalStyle)
    }
    const restoreScroll = (element: HTMLElement, scrollTop: number) => {
      element.scrollTop = scrollTop
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
    }
    if (runtime.__EIDO_LONG_NOTE_DOM__?.body.isConnected) {
      restoreScroll(runtime.__EIDO_LONG_NOTE_DOM__.body, runtime.__EIDO_LONG_NOTE_DOM__.scrollTop)
    }
    if (runtime.__EIDO_LONG_RESULT_DOM__?.body.isConnected) {
      restoreScroll(runtime.__EIDO_LONG_RESULT_DOM__.body, runtime.__EIDO_LONG_RESULT_DOM__.scrollTop)
    }
    if (runtime.__EIDO_LONG_CONVERSATION_DOM__?.transcript.isConnected) {
      restoreScroll(runtime.__EIDO_LONG_CONVERSATION_DOM__.transcript, runtime.__EIDO_LONG_CONVERSATION_DOM__.scrollTop)
    }
    delete runtime.__EIDO_LONG_SEMANTIC_MUTATION__
  })
}

async function preparePassiveResult(page: Page) {
  await page.evaluate((id) => {
    const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)
    const body = node?.querySelector<HTMLElement>('.card.result > .card-body')
    const resultRoot = body?.querySelector<HTMLElement>('.result-highlight-root')
    if (!node || !body || !resultRoot) throw new Error('Missing live Result DOM for motion preservation')
    body.scrollTop = Math.min(600, Math.max(0, body.scrollHeight - body.clientHeight))
    body.dispatchEvent(new Event('scroll', { bubbles: true }))
    const bounds = node.getBoundingClientRect()
    ;(window as unknown as {
      __EIDO_LONG_RESULT_DOM__?: {
        body: HTMLElement
        resultRoot: HTMLElement
        scrollTop: number
        width: number
        height: number
      }
    }).__EIDO_LONG_RESULT_DOM__ = {
      body,
      resultRoot,
      scrollTop: body.scrollTop,
      width: bounds.width,
      height: bounds.height,
    }
  }, LONG_RESULT_MOTION_FIXTURE.resultCardId)
}

async function preparePassiveConversation(page: Page) {
  await page.evaluate((id) => {
    const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)
    const transcript = node?.querySelector<HTMLElement>('.card.result > .card-body > .transcript')
    if (!node || !transcript) throw new Error('Missing live Conversation Result DOM for motion preservation')
    transcript.scrollTop = Math.min(600, Math.max(0, transcript.scrollHeight - transcript.clientHeight))
    transcript.dispatchEvent(new Event('scroll', { bubbles: true }))
    const bounds = node.getBoundingClientRect()
    ;(window as unknown as {
      __EIDO_LONG_CONVERSATION_DOM__?: {
        transcript: HTMLElement
        scrollTop: number
        width: number
        height: number
      }
    }).__EIDO_LONG_CONVERSATION_DOM__ = {
      transcript,
      scrollTop: transcript.scrollTop,
      width: bounds.width,
      height: bounds.height,
    }
  }, LONG_RESULT_MOTION_FIXTURE.conversationCardId)
}

async function preparePassiveNote(page: Page) {
  await page.evaluate((id) => {
    const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)
    const body = node?.querySelector<HTMLElement>('.card.note > .card-body')
    const note = body?.querySelector<HTMLElement>('.note-render:not(.markdown-card-editor-placeholder)')
    if (!node || !body || !note) throw new Error('Missing live Note DOM for motion preservation')
    body.scrollTop = Math.min(600, Math.max(0, body.scrollHeight - body.clientHeight))
    body.dispatchEvent(new Event('scroll', { bubbles: true }))
    const bounds = node.getBoundingClientRect()
    ;(window as unknown as {
      __EIDO_LONG_NOTE_DOM__?: {
        body: HTMLElement
        note: HTMLElement
        scrollTop: number
        width: number
        height: number
      }
    }).__EIDO_LONG_NOTE_DOM__ = {
      body,
      note,
      scrollTop: body.scrollTop,
      width: bounds.width,
      height: bounds.height,
    }
  }, LONG_RESULT_MOTION_FIXTURE.noteCardId)
}

async function semanticOpacity(page: Page, cardId: string, semanticSelector: string) {
  return page.locator(nodeSelector(cardId)).locator(semanticSelector).evaluate(
    (element) => getComputedStyle(element).opacity,
  )
}

async function expectSemanticVisible(
  page: Page,
  cardId: string,
  semanticSelector: string,
  message: string,
) {
  const semanticVisible = await page.locator(nodeSelector(cardId)).evaluate((node, selector) => {
    const semantic = node.querySelector<HTMLElement>(selector)
    if (!semantic) return false
    const rect = semantic.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    let candidate: HTMLElement | null = semantic
    while (candidate) {
      const style = getComputedStyle(candidate)
      if (
        style.display === 'none' ||
        style.visibility !== 'visible' ||
        Number.parseFloat(style.opacity) <= 0.01
      ) return false
      if (candidate === node) break
      candidate = candidate.parentElement
    }
    return true
  }, semanticSelector)
  expect(semanticVisible, message).toBe(true)
}

async function expectSemanticOpacity(
  page: Page,
  cardId: string,
  semanticSelector: string,
  opacity: '0' | '1',
) {
  await expect.poll(() => semanticOpacity(page, cardId, semanticSelector)).toBe(opacity)
}

async function cursorAt(page: Page, point: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y)
    return target ? getComputedStyle(target).cursor : 'missing'
  }, point)
}

async function frameMotionFixture(page: Page): Promise<ViewportSnapshot> {
  const viewport = await page.evaluate((ids) => {
    const runtime = window as unknown as {
      __eido?: {
        getState: () => {
          cards: Array<{ id: string; position: { x: number; y: number }; size?: { width: number; height: number } }>
        }
      }
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    const cards = ids.map((id) => runtime.__eido?.getState().cards.find((candidate) => candidate.id === id))
    const rect = document.querySelector('.react-flow')?.getBoundingClientRect()
    if (cards.some((card) => !card) || !rect || !runtime.__EIDO_SET_VIEWPORT__) {
      throw new Error('Cannot frame complete long Result fixture')
    }
    const bounds = cards.reduce(
      (current, card) => {
        const width = card?.size?.width ?? 260
        const height = card?.size?.height ?? 180
        return {
          minX: Math.min(current.minX, card?.position.x ?? 0),
          minY: Math.min(current.minY, card?.position.y ?? 0),
          maxX: Math.max(current.maxX, (card?.position.x ?? 0) + width),
          maxY: Math.max(current.maxY, (card?.position.y ?? 0) + height),
        }
      },
      { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY },
    )
    const targetZoom = Math.min(
      0.42,
      (rect.width - 96) / (bounds.maxX - bounds.minX),
      (rect.height - 96) / (bounds.maxY - bounds.minY),
    )
    const viewport = {
      x: rect.left + rect.width / 2 - ((bounds.minX + bounds.maxX) / 2) * targetZoom,
      y: rect.top + rect.height / 2 - ((bounds.minY + bounds.maxY) / 2) * targetZoom,
      zoom: targetZoom,
    }
    runtime.__EIDO_SET_VIEWPORT__(viewport)
    return viewport
  }, [
    LONG_RESULT_MOTION_FIXTURE.noteCardId,
    LONG_RESULT_MOTION_FIXTURE.resultCardId,
    LONG_RESULT_MOTION_FIXTURE.conversationCardId,
  ])
  await waitForFrames(page, 2)
  return viewport
}

async function restoreMotionFixtureViewport(page: Page, viewport: ViewportSnapshot) {
  await page.evaluate((nextViewport) => {
    const runtime = window as unknown as {
      __EIDO_SET_VIEWPORT__?: (value: ViewportSnapshot) => void
    }
    runtime.__EIDO_SET_VIEWPORT__?.(nextViewport)
  }, viewport)
  await waitForFrames(page, 2)
}

async function setActiveTool(page: Page, tool: 'select' | 'pan') {
  await page.evaluate((nextTool) => {
    const store = (window as unknown as {
      __eido?: { getState: () => { setActiveTool: (value: string) => void } }
    }).__eido
    store?.getState().setActiveTool(nextTool)
  }, tool)
  // Tool changes intentionally replace the canvas cursor grammar. Keep that
  // one-time style transition outside the motion sample so this contract
  // measures sustained board movement rather than toolbar activation.
  await waitForFrames(page, 2)
}

async function viewportTransform(page: Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    const transform = viewport ? getComputedStyle(viewport).transform : 'none'
    const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null
    return { x: matrix?.e ?? 0, y: matrix?.f ?? 0 }
  })
}

async function viewportZoom(page: Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    const transform = viewport ? getComputedStyle(viewport).transform : 'none'
    const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null
    return matrix?.a ?? 1
  })
}

async function cardPosition(page: Page, cardId: string) {
  return page.evaluate((id) => {
    const store = (window as unknown as {
      __eido?: { getState: () => { cards: Array<{ id: string; position: { x: number; y: number } }> } }
    }).__eido
    const card = store?.getState().cards.find((candidate) => candidate.id === id)
    if (!card) throw new Error('Missing long Result Card')
    return card.position
  }, cardId)
}

async function captureFrames(
  page: Page,
  cadenceMs: number,
  interaction: (markPhase: MarkMotionPhase) => Promise<void>,
): Promise<MotionSample> {
  await page.evaluate(async () => {
    const state = {
      timestamps: [] as Array<{ timestamp: number; phase: MotionPhase }>,
      longTasks: [] as Array<{ duration: number; startTime: number }>,
      phaseMarks: [{ at: performance.now(), phase: 'boundary' as MotionPhase }],
      phase: 'boundary' as MotionPhase,
      frame: 0,
      observer: null as PerformanceObserver | null,
      semanticObserver: null as MutationObserver | null,
      semanticMutationCount: 0,
    }
    const tick = (now: number) => {
      state.timestamps.push({ timestamp: now, phase: state.phase })
      state.frame = requestAnimationFrame(tick)
    }
    try {
      state.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTasks.push({ duration: entry.duration, startTime: entry.startTime })
        }
      })
      state.observer.observe({ type: 'longtask', buffered: false })
    } catch {
      state.observer = null
    }
    const semanticRoots = [
      document.querySelector<HTMLElement>(
        `.react-flow__node[data-id="benchmark-giant-note"] .note-render:not(.markdown-card-editor-placeholder)`,
      ),
      document.querySelector<HTMLElement>(
        `.react-flow__node[data-id="benchmark-long-result"] .result-highlight-root`,
      ),
      document.querySelector<HTMLElement>(
        `.react-flow__node[data-id="benchmark-long-conversation"] .transcript`,
      ),
    ].filter((root): root is HTMLElement => Boolean(root))
    const rootSet = new Set(semanticRoots)
    const semanticHosts = new Set<HTMLElement>()
    for (const root of semanticRoots) {
      let ancestor: HTMLElement | null = root
      while (ancestor) {
        if (ancestor === root || ancestor.matches('.card, .react-flow__node')) semanticHosts.add(ancestor)
        ancestor = ancestor.parentElement
      }
    }
    const normalizeClasses = (className: string, target: HTMLElement) => {
      const ignored = rootSet.has(target)
        ? ['nodrag', 'nopan']
        : target.matches('.card')
          ? ['selected']
          : target.matches('.react-flow__node')
            ? ['selected', 'dragging']
            : []
      return className
        .split(/\s+/)
        .filter((name) => name && !ignored.includes(name))
        .join(' ')
    }
    const normalizeNodeGeometryStyle = (style: string) => style
      .split(';')
      .map((declaration) => declaration.trim())
      .filter((declaration) => declaration && !/^(?:transform|width|height|z-index)\s*:/i.test(declaration))
      .join(';')
    state.semanticObserver = new MutationObserver((records) => {
      for (const record of records) {
        const touchesSemanticRoot = record.type === 'childList'
          ? semanticRoots.some((root) => (
              root.contains(record.target)
              || root === record.target
              || Array.from(record.addedNodes).some((node) => node === root || root.contains(node))
              || Array.from(record.removedNodes).some((node) => node === root || root.contains(node))
            ))
          : semanticRoots.some((root) => root === record.target || root.contains(record.target))
            || (record.target instanceof HTMLElement && semanticHosts.has(record.target))
        if (!touchesSemanticRoot) continue
        if (
          record.type === 'attributes'
          && record.target instanceof HTMLElement
        ) {
          if (record.attributeName === 'class') {
            const previous = normalizeClasses(record.oldValue ?? '', record.target)
            const current = normalizeClasses(record.target.className, record.target)
            if (previous === current) continue
          }
          if (record.attributeName === 'style' && record.target.matches('.react-flow__node')) {
            const previous = normalizeNodeGeometryStyle(record.oldValue ?? '')
            const current = normalizeNodeGeometryStyle(record.target.getAttribute('style') ?? '')
            if (previous === current) continue
          }
        }
        state.semanticMutationCount += 1
      }
    })
    for (const host of semanticHosts) {
      state.semanticObserver.observe(host, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
        attributeOldValue: true,
      })
    }
    ;(window as unknown as { __EIDO_LONG_RESULT_MOTION__?: typeof state }).__EIDO_LONG_RESULT_MOTION__ = state
    await new Promise<void>((resolve) => {
      requestAnimationFrame((timestamp) => {
        state.timestamps.push({ timestamp, phase: 'boundary' })
        resolve()
      })
    })
    state.frame = requestAnimationFrame(tick)
  })
  await page.evaluate(() => {
    const state = (window as unknown as {
      __EIDO_LONG_RESULT_MOTION__?: {
        phase: MotionPhase
        phaseMarks: Array<{ at: number; phase: MotionPhase }>
      }
    }).__EIDO_LONG_RESULT_MOTION__
    if (!state) throw new Error('Missing long Result motion probe at gesture start')
    state.phase = 'boundary'
    state.phaseMarks = [{ at: performance.now(), phase: 'boundary' }]
  })
  const startedAt = performance.now()
  const markPhase: MarkMotionPhase = async (phase) => {
    await page.evaluate((nextPhase) => {
      const state = (window as unknown as {
        __EIDO_LONG_RESULT_MOTION__?: {
          phase?: MotionPhase
          phaseMarks?: Array<{ at: number; phase: MotionPhase }>
        }
      })
        .__EIDO_LONG_RESULT_MOTION__
      if (state) {
        state.phase = nextPhase
        state.phaseMarks?.push({ at: performance.now(), phase: nextPhase })
      }
    }, phase)
  }
  await interaction(markPhase)
  const completionMs = performance.now() - startedAt
  // Two frames cover the immediate visual handoff. Deferred browser saves and
  // packaged Profile capture are a separate persistence/durability boundary;
  // this contract neither hides nor claims their post-gesture cost.
  await waitForFrames(page, 4)
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  const raw = await page.evaluate(() => {
    const state = (window as unknown as {
      __EIDO_LONG_RESULT_MOTION__?: {
        timestamps: Array<{ timestamp: number; phase: MotionPhase }>
        longTasks: Array<{ duration: number; startTime: number }>
        phaseMarks: Array<{ at: number; phase: MotionPhase }>
        frame: number
        observer: PerformanceObserver | null
        semanticObserver: MutationObserver | null
        semanticMutationCount: number
      }
    }).__EIDO_LONG_RESULT_MOTION__
    if (!state) throw new Error('Missing long Result motion probe')
    const pendingEntries = state.observer?.takeRecords() ?? []
    for (const entry of pendingEntries) {
      state.longTasks.push({ duration: entry.duration, startTime: entry.startTime })
    }
    cancelAnimationFrame(state.frame)
    state.observer?.disconnect()
    state.semanticObserver?.disconnect()
    return {
      timestamps: state.timestamps,
      longTasks: state.longTasks,
      phaseMarks: state.phaseMarks,
      semanticMutationCount: state.semanticMutationCount,
    }
  })
  const longTasks = raw.longTasks.map((task) => ({
    ...task,
    phase: phaseAt(task.startTime, raw.phaseMarks),
  }))
  const frameMetrics = (phase: MotionPhase) => motionMetrics(raw.timestamps, longTasks, cadenceMs, phase)
  const boundary = frameMetrics('boundary')
  const steady = frameMetrics('steady')
  const release = frameMetrics('release')
  const postRelease = frameMetrics('postRelease')
  const aggregate = motionMetrics(raw.timestamps, longTasks, cadenceMs)
  return {
    completionMs,
    cadenceMs,
    semanticMutationCount: raw.semanticMutationCount,
    ...aggregate,
    boundary,
    steady,
    release,
    postRelease,
  }
}

function motionMetrics(
  frames: CapturedFrame[],
  longTasks: Array<CapturedLongTask & { phase: MotionPhase }>,
  cadenceMs: number,
  phase?: MotionPhase,
): MotionMetrics {
  const intervals: Array<{ duration: number; phase: MotionPhase }> = []
  for (let index = 1; index < frames.length; index += 1) {
    intervals.push({
      duration: frames[index].timestamp - frames[index - 1].timestamp,
      phase: frames[index].phase,
    })
  }
  const selectedIntervals = phase ? intervals.filter((interval) => interval.phase === phase) : intervals
  const ordered = selectedIntervals.map((interval) => interval.duration).sort((left, right) => left - right)
  const p95Index = Math.max(0, Math.ceil(ordered.length * 0.95) - 1)
  return {
    p95FrameMs: ordered[p95Index] ?? 0,
    maxFrameMs: ordered[ordered.length - 1] ?? 0,
    missedFrames: selectedIntervals.reduce(
      (total, interval) => total + Math.max(0, Math.floor(interval.duration / cadenceMs) - 1),
      0,
    ),
    longTaskCount: longTasks.filter((task) => !phase || task.phase === phase).length,
    maxLongTaskMs: Math.max(0, ...longTasks
      .filter((task) => !phase || task.phase === phase)
      .map((task) => task.duration)),
  }
}

function roundedMotionMetrics(metrics: MotionMetrics): MotionMetrics {
  return {
    ...metrics,
    p95FrameMs: round(metrics.p95FrameMs),
    maxFrameMs: round(metrics.maxFrameMs),
    maxLongTaskMs: round(metrics.maxLongTaskMs),
  }
}

function roundedMotionSample(sample: MotionSample): MotionSample {
  return {
    ...sample,
    ...roundedMotionMetrics(sample),
    completionMs: round(sample.completionMs),
    cadenceMs: round(sample.cadenceMs),
    boundary: roundedMotionMetrics(sample.boundary),
    steady: roundedMotionMetrics(sample.steady),
    release: roundedMotionMetrics(sample.release),
    postRelease: roundedMotionMetrics(sample.postRelease),
  }
}

function roundedFixtureSample(sample: FixtureSample): FixtureSample {
  return {
    pan: roundedMotionSample(sample.pan),
    zoom: roundedMotionSample(sample.zoom),
    noteDrag: roundedMotionSample(sample.noteDrag),
    resultDrag: roundedMotionSample(sample.resultDrag),
    conversationDrag: roundedMotionSample(sample.conversationDrag),
  }
}

function phaseAt(startTime: number, marks: Array<{ at: number; phase: MotionPhase }>): MotionPhase {
  let phase: MotionPhase = 'boundary'
  for (const mark of marks) {
    if (mark.at > startTime) break
    phase = mark.phase
  }
  return phase
}

function expectMotionNearControl(
  label: string,
  control: MotionSample,
  stress: MotionSample,
  cadenceMs: number,
) {
  // The cleaned run showed content-hidden A/B with an unchanged stress Note
  // while a short-control Result still produced an 83.3ms outlier. That
  // invalidates an absolute single-max host cutoff as a content penalty. This
  // is not a relaxed UX promise: it is a paired content-independence authority
  // on the same host, with raw precision and a control-relative envelope.
  const phases: MotionPhase[] = ['boundary', 'steady', 'release', 'postRelease']
  for (const phase of phases) {
    const controlMetrics = control[phase]
    const stressMetrics = stress[phase]
    expect(
      isStressMaxWithinControlEnvelope(controlMetrics.maxFrameMs, stressMetrics.maxFrameMs, cadenceMs),
      `${label} ${phase} stress maximum must stay within the raw control envelope`,
    ).toBe(true)
    expect(stressMetrics.p95FrameMs, `${label} ${phase} p95 must stay near control`).toBeLessThanOrEqual(
      Math.max(controlMetrics.p95FrameMs + cadenceMs + 2, controlMetrics.p95FrameMs * 1.35),
    )
    expect(stressMetrics.missedFrames, `${label} ${phase} must not accumulate visible frame stalls`).toBeLessThanOrEqual(
      controlMetrics.missedFrames + 2,
    )
    expect(stressMetrics.maxLongTaskMs, `${label} ${phase} must avoid a severe main-thread stall`).toBeLessThanOrEqual(
      Math.max(80, controlMetrics.maxLongTaskMs + 15),
    )
    expect(stressMetrics.longTaskCount, `${label} ${phase} must not add a long task versus control`).toBeLessThanOrEqual(
      controlMetrics.longTaskCount,
    )
  }
  expect(
    isStressMaxWithinControlEnvelope(control.maxFrameMs, stress.maxFrameMs, cadenceMs),
    `${label} stress aggregate maximum must stay within the raw control envelope`,
  ).toBe(true)
  expect(stress.missedFrames, `${label} aggregate must not accumulate visible frame stalls`).toBeLessThanOrEqual(
    control.missedFrames + 4,
  )
  expect(stress.longTaskCount, `${label} stress must not add a long task versus control`).toBeLessThanOrEqual(
    control.longTaskCount,
  )
  expect(
    stress.completionMs,
    `${label} completion must stay close to the same short Result (${control.completionMs}ms)`,
  ).toBeLessThanOrEqual(control.completionMs * 1.25 + 80)
}

function expectCounterbalancedMotion(
  order: 'AB' | 'BA',
  control: FixtureSample,
  stress: FixtureSample,
  cadenceMs: number,
) {
  expectMotionNearControl(`${order} pan`, control.pan, stress.pan, cadenceMs)
  expectMotionNearControl(`${order} zoom`, control.zoom, stress.zoom, cadenceMs)
  expectMotionNearControl(`${order} Note drag`, control.noteDrag, stress.noteDrag, cadenceMs)
  expectMotionNearControl(`${order} Result drag`, control.resultDrag, stress.resultDrag, cadenceMs)
  expectMotionNearControl(
    `${order} Conversation Result drag`,
    control.conversationDrag,
    stress.conversationDrag,
    cadenceMs,
  )
}

async function measureIdleFrameMs(page: Page) {
  return page.evaluate(async (fallbackFrameMs) => {
    const gaps: number[] = []
    let previous = await new Promise<number>((resolve) => requestAnimationFrame(resolve))
    while (gaps.length < 36) {
      const next = await new Promise<number>((resolve) => requestAnimationFrame(resolve))
      gaps.push(next - previous)
      previous = next
    }
    gaps.sort((left, right) => left - right)
    return gaps[Math.floor(gaps.length / 2)] ?? fallbackFrameMs
  }, DEFAULT_CADENCE_MS)
}

function expectIndependentSemanticContent(readout: FixtureReadout, fixtureName: PerfFixtureName) {
  const expected = expectedFixtureSemanticContent(fixtureName)
  expect(readout.noteBlockHash).toBe(expected.note.sourceTextHash)
  expect(readout.resultTextHash).toBe(expected.result.sourceTextHash)
  expect(readout.noteMain).toEqual(expected.note)
  expect(readout.resultMain).toEqual(expected.result)
  expect(readout.followUpRows).toEqual(expected.followUps)
  expect(readout.transcriptRows).toEqual(expected.transcript)
  expect(readout.note.rootClassName).toBe('note-render markdown e-prose t-prose-m')
  expect(readout.result.rootClassName).toBe('result-highlight-root')
  expect(readout.conversation.rootClassName).toBe('transcript')
  expect(readout.note.inlineStyleCount).toBe(0)
  expect(readout.result.inlineStyleCount).toBe(0)
  expect(readout.conversation.inlineStyleCount).toBe(0)
}

async function captureSemanticBaseline(
  page: Page,
  fixtureName: PerfFixtureName,
  viewport: ViewportSnapshot,
): Promise<FixtureBaseline> {
  const readout = await readSemanticFixture(page)
  const stress = fixtureName === LONG_RESULT_MOTION_FIXTURE.stressName
  const expectedNoteChars = stress
    ? LONG_RESULT_MOTION_FIXTURE.noteStressTextChars
    : LONG_RESULT_MOTION_FIXTURE.controlTextChars
  const expectedResultChars = stress
    ? LONG_RESULT_MOTION_FIXTURE.stressTextChars
    : LONG_RESULT_MOTION_FIXTURE.controlTextChars
  expectIndependentSemanticContent(readout, fixtureName)
  expect(readout.noteBlockChars).toBe(expectedNoteChars)
  expect(readout.resultTextChars).toBe(expectedResultChars)
  expect(readout.followUpCount).toBe(LONG_RESULT_MOTION_FIXTURE.followUpCount)
  expect(readout.transcriptCount).toBe(LONG_RESULT_MOTION_FIXTURE.transcriptCount)
  expect(readout.terminalFollowUp).toBe(true)
  expect(readout.terminalTranscript).toBe(true)
  expect(readout.followUpSentinels).toEqual({ start: true, middle: true, end: true })
  expect(readout.dom).toEqual({ noteBody: true, noteRoot: true, resultBody: true, resultRoot: true, transcript: true })
  expect(readout.sameScroll).toEqual({ note: true, result: true, conversation: true })
  expect(readout.sameBounds).toEqual({ note: true, result: true, conversation: true })
  expect(readout.scrollable).toEqual({ note: true, result: true, conversation: true })
  expect(readout.destructiveInstrumentation).toBe(false)
  expect(readout.note.hiddenDescendantCount).toBe(0)
  expect(readout.result.hiddenDescendantCount).toBe(0)
  expect(readout.conversation.hiddenDescendantCount).toBe(0)
  return { ...readout, viewport }
}

async function readSemanticFixture(page: Page): Promise<FixtureReadout> {
  return page.evaluate((config) => {
    const runtime = window as unknown as {
      __eido?: {
        getState: () => {
          cards: Array<{
            id: string
            blocks?: Array<{ text?: string }>
          }>
          outputs: Array<{
            resultCardId: string
            chosenVersionId?: string
            versions: Array<{
              id: string
              text?: string
              followUpThread?: { messages: Array<{ text?: string }> }
              transcript?: Array<{ text?: string }>
            }>
          }>
        }
      }
      __EIDO_LONG_NOTE_DOM__?: {
        body: HTMLElement
        note: HTMLElement
        scrollTop: number
        width: number
        height: number
      }
      __EIDO_LONG_RESULT_DOM__?: {
        body: HTMLElement
        resultRoot: HTMLElement
        scrollTop: number
        width: number
        height: number
      }
      __EIDO_LONG_CONVERSATION_DOM__?: {
        transcript: HTMLElement
        scrollTop: number
        width: number
        height: number
      }
    }
    const noteId = 'benchmark-giant-note'
    const resultId = 'benchmark-long-result'
    const conversationId = 'benchmark-long-conversation'
    const state = runtime.__eido?.getState()
    const noteCard = state?.cards.find((card) => card.id === noteId)
    const resultOutput = state?.outputs.find((output) => output.resultCardId === resultId)
    const conversationOutput = state?.outputs.find((output) => output.resultCardId === conversationId)
    const resultVersion = resultOutput?.versions.find((version) => version.id === resultOutput.chosenVersionId)
    const conversationVersion = conversationOutput?.versions.find(
      (version) => version.id === conversationOutput.chosenVersionId,
    )
    const noteNode = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${noteId}"]`)
    const resultNode = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${resultId}"]`)
    const conversationNode = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${conversationId}"]`)
    const noteBody = noteNode?.querySelector<HTMLElement>('.card.note > .card-body')
    const note = noteBody?.querySelector<HTMLElement>('.note-render:not(.markdown-card-editor-placeholder)')
    const resultBody = resultNode?.querySelector<HTMLElement>('.card.result > .card-body')
    const resultRoot = resultBody?.querySelector<HTMLElement>('.result-highlight-root')
    const transcript = conversationNode?.querySelector<HTMLElement>('.card.result > .card-body > .transcript')
    const hashString = (value: string) => {
      let hash = 2_166_136_261
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16_777_619)
      }
      return hash >>> 0
    }
    const normalizeShellClasses = (className: string) => className
      .split(/\s+/)
      .filter((name) => name && name !== 'nodrag' && name !== 'nopan')
      .join(' ')
    const renderedChunks = (element: HTMLElement | null | undefined): string[] => {
      if (!element) return []
      if (element.classList.contains('result-highlight-root')) {
        return [
          ...renderedChunks(element.querySelector<HTMLElement>('.result-text')),
          ...Array.from(element.querySelectorAll<HTMLElement>('.bubble-text')).flatMap(renderedChunks),
        ]
      }
      if (element.classList.contains('transcript')) {
        return Array.from(element.querySelectorAll<HTMLElement>('.bubble-text')).flatMap(renderedChunks)
      }
      const contentRoot = element.classList.contains('note-render')
        ? element.firstElementChild
        : element
      const chunks = Array.from(contentRoot?.children ?? []).map((chunk) => chunk.textContent ?? '')
      return chunks.length > 0 ? chunks : [element.textContent ?? '']
    }
    const semanticSnapshot = (
      root: HTMLElement | null | undefined,
      rowSelector: string,
      sentinels: { start: string; middle: string; end: string },
    ): SemanticSnapshot => {
      if (!root || !root.isConnected) {
        return {
          textLength: 0,
          textHash: 0,
          structureHash: 0,
          styleHash: 0,
          descendantCount: 0,
          rowCount: 0,
          sentinels: { start: false, middle: false, end: false },
          hiddenDescendantCount: 1,
          rootClassName: '',
          inlineStyleCount: 0,
        }
      }
      let structure = 2_166_136_261
      let styles = 2_166_136_261
      let hiddenDescendantCount = 0
      let inlineStyleCount = 0
      const visit = (element: HTMLElement, rootElement = false) => {
        const style = getComputedStyle(element)
        const className = rootElement ? normalizeShellClasses(element.className) : element.className
        const descriptor = `${element.tagName}|${className}|${element.getAttribute('role') ?? ''}|${element.children.length}`
        structure = hashString(`${structure}:${descriptor}`)
        const styleDescriptor = [
          style.display,
          style.visibility,
          style.opacity,
          style.fontFamily,
          style.fontSize,
          style.fontWeight,
          style.lineHeight,
          style.color,
          style.backgroundColor,
          style.pointerEvents,
          style.userSelect,
          style.whiteSpace,
          style.overflow,
          style.textDecoration,
        ].join('|')
        styles = hashString(`${styles}:${styleDescriptor}`)
        if (
          style.display === 'none'
          || style.visibility !== 'visible'
          || Number.parseFloat(style.opacity) <= 0.01
        ) hiddenDescendantCount += 1
        if (element.hasAttribute('style')) inlineStyleCount += 1
        for (const child of Array.from(element.children)) visit(child as HTMLElement)
      }
      visit(root, true)
      const text = renderedChunks(root).join('')
      return {
        textLength: text.length,
        textHash: hashString(text),
        structureHash: structure >>> 0,
        styleHash: styles >>> 0,
        descendantCount: root.querySelectorAll('*').length,
        rowCount: root.querySelectorAll(rowSelector).length,
        sentinels: {
          start: text.includes(sentinels.start),
          middle: text.includes(sentinels.middle),
          end: text.includes(sentinels.end),
        },
        hiddenDescendantCount,
        rootClassName: normalizeShellClasses(root.className),
        inlineStyleCount,
      }
    }
    const noteSnapshot = runtime.__EIDO_LONG_NOTE_DOM__
    const resultSnapshot = runtime.__EIDO_LONG_RESULT_DOM__
    const conversationSnapshot = runtime.__EIDO_LONG_CONVERSATION_DOM__
    const followUps = resultVersion?.followUpThread?.messages ?? []
    const transcriptMessages = conversationVersion?.transcript ?? []
    const noteSemantic = semanticSnapshot(note, '*', config.sentinels.note)
    const resultSemantic = semanticSnapshot(resultRoot, '.followup-bubble', config.sentinels.result)
    const conversationSemantic = semanticSnapshot(transcript, '.bubble', config.sentinels.conversation)
    const semanticText = (
      element: HTMLElement | null | undefined,
      sentinels: { start: string; middle: string; end: string },
      sourceText = '',
    ) => {
      const chunks = renderedChunks(element)
      const text = chunks.join('')
      return {
        sourceTextLength: sourceText.length,
        sourceTextHash: hashString(sourceText),
        renderedTextLength: text.length,
        renderedTextHash: hashString(text),
        chunkCount: chunks.length,
        chunkTextLengths: chunks.map((chunk) => chunk.length),
        chunkTextHashes: chunks.map(hashString),
        sentinels: {
          start: text.includes(sentinels.start),
          middle: text.includes(sentinels.middle),
          end: text.includes(sentinels.end),
        },
      }
    }
    const noteMain = semanticText(
      note,
      config.sentinels.note,
      noteCard?.blocks?.[0]?.text ?? '',
    )
    const resultMain = semanticText(
      resultRoot?.querySelector<HTMLElement>('.result-text'),
      config.sentinels.result,
      resultVersion?.text ?? '',
    )
    const followUpRows = Array.from(resultRoot?.querySelectorAll<HTMLElement>('.followup-bubble') ?? []).map((row, index) => {
      const source = followUps[index]?.text ?? ''
      const rowText = semanticText(row.querySelector<HTMLElement>('.bubble-text'), config.sentinels.followUp, source)
      return {
        ...rowText,
        className: row.className,
      }
    })
    const transcriptRows = Array.from(transcript?.querySelectorAll<HTMLElement>('.bubble') ?? []).map((row, index) => {
      const source = transcriptMessages[index]?.text ?? ''
      const rowText = semanticText(row.querySelector<HTMLElement>('.bubble-text'), config.sentinels.conversation, source)
      return {
        ...rowText,
        className: row.className,
      }
    })
    const noteBounds = noteNode?.getBoundingClientRect()
    const resultBounds = resultNode?.getBoundingClientRect()
    const conversationBounds = conversationNode?.getBoundingClientRect()
    const destructiveInstrumentation = [
      '[data-eido-perf-detached]',
      '[data-eido-perf-truncated]',
      '[data-eido-perf-replaced]',
      '[data-eido-perf-hidden]',
      '[data-eido-perf-restyled]',
    ].some((selector) => Boolean(noteNode?.querySelector(selector)
      || resultNode?.querySelector(selector)
      || conversationNode?.querySelector(selector)))
    return {
      note: noteSemantic,
      result: resultSemantic,
      conversation: conversationSemantic,
      noteMain,
      resultMain,
      followUpRows,
      transcriptRows,
      followUpSentinels: {
        start: resultRoot?.textContent?.includes(config.sentinels.followUp.start) ?? false,
        middle: resultRoot?.textContent?.includes(config.sentinels.followUp.middle) ?? false,
        end: resultRoot?.textContent?.includes(config.sentinels.followUp.end) ?? false,
      },
      noteBlockChars: noteCard?.blocks?.[0]?.text?.length ?? 0,
      noteBlockHash: hashString(noteCard?.blocks?.[0]?.text ?? ''),
      resultTextChars: resultVersion?.text?.length ?? 0,
      resultTextHash: hashString(resultVersion?.text ?? ''),
      chosenResultVersionId: resultOutput?.chosenVersionId,
      chosenConversationVersionId: conversationOutput?.chosenVersionId,
      followUpCount: followUps.length,
      terminalFollowUp: followUps[followUps.length - 1]?.text?.includes('Answer 100.') ?? false,
      transcriptCount: transcriptMessages.length,
      terminalTranscript: transcriptMessages[transcriptMessages.length - 1]?.text?.includes('Transcript message 160.') ?? false,
      dom: {
        noteBody: Boolean(noteSnapshot && noteBody === noteSnapshot.body && noteBody?.isConnected),
        noteRoot: Boolean(noteSnapshot && note === noteSnapshot.note && note?.isConnected),
        resultBody: Boolean(resultSnapshot && resultBody === resultSnapshot.body && resultBody?.isConnected),
        resultRoot: Boolean(resultSnapshot && resultRoot === resultSnapshot.resultRoot && resultRoot?.isConnected),
        transcript: Boolean(conversationSnapshot && transcript === conversationSnapshot.transcript && transcript?.isConnected),
      },
      sameScroll: {
        note: Boolean(noteSnapshot && noteBody && Math.abs(noteBody.scrollTop - noteSnapshot.scrollTop) < 1),
        result: Boolean(resultSnapshot && resultBody && Math.abs(resultBody.scrollTop - resultSnapshot.scrollTop) < 1),
        conversation: Boolean(
          conversationSnapshot && transcript && Math.abs(transcript.scrollTop - conversationSnapshot.scrollTop) < 1,
        ),
      },
      sameBounds: {
        note: Boolean(noteSnapshot && noteBounds
          && Math.abs(noteBounds.width - noteSnapshot.width) < 1
          && Math.abs(noteBounds.height - noteSnapshot.height) < 1),
        result: Boolean(resultSnapshot && resultBounds
          && Math.abs(resultBounds.width - resultSnapshot.width) < 1
          && Math.abs(resultBounds.height - resultSnapshot.height) < 1),
        conversation: Boolean(conversationSnapshot && conversationBounds
          && Math.abs(conversationBounds.width - conversationSnapshot.width) < 1
          && Math.abs(conversationBounds.height - conversationSnapshot.height) < 1),
      },
      scrollable: {
        note: Boolean(noteBody && noteBody.scrollHeight > noteBody.clientHeight),
        result: Boolean(resultBody && resultBody.scrollHeight > resultBody.clientHeight),
        conversation: Boolean(transcript && transcript.scrollHeight > transcript.clientHeight),
      },
      destructiveInstrumentation,
    }
  }, {
    sentinels: LONG_RESULT_MOTION_FIXTURE.sentinels,
  })
}

async function assertCompleteFixtureArm(
  page: Page,
  fixtureName: PerfFixtureName,
  arm: string,
  baseline: FixtureBaseline,
) {
  const current = await readSemanticFixture(page)
  const expected = {
    noteTextChars: fixtureName === LONG_RESULT_MOTION_FIXTURE.stressName
      ? LONG_RESULT_MOTION_FIXTURE.noteStressTextChars
      : LONG_RESULT_MOTION_FIXTURE.controlTextChars,
    resultTextChars: fixtureName === LONG_RESULT_MOTION_FIXTURE.stressName
      ? LONG_RESULT_MOTION_FIXTURE.stressTextChars
      : LONG_RESULT_MOTION_FIXTURE.controlTextChars,
  }
  expectIndependentSemanticContent(current, fixtureName)
  expect(current.noteBlockChars).toBe(expected.noteTextChars)
  expect(current.resultTextChars).toBe(expected.resultTextChars)
  expect(current.followUpCount).toBe(LONG_RESULT_MOTION_FIXTURE.followUpCount)
  expect(current.transcriptCount).toBe(LONG_RESULT_MOTION_FIXTURE.transcriptCount)
  expect(current.terminalFollowUp).toBe(true)
  expect(current.terminalTranscript).toBe(true)
  expect(current.followUpSentinels).toEqual({ start: true, middle: true, end: true })
  expect(current.dom).toEqual(baseline.dom)
  expect(current.sameScroll).toEqual({ note: true, result: true, conversation: true })
  expect(current.sameBounds).toEqual({ note: true, result: true, conversation: true })
  expect(current.scrollable).toEqual({ note: true, result: true, conversation: true })
  expect(current.destructiveInstrumentation).toBe(false)
  expect(current.note).toEqual(baseline.note)
  expect(current.result).toEqual(baseline.result)
  expect(current.conversation).toEqual(baseline.conversation)
  expect(() => requireSemanticSnapshot({ ...baseline, result: { ...baseline.result, textHash: baseline.result.textHash ^ 1 } }, baseline, 'negative mutation')).toThrow()
  requireSemanticSnapshot(current, baseline, `${fixtureName} ${arm}`)
}

function requireSemanticSnapshot(current: FixtureBaseline | FixtureReadout, expected: FixtureBaseline, label: string) {
  for (const key of ['note', 'result', 'conversation'] as const) {
    const actual = current[key]
    const baseline = expected[key]
    if (
      actual.textHash !== baseline.textHash
      || actual.structureHash !== baseline.structureHash
      || actual.styleHash !== baseline.styleHash
      || actual.descendantCount !== baseline.descendantCount
      || actual.rowCount !== baseline.rowCount
      || actual.textLength !== baseline.textLength
      || actual.hiddenDescendantCount !== baseline.hiddenDescendantCount
      || actual.rootClassName !== baseline.rootClassName
      || actual.inlineStyleCount !== baseline.inlineStyleCount
      || !actual.sentinels.start
      || !actual.sentinels.middle
      || !actual.sentinels.end
    ) throw new Error(`${label}: rendered ${key} semantic snapshot changed`)
  }
}

async function waitForFrames(page: Page, count: number) {
  await page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        let remaining = frames
        const step = () => {
          remaining -= 1
          if (remaining <= 0) resolve()
          else requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }),
    count,
  )
}

function nodeSelector(cardId: string) {
  return `.react-flow__node[data-id="${cardId}"]`
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
