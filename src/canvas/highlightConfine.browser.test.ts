import { expect, test, type Page } from '@playwright/test'

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    highlights: Array<{ cardId: string; text: string; occurrence: number }>
  }
  setState: (state: unknown) => void
}

// Bug #206: with the highlighter out, a drag that starts in one card and
// overshoots into a neighbour must stay confined to the card it started in —
// the selection never picks up the neighbour's text, and release still saves
// the in-card portion.

const CARD_B_WORDS = ['delta', 'echo', 'foxtrot']

async function seedTwoCards(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'card-a',
          kind: 'note',
          blocks: [{ id: 'card-a-block', text: 'alpha bravo charlie' }],
          position: { x: 80, y: 80 },
          zIndex: 1,
        },
        {
          id: 'card-b',
          kind: 'note',
          blocks: [{ id: 'card-b-block', text: 'delta echo foxtrot' }],
          position: { x: 460, y: 80 },
          zIndex: 2,
        },
      ],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      highlights: [],
      visualDecayEnabled: false,
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'highlight',
    })
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 40, y: 40, zoom: 1 })
  })

  const bodyA = page.locator('.react-flow__node[data-id="card-a"] .note-render')
  const bodyB = page.locator('.react-flow__node[data-id="card-b"] .note-render')
  await expect(bodyA).toContainText('alpha bravo charlie')
  await expect(bodyB).toContainText('delta echo foxtrot')
  return { bodyA, bodyB }
}

// Mouse down on card A's first line, drag well into card B's text, leave the
// button held.
async function dragFromAIntoB(page: Page, bodyA: { boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> }, bodyB: { boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> }) {
  const boxA = await bodyA.boundingBox()
  const boxB = await bodyB.boundingBox()
  if (!boxA || !boxB) throw new Error('Missing card text bounds')
  await page.mouse.move(boxA.x + 4, boxA.y + 10)
  await page.mouse.down()
  await page.mouse.move(boxB.x + boxB.width / 2, boxB.y + 10, { steps: 12 })
}

function readHighlights(page: Page) {
  return page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    return devWindow.__eido.getState().highlights
  })
}

function readViewportTransform(page: Page) {
  return page.locator('.react-flow__viewport').evaluate((element) => (
    (element as HTMLElement).style.transform
  ))
}

async function expectCardAHighlightSaved(page: Page) {
  await expect
    .poll(() => readHighlights(page))
    .toEqual([expect.objectContaining({ cardId: 'card-a' })])

  const [saved] = await readHighlights(page)
  expect(saved.text).toContain('charlie')
  for (const word of CARD_B_WORDS) expect(saved.text).not.toContain(word)
  expect('alpha bravo charlie').toContain(saved.text)
}

test('highlight drag that overshoots into a neighbour card stays confined and saves', async ({ page }) => {
  const { bodyA, bodyB } = await seedTwoCards(page)
  await dragFromAIntoB(page, bodyA, bodyB)

  const midDrag = await page.evaluate(() => window.getSelection()?.toString() ?? '')
  expect(midDrag).toContain('charlie')
  for (const word of CARD_B_WORDS) expect(midDrag).not.toContain(word)

  await page.mouse.up()
  await expectCardAHighlightSaved(page)
})

test('dragging across note text highlights without panning the canvas', async ({ page }) => {
  const { bodyA } = await seedTwoCards(page)
  const boxA = await bodyA.boundingBox()
  if (!boxA) throw new Error('Missing card text bounds')
  const transformBefore = await readViewportTransform(page)

  await page.mouse.move(boxA.x + 4, boxA.y + 10)
  await page.mouse.down()
  await page.mouse.move(boxA.x + boxA.width - 4, boxA.y + 10, { steps: 8 })

  expect(await readViewportTransform(page)).toBe(transformBefore)
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('alpha')

  await page.mouse.up()
  await expectCardAHighlightSaved(page)
})

test('a release outside the window still ends the drag and saves on re-entry', async ({ page }) => {
  const { bodyA, bodyB } = await seedTwoCards(page)
  await dragFromAIntoB(page, bodyA, bodyB)

  // A release outside the window never sends the page a pointerup: the first
  // thing it sees is the pointer coming back with no button held.
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointermove', { buttons: 0, bubbles: true }))
  })

  await expect
    .poll(() => page.evaluate(() => document.body.classList.contains('highlight-drag')))
    .toBe(false)
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelectorAll('.highlight-drag-origin').length),
    )
    .toBe(0)
  await expectCardAHighlightSaved(page)

  // The real button release afterwards must not save a second highlight.
  await page.mouse.up()
  await page.waitForTimeout(50)
  expect(await readHighlights(page)).toHaveLength(1)
})
