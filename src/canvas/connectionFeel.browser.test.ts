import { expect, test, type Page } from '@playwright/test'

// Phase 3 of the connections rework (#259): the connect moment and the
// polarity flip are one-shot beats, and the connection chrome stays grabbable
// while zoomed far out.
//
// - Creating a connection sends ONE pulse along the line toward the consuming
//   card; the pulse element and the settle animation unmount when the beat
//   retires, leaving a fully static board (no persistent edge animation).
// - Flipping Helps <-> Avoid crossfades the line's character: the old look
//   fades out over the new one, then the overlay unmounts.
// - At far zoom-out the handles and the midpoint pill keep a clickable screen
//   size from their own shallow zoom subscribers, so wiring and editing work
//   without zooming back in or invalidating Card-descendant styles.
//
// The beats are ~200-800ms windows, too fast for polling assertions to catch
// reliably, so each test installs a MutationObserver BEFORE acting and asserts
// what it recorded afterwards.

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    connections: Array<{ id: string; from: { cardId: string }; to: { cardId: string }; polarity: string }>
    connectionPulse: { connectionId: string; seq: number } | null
    connectionFlip: { connectionId: string; fromPolarity: string; seq: number } | null
  }
  setState: (state: unknown) => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

async function seedBoard(
  page: Page,
  options: {
    positions: [{ x: number; y: number }, { x: number; y: number }]
    connect?: boolean
    size?: { width: number; height: number }
    sizes?: [{ width: number; height: number }, { width: number; height: number }]
    viewport?: { x: number; y: number; zoom: number }
  },
) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate((opts) => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    const card = (id: string, index: 0 | 1, x: number, y: number, text: string) => ({
      id,
      kind: 'note',
      blocks: [{ id: `${id}-block`, text }],
      position: { x, y },
      ...(opts.sizes?.[index]
        ? { size: opts.sizes[index] }
        : opts.size
          ? { size: opts.size }
          : {}),
    })
    devWindow.__eido.setState({
      cards: [
        card('feel-a', 0, opts.positions[0].x, opts.positions[0].y, 'from here'),
        card('feel-b', 1, opts.positions[1].x, opts.positions[1].y, 'to here'),
      ],
      connections: opts.connect
        ? [
            {
              id: 'feel-connection',
              from: { cardId: 'feel-a' },
              to: { cardId: 'feel-b' },
              strength: 'strong',
              polarity: 'helps',
              role: 'feeds',
            },
          ]
        : [],
      outputs: [],
      runs: [],
      intentLog: [],
      visualDecayEnabled: false,
      selection: null,
      selectedCardIds: [],
      connectionPulse: null,
      connectionFlip: null,
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
  }, options)

  // A prior test can save an Overview viewport. Establish Reading before
  // waiting for rich nodes, then move to the case's requested viewport.
  await page.evaluate(() => {
    window.__EIDO_SET_VIEWPORT__?.({ x: 120, y: 100, zoom: 1 })
  })
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length > 0)
  if (options.viewport) {
    await page.evaluate((viewport) => {
      const devWindow = window as unknown as DevWindow
      devWindow.__EIDO_SET_VIEWPORT__?.(viewport)
    }, options.viewport)
    // Let the detail aperture settle before interacting.
    await page.waitForTimeout(500)
  }
}

async function handleCenter(page: Page, cardId: string, side: 'left' | 'right') {
  const handle = page.locator(`.react-flow__node[data-id="${cardId}"] .react-flow__handle-${side}`)
  await handle.waitFor({ state: 'visible' })
  const box = await handle.boundingBox()
  if (!box) throw new Error(`Missing ${side} handle box for ${cardId}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, height: box.height }
}

async function connectByHandleDrag(page: Page) {
  const from = await handleCenter(page, 'feel-a', 'right')
  const to = await handleCenter(page, 'feel-b', 'left')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
}

async function visibleTargetConnectionGeometry(page: Page) {
  return page.evaluate(() => {
    const path = document.querySelector<SVGPathElement>(
      '.react-flow__edge[data-id="feel-connection"] path.connection-line',
    )
    const handle = document.querySelector<HTMLElement>(
      '.react-flow__node[data-id="feel-b"] .react-flow__handle-left',
    )
    if (!handle) throw new Error('Missing visible target handle')
    const bounds = handle.getBoundingClientRect()
    const target = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
      width: bounds.width,
      height: bounds.height,
    }
    const arrow = document.querySelector<SVGPolygonElement>(
      '[data-connection-arrow="feel-connection"] polygon',
    )
    const toScreen = (element: SVGGraphicsElement, point: DOMPoint) =>
      point.matrixTransform(element.getScreenCTM()!)
    const end = path ? toScreen(path, path.getPointAtLength(path.getTotalLength())) : null
    const arrowTip = arrow ? toScreen(arrow, new DOMPoint(0, 0)) : null

    const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
    const renderedCanvasConnections = Number(canvas?.dataset.renderedConnectionCount ?? 0)
    const maxCanvasAlphaNear = (screenX: number, screenY: number) => {
      if (!canvas) return 0
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      const centerX = Math.round((screenX - rect.left) * scaleX)
      const centerY = Math.round((screenY - rect.top) * scaleY)
      const radius = 2
      const image = canvas.getContext('2d')?.getImageData(
        centerX - radius,
        centerY - radius,
        radius * 2 + 1,
        radius * 2 + 1,
      )
      if (!image) return 0
      let alpha = 0
      for (let index = 3; index < image.data.length; index += 4) {
        alpha = Math.max(alpha, image.data[index]!)
      }
      return alpha
    }

    return {
      representation: path ? 'dom' : renderedCanvasConnections > 0 ? 'canvas' : 'missing',
      target,
      targetSeparation: end ? Math.hypot(end.x - target.x, end.y - target.y) : null,
      arrowTipSeparation: arrowTip
        ? Math.hypot(arrowTip.x - target.x, arrowTip.y - target.y)
        : null,
      edgeStroke: path ? getComputedStyle(path).stroke : null,
      arrowFill: arrow ? getComputedStyle(arrow).fill : null,
      renderedCanvasConnections,
      canvasCandidates: Number(canvas?.dataset.connectionCandidateCount ?? 0),
      canvasOmitted: Number(canvas?.dataset.omittedConnectionCount ?? 0),
      passiveCards: Number(document.querySelector<HTMLElement>('.board-flow')?.dataset.passiveCardCount ?? 0),
      canvasTipAlpha: maxCanvasAlphaNear(target.x, target.y),
      canvasContactAlpha: maxCanvasAlphaNear(target.x - target.width / 2 - 1, target.y),
    }
  })
}

// Records every distinct appearance of a selector's match so a sub-second
// element cannot slip between polls: `appearances` increments each time the
// selector goes from absent to present.
async function watchAppearances(page: Page, selector: string, flag: string) {
  await page.evaluate(
    ({ selector, flag }) => {
      const record = { appearances: 0, present: false }
      ;(window as unknown as Record<string, unknown>)[flag] = record
      const check = () => {
        const present = Boolean(document.querySelector(selector))
        if (present && !record.present) record.appearances += 1
        record.present = present
      }
      new MutationObserver(check).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      })
      check()
    },
    { selector, flag },
  )
}

function readAppearances(page: Page, flag: string) {
  return page.evaluate(
    (key) => (window as unknown as Record<string, { appearances: number; present: boolean }>)[key],
    flag,
  )
}

test('connecting sends one pulse toward the consumer, then the board goes fully static', async ({ page }) => {
  await seedBoard(page, { positions: [{ x: 0, y: 0 }, { x: 600, y: 0 }] })
  await watchAppearances(page, '.connection-pulse', '__pulseWatch')
  await watchAppearances(page, '.connection-line.settling', '__settleWatch')

  await connectByHandleDrag(page)

  // The connection lands in the store and its beat begins.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const devWindow = window as unknown as { __eido: EidoDevStore }
        return devWindow.__eido.getState().connections.map((c) => `${c.from.cardId}->${c.to.cardId}`)
      }),
    )
    .toContain('feel-a->feel-b')
  await expect.poll(async () => (await readAppearances(page, '__pulseWatch')).appearances).toBe(1)
  await expect.poll(async () => (await readAppearances(page, '__settleWatch')).appearances).toBe(1)

  // The beat retires: pulse element gone, settle class gone, store record
  // cleared — and nothing reappears.
  await expect.poll(async () => (await readAppearances(page, '__pulseWatch')).present, { timeout: 3000 }).toBe(false)
  await expect(page.locator('.connection-pulse')).toHaveCount(0)
  await expect(page.locator('.connection-line.settling')).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const devWindow = window as unknown as { __eido: EidoDevStore }
        return devWindow.__eido.getState().connectionPulse
      }),
    )
    .toBeNull()

  await page.waitForTimeout(400)
  expect((await readAppearances(page, '__pulseWatch')).appearances).toBe(1)
})

test('flipping Helps to Avoid crossfades the line character, then the overlay unmounts', async ({ page }) => {
  await seedBoard(page, { positions: [{ x: 0, y: 0 }, { x: 600, y: 0 }], connect: true })
  await watchAppearances(page, '.connection-flip-out', '__flipOutWatch')
  await watchAppearances(page, '.connection-line.flip-in', '__flipInWatch')

  await page.locator('.connection-pill[data-connection-id="feel-connection"]').click()
  const popover = page.locator('.connection-popover[data-connection-id="feel-connection"]')
  await popover.getByRole('radio', { name: '− Avoid' }).click()

  // The crossfade ran: old character faded out over the new one.
  await expect.poll(async () => (await readAppearances(page, '__flipOutWatch')).appearances).toBe(1)
  await expect.poll(async () => (await readAppearances(page, '__flipInWatch')).appearances).toBe(1)

  // The new character is the dashed warn line; the overlay and the beat are gone.
  await expect(
    page.locator('.react-flow__edge[data-id="feel-connection"] path.connection-line').first(),
  ).toHaveCSS('stroke-dasharray', /0\.1.*7/)
  await expect.poll(async () => (await readAppearances(page, '__flipOutWatch')).present, { timeout: 3000 }).toBe(false)
  await expect(page.locator('.connection-flip-out')).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const devWindow = window as unknown as { __eido: EidoDevStore }
        return devWindow.__eido.getState().connectionFlip
      }),
    )
    .toBeNull()
})

test('an incoming connection stays attached when its source leaves the viewport during close zoom', async ({
  page,
}) => {
  await seedBoard(page, {
    positions: [{ x: 0, y: 0 }, { x: 900, y: 0 }],
    size: { width: 260, height: 180 },
    connect: true,
    viewport: { x: -350, y: 310, zoom: 1 },
  })

  // Increasing zoom exercises DOM→canvas demotion; decreasing back through
  // the same boundary exercises canvas→DOM promotion. Finish at 4 so the
  // interaction assertion runs on the bounded fallback owner.
  for (const zoom of [1, 2, 3, 4, 3, 2, 1, 4]) {
    await page.evaluate((nextZoom) => {
      const devWindow = window as unknown as DevWindow
      // Keep the target port fixed on-screen while the source moves farther
      // beyond the left viewport edge, matching the reported close-zoom bug.
      devWindow.__EIDO_SET_VIEWPORT__?.({
        x: 550 - 900 * nextZoom,
        y: 400 - 90 * nextZoom,
        zoom: nextZoom,
      })
    }, zoom)
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))
    await expect.poll(
      async () => JSON.stringify(await visibleTargetConnectionGeometry(page)),
      { message: `connection must remain rendered with its source off-screen at zoom ${zoom}` },
    ).not.toContain('"representation":"missing"')
    const geometry = await visibleTargetConnectionGeometry(page)
    if (geometry.representation === 'dom') {
      expect(geometry.renderedCanvasConnections, JSON.stringify(geometry)).toBe(0)
      expect(geometry.targetSeparation, JSON.stringify(geometry)).toBeLessThanOrEqual(0.5)
      expect(geometry.arrowTipSeparation, JSON.stringify(geometry)).toBeLessThanOrEqual(0.5)
      expect(geometry.arrowFill).toBe(geometry.edgeStroke)
    } else {
      expect(geometry.renderedCanvasConnections).toBe(1)
      expect(geometry.canvasTipAlpha, JSON.stringify(geometry)).toBeGreaterThan(0)
      expect(geometry.canvasContactAlpha, JSON.stringify(geometry)).toBeGreaterThan(0)
    }
  }

  const finalGeometry = await visibleTargetConnectionGeometry(page)
  await page.mouse.move(finalGeometry.target.x - 80, finalGeometry.target.y)
  await expect(page.locator('.board-flow')).toHaveAttribute(
    'data-hovered-connection-id',
    'feel-connection',
  )
  await page.mouse.click(finalGeometry.target.x - 80, finalGeometry.target.y)
  await expect.poll(() => page.evaluate(() => {
    const store = (window as unknown as { __eido: EidoDevStore }).__eido.getState() as unknown as {
      connectionEditorId: string | null
    }
    return store.connectionEditorId
  })).toBe('feel-connection')
})

test('a canvas connection promoted to DOM reanchors to the measured connector center', async ({
  page,
}) => {
  await seedBoard(page, {
    positions: [{ x: -1400, y: 866 }, { x: 1046, y: 504 }],
    sizes: [{ width: 1200, height: 1060 }, { width: 260, height: 250 }],
    connect: true,
    viewport: { x: -1051, y: -461, zoom: 1.515 },
  })

  await expect
    .poll(async () => (await visibleTargetConnectionGeometry(page)).representation)
    .toBe('canvas')

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: -500, y: -305, zoom: 1.263 })
  })

  await expect
    .poll(async () => (await visibleTargetConnectionGeometry(page)).representation)
    .toBe('dom')
  await expect
    .poll(async () => (await visibleTargetConnectionGeometry(page)).targetSeparation)
    .toBeLessThanOrEqual(0.5)
  await expect
    .poll(async () => (await visibleTargetConnectionGeometry(page)).arrowTipSeparation)
    .toBeLessThanOrEqual(0.5)
})

// Zoom 0.325 is the midpoint of the Reading↔Overview body crossfade, where real card
// nodes retain interaction authority. The compensated chrome must carry a
// real handle-to-handle connect and a pill click to the popover there.
test('connecting and editing retain screen-size floors inside the Reading crossfade (zoom 0.325)', async ({ page }) => {
  await seedBoard(page, {
    positions: [{ x: 0, y: 0 }, { x: 500, y: 0 }],
    viewport: { x: 300, y: 400, zoom: 0.325 },
  })

  expect(await page.locator('.board-flow').evaluate((board) => [
    '--e-handle-scale',
    '--e-connector-flow-size',
    '--e-connector-flow-stroke',
    '--e-connector-flow-focus-ring',
    '--e-connector-hit-inner-scale',
    '--e-pill-scale',
    '--e-reading-card-opacity',
  ].filter((property) => (board as HTMLElement).style.getPropertyValue(property)))).toEqual([])

  // Handles keep a hit-testable screen size.
  const fromHandle = await handleCenter(page, 'feel-a', 'right')
  // Browser transform rounding may report just under the 5 px CSS floor.
  expect(fromHandle.width).toBeGreaterThanOrEqual(4.9)

  await connectByHandleDrag(page)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const devWindow = window as unknown as { __eido: EidoDevStore }
        return devWindow.__eido.getState().connections.map((c) => `${c.from.cardId}->${c.to.cardId}`)
      }),
    )
    .toContain('feel-a->feel-b')

  // The midpoint pill keeps a clickable screen size and opens the editor,
  // which counter-scales to read at screen size.
  const connectionId = await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    return devWindow.__eido.getState().connections[0]!.id
  })
  const pill = page.locator(`.connection-pill[data-connection-id="${connectionId}"]`)
  const pillBox = await pill.boundingBox()
  expect(pillBox).not.toBeNull()
  expect(pillBox!.width).toBeGreaterThanOrEqual(11.9)

  await pill.click()
  const popover = page.locator(`.connection-popover[data-connection-id="${connectionId}"]`)
  await expect(popover).toBeVisible()
  const popoverBox = await popover.boundingBox()
  expect(popoverBox!.width).toBeGreaterThanOrEqual(200)
})
