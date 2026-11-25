import { expect, test, type Locator, type Page } from '@playwright/test'

type ModState = {
  kind: string
  state: { picked?: number; perm?: number[] }
}

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    currentIdeaId: string
    cards: Array<{
      id: string
      position: { x: number; y: number }
      modV2?: ModState
    }>
    undoStack: unknown[]
    undo: () => void
  }
  setState: (state: unknown) => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

const card = (id: string, x: number, kind: 'select' | 'order') => ({
  id,
  kind: 'mod',
  blocks: [{ id: `${id}-block`, text: '' }],
  position: { x, y: 180 },
  size: { width: 320, height: kind === 'order' ? 330 : 240 },
  zIndex: kind === 'order' ? 2 : 1,
  modV2: kind === 'select'
    ? {
        kind,
        title: 'Audience',
        accent: '#59729A',
        treatOverride: null,
        state: {
          picked: 0,
          options: [
            { id: 'select-a', label: 'Experts', frame: '{value}' },
            { id: 'select-b', label: 'General', frame: '{value}' },
            { id: 'select-c', label: 'Newcomers', frame: '{value}' },
          ],
        },
      }
    : {
        kind,
        title: 'Priorities',
        accent: '#9B6B43',
        treatOverride: null,
        state: {
          frame: '{value}',
          perm: [0, 1, 2],
          items: [
            { id: 'order-a', label: 'Clarity', frame: '{value}' },
            { id: 'order-b', label: 'Speed', frame: '{value}' },
            { id: 'order-c', label: 'Depth', frame: '{value}' },
          ],
        },
      },
})

async function seedBoard(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const app = window as unknown as DevWindow
    return Boolean(app.__eido?.getState().hydrated && app.__EIDO_SET_VIEWPORT__)
  })
  await page.evaluate(([select, order]) => {
    const app = window as unknown as DevWindow & { __eido: EidoDevStore }
    app.__eido.setState({
      cards: [select, order],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      selection: { kind: 'card', id: select.id },
      selectedCardIds: [select.id],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
  }, [card('select-mod', 120, 'select'), card('order-mod', 560, 'order')])
}

async function setZoom(page: Page, zoom: number) {
  for (let pin = 0; pin < 2; pin += 1) {
    await page.evaluate((nextZoom) => {
      ;(window as unknown as DevWindow).__EIDO_SET_VIEWPORT__?.({ x: 40, y: 40, zoom: nextZoom })
    }, zoom)
    await page.waitForTimeout(250)
  }
}

async function selectOnly(page: Page, cardId: string) {
  await page.evaluate(() => {
    const store = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
    store.setState({
      undoStack: [],
      redoStack: [],
    })
  })
  const node = page.locator(`[data-id="${cardId}"]`)
  const head = node.locator('.card-head')
  const box = await head.boundingBox()
  if (!box) throw new Error(`Missing ${cardId} header`)
  await page.mouse.click(box.x + box.width / 2, box.y + 4)
  await expect(page.locator(`[data-id="${cardId}"] .mod-face-host`)).toHaveAttribute('aria-disabled', 'false')
}

async function dragBetween(page: Page, from: Locator, to: Locator) {
  const start = await from.boundingBox()
  const end = await to.boundingBox()
  if (!start || !end) throw new Error('Missing Mod gesture geometry')
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 })
  await page.waitForTimeout(50)
  await page.mouse.up()
}

function boardMotion(page: Page, cardId: string) {
  return page.evaluate((id) => {
    const store = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
    const position = store.getState().cards.find((candidate) => candidate.id === id)!.position
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform ?? ''
    return { position, viewport }
  }, cardId)
}

function modState(page: Page, cardId: string) {
  return page.evaluate((id) => {
    const store = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
    const state = store.getState()
    return {
      mod: state.cards.find((candidate) => candidate.id === id)!.modV2,
      undoCount: state.undoStack.length,
    }
  }, cardId)
}

for (const zoom of [0.75, 1.35]) {
  test(`Select and Order stay zoom-invariant at ${zoom}x with one commit and no Board motion`, async ({ page }) => {
    await seedBoard(page)
    await setZoom(page, zoom)

    await selectOnly(page, 'select-mod')
    const selectNode = page.locator('[data-id="select-mod"]')
    const radios = selectNode.getByRole('radio')
    const selectBefore = await boardMotion(page, 'select-mod')
    await dragBetween(page, radios.nth(0), radios.nth(2))
    await expect.poll(async () => (await modState(page, 'select-mod')).mod?.state.picked).toBe(2)
    expect(await boardMotion(page, 'select-mod')).toEqual(selectBefore)
    expect((await modState(page, 'select-mod')).undoCount).toBe(1)
    await page.evaluate(() => {
      ;(window as unknown as DevWindow & { __eido: EidoDevStore }).__eido.getState().undo()
    })
    await expect.poll(async () => (await modState(page, 'select-mod')).mod?.state.picked).toBe(0)

    await selectOnly(page, 'order-mod')
    const orderNode = page.locator('[data-id="order-mod"]')
    const items = orderNode.getByRole('listitem')
    const orderBefore = await boardMotion(page, 'order-mod')
    await dragBetween(page, items.nth(0), items.nth(2))
    await expect.poll(async () => (await modState(page, 'order-mod')).mod?.state.perm).toEqual([1, 2, 0])
    expect(await boardMotion(page, 'order-mod')).toEqual(orderBefore)
    expect((await modState(page, 'order-mod')).undoCount).toBe(1)
  })
}

test('a live face survives Reading departure, tears down after release, and reloads its committed value', async ({ page }) => {
  await seedBoard(page)
  await setZoom(page, 0.8)
  await selectOnly(page, 'select-mod')
  const radios = page.locator('[data-id="select-mod"]').getByRole('radio')
  const start = await radios.nth(0).boundingBox()
  if (!start) throw new Error('Missing Select geometry')
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()

  await page.evaluate(() => {
    ;(window as unknown as DevWindow).__EIDO_SET_VIEWPORT__?.({ x: 40, y: 40, zoom: 0.2 })
  })
  await expect(page.locator('[data-id="select-mod"] .mod-face-host')).toBeAttached()

  await page.mouse.up()
  await expect(page.locator('[data-id="select-mod"] .mod-face-host')).toHaveCount(0)

  await setZoom(page, 0.8)
  await selectOnly(page, 'select-mod')
  await dragBetween(page, radios.nth(0), radios.nth(1))
  await expect.poll(async () => (await modState(page, 'select-mod')).mod?.state.picked).toBe(1)
  const ideaId = await page.evaluate(() => (
    window as unknown as DevWindow & { __eido: EidoDevStore }
  ).__eido.getState().currentIdeaId)
  await expect.poll(async () => {
    const response = await page.request.get(`/api/eido/ideas/${encodeURIComponent(ideaId)}`)
    const { board } = await response.json() as {
      board: { cards: Array<{ id: string; modV2?: ModState }> }
    }
    return board.cards.find((candidate) => candidate.id === 'select-mod')?.modV2?.state.picked
  }).toBe(1)
  await page.reload()
  await page.waitForFunction(() => Boolean((window as unknown as DevWindow).__eido?.getState().hydrated))
  await expect.poll(async () => (await modState(page, 'select-mod')).mod?.state.picked).toBe(1)
})
