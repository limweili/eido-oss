import { expect, test, type Page } from '@playwright/test'

// A Note's attachment panels answer to exactly one geometry rule: their height
// is a clamp of a share of the Card's HEIGHT between a floor and a ceiling, and
// the Card's WIDTH is not part of that rule at all. Both halves are easy to
// break by accident later (a stray percentage, a flex basis, a media query), so
// they are pinned here against the real cascade rather than a jsdom stand-in.
const PANEL_FLOOR = 120
const PANEL_CEILING = 240
const PANEL_SHARE = 0.28
// A short Card cannot always honour the floor: the head and the Note body
// each keep a minimum of their own, and two panels asking for the floor at
// once can ask for more room than is left over. This mirrors
// --e-attachment-panel-reserved-chrome, the cap that keeps a panel (or a
// pair of panels, evenly split) inside whatever the Card has left after that
// reservation, so it can never paint past the Card's own bottom edge.
const PANEL_RESERVED_CHROME = 62

const IMAGE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

type TestCard = {
  id: string
  kind: 'note'
  blocks: Array<{ id: string; text: string }>
  position: { x: number; y: number }
  size?: { width: number; height: number }
  assets?: unknown[]
  linkPreview?: unknown
  meta?: Record<string, unknown>
}

type EidoDevStore = {
  getState: () => { hydrated: boolean; cards: TestCard[] }
  setState: (state: unknown) => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
  __EIDO_SET_GESTURE_PARTICIPANTS__?: (cardIds: readonly string[]) => void
}

function imageAsset(index: number) {
  return {
    id: `image-${index}`,
    kind: 'image',
    name: `image-${index}.png`,
    mimeType: 'image/png',
    dataUrl: IMAGE_DATA_URL,
    size: 68,
    createdAt: '2026-08-26T00:00:00.000Z',
    width: 1280,
    height: 960,
  }
}

const READY_PREVIEW = {
  url: 'https://www.drybread.studio/studio',
  status: 'ready',
  title: 'Drybread Studio',
  description:
    'A small design practice working on tools for thinking, drawing, and keeping track of what a project actually decided.',
  siteName: 'Drybread Studio',
  imageDataUrl: IMAGE_DATA_URL,
}

async function seedCards(page: Page, cards: TestCard[]) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })
  await page.evaluate((nextCards) => {
    const store = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
    store.setState({
      cards: nextCards,
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
  for (let pin = 0; pin < 2; pin += 1) {
    await page.evaluate(() => {
      ;(window as unknown as DevWindow).__EIDO_SET_VIEWPORT__?.({ x: 80, y: 60, zoom: 1 })
    })
    await page.waitForTimeout(250)
  }
}

async function resizeCard(page: Page, id: string, size: { width: number; height: number }) {
  await page.evaluate(({ cardId, nextSize }) => {
    const store = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
    const state = store.getState() as unknown as { cards: TestCard[] }
    store.setState({
      cards: state.cards.map((card) =>
        card.id === cardId ? { ...card, size: nextSize } : card,
      ),
    })
  }, { cardId: id, nextSize: size })
  await page.waitForTimeout(250)
}

/** The Card's own content-box height: the containing block the share reads. */
function measurePanels(page: Page, id: string) {
  return page.evaluate((cardId) => {
    const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${cardId}"]`)
    const card = node?.querySelector<HTMLElement>('.card')
    if (!card) throw new Error('Missing Card')
    const style = getComputedStyle(card)
    const cardContentHeight =
      card.clientHeight
      - Number.parseFloat(style.paddingTop)
      - Number.parseFloat(style.paddingBottom)
    const cardBottom = card.getBoundingClientRect().bottom
    return {
      cardWidth: card.getBoundingClientRect().width,
      cardContentHeight,
      cardBottom,
      panels: [...card.querySelectorAll<HTMLElement>('.card-attachment-panel')].map((panel) => {
        const box = panel.getBoundingClientRect()
        return {
          kind: panel.className.includes('--images') ? 'images' : 'previews',
          height: box.height,
          // How far the panel's own painted box reaches past the Card's
          // bottom border. Zero or negative means it stayed inside.
          overflowPastCardBottom: box.bottom - cardBottom,
        }
      }),
    }
  }, id)
}

/** The per-panel clamp, further capped by an even split of whatever the Card
 * has left after reserving room for its head and a usable body -- the same
 * cap `.card-attachment-panel` applies in the stylesheet. At Card heights
 * where the cap does not bind, this is exactly the classic clamp formula. */
function expectedPanelHeight(cardContentHeight: number, panelCount: number) {
  const clamped = Math.min(PANEL_CEILING, Math.max(PANEL_FLOOR, PANEL_SHARE * cardContentHeight))
  const safeCap = (cardContentHeight - PANEL_RESERVED_CHROME) / panelCount
  return Math.min(clamped, safeCap)
}

test.describe('Note attachment panels', () => {
  test('height is a clamp of a share of the Card height, and its width never enters the rule', async ({ page }) => {
    await seedCards(page, [{
      id: 'panels-note',
      kind: 'note',
      blocks: [{ id: 'body', text: 'Attachments live below this prose.' }],
      position: { x: 0, y: 0 },
      size: { width: 320, height: 300 },
      assets: [imageAsset(0), imageAsset(1), imageAsset(2)],
      linkPreview: READY_PREVIEW,
    }])

    const byHeight = new Map<number, number>()
    // 120 is the Card's own resize minimum (see MIN_CARD_HEIGHT); heights
    // below 460 are where two panels sharing one floor can outgrow a short
    // Card, so they are exercised here alongside the tall end of the range.
    for (const height of [120, 130, 160, 200, 240, 300, 460, 600, 760, 900, 1200]) {
      await resizeCard(page, 'panels-note', { width: 320, height })
      const measured = await measurePanels(page, 'panels-note')
      expect(measured.panels.map((panel) => panel.kind)).toEqual(['images', 'previews'])
      const expected = expectedPanelHeight(measured.cardContentHeight, measured.panels.length)
      for (const panel of measured.panels) {
        expect(panel.height).toBeCloseTo(expected, 0)
        // Never past the Card's own bottom edge, at any height down to the
        // resize minimum -- the defect this test now also guards against.
        expect(panel.overflowPastCardBottom).toBeLessThanOrEqual(1)
      }
      byHeight.set(height, measured.panels[0].height)
    }

    // The clamp is a real clamp: floored short, growing in the middle, capped
    // tall -- except at the very short end, where two panels dividing one
    // floor between them can no longer each reach it without overflowing.
    expect(byHeight.get(120)).toBeLessThan(PANEL_FLOOR)
    expect(byHeight.get(300)).toBeLessThanOrEqual(PANEL_FLOOR)
    expect(byHeight.get(600)!).toBeGreaterThan(PANEL_FLOOR)
    expect(byHeight.get(600)!).toBeLessThan(PANEL_CEILING)
    expect(byHeight.get(760)!).toBeGreaterThan(byHeight.get(600)!)
    expect(byHeight.get(900)).toBe(PANEL_CEILING)
    expect(byHeight.get(1200)).toBe(PANEL_CEILING)

    // Width independence, the half most likely to rot: one Card height, five
    // widths from narrower than a preview tile to far wider, one panel height.
    const heightsByWidth: number[] = []
    for (const width of [220, 280, 360, 560, 900]) {
      await resizeCard(page, 'panels-note', { width, height: 600 })
      const measured = await measurePanels(page, 'panels-note')
      expect(measured.cardWidth).toBeCloseTo(width, 0)
      heightsByWidth.push(...measured.panels.map((panel) => panel.height))
    }
    expect(new Set(heightsByWidth).size).toBe(1)
  })

  test('no panel paints past the Card, at any height down to the resize minimum, with any panel count', async ({ page }) => {
    // The regression this guards: a short Card with attachments used to let
    // its panels keep their full intended height regardless of how little
    // room was actually left, painting past the Card's own bottom border and
    // over whatever sat below it on the canvas. Three Cards side by side --
    // no attachments, one panel, two panels -- swept through every height
    // from the resize minimum up, is the matrix that would have caught it.
    const cards: TestCard[] = [
      {
        id: 'zero-panels',
        kind: 'note',
        blocks: [{ id: 'body', text: 'Plain prose, no attachments.' }],
        position: { x: 0, y: 0 },
        size: { width: 320, height: 300 },
      },
      {
        id: 'one-panel',
        kind: 'note',
        blocks: [{ id: 'body', text: 'One panel of images.' }],
        position: { x: 500, y: 0 },
        size: { width: 320, height: 300 },
        assets: [imageAsset(0), imageAsset(1)],
      },
      {
        id: 'two-panels',
        kind: 'note',
        blocks: [{ id: 'body', text: 'An image panel and a preview panel.' }],
        position: { x: 1000, y: 0 },
        size: { width: 320, height: 300 },
        assets: [imageAsset(0), imageAsset(1)],
        linkPreview: READY_PREVIEW,
      },
    ]
    await seedCards(page, cards)

    for (const height of [120, 130, 160, 200, 240, 300, 460, 600, 900]) {
      for (const card of cards) {
        await resizeCard(page, card.id, { width: 320, height })
        const measured = await measurePanels(page, card.id)
        for (const panel of measured.panels) {
          expect(panel.overflowPastCardBottom).toBeLessThanOrEqual(1)
        }
        if (measured.panels.length > 0) {
          const expected = expectedPanelHeight(measured.cardContentHeight, measured.panels.length)
          for (const panel of measured.panels) {
            expect(panel.height).toBeCloseTo(expected, 0)
          }
        }
      }
    }

    // Above the range where the safe cap can bind, the classic clamp and its
    // width independence still hold exactly, for both a lone panel and a pair.
    for (const id of ['one-panel', 'two-panels']) {
      for (const width of [220, 560]) {
        await resizeCard(page, id, { width, height: 600 })
        const measured = await measurePanels(page, id)
        const expected = expectedPanelHeight(measured.cardContentHeight, measured.panels.length)
        for (const panel of measured.panels) {
          expect(panel.height).toBeCloseTo(expected, 0)
        }
      }
    }
  })

  test('a narrow Card scrolls every image into reach instead of cropping or dropping one', async ({ page }) => {
    await seedCards(page, [{
      id: 'narrow-note',
      kind: 'note',
      blocks: [{ id: 'body', text: 'Three images.' }],
      position: { x: 0, y: 0 },
      size: { width: 240, height: 320 },
      assets: [imageAsset(0), imageAsset(1), imageAsset(2)],
    }])

    const track = page.locator('.card-attachment-panel--images .card-attachment-track')
    await expect(page.locator('.card-attachment-item--image')).toHaveCount(3)

    const reach = await track.evaluate((element) => {
      const tiles = [...element.querySelectorAll<HTMLElement>('.card-attachment-item')]
      const scrollable = element.scrollWidth - element.clientWidth
      element.scrollLeft = element.scrollWidth
      const lastTile = tiles[tiles.length - 1]
      return {
        tiles: tiles.length,
        scrollable,
        // Every tile keeps its full authored width: the Card edge changes what
        // is on screen, never what the tile is.
        widths: tiles.map((tile) => Math.round(tile.getBoundingClientRect().width)),
        lastTileFullyVisible:
          lastTile.getBoundingClientRect().right
            <= element.getBoundingClientRect().right + 1,
        verticallyClipped: element.scrollHeight > element.clientHeight + 1,
      }
    })

    expect(reach.tiles).toBe(3)
    expect(reach.scrollable).toBeGreaterThan(0)
    expect(new Set(reach.widths).size).toBe(1)
    expect(reach.lastTileFullyVisible).toBe(true)
    expect(reach.verticallyClipped).toBe(false)
  })

  test('the preview keeps its text at the floor and gains its image toward the ceiling', async ({ page }) => {
    // A NARROW Card, so the tile is in its stacked shape throughout: this is
    // the case the floor rule is about, where the image competes with the text
    // for the same height and therefore loses. A wide tile puts its image
    // beside the text instead, and is covered by the layout-ladder tests
    // below.
    await seedCards(page, [{
      id: 'preview-note',
      kind: 'note',
      blocks: [{ id: 'body', text: 'https://www.drybread.studio/studio' }],
      position: { x: 0, y: 0 },
      size: { width: 320, height: 300 },
      linkPreview: READY_PREVIEW,
    }])

    const title = page.locator('.card-attachment-item--preview .link-preview-title')
    const site = page.locator('.card-attachment-item--preview .link-preview-site-name')
    const image = page.locator('.card-attachment-item--preview .link-preview-image')
    const link = page.locator('.card-attachment-item--preview a.link-preview-card')

    await expect(title).toBeVisible()
    await expect(site).toBeVisible()
    const atFloor = await image.evaluate((element) => element.getBoundingClientRect().height)
    expect(atFloor).toBeLessThanOrEqual(1)

    await resizeCard(page, 'preview-note', { width: 320, height: 1200 })
    await expect(title).toBeVisible()
    const atCeiling = await image.evaluate((element) => element.getBoundingClientRect().height)
    expect(atCeiling).toBeGreaterThan(80)

    // Halfway up the growth band the image exists but is not yet whole.
    await resizeCard(page, 'preview-note', { width: 320, height: 700 })
    const midway = await image.evaluate((element) => element.getBoundingClientRect().height)
    expect(midway).toBeGreaterThan(atFloor)
    expect(midway).toBeLessThan(atCeiling)

    // The preview is still one external link, and its action rail is still
    // mounted and reachable -- it is revealed on hover and on focus rather
    // than painted at rest (see the controls test below).
    await expect(link).toHaveAttribute('href', READY_PREVIEW.url)
    await expect(page.locator('.link-preview-retry')).toHaveCount(1)
    await expect(page.locator('.link-preview-remove')).toHaveCount(1)
  })

  test('a press on a panel drags the Card and never starts a native drag', async ({ page }) => {
    await seedCards(page, [{
      id: 'drag-note',
      kind: 'note',
      blocks: [{ id: 'body', text: 'Drag me by my attachments.' }],
      position: { x: 0, y: 0 },
      size: { width: 320, height: 420 },
      assets: [imageAsset(0), imageAsset(1)],
      linkPreview: READY_PREVIEW,
    }])

    const refused = await page.evaluate(() => {
      const image = document.querySelector<HTMLElement>('.card-attachment-open img')
      if (!image) throw new Error('Missing carousel image')
      const dragStart = new Event('dragstart', { bubbles: true, cancelable: true })
      image.dispatchEvent(dragStart)
      return {
        prevented: dragStart.defaultPrevented,
        draggable: image.getAttribute('draggable'),
      }
    })
    expect(refused.prevented).toBe(true)
    expect(refused.draggable).toBe('false')

    const before = await page.evaluate(() => {
      const store = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
      return (store.getState() as unknown as { cards: Array<{ id: string; position: { x: number; y: number } }> })
        .cards.find((card) => card.id === 'drag-note')!.position
    })

    const tile = page.locator('.card-attachment-item--image').first()
    const box = (await tile.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    for (const step of [1, 2, 3, 4]) {
      await page.mouse.move(box.x + box.width / 2 + step * 20, box.y + box.height / 2 + step * 10)
      await page.waitForTimeout(30)
    }
    await page.mouse.up()
    await page.waitForTimeout(200)

    const after = await page.evaluate(() => {
      const store = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
      return (store.getState() as unknown as { cards: Array<{ id: string; position: { x: number; y: number } }> })
        .cards.find((card) => card.id === 'drag-note')!.position
    })
    expect(after.x).toBeGreaterThan(before.x)
    expect(after.y).toBeGreaterThan(before.y)
  })

  test('a press on a link preview tile drags the Card, and a plain click still opens the link', async ({ page }) => {
    // A stable, non-redirecting URL: the real drybread.studio domain 301s
    // www -> apex, which would make this assertion about navigation firing
    // from the anchor's own click, not about that domain's redirect chain.
    const linkPreview = { ...READY_PREVIEW, url: 'https://example.com/link-preview-target' }
    await seedCards(page, [{
      id: 'link-drag-note',
      kind: 'note',
      blocks: [{ id: 'body', text: 'Drag me by my link preview.' }],
      position: { x: 0, y: 0 },
      size: { width: 320, height: 420 },
      linkPreview,
    }])

    const before = await page.evaluate(() => {
      const store = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
      return (store.getState() as unknown as { cards: Array<{ id: string; position: { x: number; y: number } }> })
        .cards.find((card) => card.id === 'link-drag-note')!.position
    })

    const tile = page.locator('.card-attachment-item--preview a.link-preview-card')
    const box = (await tile.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    for (const step of [1, 2, 3, 4]) {
      await page.mouse.move(box.x + box.width / 2 + step * 20, box.y + box.height / 2 + step * 10)
      await page.waitForTimeout(30)
    }
    await page.mouse.up()
    await page.waitForTimeout(200)

    const after = await page.evaluate(() => {
      const store = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
      return (store.getState() as unknown as { cards: Array<{ id: string; position: { x: number; y: number } }> })
        .cards.find((card) => card.id === 'link-drag-note')!.position
    })
    // A press-and-move starting on the link preview drags the Card, exactly
    // like an image tile: React Flow's nodrag/nopan block was removed from
    // the anchor so the gesture falls through instead of being ignored.
    expect(after.x).toBeGreaterThan(before.x)
    expect(after.y).toBeGreaterThan(before.y)

    // A plain click (no movement past the drag threshold) still opens the
    // link in a new tab, and the refresh/remove controls still work as
    // controls without dragging the Card.
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      tile.click(),
    ])
    expect(popup.url()).toBe(linkPreview.url)
    await popup.close()

    const positionAfterClick = await page.evaluate(() => {
      const store = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
      return (store.getState() as unknown as { cards: Array<{ id: string; position: { x: number; y: number } }> })
        .cards.find((card) => card.id === 'link-drag-note')!.position
    })
    expect(positionAfterClick).toEqual(after)

    // The rail is revealed by the pointer that is about to use it.
    await tile.hover()
    await page.locator('.link-preview-retry').click()
    await tile.hover()
    await page.locator('.link-preview-remove').click()
    await expect(page.locator('.card-attachment-panel--previews')).toHaveCount(0)

    const positionAfterControls = await page.evaluate(() => {
      const store = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
      return (store.getState() as unknown as { cards: Array<{ id: string; position: { x: number; y: number } }> })
        .cards.find((card) => card.id === 'link-drag-note')!.position
    })
    expect(positionAfterControls).toEqual(after)
  })

  test('carousel tiles are capped at a maximum width regardless of source content', async ({ page }) => {
    await seedCards(page, [{
      id: 'wide-tile-note',
      kind: 'note',
      blocks: [{ id: 'body', text: 'A very wide image, a very tall image, and a preview.' }],
      position: { x: 0, y: 0 },
      size: { width: 900, height: 900 },
      assets: [
        { ...imageAsset(0), width: 4000, height: 200 },
        { ...imageAsset(1), width: 200, height: 4000 },
      ],
      linkPreview: READY_PREVIEW,
    }])

    const widths = await page.evaluate(() => {
      const imageTiles = [...document.querySelectorAll<HTMLElement>('.card-attachment-item--image')]
      const previewTile = document.querySelector<HTMLElement>('.card-attachment-item--preview')
      return {
        image: imageTiles.map((tile) => tile.getBoundingClientRect().width),
        preview: previewTile?.getBoundingClientRect().width,
        imageMaxWidthToken: getComputedStyle(document.documentElement)
          .getPropertyValue('--e-attachment-image-width-max')
          .trim(),
        previewMaxWidthToken: getComputedStyle(document.documentElement)
          .getPropertyValue('--e-attachment-preview-width-max')
          .trim(),
      }
    })

    expect(widths.imageMaxWidthToken).toBe('320px')
    expect(widths.previewMaxWidthToken).toBe('480px')
    // The very wide (4000x200) and very tall (200x4000) source images both
    // still cap at the same token ceiling: the fixed 4:3 tile box neither
    // stretches past it nor collapses to something illegibly thin.
    for (const width of widths.image) {
      expect(width).toBeLessThanOrEqual(321)
      expect(width).toBeGreaterThan(80)
    }
    // The wide (900px) Card lets the single preview stretch to read as a
    // link bar, but only up to its own ceiling.
    expect(widths.preview!).toBeLessThanOrEqual(481)
  })

  test('a tile still deletes its attachment, through the key hover reveals', async ({ page }) => {
    await seedCards(page, [{
      id: 'delete-note',
      kind: 'note',
      blocks: [{ id: 'body', text: 'Three images, one about to go.' }],
      position: { x: 0, y: 0 },
      size: { width: 420, height: 420 },
      assets: [imageAsset(0), imageAsset(1), imageAsset(2)],
    }])

    const tile = page.locator('.card-attachment-item--image').nth(1)
    const remove = tile.getByRole('button', { name: 'Remove asset' })
    // The key is present for assistive technology and keyboard users at rest,
    // and only paints once the tile is hovered.
    expect(await remove.evaluate((element) => getComputedStyle(element).opacity)).toBe('0')
    await tile.hover()
    await expect(remove).toHaveCSS('opacity', '1')
    await remove.click()

    await expect(page.locator('.card-attachment-item--image')).toHaveCount(2)
    const names = await page.evaluate(() => {
      const store = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
      const cards = (store.getState() as unknown as {
        cards: Array<{ id: string; assets?: Array<{ name: string }> }>
      }).cards
      return cards.find((card) => card.id === 'delete-note')!.assets!.map((asset) => asset.name)
    })
    expect(names).toEqual(['image-0.png', 'image-2.png'])
  })

  test('a long carousel mounts only what the panel can reach, and keeps the whole track\'s scroll geometry', async ({ page }) => {
    // The cost a long carousel used to charge was pure DOM: a hundred images
    // meant a hundred mounted tiles on a Card the founder may only ever look
    // at the first four of. The tile BOXES all stay -- they are what the
    // scroll bar is made of -- and only what they carry is mounted, within
    // reach of the panel's visible width.
    await seedCards(page, [{
      id: 'long-carousel-note',
      kind: 'note',
      blocks: [{ id: 'body', text: 'A hundred images.' }],
      position: { x: 0, y: 0 },
      size: { width: 640, height: 520 },
      assets: Array.from({ length: 100 }, (_, index) => imageAsset(index)),
    }])

    await expect(page.locator('.card-attachment-item--image')).toHaveCount(100)
    const mounted = page.locator('.card-attachment-open')
    const restingMounted = await mounted.count()
    expect(restingMounted).toBeGreaterThan(0)
    // Generous on purpose: this pins the shape of the cost (a window, not the
    // whole track), not one browser's exact window size.
    expect(restingMounted).toBeLessThan(30)

    const track = page.locator('.card-attachment-panel--images .card-attachment-track')
    const read = () => track.evaluate((element) => {
      const view = element.getBoundingClientRect()
      const tiles = [...element.querySelectorAll<HTMLElement>('.card-attachment-item')]
      let visible = 0
      let emptyVisible = 0
      for (const tile of tiles) {
        const box = tile.getBoundingClientRect()
        if (box.right < view.left || box.left > view.right) continue
        visible += 1
        if (!tile.firstElementChild) emptyVisible += 1
      }
      return {
        tiles: tiles.length,
        mounted: element.querySelectorAll('.card-attachment-open').length,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollLeft: element.scrollLeft,
        tileWidths: [...new Set(tiles.map((tile) => Math.round(tile.getBoundingClientRect().width)))],
        panelTop: Math.round(element.getBoundingClientRect().top),
        verticallyClipped: element.scrollHeight > element.clientHeight + 1,
        visible,
        emptyVisible,
      }
    })

    const readings = [await read()]
    for (let step = 0; step < 70; step += 1) {
      const last = readings[readings.length - 1]
      if (last.scrollLeft >= last.scrollWidth - last.clientWidth - 1) break
      await track.evaluate((element) => {
        element.scrollLeft += Math.round(element.clientWidth * 0.6)
      })
      await page.waitForTimeout(120)
      readings.push(await read())
    }

    // The founder really did travel the whole track, and every step of it
    // moved forward: mounting a tile never shoved the scroll position.
    expect(readings.length).toBeGreaterThan(5)
    for (const [index, reading] of readings.entries()) {
      if (index > 0) expect(reading.scrollLeft).toBeGreaterThan(readings[index - 1].scrollLeft)
      // Geometry is the invariant: the same hundred boxes, the same widths,
      // the same scrollable length, and a panel that never moved.
      expect(reading.tiles).toBe(100)
      expect(reading.scrollWidth).toBe(readings[0].scrollWidth)
      expect(reading.tileWidths).toEqual(readings[0].tileWidths)
      expect(reading.panelTop).toBe(readings[0].panelTop)
      expect(reading.verticallyClipped).toBe(false)
      // Never a hole where an image should be, and never the whole track.
      expect(reading.visible).toBeGreaterThan(0)
      expect(reading.emptyVisible).toBe(0)
      expect(reading.mounted).toBeLessThan(30)
    }
    const last = readings[readings.length - 1]
    expect(last.scrollLeft).toBeGreaterThanOrEqual(last.scrollWidth - last.clientWidth - 1)
  })

  test('the Card grows one panel floor when a panel arrives, once, and never on reopening', async ({ page }) => {
    // A panel is pinned to the bottom of the Card, so without this the Note
    // body silently loses 120px the moment a link resolves. The Card pays for
    // the panel instead: one floor per PANEL, granted when the panel appears
    // in front of the founder, and never granted twice for the same panel.
    await seedCards(page, [{
      id: 'growth-note',
      kind: 'note',
      blocks: [{ id: 'body', text: 'https://www.drybread.studio/studio' }],
      position: { x: 0, y: 0 },
      size: { width: 420, height: 400 },
    }])

    const heightOf = (id: string) => page.evaluate((cardId) => {
      const store = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
      return store.getState().cards.find((card) => card.id === cardId)?.size?.height ?? null
    }, id)
    const attach = (id: string, patch: Partial<TestCard>) => page.evaluate(({ cardId, next }) => {
      const store = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
      const state = store.getState()
      store.setState({
        cards: state.cards.map((card) => (card.id === cardId ? { ...card, ...next } : card)),
      })
    }, { cardId: id, next: patch })

    expect(await heightOf('growth-note')).toBe(400)

    // The preview resolves while the founder is looking at the Note.
    await attach('growth-note', { linkPreview: READY_PREVIEW })
    await expect(page.locator('.card-attachment-panel--previews')).toBeVisible()
    await expect.poll(() => heightOf('growth-note')).toBe(400 + PANEL_FLOOR)

    // A first image is a second PANEL, so it earns a second floor.
    await attach('growth-note', { assets: [imageAsset(0)] })
    await expect(page.locator('.card-attachment-panel--images')).toBeVisible()
    await expect.poll(() => heightOf('growth-note')).toBe(400 + 2 * PANEL_FLOOR)

    // More tiles in the tracks that already exist are not more panels.
    await attach('growth-note', { assets: [imageAsset(0), imageAsset(1), imageAsset(2)] })
    await page.waitForTimeout(400)
    expect(await heightOf('growth-note')).toBe(400 + 2 * PANEL_FLOOR)

    // Reopening the Board: the same Card, with the same attachments and the
    // marker it earned, mounts and stays exactly where the founder left it.
    const settled = await page.evaluate(() => {
      const store = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
      return store.getState().cards.find((card) => card.id === 'growth-note')!
    })
    await seedCards(page, [settled])
    await expect(page.locator('.card-attachment-panel--previews')).toBeVisible()
    await page.waitForTimeout(400)
    expect(await heightOf('growth-note')).toBe(400 + 2 * PANEL_FLOOR)
  })

  test('a scrollable carousel rests at its true ends, with the leading and trailing gutters intact', async ({ page }) => {
    // Snap points and the track's own padding used to disagree. A tile snaps
    // its START edge to the start of the snapport, and the first tile begins
    // one padding-inline in, so the nearest snap position at the left end was
    // scrollLeft: 8 rather than 0: the track settled with its leading gutter
    // scrolled away and the first tile clipped against the panel's left edge.
    // scroll-padding-inline insets the snapport by exactly that gutter, so both
    // ends of the track rest where they actually end.
    await seedCards(page, [{
      id: 'resting-carousel-note',
      kind: 'note',
      blocks: [{ id: 'body', text: 'Enough tiles to scroll.' }],
      position: { x: 0, y: 0 },
      size: { width: 420, height: 420 },
      assets: Array.from({ length: 8 }, (_, index) => imageAsset(index)),
    }])

    const track = page.locator('.card-attachment-panel--images .card-attachment-track')
    const settle = (to: number) => track.evaluate((element, target) => new Promise<void>((done) => {
      element.scrollTo({ left: target, behavior: 'smooth' })
      // Long enough for a smooth scroll to finish AND for the snap to pull it
      // wherever the snap points say it belongs, which is the whole question.
      setTimeout(done, 700)
    }), to)
    const read = () => track.evaluate((element) => {
      const view = element.getBoundingClientRect()
      const tiles = [...element.querySelectorAll<HTMLElement>('.card-attachment-item')]
      const first = tiles[0].getBoundingClientRect()
      const last = tiles[tiles.length - 1].getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        scrollLeft: Math.round(element.scrollLeft),
        maxScrollLeft: Math.round(element.scrollWidth - element.clientWidth),
        leadingGutter: Math.round(first.left - view.left),
        trailingGutter: Math.round(view.right - last.right),
        paddingInlineStart: Math.round(Number.parseFloat(style.paddingInlineStart)),
        paddingInlineEnd: Math.round(Number.parseFloat(style.paddingInlineEnd)),
      }
    })

    const before = await read()
    expect(before.maxScrollLeft).toBeGreaterThan(0)

    // Nudge off the left end and let it settle back. The rest position must be
    // the true start, showing the first tile whole behind its own gutter.
    await settle(6)
    const atStart = await read()
    expect(atStart.scrollLeft).toBe(0)
    expect(atStart.leadingGutter).toBe(atStart.paddingInlineStart)

    // The far end answers the same way: the last tile whole, its gutter kept.
    await settle(before.maxScrollLeft)
    const atEnd = await read()
    expect(atEnd.scrollLeft).toBe(atEnd.maxScrollLeft)
    expect(atEnd.trailingGutter).toBe(atEnd.paddingInlineEnd)
  })

  test('an image the Card never showed still deletes once it is scrolled into reach', async ({ page }) => {
    await seedCards(page, [{
      id: 'far-delete-note',
      kind: 'note',
      blocks: [{ id: 'body', text: 'The last of forty.' }],
      position: { x: 0, y: 0 },
      size: { width: 420, height: 420 },
      assets: Array.from({ length: 40 }, (_, index) => imageAsset(index)),
    }])

    const track = page.locator('.card-attachment-panel--images .card-attachment-track')
    const lastTile = page.locator('.card-attachment-item--image').nth(39)
    // It really was out of reach when the Card opened: nothing inside it.
    expect(await lastTile.evaluate((element) => element.childElementCount)).toBe(0)

    await track.evaluate((element) => { element.scrollLeft = element.scrollWidth })
    const remove = lastTile.getByRole('button', { name: 'Remove asset' })
    await expect(remove).toHaveCount(1)
    await lastTile.hover()
    await expect(remove).toHaveCSS('opacity', '1')
    await remove.click()

    await expect(page.locator('.card-attachment-item--image')).toHaveCount(39)
    const names = await page.evaluate(() => {
      const store = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
      const cards = (store.getState() as unknown as {
        cards: Array<{ id: string; assets?: Array<{ name: string }> }>
      }).cards
      return cards.find((card) => card.id === 'far-delete-note')!.assets!.map((asset) => asset.name)
    })
    expect(names).toHaveLength(39)
    expect(names).not.toContain('image-39.png')
  })
})

/** The link preview tile's own layout ladder, mirrored from the
 * --e-link-preview-* tokens. The tile reads its OWN box, so these are the
 * thresholds a tile changes shape at, not Card or panel sizes. */
const TILE_SPLIT_INLINE = 360
const TILE_STACK_IMAGE_BLOCK = 144
const TILE_DESCRIPTION_BLOCK = 96
const TILE_CHIP_BLOCK = 72
/** The copy's own padding (2 x --e-sp-2) and the gutter the action rail keeps
 * on the title line (--e-sp-7 + --e-sp-2), both spent from the tile's width. */
const COPY_INLINE_PADDING = 16
const ACTION_RAIL_GUTTER = 56

/** What the tile is showing, and how wide each part of it ended up. */
function readPreviewShape(page: Page) {
  return page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>(
      '.card-attachment-item--preview .link-preview-frame',
    )
    if (!frame) throw new Error('Missing preview tile')
    const box = (selector: string) => {
      const element = frame.querySelector<HTMLElement>(selector)
      if (!element) return { shown: false, width: 0, height: 0 }
      const rect = element.getBoundingClientRect()
      return {
        shown: getComputedStyle(element).display !== 'none' && rect.height > 0,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    }
    const frameBox = frame.getBoundingClientRect()
    const copy = frame.querySelector<HTMLElement>('.link-preview-copy')!
    return {
      inline: Math.round(frameBox.width),
      block: Math.round(frameBox.height),
      direction: getComputedStyle(frame.querySelector<HTMLElement>('.link-preview-card')!)
        .flexDirection,
      image: box('.link-preview-image'),
      title: box('.link-preview-title'),
      description: box('.link-preview-description'),
      site: box('.link-preview-site'),
      compactMark: box('.link-preview-compact-mark'),
      openIcon: box('.link-preview-open-icon'),
      // Nothing the copy carries may be pushed past the tile's bottom edge:
      // a shape that "fits" by clipping the domain off is not fitting.
      clipped: [...copy.children]
        .filter((child) => child.getBoundingClientRect().height > 0)
        .filter((child) => child.getBoundingClientRect().bottom > frameBox.bottom + 1)
        .map((child) => child.className.split(' ')[0]),
    }
  })
}

test.describe('Note link preview tile layout', () => {
  test('takes one shape per box, and gives the text every pixel the shape leaves', async ({ page }) => {
    await seedCards(page, [{
      id: 'shape-note',
      kind: 'note',
      blocks: [{ id: 'body', text: 'https://www.drybread.studio/studio' }],
      position: { x: 0, y: 0 },
      // The image panel is here so the short end of the ladder is reachable:
      // two panels divide what a short Card has left, which is how a tile
      // gets below its own description and chip thresholds in real use.
      size: { width: 320, height: 1000 },
      assets: [imageAsset(0)],
      linkPreview: READY_PREVIEW,
    }])

    // Card sizes chosen to land one tile in each rung of the ladder. The
    // assertions are about the tile's own measured box, not these numbers.
    const rungs = [
      { name: 'wide', size: { width: 760, height: 900 } },
      { name: 'wide at the panel floor', size: { width: 760, height: 460 } },
      { name: 'narrow and tall', size: { width: 320, height: 1000 } },
      { name: 'narrow, mid', size: { width: 320, height: 700 } },
      { name: 'narrow at the panel floor', size: { width: 320, height: 460 } },
      { name: 'no room for the description', size: { width: 320, height: 250 } },
      { name: 'no room for anything but the title', size: { width: 320, height: 222 } },
    ]

    const seen = new Set<string>()
    for (const rung of rungs) {
      await resizeCard(page, 'shape-note', rung.size)
      const shape = await readPreviewShape(page)
      const wide = shape.inline >= TILE_SPLIT_INLINE
      const chip = shape.block <= TILE_CHIP_BLOCK

      // 1. WIDE: image on the left, text on the right.
      // 2. NARROW and TALL: image on top, text below.
      // 3. NO ROOM: no image at all, and the text keeps what fits.
      if (wide && !chip) {
        expect(shape.direction, rung.name).toBe('row')
        expect(shape.image.shown, rung.name).toBe(true)
        expect(shape.image.height, rung.name).toBeCloseTo(shape.block, 0)
      } else {
        expect(shape.direction, rung.name).toBe('column')
        expect(shape.image.shown, rung.name).toBe(
          !chip && shape.block > TILE_STACK_IMAGE_BLOCK,
        )
        if (shape.image.shown) {
          expect(shape.image.width, rung.name).toBeCloseTo(shape.inline, 0)
          expect(shape.image.height, rung.name).toBeLessThanOrEqual(shape.block / 2 + 1)
        }
      }

      // The text fits what fits, in priority order: the title always, then
      // the description, then the domain -- and the favicon moves onto the
      // title line rather than leaving with the domain.
      expect(shape.title.shown, rung.name).toBe(true)
      expect(shape.description.shown, rung.name).toBe(shape.block > TILE_DESCRIPTION_BLOCK)
      expect(shape.site.shown, rung.name).toBe(!chip)
      expect(shape.compactMark.shown, rung.name).toBe(chip)
      expect(shape.clipped, rung.name).toEqual([])

      // The text uses the full width of whatever the shape left it: the tile,
      // less the image beside it (only in the wide shape), less the copy's own
      // padding, less the rail's gutter wherever the rail lands on the title.
      const besideTheText = shape.direction === 'row' ? shape.image.width : 0
      const gutter = shape.direction === 'row' || shape.block <= TILE_STACK_IMAGE_BLOCK
        ? ACTION_RAIL_GUTTER
        : 0
      const mark = chip ? shape.compactMark.width + 8 : 0
      expect(shape.title.width, rung.name).toBeCloseTo(
        shape.inline - besideTheText - COPY_INLINE_PADDING - gutter - mark,
        0,
      )
      if (shape.description.shown) {
        expect(shape.description.width, rung.name).toBeCloseTo(
          shape.inline - besideTheText - COPY_INLINE_PADDING,
          0,
        )
      }
      if (shape.site.shown) {
        // The site row keeps its favicon and its open-in-a-new-tab icon on
        // the same line, spanning the same measure as the description.
        expect(shape.openIcon.shown, rung.name).toBe(true)
        expect(shape.site.width, rung.name).toBeCloseTo(
          shape.inline - besideTheText - COPY_INLINE_PADDING,
          0,
        )
      }
      seen.add(`${shape.direction}:${shape.image.shown}:${shape.description.shown}:${shape.site.shown}`)
    }

    // Every rung really was a different shape, so this test cannot pass by
    // measuring one arrangement seven times.
    expect(seen.size).toBeGreaterThanOrEqual(4)
  })

  test('each tile in a shared carousel answers for its own box, not the panel\'s', async ({ page }) => {
    // The shapes are chosen by container queries against the TILE, so a Note
    // carrying four previews on a very wide Card gives four narrow tiles that
    // must each stack -- even though the panel they share is wider than the
    // widest single tile. A query written against the panel, or against the
    // Card, would put all four in the wide shape and crush their text.
    // Media never reaches a Card: `durableLinkPreview` strips it before the
    // store sees a settled preview, and the panel loads its own image. So the
    // extras here carry the durable shape the envelope actually holds.
    const { imageDataUrl: _loadedOnly, ...durablePreview } = READY_PREVIEW
    const extras = [
      'https://one.example/a',
      'https://two.example/b',
      'https://three.example/c',
    ].map((url) => ({ ...durablePreview, url, title: `Preview for ${url}` }))
    await seedCards(page, [{
      id: 'carousel-note',
      kind: 'note',
      blocks: [{ id: 'body', text: 'Four links, one carousel.' }],
      position: { x: 0, y: 0 },
      size: { width: 1200, height: 900 },
      linkPreview: READY_PREVIEW,
      // Previews two and up live in the Card's settings envelope, never as a
      // top-level key an older build's validator would refuse (ADR 0040).
      meta: { linkPreviewExtras: extras },
    }])

    const shapes = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.card-attachment-panel--previews')!
      return {
        panelWidth: Math.round(panel.getBoundingClientRect().width),
        tiles: [...document.querySelectorAll<HTMLElement>('.card-attachment-item--preview')]
          .map((tile) => {
            const frame = tile.querySelector<HTMLElement>('.link-preview-frame')!
            const card = frame.querySelector<HTMLElement>('.link-preview-card')!
            return {
              width: Math.round(frame.getBoundingClientRect().width),
              direction: getComputedStyle(card).flexDirection,
            }
          }),
      }
    })

    expect(shapes.tiles).toHaveLength(4)
    expect(shapes.panelWidth).toBeGreaterThan(1000)
    for (const tile of shapes.tiles) {
      expect(tile.width).toBeLessThan(360)
      expect(tile.direction).toBe('column')
    }

    // The same four previews on a Card narrow enough to scroll them keep
    // their own width instead of being squeezed by the neighbours.
    await resizeCard(page, 'carousel-note', { width: 420, height: 900 })
    const narrow = await page.evaluate(() => {
      const track = document.querySelector<HTMLElement>(
        '.card-attachment-panel--previews .card-attachment-track',
      )!
      return {
        scrollable: track.scrollWidth - track.clientWidth,
        widths: [...new Set([...track.querySelectorAll<HTMLElement>('.card-attachment-item--preview')]
          .map((tile) => Math.round(tile.getBoundingClientRect().width)))],
      }
    })
    expect(narrow.scrollable).toBeGreaterThan(0)
    expect(narrow.widths).toHaveLength(1)
  })

  test('the controls appear on hover and on keyboard focus, and never move the text', async ({ page }) => {
    await seedCards(page, [{
      id: 'controls-note',
      kind: 'note',
      blocks: [{ id: 'body', text: 'https://www.drybread.studio/studio' }],
      position: { x: 0, y: 0 },
      size: { width: 760, height: 900 },
      linkPreview: READY_PREVIEW,
    }])

    const rail = page.locator('.card-attachment-item--preview .link-preview-actions')
    const tile = page.locator('.card-attachment-item--preview .link-preview-card')
    const title = page.locator('.card-attachment-item--preview .link-preview-title')
    const titleWidth = () => title.evaluate((element) =>
      Math.round(element.getBoundingClientRect().width))

    // Refresh leads, Remove follows.
    expect(await rail.evaluate((element) =>
      [...element.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')),
    )).toEqual(['Refresh preview', 'Remove preview'])

    await expect(rail).toHaveCSS('opacity', '0')
    const atRest = await titleWidth()

    await tile.hover()
    await expect(rail).toHaveCSS('opacity', '1')
    // The gutter is reserved whether or not the rail is painted, so revealing
    // it never re-wraps the title under the pointer.
    expect(await titleWidth()).toBe(atRest)

    await page.mouse.move(4, 4)
    await expect(rail).toHaveCSS('opacity', '0')

    // Keyboard only: tab out of the link and the rail comes into view with
    // Refresh, the key the founder reaches first.
    await tile.focus()
    await page.keyboard.press('Tab')
    await expect(rail).toHaveCSS('opacity', '1')
    await expect(page.locator('.link-preview-retry')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.locator('.link-preview-remove')).toBeFocused()
    await expect(rail).toHaveCSS('opacity', '1')
    expect(await titleWidth()).toBe(atRest)

    await page.locator('.link-preview-remove').evaluate((element: HTMLElement) => element.blur())
    await expect(rail).toHaveCSS('opacity', '0')
  })
})
