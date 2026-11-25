import { expect, test, type Page } from '@playwright/test'
import type { Card } from '../graph/types'

type EidoDevStore = {
  getState: () => { hydrated: boolean }
  setState: (state: unknown) => void
}

type OverviewProbe = {
  painted: number
  drawn: number
  dropped: number
  ramped: number
  eligible: number
  silhouettes: number
}

const group = (id: string, title: string, position: Card['position'], size: NonNullable<Card['size']>): Card => ({
  id,
  kind: 'group',
  title,
  blocks: [],
  position,
  size,
  zIndex: 1,
})

const note = (id: string, text: string, position: Card['position'], title?: string): Card => ({
  id,
  kind: 'note',
  title,
  blocks: [{ id: `${id}-block`, text }],
  position,
  size: { width: 260, height: 180 },
  zIndex: 2,
})

async function seed(page: Page, cards: Card[]) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })
  await page.evaluate((seededCards) => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    devWindow.__eido.setState({
      cards: seededCards,
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
  }, cards)
}

async function setViewport(page: Page, viewport: { x: number; y: number; zoom: number }) {
  await page.evaluate((next) => window.__EIDO_SET_VIEWPORT__?.(next), viewport)
  await page.waitForTimeout(50)
  await page.evaluate(() => window.__EIDO_FORCE_OVERVIEW_DRAW__?.())
}

function probe(page: Page): Promise<OverviewProbe> {
  return page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')
    if (!layer) throw new Error('Missing overview layer')
    return {
      painted: Number(layer.dataset.paintedLabelCount ?? -1),
      drawn: Number(layer.dataset.drawn ?? -1),
      dropped: Number(layer.dataset.dropped ?? -1),
      ramped: Number(layer.dataset.ramped ?? -1),
      eligible: Number(layer.dataset.eligibleLabelCandidateCount ?? -1),
      silhouettes: Number(layer.dataset.silhouetteCardCount ?? -1),
    }
  })
}

async function sampleCanvas(
  page: Page,
  rect: { x: number; y: number; width: number; height: number },
  mode: 'alpha' | 'dark-ink',
) {
  return page.evaluate(({ sampleRect, sampleMode }) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
    if (!canvas) throw new Error('Missing overview canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Missing overview 2d context')
    const css = canvas.getBoundingClientRect()
    const scaleX = canvas.width / css.width
    const scaleY = canvas.height / css.height
    const image = context.getImageData(
      Math.floor(sampleRect.x * scaleX),
      Math.floor(sampleRect.y * scaleY),
      Math.max(1, Math.floor(sampleRect.width * scaleX)),
      Math.max(1, Math.floor(sampleRect.height * scaleY)),
    ).data
    if (sampleMode === 'alpha') return image[3]
    let pixels = 0
    for (let at = 0; at < image.length; at += 4) {
      if (image[at + 3] > 80 && image[at] < 150 && image[at + 1] < 150 && image[at + 2] < 150) pixels += 1
    }
    return pixels
  }, { sampleRect: rect, sampleMode: mode })
}

const darkInkPixels = (page: Page, rect: { x: number; y: number; width: number; height: number }) =>
  sampleCanvas(page, rect, 'dark-ink')

test('overview labels: a tinted group region keeps its name pinned while its top-left is off screen', async ({ page }) => {
  await seed(page, [group('continent', 'CONTINENT LANDMARK', { x: 0, y: 0 }, { width: 4200, height: 2600 })])

  for (const viewport of [
    { x: -420, y: -260, zoom: 0.25 },
    { x: -680, y: -400, zoom: 0.25 },
  ]) {
    await setViewport(page, viewport)
    expect(await darkInkPixels(page, { x: 0, y: 0, width: 180, height: 28 }), 'pinned group name ink').toBeGreaterThan(4)
    const alpha = await sampleCanvas(page, { x: 300, y: 180, width: 1, height: 1 }, 'alpha')
    expect(alpha, 'group region tint').toBeGreaterThan(0)
  }
})

test('overview labels: displayPriority landmark wins a collision and remains full-strength ink', async ({ page }) => {
  const oversizedOrdinary = note('ordinary', 'x', { x: 100, y: 100 }, 'x')
  oversizedOrdinary.size = { width: 1200, height: 700 }
  await seed(page, [
    group('landmark', 'LANDMARK-WIDE-UNIQUE', { x: 100, y: 100 }, { width: 120, height: 80 }),
    oversizedOrdinary,
  ])
  await setViewport(page, { x: 120, y: 100, zoom: 0.25 })

  const counters = await probe(page)
  expect(counters).toMatchObject({ drawn: 1, ramped: 0, dropped: 1, eligible: 2 })
  expect(
    await darkInkPixels(page, { x: 120 + 100 * 0.25 + 18, y: 100 + 100 * 0.25, width: 135, height: 24 }),
    'landmark-only tail ink',
  ).toBeGreaterThan(4)
})

test('overview labels: hovering collision-dropped dust restores it at full strength through an attached proxy', async ({ page }) => {
  await seed(page, [
    group('collision-landmark', 'x', { x: 800, y: 500 }, { width: 120, height: 80 }),
    note('hover-dust', 'HOVERED-DUST-WIDE', { x: 800, y: 500 }),
  ])
  await setViewport(page, { x: 180, y: 140, zoom: 0.25 })
  expect(await probe(page)).toMatchObject({ painted: 1, drawn: 1, dropped: 1, eligible: 2 })

  const point = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow')?.getBoundingClientRect()
    if (!pane) throw new Error('Missing board pane')
    return { x: pane.left + 180 + 800 * 0.25 + 20, y: pane.top + 140 + 500 * 0.25 + 20 }
  })
  await page.mouse.move(point.x, point.y)
  // Canvas hover mounts an invisible interaction proxy: attached is the only
  // valid wait state; `visible` can never succeed by design.
  await page.locator('.react-flow__node[data-id="hover-dust"]').waitFor({ state: 'attached', timeout: 10_000 })
  await expect
    .poll(async () => {
      await page.evaluate(() => window.__EIDO_FORCE_OVERVIEW_DRAW__?.())
      return probe(page)
    })
    .toMatchObject({ painted: 2, drawn: 2, ramped: 0, dropped: 0, eligible: 2 })
  expect(
    await darkInkPixels(page, { x: 180 + 800 * 0.25 + 18, y: 140 + 500 * 0.25, width: 125, height: 24 }),
    'hovered label tail ink',
  ).toBeGreaterThan(4)
})

test('overview labels: a Reading-mounted card never duplicates its DOM title on canvas', async ({ page }) => {
  await seed(page, [note('reading-card', 'Reading body', { x: 180, y: 140 }, 'Reading DOM title')])
  await setViewport(page, { x: 160, y: 120, zoom: 1 })
  await page.locator('.react-flow__node[data-id="reading-card"]').waitFor({ state: 'attached', timeout: 10_000 })

  // Move a mounted Reading card into the intentional motion-underlay phase,
  // then sample synchronously: its shape is a silhouette, but its DOM title
  // must remain the only text representation.
  const movingFrame = await page.evaluate(async () => {
    window.__EIDO_SET_VIEWPORT__?.({ x: 172, y: 126, zoom: 1 })
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    window.__EIDO_FORCE_OVERVIEW_DRAW__?.()
    const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')
    return {
      painted: Number(layer?.dataset.paintedLabelCount ?? -1),
      eligible: Number(layer?.dataset.eligibleLabelCandidateCount ?? -1),
      silhouettes: Number(layer?.dataset.silhouetteCardCount ?? -1),
    }
  })
  expect(movingFrame.silhouettes, 'Reading motion underlay must exercise suppression').toBe(1)
  expect(movingFrame).toMatchObject({ painted: 0, eligible: 0 })
  await expect(page.locator('.react-flow__node[data-id="reading-card"]')).toContainText('Reading DOM title')
})
