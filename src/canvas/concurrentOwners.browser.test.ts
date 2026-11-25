import { expect, test, type Page } from '@playwright/test'
import { activateAndRequireExactReadyMarkdownEditor } from '../performance/richCardEditorReadiness'

type BrowserCard = {
  id: string
  kind: 'note' | 'askAi' | 'result'
  title?: string
  blocks: Array<{ id: string; text: string }>
  position: { x: number; y: number }
  size?: { width: number; height: number }
}

type BrowserOutput = {
  id: string
  resultCardId: string
  chosenVersionId: string
  versions: Array<{
    id: string
    number: number
    text: string
    createdAt: string
    fromRunId: string
  }>
}

type BrowserRun = {
  id: string
  startedAt: string
  askAiCardId: string
  model: string
  usedCardIds: string[]
  usedConnectionIds: string[]
  modIds: string[]
  appliedMods: unknown[]
  compiledInstruction: string
  producedVersionId: string
  status: 'running' | 'done'
}

type BrowserStoreState = {
  hydrated: boolean
  cards: BrowserCard[]
  outputs: BrowserOutput[]
  runs: BrowserRun[]
  selectedCardIds: string[]
  appendVersionText: (versionId: string, chunk: string) => void
}

type BrowserStore = {
  getState: () => BrowserStoreState
  setState: (state: unknown) => void
}

type OwnerSnapshot = {
  mode: 'live' | 'passive'
  ownerTokens: string[]
  owners: Record<string, boolean>
}

type DevWindow = {
  __eido?: BrowserStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
  __EIDO_SET_GESTURE_PARTICIPANTS__?: (cardIds: readonly string[]) => void
  __EIDO_CARD_ACTIVATION_OWNER_SNAPSHOT__?: (cardId: string) => OwnerSnapshot
  __concurrentComposition?: {
    starts: number
    updates: number
    ends: number
    active: boolean
    lastData: string
  }
  __concurrentEditorBlurCount?: number
}

const NOW = '2026-08-21T00:00:00.000Z'
const PINNED_ID = 'concurrent-stream-pinned'
const AWAY_ID = 'concurrent-stream-away'
const EDITOR_ID = 'concurrent-editor-note'
const MEDIA_ID = 'concurrent-media-note'
const BODY_DRAG_ID = 'concurrent-body-drag-note'
const OFFSCREEN_ID = 'concurrent-offscreen-running-result'
const GIANT_NOTE_LENGTH = 620_000
const GESTURE_IDS = ['concurrent-gesture-note', 'concurrent-extra-a'] as const
const MEDIA_IDS = [
  MEDIA_ID,
  'concurrent-gesture-note',
  'concurrent-extra-a',
  'concurrent-extra-b',
  'concurrent-extra-c',
] as const

function paragraphs(label: string, count = 72) {
  return Array.from(
    { length: count },
    (_, index) => `${label} paragraph ${String(index + 1).padStart(3, '0')}. Synthetic concurrent-owner content.`,
  ).join('\n\n')
}

function fixedHeightGiantText() {
  const prefix = 'CONCURRENT-GIANT-START\n\n'
  const suffix = '\n\nCONCURRENT-GIANT-END'
  const phrase = 'Fixed-height giant native prose stays mounted during concurrent work. '
  return (prefix + phrase.repeat(Math.ceil(GIANT_NOTE_LENGTH / phrase.length)))
    .slice(0, GIANT_NOTE_LENGTH - suffix.length) + suffix
}

function note(id: string, position: { x: number; y: number }, text: string, size = { width: 500, height: 280 }): BrowserCard {
  return {
    id,
    kind: 'note',
    blocks: [{ id: `${id}-block`, text }],
    position,
    size,
  }
}

function ask(id: string, position: { x: number; y: number }): BrowserCard {
  return {
    id,
    kind: 'askAi',
    blocks: [{ id: `${id}-block`, text: 'Synthetic running request.' }],
    position,
  }
}

function result(
  id: string,
  title: string,
  position: { x: number; y: number },
): BrowserCard {
  return {
    id,
    kind: 'result',
    title,
    blocks: [{ id: `${id}-block`, text: '' }],
    position,
    size: { width: 500, height: 410 },
  }
}

function output(id: string, runId: string, text: string): BrowserOutput {
  return {
    id: `${id}-output`,
    resultCardId: id,
    chosenVersionId: `${id}-version`,
    versions: [{
      id: `${id}-version`,
      number: 1,
      text,
      createdAt: NOW,
      fromRunId: runId,
    }],
  }
}

function run(id: string, askAiCardId: string, producedVersionId: string): BrowserRun {
  return {
    id,
    startedAt: NOW,
    askAiCardId,
    model: 'openai/gpt-4o-mini',
    usedCardIds: [],
    usedConnectionIds: [],
    modIds: [],
    appliedMods: [],
    compiledInstruction: 'Synthetic concurrent-owner run.',
    producedVersionId,
    status: 'running',
  }
}

async function seedConcurrentBoard(page: Page) {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  const cards: BrowserCard[] = [
    ask('concurrent-pinned-ask', { x: -1_600, y: -1_600 }),
    ask('concurrent-away-ask', { x: -1_500, y: -1_500 }),
    ask('concurrent-offscreen-ask', { x: 5_000, y: 5_000 }),
    result(PINNED_ID, 'Pinned stream', { x: 80, y: 80 }),
    result(AWAY_ID, 'Away reader stream', { x: 620, y: 80 }),
    note(EDITOR_ID, { x: 80, y: 540 }, 'Independent editor keeps native focus, selection, composition, and input identity.'),
    note('concurrent-gesture-note', { x: 80, y: 860 }, 'Gesture owner.', { width: 240, height: 120 }),
    note(MEDIA_ID, { x: 620, y: 540 }, fixedHeightGiantText(), { width: 500, height: 410 }),
    note(BODY_DRAG_ID, { x: 1_120, y: 540 }, fixedHeightGiantText(), { width: 500, height: 410 }),
    note('concurrent-extra-a', { x: 340, y: 860 }, 'Extra Live owner A.', { width: 240, height: 120 }),
    note('concurrent-extra-b', { x: 600, y: 860 }, 'Extra Live owner B.', { width: 240, height: 120 }),
    note('concurrent-extra-c', { x: 860, y: 860 }, 'Extra Live owner C.', { width: 240, height: 120 }),
    result(OFFSCREEN_ID, 'Offscreen running result', { x: 5_000, y: 5_000 }),
  ]
  const connections = [
    { id: 'concurrent-pinned-connection', from: { cardId: 'concurrent-pinned-ask' }, to: { cardId: PINNED_ID }, strength: 'strong', polarity: 'helps', role: 'feeds' },
    { id: 'concurrent-away-connection', from: { cardId: 'concurrent-away-ask' }, to: { cardId: AWAY_ID }, strength: 'strong', polarity: 'helps', role: 'feeds' },
    { id: 'concurrent-offscreen-connection', from: { cardId: 'concurrent-offscreen-ask' }, to: { cardId: OFFSCREEN_ID }, strength: 'strong', polarity: 'helps', role: 'feeds' },
  ]
  const outputs = [
    output(PINNED_ID, 'concurrent-pinned-run', paragraphs('Pinned stream')),
    output(AWAY_ID, 'concurrent-away-run', paragraphs('Away reader')),
    output(OFFSCREEN_ID, 'concurrent-offscreen-run', 'Offscreen stream seed. Searchable offscreen content.'),
  ]
  const runs = [
    run('concurrent-pinned-run', 'concurrent-pinned-ask', `${PINNED_ID}-version`),
    run('concurrent-away-run', 'concurrent-away-ask', `${AWAY_ID}-version`),
    run('concurrent-offscreen-run', 'concurrent-offscreen-ask', `${OFFSCREEN_ID}-version`),
  ]

  await page.evaluate(({ cards, connections, outputs, runs }) => {
    const devWindow = window as unknown as DevWindow
    const store = devWindow.__eido
    if (!store) throw new Error('Missing synthetic Eido store')

    store.setState({
      cards,
      connections,
      outputs,
      runs,
      intentLog: [],
      highlights: [],
      highlightTags: [],
      visualDecayEnabled: false,
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
  }, { cards, connections, outputs, runs })

  const pinnedNode = page.locator(`.react-flow__node[data-id="${PINNED_ID}"]`)
  const awayNode = page.locator(`.react-flow__node[data-id="${AWAY_ID}"]`)
  const editorNode = page.locator(`.react-flow__node[data-id="${EDITOR_ID}"]`)
  const mediaNode = page.locator(`.react-flow__node[data-id="${MEDIA_ID}"]`)
  const bodyDragNode = page.locator(`.react-flow__node[data-id="${BODY_DRAG_ID}"]`)
  await expect(pinnedNode).toBeVisible()
  await expect(awayNode).toBeVisible()
  await expect(editorNode).toBeVisible()
  await expect(mediaNode).toBeVisible()
  await expect(bodyDragNode).toBeVisible()
  await expect(mediaNode.locator('.card')).toHaveClass(/fixed-h/)
  await expect.poll(() => mediaNode.evaluate((element) => element.getBoundingClientRect().height)).toBe(410)
  await expect.poll(() => page.evaluate((id) => {
    const card = (window as unknown as DevWindow).__eido?.getState().cards.find((candidate) => candidate.id === id)
    return card?.blocks[0]?.text.length ?? 0
  }, MEDIA_ID)).toBe(GIANT_NOTE_LENGTH)
  await expect.poll(() => mediaNode.locator('.note-render.markdown').evaluate(
    (element) => element.textContent?.length ?? 0,
  )).toBeGreaterThan(619_900)
  await expect.poll(() => bodyDragNode.locator('.note-render.markdown').evaluate(
    (element) => element.textContent?.length ?? 0,
  )).toBeGreaterThan(619_900)
  await expect.poll(() => pinnedNode.locator('.card-body').evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(500)
  await expect.poll(() => awayNode.locator('.card-body').evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(500)
  await page.waitForFunction(() => typeof (window as unknown as DevWindow).__EIDO_CARD_ACTIVATION_OWNER_SNAPSHOT__ === 'function')
  await page.waitForFunction(() => typeof (window as unknown as DevWindow).__EIDO_SET_GESTURE_PARTICIPANTS__ === 'function')

  return { pinnedNode, awayNode, editorNode, mediaNode, bodyDragNode }
}

async function ownerSnapshot(page: Page, cardId: string) {
  return page.evaluate((id) => {
    const read = (window as unknown as DevWindow).__EIDO_CARD_ACTIVATION_OWNER_SNAPSHOT__
    if (!read) throw new Error('Missing card owner diagnostic')
    return read(id)
  }, cardId)
}

async function gestureOwnerIds(page: Page) {
  const cardIds = await page.evaluate(() => (
    (window as unknown as DevWindow).__eido?.getState().cards.map((card) => card.id) ?? []
  ))
  const snapshots = await Promise.all(cardIds.map(async (id) => ({
    id,
    snapshot: await ownerSnapshot(page, id),
  })))
  return snapshots.filter(({ snapshot }) => snapshot.owners.gesture).map(({ id }) => id).sort()
}

async function appendStream(page: Page, cardId: string, tail: string) {
  await page.evaluate(({ cardId: targetId, tail: nextText }) => {
    const store = (window as unknown as DevWindow).__eido
    if (!store) throw new Error('Missing synthetic Eido store')
    const state = store.getState()
    const versionId = state.outputs.find((candidate) => candidate.resultCardId === targetId)
      ?.chosenVersionId
    if (!versionId) throw new Error(`Missing public stream target ${targetId}`)
    state.appendVersionText(versionId, `\n\n${nextText}`)
  }, { cardId, tail })
}

async function markReadingPosition(
  page: Page,
  element: ReturnType<Page['locator']>,
  fraction: number,
) {
  const before = await element.evaluate((node, ratio) => {
    const max = node.scrollHeight - node.clientHeight
    node.scrollTop = Math.round(max * Math.min(ratio, 0.98))
    return node.scrollTop
  }, fraction)
  const box = await element.boundingBox()
  if (!box) throw new Error('Missing stream reader bounds')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, fraction >= 0.9 ? 2_000 : 48)
  if (fraction >= 0.9) {
    await expect.poll(() => element.evaluate((node) => (
      node.scrollHeight - node.clientHeight - node.scrollTop
    ))).toBeLessThanOrEqual(2)
  } else {
    await expect.poll(() => element.evaluate((node) => node.scrollTop)).toBeGreaterThan(before)
  }
  return element.evaluate((node) => node.scrollTop)
}

async function visibleReaderAnchor(element: ReturnType<Page['locator']>) {
  return element.evaluate((body) => {
    const bodyRect = body.getBoundingClientRect()
    const candidates = Array.from(body.querySelectorAll<HTMLElement>('p'))
      .map((candidate) => ({ candidate, rect: candidate.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom > bodyRect.top && rect.top < bodyRect.bottom)
    const anchor = candidates.find(({ rect }) => rect.top >= bodyRect.top) ?? candidates[0]
    if (!anchor) throw new Error('Missing visible reader anchor')
    return {
      text: anchor.candidate.textContent ?? '',
      offset: Math.round((anchor.rect.top - bodyRect.top) * 10) / 10,
    }
  })
}

async function rememberConcurrentIdentity(page: Page) {
  await page.evaluate(({ pinnedId, awayId, editorId, giantId }) => {
    const node = (id: string) => document.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${id}"]`,
    )
    const pinnedNode = node(pinnedId)
    const awayNode = node(awayId)
    const editorNode = node(editorId)
    const giantNode = node(giantId)
    const pinnedBody = pinnedNode?.querySelector<HTMLElement>('.card-body')
    const awayBody = awayNode?.querySelector<HTMLElement>('.card-body')
    const editor = editorNode?.querySelector<HTMLElement>(
      '.markdown-card-editor-content[contenteditable="true"]',
    )
    const giantRoot = giantNode === editorNode
      ? editor
      : giantNode?.querySelector<HTMLElement>('.note-render.markdown')
    const giantHead = giantNode?.querySelector<HTMLElement>('.card-head')
    const giantTitle = giantNode?.querySelector<HTMLElement>('.card-title-display')
    if (
      !pinnedNode || !awayNode || !editorNode || !giantNode || !pinnedBody || !awayBody ||
      !editor || !giantRoot || !giantHead || !giantTitle
    ) throw new Error('Missing concurrent native identity surface')
    const selection = window.getSelection()
    const remembered = {
      elements: [
        pinnedNode,
        awayNode,
        editorNode,
        giantNode,
        pinnedBody,
        awayBody,
        editor,
        giantRoot,
        giantHead,
        giantTitle,
      ],
      selection: {
        anchorNode: selection?.anchorNode ?? null,
        anchorOffset: selection?.anchorOffset ?? -1,
        focusNode: selection?.focusNode ?? null,
        focusOffset: selection?.focusOffset ?? -1,
      },
    }
    ;(window as unknown as { __EIDO_CONCURRENT_IDENTITY__?: typeof remembered })
      .__EIDO_CONCURRENT_IDENTITY__ = remembered
  }, { pinnedId: PINNED_ID, awayId: AWAY_ID, editorId: EDITOR_ID, giantId: MEDIA_ID })
}

async function concurrentContinuitySnapshot(page: Page) {
  return page.evaluate(({ pinnedId, awayId, editorId, giantId }) => {
    const devWindow = window as unknown as DevWindow & {
      __EIDO_CONCURRENT_IDENTITY__?: {
        elements: HTMLElement[]
        selection: {
          anchorNode: Node | null
          anchorOffset: number
          focusNode: Node | null
          focusOffset: number
        }
      }
    }
    const remembered = devWindow.__EIDO_CONCURRENT_IDENTITY__
    if (!remembered) throw new Error('Missing remembered concurrent identity')
    const node = (id: string) => document.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${id}"]`,
    )
    const pinnedNode = node(pinnedId)
    const awayNode = node(awayId)
    const editorNode = node(editorId)
    const giantNode = node(giantId)
    const pinnedBody = pinnedNode?.querySelector<HTMLElement>('.card-body')
    const awayBody = awayNode?.querySelector<HTMLElement>('.card-body')
    const editor = editorNode?.querySelector<HTMLElement>(
      '.markdown-card-editor-content[contenteditable="true"]',
    )
    const giantRoot = giantNode === editorNode
      ? editor
      : giantNode?.querySelector<HTMLElement>('.note-render.markdown')
    const giantHead = giantNode?.querySelector<HTMLElement>('.card-head')
    const giantTitle = giantNode?.querySelector<HTMLElement>('.card-title-display')
    const namedCurrent = [
      ['pinned node', pinnedNode],
      ['away node', awayNode],
      ['editor node', editorNode],
      ['giant node', giantNode],
      ['pinned body', pinnedBody],
      ['away body', awayBody],
      ['editor', editor],
      ['giant root', giantRoot],
      ['giant head', giantHead],
      ['giant title', giantTitle],
    ] as const
    const missing = namedCurrent.filter(([, element]) => !element).map(([label]) => label)
    if (missing.length) throw new Error(`Concurrent identity surface disappeared: ${missing.join(', ')}`)
    const current = namedCurrent.map(([, element]) => element)
    const elements = current as HTMLElement[]
    const visible = (element: HTMLElement) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 &&
        rect.width > 0 && rect.height > 0
    }
    const selection = window.getSelection()
    const state = devWindow.__eido?.getState()
    return {
      sameIdentity: elements.length === remembered.elements.length &&
        elements.every((element, index) => element === remembered.elements[index]),
      connected: elements.every((element) => element.isConnected),
      visible: elements.every(visible),
      editorFocused: document.activeElement === editor,
      compositionActive: devWindow.__concurrentComposition?.active === true,
      compositionEvents: devWindow.__concurrentComposition
        ? { ...devWindow.__concurrentComposition }
        : null,
      selectionPreserved: selection?.anchorNode === remembered.selection.anchorNode &&
        selection?.anchorOffset === remembered.selection.anchorOffset &&
        selection?.focusNode === remembered.selection.focusNode &&
        selection?.focusOffset === remembered.selection.focusOffset,
      editorText: editor?.textContent ?? '',
      giantRenderedTextLength: giantRoot?.textContent?.length ?? 0,
      giantHeight: giantNode?.getBoundingClientRect().height ?? 0,
      selectedCardIds: [...(state?.selectedCardIds ?? [])].sort(),
    }
  }, { pinnedId: PINNED_ID, awayId: AWAY_ID, editorId: EDITOR_ID, giantId: MEDIA_ID })
}

test('different 620k Card title and passive-body drags preserve the active editor exactly', async ({ page, context }) => {
  test.setTimeout(120_000)
  const { pinnedNode, awayNode, editorNode, mediaNode, bodyDragNode } = await seedConcurrentBoard(page)
  const pinnedBody = pinnedNode.locator('.card-body')
  const awayBody = awayNode.locator('.card-body')

  // Running execution is graph-owned, not rich-DOM-owned: this Result stays
  // offscreen and nonresident while the public stream action changes its
  // exact saved output without settling the run.
  const offscreen = page.locator(`.react-flow__node[data-id="${OFFSCREEN_ID}"]`)
  await expect(offscreen).toHaveCount(0)
  await appendStream(page, OFFSCREEN_ID, 'Offscreen running tail exact graph update.')
  await expect(offscreen).toHaveCount(0)
  await expect.poll(() => page.evaluate((id) => {
    const state = (window as unknown as DevWindow).__eido?.getState()
    const output = state?.outputs.find((candidate) => candidate.resultCardId === id)
    const run = state?.runs.find((candidate) => candidate.id === 'concurrent-offscreen-run')
    return {
      text: output?.versions[0]?.text ?? '',
      runStatus: run?.status ?? null,
    }
  }, OFFSCREEN_ID)).toEqual({
    text: 'Offscreen stream seed. Searchable offscreen content.\n\nOffscreen running tail exact graph update.',
    runStatus: 'running',
  })
  await expect.poll(() => ownerSnapshot(page, OFFSCREEN_ID)).toEqual({
    mode: 'passive',
    ownerTokens: [],
    owners: {
      selected: false,
      editing: false,
      activation: false,
      focused: false,
      scrolling: false,
      gesture: false,
      media: false,
    },
  })

  // Establish both reading positions through the real selection and trusted
  // wheel paths before the giant Note becomes the sole selected editor.
  await pinnedNode.locator('.card-head').click({ position: { x: 250, y: 3 } })
  await expect(pinnedNode).toHaveClass(/selected/)
  await markReadingPosition(page, pinnedBody, 1)
  await expect.poll(() => pinnedBody.evaluate((element) => (
    element.scrollHeight - element.clientHeight - element.scrollTop
  ))).toBeLessThanOrEqual(2)
  await awayNode.locator('.card-head').click({ position: { x: 250, y: 3 } })
  await expect(awayNode).toHaveClass(/selected/)
  const awayBefore = await markReadingPosition(page, awayBody, 0.36)
  const awayAnchorBefore = await visibleReaderAnchor(awayBody)

  const { editor, pressSequentially } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    `.react-flow__node[data-id="${EDITOR_ID}"]`,
    () => editorNode.locator('.note-render.markdown').click({ position: { x: 36, y: 24 } }),
  )
  await pressSequentially(' draft input')
  await expect(editor).toContainText('draft input')

  // Begin a real Chromium IME composition. Its browser-delivered event state,
  // exact native selection, focus, and editor identity must survive the
  // subsequent wheel, stream, and different-Card head drag.
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __concurrentEditor?: Element }
    const target = document.querySelector<HTMLElement>(
      '.react-flow__node[data-id="concurrent-editor-note"] .markdown-card-editor-content[contenteditable="true"]',
    )
    if (!target) throw new Error('Missing synthetic editor')
    target.focus()
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
    let textNode: Node | null = null
    for (let candidate = walker.nextNode(); candidate; candidate = walker.nextNode()) {
      if (candidate.textContent?.length) textNode = candidate
    }
    if (!textNode) throw new Error('Missing synthetic editor caret target')
    const range = document.createRange()
    range.setStart(textNode, textNode.textContent?.length ?? 0)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    devWindow.__concurrentEditor = target
    devWindow.__concurrentEditorBlurCount = 0
    devWindow.__concurrentComposition = { starts: 0, updates: 0, ends: 0, active: false, lastData: '' }
    target.addEventListener('compositionstart', (event) => {
      const state = devWindow.__concurrentComposition!
      state.starts += 1
      state.active = true
      state.lastData = event.data
    })
    target.addEventListener('compositionupdate', (event) => {
      const state = devWindow.__concurrentComposition!
      state.updates += 1
      state.lastData = event.data
    })
    target.addEventListener('compositionend', (event) => {
      const state = devWindow.__concurrentComposition!
      state.ends += 1
      state.active = false
      state.lastData = event.data
    })
    target.addEventListener('blur', () => {
      devWindow.__concurrentEditorBlurCount = (devWindow.__concurrentEditorBlurCount ?? 0) + 1
    })
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.imeSetComposition', {
    text: '未確定',
    selectionStart: 3,
    selectionEnd: 3,
  })
  await expect(editor).toBeFocused()
  await expect.poll(() => page.evaluate(() => (
    (window as unknown as DevWindow).__concurrentComposition
  ))).toMatchObject({ starts: 1, active: true, ends: 0, lastData: '未確定' })

  // Five independent media owners plus the editor establish six distinct
  // legitimate Live IDs. Exactly two of those media Cards also participate
  // in the synthetic gesture boundary, keeping G within its 0-2 invariant.
  await page.evaluate((mediaIds) => {
    for (const mediaId of mediaIds) {
      const node = document.querySelector(`.react-flow__node[data-id="${mediaId}"]`)
      if (!node) throw new Error(`Missing media owner host ${mediaId}`)
      const media = document.createElement('video')
      media.dataset.concurrentSyntheticMedia = mediaId
      media.muted = true
      node.append(media)
      media.dispatchEvent(new Event('play', { bubbles: true }))
    }
  }, MEDIA_IDS)
  for (const id of MEDIA_IDS) {
    await expect.poll(() => ownerSnapshot(page, id)).toMatchObject({ owners: { media: true } })
  }

  await page.evaluate((ids) => {
    ;(window as unknown as DevWindow).__EIDO_SET_GESTURE_PARTICIPANTS__?.(ids)
  }, GESTURE_IDS)
  for (const id of GESTURE_IDS) {
    await expect.poll(() => ownerSnapshot(page, id)).toMatchObject({ mode: 'live', owners: { gesture: true } })
  }

  // A final trusted wheel over the away reader is the scrolling-owner
  // authority while the single selected editor keeps its composition.
  const awayBox = await awayBody.boundingBox()
  if (!awayBox) throw new Error('Missing away reader bounds')
  await page.mouse.move(awayBox.x + awayBox.width / 2, awayBox.y + awayBox.height / 2)
  await page.mouse.wheel(0, 1)
  await expect.poll(() => ownerSnapshot(page, AWAY_ID)).toMatchObject({
    mode: 'live',
    owners: { scrolling: true },
  })

  await expect.poll(async () => Number(
    (await page.locator('.board-flow').getAttribute('data-live-card-count')) ?? 0,
  )).toBeGreaterThanOrEqual(6)
  await expect.poll(() => ownerSnapshot(page, EDITOR_ID)).toMatchObject({
    mode: 'live',
    owners: { selected: true, editing: true, focused: true },
  })

  await rememberConcurrentIdentity(page)
  const editorTextBeforeDrags = await editor.textContent()
  expect(await concurrentContinuitySnapshot(page)).toMatchObject({
    sameIdentity: true,
    connected: true,
    visible: true,
    editorFocused: true,
    compositionActive: true,
    compositionEvents: expect.objectContaining({ starts: 1, active: true, ends: 0 }),
    selectionPreserved: true,
    giantRenderedTextLength: expect.any(Number),
    giantHeight: 410,
    selectedCardIds: [EDITOR_ID],
  })

  // Title text and passive prose are both true node-drag surfaces while this
  // other Card is unselected. Each gesture must move the 620k Card without
  // allowing its mousedown default to blur the exact editor/Range/IME owner.
  // Oversized pointer travel is geometry-only and selects neither Card.
  const dragSurfaces = [
    { name: 'title', cardId: MEDIA_ID, locator: mediaNode.locator('.card-title-display') },
    { name: 'passive body', cardId: BODY_DRAG_ID, locator: bodyDragNode.locator('.card-body') },
  ] as const
  for (const [index, surface] of dragSurfaces.entries()) {
    const box = await surface.locator.boundingBox()
    if (!box) throw new Error(`Missing giant concurrent Card ${surface.name}`)
    const from = surface.name === 'passive body'
      ? { x: box.x + 80, y: box.y + 60 }
      : { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const beforePosition = await page.evaluate((id) => (
      (window as unknown as DevWindow).__eido?.getState().cards.find((card) => card.id === id)?.position
    ), surface.cardId)
    if (!beforePosition) throw new Error('Missing giant concurrent Card position')
    let pointerHeld = false
    try {
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      pointerHeld = true
      await expect(editor).toBeFocused()
      await page.mouse.move(from.x + 72, from.y + 24, { steps: 4 })
      await expect(editor).toBeFocused()

      const heldPosition = await page.evaluate((id) => (
        (window as unknown as DevWindow).__eido?.getState().cards.find((card) => card.id === id)?.position
      ), surface.cardId)
      expect(heldPosition!.x).toBeGreaterThan(beforePosition.x + 36)
      expect(heldPosition!.y).toBeGreaterThan(beforePosition.y + 12)
      await expect.poll(() => page.evaluate(() => (
        (window as unknown as DevWindow).__eido?.getState().selectedCardIds ?? []
      ))).toEqual([])
      await expect.poll(() => ownerSnapshot(page, EDITOR_ID)).toMatchObject({
        mode: 'live',
        owners: { selected: false, editing: false, focused: true },
      })
      await expect.poll(async () => Number(
        (await page.locator('.board-flow').getAttribute('data-live-card-count')) ?? 0,
      )).toBeGreaterThanOrEqual(6)
      await expect.poll(async () => (await gestureOwnerIds(page)).length).toBeLessThanOrEqual(2)

      if (index === 0) {
        await appendStream(page, PINNED_ID, 'Pinned stream tail while the giant Card is held.')
        await appendStream(page, AWAY_ID, 'Away reader tail while the giant Card is held.')
        await expect(pinnedBody).toContainText('Pinned stream tail while the giant Card is held.')
        await expect(awayBody).toContainText('Away reader tail while the giant Card is held.')
        await expect.poll(() => pinnedBody.evaluate((element) => (
          element.scrollHeight - element.clientHeight - element.scrollTop
        ))).toBeLessThanOrEqual(2)
        await expect.poll(() => awayBody.evaluate((element) => element.scrollTop)).toBeCloseTo(awayBefore, 0)
        await expect.poll(() => visibleReaderAnchor(awayBody)).toEqual(awayAnchorBefore)
      }

      const held = await concurrentContinuitySnapshot(page)
      expect(held).toMatchObject({
        sameIdentity: true,
        connected: true,
        visible: true,
        editorFocused: true,
        compositionActive: true,
        compositionEvents: expect.objectContaining({ starts: 1, active: true, ends: 0 }),
        selectionPreserved: true,
        editorText: editorTextBeforeDrags,
        giantHeight: 410,
        selectedCardIds: [],
      })
      expect(held.giantRenderedTextLength).toBeGreaterThan(619_900)
      expect(await page.evaluate(() => (
        (window as unknown as DevWindow).__concurrentEditorBlurCount
      ))).toBe(0)
    } finally {
      if (pointerHeld) await page.mouse.up()
    }

    const after = await concurrentContinuitySnapshot(page)
    expect(after).toMatchObject({
      sameIdentity: true,
      connected: true,
      visible: true,
      editorFocused: true,
      compositionActive: true,
      compositionEvents: expect.objectContaining({ starts: 1, active: true, ends: 0 }),
      selectionPreserved: true,
      editorText: editorTextBeforeDrags,
      giantHeight: 410,
      selectedCardIds: [],
    })
    expect(after.giantRenderedTextLength).toBeGreaterThan(619_900)
  }
  await expect.poll(async () => (await gestureOwnerIds(page)).length).toBeLessThanOrEqual(2)
  for (const id of MEDIA_IDS) {
    await expect.poll(() => ownerSnapshot(page, id)).toMatchObject({
      mode: 'live',
      owners: { media: true },
    })
  }

  // Commit the live IME session, then prove ordinary trusted input still
  // reaches the exact editor instance after release.
  await cdp.send('Input.insertText', { text: '確定' })
  await expect.poll(() => page.evaluate(() => (
    (window as unknown as DevWindow).__concurrentComposition
  ))).toMatchObject({ starts: 1, active: false, ends: 1 })
  await pressSequentially(' after drag')
  await expect(editor).toContainText('after drag')

  // A fresh unselected passive-body press is still an ordinary stationary
  // click. It blurs and retires the old editor once; the drag-only focus
  // preservation and press-local body intent do not leak into this click.
  await expect(mediaNode).not.toHaveClass(/selected/)
  await mediaNode.locator('.card-body').click({ position: { x: 80, y: 60 } })
  await expect.poll(() => page.evaluate(() => (
    (window as unknown as DevWindow).__eido?.getState().selectedCardIds ?? []
  ))).toEqual([MEDIA_ID])
  await expect(editorNode.locator('.markdown-card-editor-content[contenteditable="true"]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (
    (window as unknown as DevWindow).__concurrentEditorBlurCount
  ))).toBe(1)
  await expect(offscreen).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (
    (window as unknown as DevWindow).__eido?.getState().runs
      .find((candidate) => candidate.id === 'concurrent-offscreen-run')?.status
  ))).toBe('running')
})

test('Board search and logical whole-Board copy retain offscreen nonresident meaning', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await seedConcurrentBoard(page)
  await appendStream(page, OFFSCREEN_ID, 'Offscreen copy sentinel remains in graph truth.')

  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const panel = page.getByRole('search', { name: 'Search' })
  const search = panel.locator('#board-search-input')
  await search.fill('Offscreen copy sentinel')
  await expect(panel.getByRole('button', { name: 'Offscreen running result' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.locator('.board-flow').focus()
  await page.keyboard.press('Control+A')
  await expect(page.locator('.board-flow')).toHaveAttribute('data-whole-board-selected', 'true')
  await page.keyboard.press('Control+C')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('Offscreen copy sentinel remains in graph truth.')
})

test('Escape and resolved stationary clicks retire the focused editor', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const app = window as unknown as DevWindow
    return Boolean(app.__eido?.getState().hydrated && app.__EIDO_SET_VIEWPORT__)
  })
  await page.evaluate(({ cards, outputs }) => {
    const app = window as unknown as DevWindow
    app.__eido?.setState({
      cards,
      outputs,
      connections: [],
      runs: [],
      intentLog: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
    app.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
  }, {
    cards: [
      note('exit-editor', { x: 80, y: 80 }, 'Keep editing until the interaction resolves.', { width: 340, height: 240 }),
      note('exit-header', { x: 500, y: 80 }, 'Another Card.', { width: 340, height: 240 }),
      { ...result('exit-result', 'A non-editable Result', { x: 500, y: 400 }), size: { width: 340, height: 280 } },
    ],
    outputs: [output('exit-result', 'exit-result-run', 'A completed answer.')],
  })

  const nodeSelector = '.react-flow__node[data-id="exit-editor"]'
  const node = page.locator(nodeSelector)
  const exits = [
    { name: 'Escape', act: () => page.keyboard.press('Escape') },
    { name: 'another Card header', act: () => page.locator('[data-id="exit-header"] .card-head').click({ position: { x: 250, y: 3 } }) },
    { name: 'a Result body', act: () => page.locator('[data-id="exit-result"] .card-body').click({ position: { x: 30, y: 30 } }) },
    { name: 'empty Board', act: () => page.locator('.react-flow__pane').click({ position: { x: 1000, y: 500 } }) },
  ]
  for (const exit of exits) {
    const { editor } = await activateAndRequireExactReadyMarkdownEditor(
      page,
      nodeSelector,
      () => node.locator('.card-body').click({ position: { x: 36, y: 28 } }),
    )
    await exit.act()
    await expect(editor, exit.name).toHaveCount(0)
  }
})
