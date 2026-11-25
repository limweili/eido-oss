import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test'
import { activateAndRequireExactReadyMarkdownEditor } from '../performance/richCardEditorReadiness'

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    cards: Array<{ id: string; position: { x: number; y: number } }>
    highlights: Array<{ cardId: string; text: string; occurrence: number }>
    selectedCardIds: string[]
  }
  setState: (state: unknown) => void
}

const GIANT_NOTE_ID = 'giant-first-drag-note'
const GIANT_NOTE_LENGTH = 1_000_000
const START_SENTINEL = 'EIDO-NATIVE-START-SENTINEL'
const MIDDLE_SENTINEL = 'EIDO-NATIVE-MIDDLE-SENTINEL'
const END_SENTINEL = 'EIDO-NATIVE-END-SENTINEL'
const FIRST_FILL_PHRASE = 'First giant native prose remains mounted. '
const SECOND_FILL_PHRASE = 'Second giant native prose remains mounted. '
const FILL_PADDING = '¤'

type ContinuitySnapshot = {
  sameCoreIdentity: boolean
  sameIdentity: boolean
  connected: boolean
  bodyWidth: number
  bodyHeight: number
  bodyScrollWidth: number
  bodyScrollHeight: number
  bodyClientWidth: number
  bodyClientHeight: number
  nodeWidth: number
  nodeHeight: number
  shellWidth: number
  shellHeight: number
  scrollLeft: number
  scrollTop: number
  maxScrollLeft: number
  maxScrollTop: number
  anchorText: string
  anchorOffset: number
  semanticVisible: boolean
  semanticHidden: boolean
  completeStateLength: number
  hasEverySentinel: boolean
  renderedTextLength: number
  renderedHasEverySentinel: boolean
  fillerCountsMatch: boolean
  paddingCountMatches: boolean
  shellVisible: boolean
  chromeVisible: boolean
  portGeometry: string[]
  handleGeometry: string[]
  headingCount: number
  linkCount: number
  listItemCount: number
  codeCount: number
}

async function seedGiantNote(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(({
    cardId,
    targetLength,
    firstPhrase,
    secondPhrase,
    fillPadding,
    startSentinel,
    middleSentinel,
    endSentinel,
  }) => {
    const devWindow = window as unknown as {
      __eido: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    const prefix = [
      `## ${startSentinel}`,
      '',
      'Structured synthetic prose keeps the [passive Note](https://example.com) representative.',
      '',
      '- One deterministic bullet exercises Markdown descendants.',
      '- Another keeps selection and cursor styling honest.',
      '',
      '```ts',
      "const nativeIdentity = 'stable';",
      '```',
      '',
    ].join('\n')
    const middle = `\n\n## ${middleSentinel}\n\nMiddle anchor paragraph stays exact.`
    const suffix = `\n\n## ${endSentinel}\n\nTerminal native semantics.`
    const fill = (length: number, phrase: string) => {
      const repeated = phrase.repeat(Math.floor(length / phrase.length))
      return repeated + fillPadding.repeat(length - repeated.length)
    }
    const available = targetLength - prefix.length - middle.length - suffix.length
    const firstFillLength = Math.floor(available / 2)
    const text = prefix +
      fill(firstFillLength, firstPhrase) +
      middle +
      fill(available - firstFillLength, secondPhrase) +
      suffix
    devWindow.__eido.setState({
      cards: [{
        id: cardId,
        kind: 'note',
        title: 'Giant native semantics',
        blocks: [{ id: `${cardId}-block`, text }],
        position: { x: 220, y: 180 },
        size: { width: 420, height: 300 },
        // This fixture measures prose and chrome continuity. Keep its native
        // link without an asynchronous preview adding a panel and AX listitem.
        meta: { linkPreviewDismissedUrls: ['https://example.com'] },
        zIndex: 1,
      }],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      highlights: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
  }, {
    cardId: GIANT_NOTE_ID,
    targetLength: GIANT_NOTE_LENGTH,
    firstPhrase: FIRST_FILL_PHRASE,
    secondPhrase: SECOND_FILL_PHRASE,
    fillPadding: FILL_PADDING,
    startSentinel: START_SENTINEL,
    middleSentinel: MIDDLE_SENTINEL,
    endSentinel: END_SENTINEL,
  })

  const node = page.locator(`.react-flow__node-note[data-id="${GIANT_NOTE_ID}"]`)
  await node.waitFor({ state: 'visible' })
  await expect(node.locator('.note-render.markdown')).toBeVisible()
  await expect(node.locator('.markdown-card-editor-transition')).toHaveCount(0)
  await expect.poll(() => page.evaluate((cardId) => {
    const card = (window as unknown as { __eido: EidoDevStore }).__eido
      .getState()
      .cards.find(({ id }) => id === cardId) as unknown as { blocks?: Array<{ text: string }> } | undefined
    return card?.blocks?.[0]?.text.length ?? 0
  }, GIANT_NOTE_ID)).toBe(GIANT_NOTE_LENGTH)
  return node
}

async function selectGiantNote(page: Page, node: Locator) {
  await node.locator('.card-head').click({ position: { x: 200, y: 4 } })
  await expect(node).toHaveClass(/selected/)
  await expect.poll(() => page.evaluate(
    () => (window as unknown as { __eido: EidoDevStore }).__eido.getState().selectedCardIds,
  )).toEqual([GIANT_NOTE_ID])
  await waitForSelectedChromeReady(node)
}

async function waitForSelectedChromeReady(node: Locator) {
  await expect.poll(() => node.locator('.card-resize-handle').count()).toBeGreaterThan(0)
  await expect.poll(() => node.evaluate((element) => {
    const chrome = element.querySelector<HTMLElement>('.card-resize-layer')
    const handles = Array.from(element.querySelectorAll<HTMLElement>('.card-resize-handle'))
    const surfaces = chrome ? [chrome, ...handles] : handles
    return surfaces.length > 1 && surfaces.every((surface) => {
      const rect = surface.getBoundingClientRect()
      return surface.isConnected && rect.width > 0 && rect.height > 0 &&
        surface.getAnimations().every((animation) => animation.playState === 'finished')
    })
  })).toBe(true)
}

async function positionMiddleAnchor(node: Locator) {
  await node.locator('.note-body').evaluate((body, middleSentinel) => {
    const anchor = Array.from(body.querySelectorAll<HTMLElement>('h2')).find(
      (candidate) => candidate.textContent === middleSentinel,
    )
    if (!anchor) throw new Error('Missing giant Note middle anchor')
    anchor.scrollIntoView({ block: 'center' })
  }, MIDDLE_SENTINEL)
}

async function rememberNativeIdentity(page: Page) {
  return page.evaluate((cardId) => {
    const node = document.querySelector<HTMLElement>(`.react-flow__node-note[data-id="${cardId}"]`)
    const shell = node?.querySelector<HTMLElement>('.card')
    const selectedChrome = node?.querySelector<HTMLElement>('.card-resize-layer')
    const head = node?.querySelector<HTMLElement>('.card-head')
    const title = node?.querySelector<HTMLElement>('.card-title-display')
    const body = node?.querySelector<HTMLElement>('.note-body')
    const root = node?.querySelector<HTMLElement>('.note-render.markdown')
    if (!node || !shell || !selectedChrome || !head || !title || !body || !root) {
      throw new Error('Missing giant Note native surface')
    }
    const identity = {
      node,
      shell,
      selectedChrome,
      head,
      title,
      body,
      root,
      ports: Array.from(node.querySelectorAll('.react-flow__handle')),
      handles: Array.from(node.querySelectorAll('.card-resize-handle')),
    }
    ;(window as unknown as { __EIDO_GIANT_NATIVE_IDENTITY__?: typeof identity })
      .__EIDO_GIANT_NATIVE_IDENTITY__ = identity
    return {
      portCount: identity.ports.length,
      handleCount: identity.handles.length,
    }
  }, GIANT_NOTE_ID)
}

async function continuitySnapshot(page: Page): Promise<ContinuitySnapshot> {
  return page.evaluate(({ cardId, middleSentinel, sentinels, fillerPhrases, fillPadding }) => {
    const devWindow = window as unknown as {
      __eido: EidoDevStore
      __EIDO_GIANT_NATIVE_IDENTITY__?: {
        node: HTMLElement
        shell: HTMLElement
        selectedChrome: HTMLElement
        head: HTMLElement
        title: HTMLElement
        body: HTMLElement
        root: HTMLElement
        ports: Element[]
        handles: Element[]
      }
    }
    const remembered = devWindow.__EIDO_GIANT_NATIVE_IDENTITY__
    const node = document.querySelector<HTMLElement>(`.react-flow__node-note[data-id="${cardId}"]`)
    const shell = node?.querySelector<HTMLElement>('.card')
    const selectedChrome = node?.querySelector<HTMLElement>('.card-resize-layer')
    const head = node?.querySelector<HTMLElement>('.card-head')
    const title = node?.querySelector<HTMLElement>('.card-title-display')
    const body = node?.querySelector<HTMLElement>('.note-body')
    const root = node?.querySelector<HTMLElement>('.note-render.markdown')
    if (!remembered || !node || !shell || !selectedChrome || !head || !title || !body || !root) {
      throw new Error('Missing remembered giant Note native surface')
    }
    const nodeRect = node.getBoundingClientRect()
    const shellRect = shell.getBoundingClientRect()
    const bodyRect = body.getBoundingClientRect()
    const anchor = Array.from(root.querySelectorAll<HTMLElement>('h2')).find(
      (candidate) => candidate.textContent === middleSentinel,
    )
    if (!anchor) throw new Error('Missing middle anchor')
    const rootStyle = getComputedStyle(root)
    const nodeStyle = getComputedStyle(node)
    const shellStyle = getComputedStyle(shell)
    const renderedText = root.textContent ?? ''
    const ports = Array.from(node.querySelectorAll<HTMLElement>('.react-flow__handle'))
    const handles = Array.from(node.querySelectorAll<HTMLElement>('.card-resize-handle'))
    const relativeGeometry = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect()
      const cssTenth = (value: number) => Math.round(value * 10) / 10
      return [
        cssTenth(rect.left - shellRect.left),
        cssTenth(rect.top - shellRect.top),
        cssTenth(rect.width),
        cssTenth(rect.height),
      ].join(':')
    }
    const card = devWindow.__eido.getState().cards.find(({ id }) => id === cardId) as unknown as {
      blocks?: Array<{ text: string }>
    } | undefined
    const stateText = card?.blocks?.[0]?.text ?? ''
    const occurrenceCount = (text: string, target: string) => text.split(target).length - 1
    const sameCoreIdentity = remembered.node === node &&
        remembered.shell === shell &&
        remembered.body === body &&
        remembered.root === root
    return {
      sameCoreIdentity,
      sameIdentity: sameCoreIdentity &&
        remembered.ports.length === ports.length &&
        remembered.handles.length === handles.length &&
        remembered.ports.every((port, index) => port === ports[index]) &&
        remembered.handles.every((handle, index) => handle === handles[index]),
      connected: [node, shell, body, root, ...remembered.ports, ...remembered.handles]
        .every((element) => element.isConnected),
      bodyWidth: bodyRect.width,
      bodyHeight: bodyRect.height,
      bodyScrollWidth: body.scrollWidth,
      bodyScrollHeight: body.scrollHeight,
      bodyClientWidth: body.clientWidth,
      bodyClientHeight: body.clientHeight,
      nodeWidth: nodeRect.width,
      nodeHeight: nodeRect.height,
      shellWidth: shellRect.width,
      shellHeight: shellRect.height,
      scrollLeft: body.scrollLeft,
      scrollTop: body.scrollTop,
      maxScrollLeft: body.scrollWidth - body.clientWidth,
      maxScrollTop: body.scrollHeight - body.clientHeight,
      anchorText: anchor.textContent ?? '',
      anchorOffset: anchor.getBoundingClientRect().top - bodyRect.top,
      semanticVisible: rootStyle.display !== 'none' &&
        rootStyle.visibility !== 'hidden' &&
        Number(rootStyle.opacity) > 0 &&
        root.getClientRects().length > 0,
      semanticHidden: root.inert ||
        root.getAttribute('aria-hidden') === 'true' ||
        Boolean(root.closest('[aria-hidden="true"]')),
      completeStateLength: stateText.length,
      hasEverySentinel: sentinels.every((sentinel) => stateText.includes(sentinel)),
      renderedTextLength: renderedText.length,
      renderedHasEverySentinel: sentinels.every((sentinel) => renderedText.includes(sentinel)),
      fillerCountsMatch: fillerPhrases.every((phrase) => (
        occurrenceCount(renderedText, phrase) === occurrenceCount(stateText, phrase)
      )),
      paddingCountMatches: occurrenceCount(renderedText, fillPadding) ===
        occurrenceCount(stateText, fillPadding),
      shellVisible: node.classList.contains('selected') &&
        nodeStyle.display !== 'none' && nodeStyle.visibility !== 'hidden' && Number(nodeStyle.opacity) > 0 &&
        shellStyle.display !== 'none' && shellStyle.visibility !== 'hidden' && Number(shellStyle.opacity) > 0 &&
        shell.getClientRects().length > 0 &&
        Boolean(shell.querySelector<HTMLElement>('.card-head')?.getClientRects().length) &&
        Boolean(shell.querySelector<HTMLElement>('.card-title-display')?.getClientRects().length),
      chromeVisible: [...ports, ...handles].every((element) => {
        const style = getComputedStyle(element)
        return element.isConnected &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0 &&
          element.getClientRects().length > 0
      }),
      portGeometry: ports.map(relativeGeometry),
      handleGeometry: handles.map(relativeGeometry),
      headingCount: root.querySelectorAll('h2').length,
      linkCount: root.querySelectorAll('a[href]').length,
      listItemCount: root.querySelectorAll('li').length,
      codeCount: root.querySelectorAll('code').length,
    }
  }, {
    cardId: GIANT_NOTE_ID,
    middleSentinel: MIDDLE_SENTINEL,
    sentinels: [START_SENTINEL, MIDDLE_SENTINEL, END_SENTINEL],
    fillerPhrases: [FIRST_FILL_PHRASE, SECOND_FILL_PHRASE],
    fillPadding: FILL_PADDING,
  })
}

function expectContinuity(actual: ContinuitySnapshot, expected: ContinuitySnapshot) {
  expect(actual.sameCoreIdentity).toBe(true)
  expect(actual.sameIdentity).toBe(true)
  expect(actual.connected).toBe(true)
  expect(actual.semanticVisible).toBe(true)
  expect(actual.semanticHidden).toBe(false)
  expect(actual.completeStateLength).toBe(GIANT_NOTE_LENGTH)
  expect(actual.hasEverySentinel).toBe(true)
  expect(actual.renderedTextLength).toBe(expected.renderedTextLength)
  expect(actual.renderedHasEverySentinel).toBe(true)
  expect(actual.fillerCountsMatch).toBe(true)
  expect(actual.paddingCountMatches).toBe(true)
  expect(actual.shellVisible).toBe(true)
  expect(actual.chromeVisible).toBe(true)
  expect(actual.portGeometry).toEqual(expected.portGeometry)
  expect(actual.handleGeometry).toEqual(expected.handleGeometry)
  expect(actual.headingCount).toBe(expected.headingCount)
  expect(actual.linkCount).toBe(expected.linkCount)
  expect(actual.listItemCount).toBe(expected.listItemCount)
  expect(actual.codeCount).toBe(expected.codeCount)
  for (const key of [
    'bodyWidth',
    'bodyHeight',
    'bodyScrollWidth',
    'bodyScrollHeight',
    'bodyClientWidth',
    'bodyClientHeight',
    'nodeWidth',
    'nodeHeight',
    'shellWidth',
    'shellHeight',
    'scrollLeft',
    'scrollTop',
    'maxScrollLeft',
    'maxScrollTop',
    'anchorOffset',
  ] as const) expect(actual[key]).toBe(expected[key])
  expect(actual.anchorText).toBe(expected.anchorText)
}

async function dragCardByMouse(page: Page, node: Locator, dx: number, dy: number) {
  const before = await cardPosition(page)
  const surfaceBefore = await nativeSurfaceState(page)
  const from = await cardOwnDragPoint(node)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let step = 1; step <= 4; step += 1) {
    await page.mouse.move(from.x + (dx * step) / 4, from.y + (dy * step) / 4)
  }
  const held = await nativeSurfaceState(page)
  expect(held).toEqual(surfaceBefore)
  await page.mouse.up()
  await expect.poll(async () => {
    const after = await cardPosition(page)
    const movedX = after.x - before.x
    const movedY = after.y - before.y
    return Math.sign(movedX) === Math.sign(dx) && Math.abs(movedX) > Math.abs(dx) * 0.5 &&
      Math.sign(movedY) === Math.sign(dy) && Math.abs(movedY) > Math.abs(dy) * 0.5
  }).toBe(true)
}

async function dragCardByTouch(
  page: Page,
  cdp: CDPSession,
  node: Locator,
  dx: number,
  dy: number,
) {
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  const before = await cardPosition(page)
  const surfaceBefore = await nativeSurfaceState(page)
  const from = await cardOwnDragPoint(node)
  const touchPoint = (x: number, y: number) => ({
    x,
    y,
    id: 1,
    radiusX: 1,
    radiusY: 1,
    force: 1,
  })
  let ended = false
  try {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [touchPoint(from.x, from.y)],
    })
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    for (let step = 1; step <= 4; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [touchPoint(
          from.x + (dx * step) / 4,
          from.y + (dy * step) / 4,
        )],
      })
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    }
    expect(await nativeSurfaceState(page)).toEqual(surfaceBefore)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    ended = true
  } finally {
    if (!ended) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {})
    }
  }
  await expect.poll(async () => {
    const after = await cardPosition(page)
    const movedX = after.x - before.x
    const movedY = after.y - before.y
    return Math.sign(movedX) === Math.sign(dx) && Math.abs(movedX) > Math.abs(dx) * 0.5 &&
      Math.sign(movedY) === Math.sign(dy) && Math.abs(movedY) > Math.abs(dy) * 0.5
  }).toBe(true)
}

async function cardOwnDragPoint(node: Locator) {
  const box = await node.locator('.card-head').boundingBox()
  if (!box) throw new Error('Missing giant Note head')
  // The shared Card head reserves its top padding as the drag surface while
  // title and colour controls below it remain `nodrag`.
  return { x: box.x + box.width / 2, y: box.y + 3 }
}

async function cardPosition(page: Page) {
  return page.evaluate((cardId) => {
    const card = (window as unknown as { __eido: EidoDevStore }).__eido
      .getState()
      .cards.find(({ id }) => id === cardId)
    if (!card) throw new Error('Missing giant Note position')
    return card.position
  }, GIANT_NOTE_ID)
}

async function nativeSurfaceState(page: Page) {
  return page.evaluate((cardId) => {
    const remembered = (window as unknown as {
      __EIDO_GIANT_NATIVE_IDENTITY__?: {
        node: HTMLElement
        shell: HTMLElement
        selectedChrome: HTMLElement
        head: HTMLElement
        title: HTMLElement
        body: HTMLElement
        root: HTMLElement
        ports: Element[]
        handles: Element[]
      }
    }).__EIDO_GIANT_NATIVE_IDENTITY__
    const node = document.querySelector<HTMLElement>(`.react-flow__node-note[data-id="${cardId}"]`)
    const shell = node?.querySelector<HTMLElement>('.card')
    const selectedChrome = node?.querySelector<HTMLElement>('.card-resize-layer')
    const head = node?.querySelector<HTMLElement>('.card-head')
    const title = node?.querySelector<HTMLElement>('.card-title-display')
    const body = node?.querySelector<HTMLElement>('.note-body')
    const root = node?.querySelector<HTMLElement>('.note-render.markdown')
    const ports = Array.from(node?.querySelectorAll<HTMLElement>('.react-flow__handle') ?? [])
    const handles = Array.from(node?.querySelectorAll<HTMLElement>('.card-resize-handle') ?? [])
    if (!remembered || !node || !shell || !selectedChrome || !head || !title || !body || !root) {
      throw new Error('Missing native surface')
    }
    const style = getComputedStyle(root)
    const nodeStyle = getComputedStyle(node)
    const shellStyle = getComputedStyle(shell)
    const visible = (element: HTMLElement) => {
      const elementStyle = getComputedStyle(element)
      return element.isConnected &&
        elementStyle.display !== 'none' &&
        elementStyle.visibility !== 'hidden' &&
        Number(elementStyle.opacity) > 0 &&
        element.getClientRects().length > 0
    }
    const shellRect = shell.getBoundingClientRect()
    const relativeBounds = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect()
      const cssTenth = (value: number) => Math.round(value * 10) / 10
      return [
        cssTenth(rect.left - shellRect.left),
        cssTenth(rect.top - shellRect.top),
        cssTenth(rect.width),
        cssTenth(rect.height),
      ].join(':')
    }
    return {
      sameIdentity: remembered.node === node && remembered.shell === shell &&
        remembered.selectedChrome === selectedChrome && remembered.head === head &&
        remembered.title === title && remembered.body === body && remembered.root === root &&
        remembered.ports.length === ports.length && remembered.handles.length === handles.length &&
        remembered.ports.every((port, index) => port === ports[index]) &&
        remembered.handles.every((handle, index) => handle === handles[index]),
      connected: [node, shell, selectedChrome, head, title, body, root, ...ports, ...handles]
        .every((element) => element.isConnected),
      semanticVisible: nodeStyle.display !== 'none' && nodeStyle.visibility !== 'hidden' &&
        Number(nodeStyle.opacity) > 0 && shellStyle.display !== 'none' &&
        shellStyle.visibility !== 'hidden' && Number(shellStyle.opacity) > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 &&
        shell.getClientRects().length > 0 && root.getClientRects().length > 0,
      semanticHidden: root.inert || root.getAttribute('aria-hidden') === 'true' ||
        Boolean(root.closest('[aria-hidden="true"]')),
      selected: node.classList.contains('selected') && shell.classList.contains('selected'),
      headVisible: visible(head),
      titleVisible: visible(title),
      selectedChromeVisible: visible(selectedChrome),
      portsVisible: ports.every(visible),
      handlesVisible: handles.every(visible),
      headBounds: relativeBounds(head),
      titleBounds: relativeBounds(title),
      selectedChromeBounds: relativeBounds(selectedChrome),
      portBounds: ports.map(relativeBounds),
      handleBounds: handles.map(relativeBounds),
    }
  }, GIANT_NOTE_ID)
}

async function selectAndCopySemanticRange(page: Page, node: Locator) {
  const body = node.locator('.note-body')
  await body.evaluate((element) => { element.scrollTop = 0 })
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0)
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  const endpoints = await node.locator('.note-render.markdown').evaluate((root) => {
    const prose = Array.from(root.querySelectorAll('p')).find(
      (candidate) => candidate.textContent?.includes('Structured synthetic prose'),
    )
    const code = root.querySelector('pre code')
    if (!prose || !code) throw new Error('Missing giant Note copy descendants')
    const firstText = prose.firstChild
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
    let lastText: Node | null = null
    for (let candidate = walker.nextNode(); candidate; candidate = walker.nextNode()) {
      if (candidate.textContent?.length) lastText = candidate
    }
    if (!(firstText instanceof Text) || !(lastText instanceof Text)) {
      throw new Error('Missing giant Note text selection endpoints')
    }
    const startRange = document.createRange()
    startRange.setStart(firstText, 0)
    startRange.setEnd(firstText, Math.min(1, firstText.length))
    const endRange = document.createRange()
    endRange.setStart(lastText, Math.max(0, lastText.length - 1))
    endRange.setEnd(lastText, lastText.length)
    const start = startRange.getBoundingClientRect()
    const end = endRange.getBoundingClientRect()
    if (!start.width || !start.height || !end.width || !end.height) {
      throw new Error('Giant Note pointer-selection endpoints are not visible')
    }
    return {
      start: { x: start.left + 1, y: start.top + start.height / 2 },
      end: { x: end.right - 1, y: end.top + end.height / 2 },
    }
  })
  await page.mouse.move(endpoints.start.x, endpoints.start.y)
  await page.mouse.down()
  await page.mouse.move(endpoints.end.x, endpoints.end.y, { steps: 12 })
  await page.mouse.up()
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
  expect(selected).toContain('Structured synthetic prose keeps the passive Note representative.')
  expect(selected).toContain('One deterministic bullet exercises Markdown descendants.')
  expect(selected).toContain('Another keeps selection and cursor styling honest.')
  expect(selected).toContain("const nativeIdentity = 'stable';")
  const modifier = await page.evaluate(() => (/Mac/.test(navigator.platform) ? 'Meta' : 'Control'))
  await page.keyboard.press(`${modifier}+C`)
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toBe(selected)
  return selected
}

async function expectWindowFindSmokeTargets(page: Page) {
  for (const target of [START_SENTINEL, MIDDLE_SENTINEL, END_SENTINEL]) {
    const found = await page.evaluate(({ cardId, text }) => {
      const selection = window.getSelection()
      selection?.removeAllRanges()
      const browserWindow = window as unknown as { find?: (value: string) => boolean }
      if (browserWindow.find?.(text) !== true) return false
      const anchor = window.getSelection()?.anchorNode
      const root = document.querySelector(`.react-flow__node-note[data-id="${cardId}"] .note-render.markdown`)
      return Boolean(anchor && root?.contains(anchor))
    }, { cardId: GIANT_NOTE_ID, text: target })
    expect(found, `window.find smoke must resolve ${target} inside the same native root`).toBe(true)
  }
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
}

type AxSignature = Array<{
  role: string
  name: string
  selected: boolean | null
  focused: boolean | null
}>

async function accessibilitySignature(cdp: CDPSession): Promise<AxSignature> {
  await cdp.send('Accessibility.enable')
  const evaluated = await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector('.react-flow__node-note[data-id="${GIANT_NOTE_ID}"]')`,
    objectGroup: 'eido-giant-native-semantics',
  })
  const objectId = evaluated.result.objectId
  if (!objectId) throw new Error('Missing giant Note CDP object id')
  const response = await cdp.send('Accessibility.queryAXTree', { objectId })
  const meaningfulRoles = new Set([
    'group',
    'heading',
    'link',
    'button',
    'textbox',
    'list',
    'listitem',
    'code',
  ])
  return response.nodes
    .filter((node) => !node.ignored && meaningfulRoles.has(String(node.role?.value ?? '')))
    .map((node) => ({
      role: String(node.role?.value ?? ''),
      name: String(node.name?.value ?? '').slice(0, 160),
      selected: (node.properties?.find((property) => property.name === 'selected')
        ?.value?.value as boolean | undefined) ?? null,
      focused: (node.properties?.find((property) => property.name === 'focused')
        ?.value?.value as boolean | undefined) ?? null,
    }))
}

function expectAccessibleStructure(signature: AxSignature) {
  const indexOf = (role: string, name?: string) => signature.findIndex((entry) => (
    entry.role === role && (name === undefined || entry.name === name)
  ))
  const group = indexOf('group', 'Note: Giant native semantics, Selected')
  const titleControl = indexOf('button', 'Note title')
  const body = indexOf('textbox', 'Note body')
  const start = indexOf('heading', START_SENTINEL)
  const link = indexOf('link', 'passive Note')
  const list = indexOf('list')
  const listItems = signature.filter(({ role }) => role === 'listitem')
  const code = indexOf('code')
  const middle = indexOf('heading', MIDDLE_SENTINEL)
  const end = indexOf('heading', END_SENTINEL)

  expect(group).toBeGreaterThanOrEqual(0)
  expect(titleControl).toBeGreaterThan(group)
  expect(body).toBeGreaterThan(titleControl)
  expect(start).toBeGreaterThan(body)
  expect(link).toBeGreaterThan(start)
  expect(list).toBeGreaterThan(link)
  expect(listItems).toHaveLength(2)
  expect(code).toBeGreaterThan(list)
  expect(middle).toBeGreaterThan(code)
  expect(end).toBeGreaterThan(middle)
}

async function focusOrder(node: Locator) {
  return node.evaluate((element) => Array.from(element.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((candidate) => getComputedStyle(candidate).display !== 'none').map((candidate) => ({
    tag: candidate.tagName,
    label: candidate.getAttribute('aria-label') ?? candidate.textContent?.trim().slice(0, 80) ?? '',
    href: candidate.getAttribute('href'),
  })))
}

test('the first body drag of a 1M Note moves it without selecting or opening the editor', async ({ page }) => {
  const node = await seedGiantNote(page)
  const passive = node.locator('.note-render.markdown')
  const bodyBox = await passive.boundingBox()
  if (!bodyBox) throw new Error('Missing giant Note passive body')

  const start = await page.evaluate((cardId) => {
    const state = (window as unknown as { __eido: EidoDevStore }).__eido.getState()
    return state.cards.find(({ id }) => id === cardId)?.position
  }, GIANT_NOTE_ID)
  if (!start) throw new Error('Missing giant Note position')

  // Exercise the armed editing surface itself: travel beyond five pixels must
  // cancel the queued caret intent while React Flow owns only the geometry
  // drag. Oversized passive Cards do not promote, select, or show a loading
  // transition until a stationary click resolves.
  const from = { x: bodyBox.x + bodyBox.width - 18, y: bodyBox.y + 18 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 90, from.y + 30, { steps: 3 })

  await expect(node).not.toHaveClass(/selected/)
  await expect(node).not.toHaveAttribute('data-live-transition')
  await expect(node.locator('.note-render.markdown')).toBeVisible()
  await expect(node.locator('.markdown-card-editor-transition')).toHaveCount(0)

  await page.mouse.up()
  await expect.poll(() => page.evaluate((cardId) => {
    const state = (window as unknown as { __eido: EidoDevStore }).__eido.getState()
    return state.cards.find(({ id }) => id === cardId)?.position.x ?? Number.NEGATIVE_INFINITY
  }, GIANT_NOTE_ID)).toBeGreaterThan(start.x + 40)
  await expect.poll(() => page.evaluate(
    () => (window as unknown as { __eido: EidoDevStore }).__eido.getState().selectedCardIds,
  )).toEqual([])
  await expect(node).not.toHaveClass(/selected/)
  await expect(node).not.toHaveAttribute('data-live-transition')
  await expect(node.locator('.note-render.markdown')).toBeVisible()
  await expect(node.locator('.markdown-card-editor-transition')).toHaveCount(0)

  const paragraph = node.locator('.note-render p').first()
  const link = paragraph.getByRole('link', { name: 'passive Note' })
  await expect(paragraph).toHaveCSS('cursor', 'default')
  await expect(paragraph).toHaveCSS('user-select', 'none')
  await expect(link).toHaveCSS('cursor', 'pointer')
})

test('one complete native 1M Note retains semantics across repeated own-drags', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const node = await seedGiantNote(page)
  await selectGiantNote(page, node)
  await positionMiddleAnchor(node)

  const identityCounts = await rememberNativeIdentity(page)
  expect(identityCounts.portCount).toBeGreaterThan(0)
  expect(identityCounts.handleCount).toBeGreaterThan(0)
  const before = await continuitySnapshot(page)
  expect(before.scrollTop).toBeGreaterThan(1_000)
  expect(before.maxScrollTop).toBeGreaterThan(before.scrollTop)
  expect(before.headingCount).toBe(3)
  expect(before.linkCount).toBe(1)
  expect(before.listItemCount).toBe(2)
  expect(before.codeCount).toBe(1)
  expect(before.renderedTextLength).toBeGreaterThan(999_500)
  expectContinuity(before, before)

  const focusOrderBefore = await focusOrder(node)
  expect(focusOrderBefore.some(({ label }) => label === 'Note body')).toBe(true)
  expect(focusOrderBefore.some(({ label }) => label === 'Note title')).toBe(true)
  expect(focusOrderBefore.some(({ label }) => label === 'passive Note')).toBe(true)

  const cdp = await context.newCDPSession(page)
  await node.focus()
  await expect(node).toBeFocused()
  const axBefore = await accessibilitySignature(cdp)
  expectAccessibleStructure(axBefore)
  expect(axBefore.some(({ role, name }) => (
    role === 'group' && name === 'Note: Giant native semantics, Selected'
  ))).toBe(true)
  expect(axBefore.filter(({ role }) => role === 'heading').map(({ name }) => name)).toEqual([
    START_SENTINEL,
    MIDDLE_SENTINEL,
    END_SENTINEL,
  ])
  expect(axBefore.some(({ role, name }) => role === 'link' && name === 'passive Note')).toBe(true)
  expect(axBefore.some(({ role, name }) => role === 'textbox' && name === 'Note body')).toBe(true)

  // `window.find` is only an automatable smoke over the unchanged complete
  // visible DOM. Native browser-toolbar Find is inherited from that ordinary
  // DOM authority; this test does not claim to automate Chromium chrome.
  await expectWindowFindSmokeTargets(page)
  await positionMiddleAnchor(node)
  const selectedBefore = await selectAndCopySemanticRange(page, node)
  await positionMiddleAnchor(node)
  await node.focus()
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe(selectedBefore)
  const focusedBeforeDrags = await page.evaluateHandle(() => document.activeElement)
  const axBeforeDrags = await accessibilitySignature(cdp)

  for (const [dx, dy] of [
    [68, 22],
    [-54, 18],
    [46, -16],
    [-38, -12],
  ] as const) {
    await dragCardByMouse(page, node, dx, dy)
    expect(await page.evaluate(
      (focused) => document.activeElement === focused,
      focusedBeforeDrags,
    )).toBe(true)
    expect(await accessibilitySignature(cdp)).toEqual(axBeforeDrags)
    const afterCycle = await continuitySnapshot(page)
    expectContinuity(afterCycle, before)
  }
  await focusedBeforeDrags.dispose()

  // An existing native Range is an explicit fail-open condition: even while
  // the Card itself moves, Eido keeps the complete ordinary DOM as authority.
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe(selectedBefore)
  expect(await selectAndCopySemanticRange(page, node)).toBe(selectedBefore)
  await page.evaluate(() => window.getSelection()?.removeAllRanges())

  await expectWindowFindSmokeTargets(page)
  await positionMiddleAnchor(node)
  expectContinuity(await continuitySnapshot(page), before)
  expect(await focusOrder(node)).toEqual(focusOrderBefore)
  const withoutFocus = (signature: AxSignature) => signature.map(({ focused: _focused, ...entry }) => entry)
  expect(withoutFocus(await accessibilitySignature(cdp))).toEqual(withoutFocus(axBeforeDrags))
})

test('native targets, highlighting, and exact caret work on the first interaction after giant drags', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000)
  const node = await seedGiantNote(page)
  await selectGiantNote(page, node)
  await positionMiddleAnchor(node)
  await rememberNativeIdentity(page)
  const before = await continuitySnapshot(page)
  const focusOrderBefore = await focusOrder(node)
  for (const [dx, dy] of [[52, 18], [-44, -14]] as const) {
    await dragCardByMouse(page, node, dx, dy)
    expectContinuity(await continuitySnapshot(page), before)
  }

  const nativeLink = node.getByRole('link', { name: 'passive Note' })
  await node.locator('.note-body').evaluate((body) => { body.scrollTop = 0 })
  await context.route('https://example.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>Synthetic trusted target</title>',
  }))
  const pagesBefore = context.pages().length
  const popupPromise = page.waitForEvent('popup')
  await nativeLink.click()
  const popup = await popupPromise
  await expect(popup).toHaveURL('https://example.com/')
  expect(context.pages()).toHaveLength(pagesBefore + 1)
  await popup.close()

  // Keyboard traversal starts from the real Card group and enters the same
  // descendant order recorded before motion; no gesture proxy is focusable.
  await node.focus()
  await expect(node).toBeFocused()
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')))
    .toBe(focusOrderBefore[0]?.label)
  const titleButton = node.getByRole('button', { name: 'Note title' })
  await titleButton.focus()
  await page.keyboard.press('Enter')
  const titleInput = node.getByRole('textbox', { name: 'Note title' })
  await expect(titleInput).toBeVisible()
  await expect(titleInput).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(titleInput).toHaveCount(0)

  // Highlighting composes with the same giant root after motion. Use a native
  // Range over one exact list descendant, then let the real pointer-release
  // listener persist and repaint it.
  await page.evaluate(() => {
    const store = (window as unknown as { __eido: EidoDevStore }).__eido
    store.setState({ activeTool: 'highlight' })
  })
  const root = node.locator('.note-render.markdown')
  await expect(root).toHaveClass(/nodrag/)
  const highlightText = 'One deterministic bullet exercises Markdown descendants.'
  await root.evaluate((element, targetText) => {
    const target = Array.from(element.querySelectorAll('li')).find(
      (candidate) => candidate.textContent === targetText,
    )
    if (!target) throw new Error('Missing giant Note highlight target')
    const range = document.createRange()
    range.selectNodeContents(target)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    element.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      buttons: 1,
      pointerType: 'mouse',
    }))
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      pointerType: 'mouse',
    }))
  }, highlightText)
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __eido: EidoDevStore }
  ).__eido.getState().highlights)).toEqual([
    expect.objectContaining({ cardId: GIANT_NOTE_ID, text: highlightText, occurrence: 0 }),
  ])
  await expect(root.locator('mark.painted-highlight')).toHaveText(highlightText)
  const afterHighlight = await continuitySnapshot(page)
  expect(afterHighlight.sameCoreIdentity).toBe(true)
  expect(afterHighlight.semanticVisible).toBe(true)
  expect(afterHighlight.semanticHidden).toBe(false)
  expect(afterHighlight.renderedTextLength).toBe(before.renderedTextLength)

  // The first stationary post-drag body interaction targets the actual editor
  // and exact caret. It is delivered once; no replay or second click is needed.
  await page.evaluate(() => {
    const store = (window as unknown as { __eido: EidoDevStore }).__eido
    store.setState({ activeTool: 'select' })
  })
  await selectGiantNote(page, node)
  const passiveHeading = node.locator('.note-render h2').first()
  const headingBox = await passiveHeading.boundingBox()
  if (!headingBox) throw new Error('Missing giant Note heading bounds')
  const { editor, pressSequentially } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    `.react-flow__node-note[data-id="${GIANT_NOTE_ID}"]`,
    () => passiveHeading.click({ position: { x: Math.min(180, headingBox.width - 4), y: 10 } }),
  )
  await expect(editor).toBeFocused()
  await expect(node.locator('.markdown-card-editor-transition')).toHaveCount(1)
  const caret = await editor.evaluate((element) => {
    const heading = element.querySelector('h2')
    const selection = window.getSelection()
    const anchor = selection?.anchorNode
    if (!heading || !selection || selection.rangeCount !== 1 || !anchor || !heading.contains(anchor)) {
      return null
    }
    const beforeRange = document.createRange()
    beforeRange.selectNodeContents(heading)
    beforeRange.setEnd(anchor, selection.anchorOffset)
    const before = beforeRange.toString()
    const text = heading.textContent ?? ''
    return { before, after: text.slice(before.length) }
  })
  expect(caret).not.toBeNull()
  expect(caret!.before.length).toBeGreaterThan(0)
  expect(caret!.after.length).toBeGreaterThan(0)
  const inserted = ' POST-DRAG-CARET '
  await pressSequentially(inserted, { delay: 0 })
  await expect(editor.locator('h2').first()).toHaveText(`${caret!.before}${inserted}${caret!.after}`)
})

test('real CDP touch drag in coarse no-hover mode keeps the complete native giant Note', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000)
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()
  try {
    const node = await seedGiantNote(page)
    expect(await page.evaluate(() => ({
      coarse: matchMedia('(pointer: coarse)').matches,
      noHover: matchMedia('(hover: none)').matches,
    }))).toEqual({ coarse: true, noHover: true })

    const headBox = await node.locator('.card-head').boundingBox()
    if (!headBox) throw new Error('Missing touch giant Note head')
    await page.touchscreen.tap(headBox.x + headBox.width / 2, headBox.y + 4)
    await expect(node).toHaveClass(/selected/)
    await waitForSelectedChromeReady(node)
    await positionMiddleAnchor(node)
    await rememberNativeIdentity(page)
    const before = await continuitySnapshot(page)
    expect(before.renderedTextLength).toBeGreaterThan(999_500)
    expectContinuity(before, before)

    const cdp = await context.newCDPSession(page)
    await dragCardByTouch(page, cdp, node, 72, 24)
    expectContinuity(await continuitySnapshot(page), before)

    // This is an automatable window.find smoke over the unchanged complete
    // visible DOM, not a claim that Playwright drove Chromium toolbar chrome.
    await expectWindowFindSmokeTargets(page)
    const root = node.locator('.note-render.markdown')
    await expect(root).toHaveCSS('user-select', 'text')
    await expect(root).toHaveAttribute('aria-label', 'Note body')
    await expect(root).not.toHaveAttribute('aria-hidden', 'true')
  } finally {
    await context.close()
  }
})
