import { expect, test, type Page } from '@playwright/test'

type DevWindow = {
  __eido?: { getState: () => { hydrated: boolean }; setState: (state: unknown) => void }
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

async function seedLongResultAfterViewportSettles(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'ask',
          kind: 'askAi',
          blocks: [{ id: 'ask-block', text: 'Question' }],
          position: { x: 100, y: 100 },
        },
      ],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      visualDecayEnabled: false,
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
  })

  const ask = page.locator('.react-flow__node[data-id="ask"] .card')
  await expect(ask).toBeVisible()
  // Let the Board's one-time initial fit finish before establishing the
  // viewport a user would actually press Run from.
  await page.waitForTimeout(180)
  const board = page.locator('.board-flow')
  const boardTop = await board.evaluate((element) => element.getBoundingClientRect().top)
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__!({ x: 0, y: 0, zoom: 1 })
  })
  await expect
    .poll(() => ask.evaluate((element) => element.getBoundingClientRect().top))
    .toBeCloseTo(boardTop + 100, 0)

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    const longAnswer = Array.from({ length: 80 }, (_, index) => `Streaming line ${index + 1}.`).join('\n\n')
    devWindow.__eido.setState({
      cards: [
        {
          id: 'ask',
          kind: 'askAi',
          blocks: [{ id: 'ask-block', text: 'Question' }],
          position: { x: 100, y: 100 },
        },
        {
          id: 'result',
          kind: 'result',
          blocks: [{ id: 'result-block', text: '' }],
          position: { x: 420, y: 100 },
        },
        {
          id: 'blocker',
          kind: 'note',
          blocks: [{ id: 'blocker-block', text: 'Existing thought below the result.' }],
          position: { x: 420, y: 360 },
          size: { width: 260, height: 180 },
        },
      ],
      connections: [
        {
          id: 'ask-result',
          from: { cardId: 'ask' },
          to: { cardId: 'result' },
          strength: 'strong',
          polarity: 'helps',
          role: 'feeds',
        },
      ],
      outputs: [
        {
          id: 'output',
          resultCardId: 'result',
          chosenVersionId: 'version',
          versions: [
            {
              id: 'version',
              number: 1,
              text: longAnswer,
              createdAt: '2026-07-15T00:00:00.000Z',
              fromRunId: 'run',
            },
          ],
        },
      ],
    })
  })

  const card = page.locator('.react-flow__node[data-id="result"] .card')
  await expect(card).toBeVisible()
  await expect
    .poll(async () => {
      const bounds = await Promise.all([
        card.evaluate((element) => element.getBoundingClientRect().bottom),
        board.evaluate((element) => element.getBoundingClientRect().bottom),
      ])
      return bounds[1] - bounds[0]
    })
    .toBeGreaterThanOrEqual(198)
  const blocker = page.locator('.react-flow__node[data-id="blocker"] .card')
  await expect(blocker).toBeVisible()
  return { board, card, blocker }
}

test('an auto-sized Result keeps its established height when the viewport pans', async ({ page }) => {
  const { card } = await seedLongResultAfterViewportSettles(page)
  const initialBounds = await card.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { top: rect.top, height: rect.height }
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__!({ x: 0, y: -180, zoom: 1 })
  })
  await expect
    .poll(() => card.evaluate((element) => element.getBoundingClientRect().top))
    .toBeCloseTo(initialBounds.top - 180, 0)

  const pannedHeight = await card.evaluate((element) => element.getBoundingClientRect().height)
  expect(pannedHeight).toBeCloseTo(initialBounds.height, 0)
})

test('an auto-sized Result leaves at least 30px of viewport space and scrolls its body', async ({ page }) => {
  const { board, card } = await seedLongResultAfterViewportSettles(page)
  const layout = await card.evaluate((element) => {
    const body = element.querySelector<HTMLElement>('.card-body')
    if (!body) throw new Error('Missing Result body')
    const board = element.closest<HTMLElement>('.board-flow')
    if (!board) throw new Error('Missing board')
    return {
      cardBottom: element.getBoundingClientRect().bottom,
      boardBottom: board.getBoundingClientRect().bottom,
      bodyScrollable: body.scrollHeight > body.clientHeight,
      bodyOverflowY: getComputedStyle(body).overflowY,
    }
  })

  expect(layout.cardBottom).toBeLessThanOrEqual(layout.boardBottom - 28)
  expect(layout.bodyScrollable).toBe(true)
  expect(layout.bodyOverflowY).toBe('auto')
  await expect(board).toBeVisible()
})

test('an auto-sized Result stops before a Card below it', async ({ page }) => {
  const { card, blocker } = await seedLongResultAfterViewportSettles(page)
  const gap = await Promise.all([
    card.evaluate((element) => element.getBoundingClientRect().bottom),
    blocker.evaluate((element) => element.getBoundingClientRect().top),
  ]).then(([cardBottom, blockerTop]) => blockerTop - cardBottom)

  expect(gap).toBeGreaterThanOrEqual(18)
})

test('an auto-sized Note also stops before a Card below it and scrolls', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    const longNote = Array.from({ length: 80 }, (_, index) => `Growing note line ${index + 1}.`).join('\n\n')
    devWindow.__eido.setState({
      cards: [
        {
          id: 'growing-note',
          kind: 'note',
          blocks: [{ id: 'growing-note-block', text: longNote }],
          position: { x: 100, y: 100 },
        },
        {
          id: 'note-blocker',
          kind: 'note',
          blocks: [{ id: 'note-blocker-block', text: 'Blocker' }],
          position: { x: 100, y: 360 },
          size: { width: 260, height: 180 },
        },
      ],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      visualDecayEnabled: false,
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
  })

  const board = page.locator('.board-flow')
  const note = page.locator('.react-flow__node[data-id="growing-note"] .card')
  const blocker = page.locator('.react-flow__node[data-id="note-blocker"] .card')
  await expect(note).toBeVisible()
  await expect(blocker).toBeVisible()
  await page.waitForTimeout(180)
  const boardTop = await board.evaluate((element) => element.getBoundingClientRect().top)
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__!({ x: 0, y: 0, zoom: 1 })
  })
  await expect
    .poll(() => note.evaluate((element) => element.getBoundingClientRect().top))
    .toBeCloseTo(boardTop + 100, 0)

  const layout = await Promise.all([
    note.evaluate((element) => {
      const body = element.querySelector<HTMLElement>('.card-body')
      if (!body) throw new Error('Missing Note body')
      return {
        bottom: element.getBoundingClientRect().bottom,
        scrollable: body.scrollHeight > body.clientHeight,
        overflowY: getComputedStyle(body).overflowY,
      }
    }),
    blocker.evaluate((element) => element.getBoundingClientRect().top),
  ])

  expect(layout[1] - layout[0].bottom).toBeGreaterThanOrEqual(18)
  expect(layout[0].scrollable).toBe(true)
  expect(layout[0].overflowY).toBe('auto')
})

test('an auto-sized Card uses a 250px preferred height when space permits', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'preferred-height-note',
          kind: 'note',
          blocks: [{ id: 'preferred-height-block', text: 'A short thought.' }],
          position: { x: 100, y: 100 },
        },
        {
          id: 'distant-blocker',
          kind: 'note',
          blocks: [{ id: 'distant-blocker-block', text: 'Far enough below.' }],
          position: { x: 100, y: 500 },
          size: { width: 260, height: 180 },
        },
      ],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      visualDecayEnabled: false,
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
  })

  const card = page.locator('.react-flow__node[data-id="preferred-height-note"] .card')
  await expect(card).toBeVisible()
  await page.waitForTimeout(180)
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__!({ x: 0, y: 0, zoom: 1 })
  })

  await expect.poll(() => card.evaluate((element) => element.getBoundingClientRect().height)).toBeCloseTo(250, 0)
})
