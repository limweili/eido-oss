import { expect, test } from '@playwright/test'

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    currentIdeaId: string
    addCardAssets: (cardId: string, assets: unknown[]) => void
  }
  setState: (state: unknown) => void
}

const pinReadingViewport = async (page: import('@playwright/test').Page) => {
  await expect
    .poll(async () => {
      await page.evaluate(() => {
        window.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
      })
      await page.waitForTimeout(80)
      return page.locator('.react-flow__viewport').evaluate((viewport) => getComputedStyle(viewport).transform)
    })
    .toBe('matrix(1, 0, 0, 1, 0, 0)')
}

const readPaintedCardHeight = (
  page: import('@playwright/test').Page,
  card: { x: number; y: number; width: number },
) => page.evaluate(({ x, y, width }) => {
  window.__EIDO_FORCE_OVERVIEW_DRAW__?.()
  const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
  const context = canvas?.getContext('2d')
  if (!canvas || !context) throw new Error('Missing overview canvas')
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  const pixelX = Math.round((x + width / 2 - rect.left) * scaleX)
  const firstPixelY = Math.round((y - rect.top) * scaleY)
  let lastPaintedPixelY = firstPixelY - 1
  let firstPaintedPixelY = firstPixelY
  let started = false
  for (let pixelY = firstPixelY; pixelY < canvas.height; pixelY += 1) {
    if (context.getImageData(pixelX, pixelY, 1, 1).data[3] > 0) {
      if (!started) firstPaintedPixelY = pixelY
      started = true
      lastPaintedPixelY = pixelY
    } else if (started) {
      break
    }
  }
  return (lastPaintedPixelY - firstPaintedPixelY + 1) / scaleY
}, card)

test('a previously rendered Card keeps its exact safety footprint after reload', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    devWindow.__eido.setState({
      cards: [
        ...Array.from({ length: 6 }, (_, index) => ({
          id: `durable-size-budget-${index}`,
          kind: 'note',
          blocks: [{ id: `durable-size-budget-block-${index}`, text: '' }],
          assets: [],
          position: { x: 80, y: 80 },
          size: { width: 260, height: 180 },
          zIndex: 1,
        })),
        {
          id: 'durable-size-target',
          kind: 'askAi',
          blocks: [{
            id: 'durable-size-target-block',
            text: 'A previously rendered Card must keep this exact footprint. '.repeat(8),
          }],
          position: { x: 500, y: 40 },
          zIndex: 2,
        },
      ],
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
  })
  await pinReadingViewport(page)

  const target = page.locator('.react-flow__node[data-id="durable-size-target"]')
  await expect.poll(async () => (await target.boundingBox())?.height ?? 0).toBeGreaterThan(200)

  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    // Six ordinary residents fill the text-weight pool. One 30-file Card
    // instead enters the separate oversize pool and cannot evict the target.
    for (let budget = 0; budget < 6; budget += 1) {
      devWindow.__eido.getState().addCardAssets(
        `durable-size-budget-${budget}`,
        Array.from({ length: 5 }, (_, index) => ({
          id: `durable-size-budget-file-${budget}-${index}`,
          kind: 'file',
          name: `budget-${index}.pdf`,
          mimeType: 'application/pdf',
          dataUrl: 'data:application/pdf;base64,JVBERi0=',
          size: 8,
          createdAt: '2026-08-21T00:00:00.000Z',
        })),
      )
    }
  })
  await expect(page.locator('.react-flow__node[data-id="durable-size-target"]')).toHaveCount(0)
  const paintedHeightBeforeReload = await readPaintedCardHeight(page, {
    x: 500,
    y: 40,
    width: 260,
  })
  expect(paintedHeightBeforeReload).toBeGreaterThan(250)
  await expect
    .poll(() => page.evaluate(() => {
      const state = (window as unknown as { __eido: EidoDevStore }).__eido.getState() as unknown as {
        cards: Array<{ id: string; size?: { width: number; height: number } }>
      }
      return state.cards.find((card) => card.id === 'durable-size-target')?.size
    }))
    .not.toBeUndefined()
  const adoptedSize = await page.evaluate(() => {
    const state = (window as unknown as { __eido: EidoDevStore }).__eido.getState() as unknown as {
      cards: Array<{ id: string; size?: { width: number; height: number } }>
    }
    return state.cards.find((card) => card.id === 'durable-size-target')?.size
  })
  if (!adoptedSize) throw new Error('Missing adopted size')
  expect(adoptedSize.width).toBeCloseTo(260, 0)
  expect(Math.abs(adoptedSize.height - paintedHeightBeforeReload)).toBeLessThanOrEqual(2)

  // Browser saves drain after a quiet window. A fixed 900ms reload discards
  // this fixture before that write, so inspect the durable board before reload.
  const ideaId = await page.evaluate(() => (
    window as unknown as { __eido: EidoDevStore }
  ).__eido.getState().currentIdeaId)
  await expect.poll(async () => {
    const response = await page.request.get(`/api/eido/ideas/${encodeURIComponent(ideaId)}`)
    const { board } = await response.json() as {
      board: { cards: Array<{ id: string; size?: { width: number; height: number } }> }
    }
    return board.cards.find((card) => card.id === 'durable-size-target')?.size
  }).toEqual(adoptedSize)
  await page.reload()
  await page.waitForFunction(() => Boolean((window as unknown as { __eido?: EidoDevStore }).__eido?.getState().hydrated))
  await pinReadingViewport(page)
  await expect(page.locator('.react-flow__node[data-id="durable-size-target"]')).toHaveCount(0)

  const paintedHeightAfterReload = await readPaintedCardHeight(page, {
    x: 500,
    y: 40,
    width: 260,
  })
  expect(Math.abs(paintedHeightAfterReload - paintedHeightBeforeReload)).toBeLessThanOrEqual(2)

  await page.mouse.click(630, 160)
  const activatedTarget = page.locator('.react-flow__node[data-id="durable-size-target"]')
  await activatedTarget.waitFor({ state: 'visible' })
  const activatedBox = await activatedTarget.boundingBox()
  if (!activatedBox) throw new Error('Missing activated target geometry')
  expect(Math.abs(activatedBox.height - paintedHeightAfterReload)).toBeLessThanOrEqual(2)
})

test('Overview keeps the exact measured height of an auto-height card after Reading unmounts it', async ({ page }) => {
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
          id: 'tall-auto-card',
          kind: 'askAi',
          blocks: [
            {
              id: 'tall-auto-card-block',
              text: 'Short question',
            },
          ],
          position: { x: 80, y: 80 },
          zIndex: 1,
        },
      ],
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
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 120, y: 120, zoom: 1 })
  })

  const node = page.locator('.react-flow__node[data-id="tall-auto-card"] .card')
  await node.waitFor()
  // Let the initial fit complete while the card is short, then grow it while
  // it is mounted so React Flow reports the real auto-height measurement.
  await page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'tall-auto-card',
          kind: 'askAi',
          blocks: [
            {
              id: 'tall-auto-card-block',
              text: 'A deliberately tall question. '.repeat(120),
            },
          ],
          position: { x: 80, y: 80 },
          zIndex: 1,
        },
      ],
    })
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 120, y: 120, zoom: 1 })
  })
  await expect.poll(async () => (await node.boundingBox())?.height ?? 0).toBeGreaterThan(500)
  const readingHeight = (await node.boundingBox())!.height

  await page.evaluate(() => {
    window.__EIDO_SET_VIEWPORT__?.({ x: 120, y: 20, zoom: 0.2 })
  })
  await page.waitForTimeout(900)
  await page.waitForFunction(() => {
    window.__EIDO_FORCE_OVERVIEW_DRAW__?.()
    const visualNodes = document.querySelectorAll('.react-flow__node:not(.react-flow__node-gestureProxy)').length
    return visualNodes === 0 && (window.__EIDO_OVERVIEW_CARD_IDS__?.has('tall-auto-card') ?? false)
  })

  const sample = await page.evaluate((measuredHeight) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
    const context = canvas?.getContext('2d')
    if (!canvas || !context) throw new Error('Missing overview canvas')
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const alphaAtCanvasPoint = (x: number, y: number) =>
      context.getImageData(Math.round(x * scaleX), Math.round(y * scaleY), 1, 1).data[3]

    const zoom = 0.2
    const cardLeft = 120 + 80 * zoom
    const cardTop = 20 + 80 * zoom
    const cardMidX = cardLeft + (260 * zoom) / 2
    return {
      // This point is far below the old 180px fallback but inside the real
      // measured body.
      alphaInsideTallBody: alphaAtCanvasPoint(cardMidX, cardTop + measuredHeight * zoom - 6),
      // The low-detail representation must end at the same measured bottom.
      alphaBelowTallBody: alphaAtCanvasPoint(cardMidX, cardTop + measuredHeight * zoom + 6),
    }
  }, readingHeight)

  expect(sample.alphaInsideTallBody).toBeGreaterThan(0)
  expect(sample.alphaBelowTallBody).toBe(0)
})

// #216/#217, rewritten by #309 (decay is removed — ADR 0021, every card is
// opacity 1, so the old opaque-vs-decayed two-card premise is meaningless):
// while the viewport is MOVING, a MOUNTED note's underlay stand-in must be a
// bare SILHOUETTE —
// - drawn (the dense perf gate's "every visible card represented" invariant)
// - pixel-aligned to the measured DOM size: a planning-estimate rect ghosts
//   out past a short auto-height note (the #126/#158 regression)
// - nothing but the flat body fill inside: no port discs, no header band, no
//   text — anything brighter than the flat fill doubles the real card's
//   content through the React node above it (#217)
test('motion-time underlay draws a mounted note as a bare pixel-aligned silhouette', async ({ page }) => {
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
          id: 'mounted-note',
          kind: 'note',
          blocks: [{ id: 'mounted-note-block', text: 'Short mounted note' }],
          position: { x: 80, y: 80 },
          zIndex: 1,
        },
      ],
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
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 120, y: 120, zoom: 1 })
  })

  await page.waitForSelector('.react-flow__node[data-id="mounted-note"]')
  await page.waitForFunction(() => Boolean(window.__EIDO_FORCE_OVERVIEW_DRAW__))

  // Settled baseline first (the #158 guarantee): the mounted note is
  // suppressed, so we know suppression works before we exercise motion.
  await page.waitForFunction(() => {
    window.__EIDO_FORCE_OVERVIEW_DRAW__?.()
    const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')
    return Number(layer?.dataset.suppressedReactCardCount ?? 0) === 1
  })

  // Nudge the viewport and sample the underlay inside the settle window
  // (motion state). Retry across frames until the underlay is actually in
  // its motion configuration (the mounted note drawn).
  const sample = await page.evaluate(async () => {
    const devWindow = window as unknown as {
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))

    for (let attempt = 0; attempt < 40; attempt += 1) {
      devWindow.__EIDO_SET_VIEWPORT__?.({ x: 120 + (attempt % 2 ? 40 : -40), y: 120, zoom: 1 })
      await nextFrame()
      await nextFrame()
      window.__EIDO_FORCE_OVERVIEW_DRAW__?.()

      const overviewIds = window.__EIDO_OVERVIEW_CARD_IDS__ ?? new Set<string>()
      if (!overviewIds.has('mounted-note')) continue

      const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')
      const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
      const context = canvas?.getContext('2d')
      if (!canvas || !context || !layer) throw new Error('Missing overview layer')
      const canvasRect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / canvasRect.width
      const scaleY = canvas.height / canvasRect.height
      const pixelAt = (clientX: number, clientY: number) => {
        const x = Math.round((clientX - canvasRect.left) * scaleX)
        const y = Math.round((clientY - canvasRect.top) * scaleY)
        if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return [0, 0, 0, 0]
        return Array.from(context.getImageData(x, y, 1, 1).data)
      }
      const alphaAt = (clientX: number, clientY: number) => pixelAt(clientX, clientY)[3]
      const card = document.querySelector<HTMLElement>('.react-flow__node[data-id="mounted-note"] .card')
      if (!card) throw new Error('Missing mounted card node')
      const rect = card.getBoundingClientRect()
      const midY = rect.top + rect.height / 2

      // The design system's paper fill is opaque. Compare complete pixels,
      // since alpha alone cannot distinguish paper from text or port discs.
      const bodyPixel = pixelAt(rect.left + rect.width / 2, rect.bottom - 8)
      const differenceFromBody = (pixel: number[]) => Math.max(
        ...pixel.map((value, index) => Math.abs(value - bodyPixel[index])),
      )
      let interiorDifference = 0
      for (let dy = 8; dy <= rect.height - 8; dy += 8) {
        interiorDifference = Math.max(
          interiorDifference,
          differenceFromBody(pixelAt(rect.left + rect.width / 2, rect.top + dy)),
        )
      }
      // Port probes: CH2 port discs sit ON the edge midpoints (radius ≤ 4px,
      // white fill at 0.92). Sampling 3px inside each edge midpoint lands
      // inside a disc if one was painted.
      const portDifference = Math.max(
        differenceFromBody(pixelAt(rect.left + 3, midY)),
        differenceFromBody(pixelAt(rect.right - 3, midY)),
      )
      // Alignment probes: nothing may paint below the measured DOM bottom —
      // a planning-estimate-sized silhouette leaks here (#216).
      let alphaBelow = 0
      for (let offset = 4; offset <= 56; offset += 8) {
        alphaBelow = Math.max(alphaBelow, alphaAt(rect.left + rect.width / 2, rect.bottom + offset))
      }

      return {
        drawn: true,
        silhouetteCount: Number(layer.dataset.silhouetteCardCount ?? -1),
        interiorDifference,
        portDifference,
        alphaBelow,
        alphaInsideBottom: alphaAt(rect.left + rect.width / 2, rect.bottom - 8),
        cardHeight: rect.height,
      }
    }
    throw new Error('Underlay never entered its motion configuration (mounted note stayed suppressed)')
  })

  // The natural-height floor now exceeds the old 180px planning estimate.
  // Probe both sides of the measured bottom to catch either a short fallback
  // or a silhouette leaking past the real Card.
  expect(sample.cardHeight).toBeGreaterThan(200)
  expect(sample.alphaInsideBottom).toBeGreaterThan(0)
  // Motion-time representation invariant (perf gate): the mounted note draws,
  // and it draws as a silhouette by the painter's own accounting.
  expect(sample.drawn).toBe(true)
  expect(sample.silhouetteCount).toBe(1)
  // ...visibly: only the same flat paper fill occupies the interior.
  expect(sample.interiorDifference).toBe(0)
  // No port discs on a silhouette — they would double the DOM card's ports.
  expect(sample.portDifference).toBe(0)
  // The #216 regression: an estimate-sized rect leaks below the real card.
  expect(sample.alphaBelow).toBe(0)
})

test('motion-time underlay keeps a Group translucent while the board moves', async ({ page }) => {
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
          id: 'translucent-group',
          kind: 'group',
          title: 'Translucent group',
          blocks: [],
          position: { x: 80, y: 80 },
          size: { width: 420, height: 260 },
          zIndex: 1,
        },
      ],
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
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 120, y: 120, zoom: 1 })
  })

  await page.waitForSelector('.react-flow__node[data-id="translucent-group"]')
  await page.waitForFunction(() => {
    window.__EIDO_FORCE_OVERVIEW_DRAW__?.()
    const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')
    return Number(layer?.dataset.suppressedReactCardCount ?? 0) === 1
  })

  const settledOpacity = await page.locator('.react-flow__node[data-id="translucent-group"] .card').evaluate((group) => {
    const sample = document.createElement('canvas')
    sample.width = 1
    sample.height = 1
    const context = sample.getContext('2d')
    if (!context) throw new Error('Missing Group color sampling context')
    context.fillStyle = getComputedStyle(group).backgroundColor
    context.fillRect(0, 0, 1, 1)
    return context.getImageData(0, 0, 1, 1).data[3] / 255
  })

  const movingOpacity = await page.evaluate(async () => {
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))

    for (let attempt = 0; attempt < 40; attempt += 1) {
      window.__EIDO_SET_VIEWPORT__?.({ x: 120 + (attempt % 2 ? 40 : -40), y: 120, zoom: 1 })
      await nextFrame()
      await nextFrame()
      window.__EIDO_FORCE_OVERVIEW_DRAW__?.()

      if (!(window.__EIDO_OVERVIEW_CARD_IDS__?.has('translucent-group') ?? false)) continue

      const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')
      if (Number(layer?.dataset.silhouetteCardCount ?? 0) !== 1) continue

      const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
      const group = document.querySelector<HTMLElement>('.react-flow__node[data-id="translucent-group"] .card')
      const context = canvas?.getContext('2d')
      if (!canvas || !group || !context) throw new Error('Missing Group underlay')

      const canvasRect = canvas.getBoundingClientRect()
      const groupRect = group.getBoundingClientRect()
      const scaleX = canvas.width / canvasRect.width
      const scaleY = canvas.height / canvasRect.height
      const x = Math.round((groupRect.left + groupRect.width / 2 - canvasRect.left) * scaleX)
      const y = Math.round((groupRect.top + groupRect.height / 2 - canvasRect.top) * scaleY)
      const underlayOpacity = context.getImageData(x, y, 1, 1).data[3] / 255

      const sample = document.createElement('canvas')
      sample.width = 1
      sample.height = 1
      const sampleContext = sample.getContext('2d')
      if (!sampleContext) throw new Error('Missing Group color sampling context')
      sampleContext.fillStyle = getComputedStyle(group).backgroundColor
      sampleContext.fillRect(0, 0, 1, 1)
      const cardOpacity = sampleContext.getImageData(0, 0, 1, 1).data[3] / 255

      return {
        cardOpacity,
        underlayOpacity,
        combinedOpacity: cardOpacity + underlayOpacity * (1 - cardOpacity),
      }
    }

    throw new Error('Group underlay never entered its motion configuration')
  })

  expect(settledOpacity).toBeGreaterThan(0)
  expect(
    movingOpacity.combinedOpacity,
    `settled ${settledOpacity}; moving card ${movingOpacity.cardOpacity}; underlay ${movingOpacity.underlayOpacity}`,
  ).toBeCloseTo(settledOpacity, 2)
})

// B1's micro-bench (#309): the measured cost of one halo+ink label paint —
// `strokeText` then `fillText` at B2's frozen visual spec (12px system-ui at
// weight 500, 3px round-join halo) on a dpr-2 canvas. B2's label bitmap
// cache (#310) is sized against this number; it lives here so the [MANUAL]
// overviewGhosting gate re-measures it on the same real-browser runtime.
test('micro-bench: fillText+strokeText µs per label pair at dpr 2', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(() => {
    const ratio = 2
    const canvas = document.createElement('canvas')
    canvas.width = 1024 * ratio
    canvas.height = 512 * ratio
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Missing 2d context')
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.font = '500 12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    context.textBaseline = 'middle'
    context.lineJoin = 'round'
    context.miterLimit = 2
    context.lineWidth = 3
    context.strokeStyle = 'rgba(255, 253, 248, 0.92)'
    context.fillStyle = '#1f4a3f'

    const labels = Array.from({ length: 64 }, (_, i) => `Label sample ${i} — what is this app NOT supposed to be?`.slice(0, 12 + (i % 36)))
    const flush = () => context.getImageData(0, 0, 1, 1)

    // Warm up font rasterization and the canvas pipeline.
    for (let i = 0; i < 500; i += 1) {
      const label = labels[i % labels.length]
      context.strokeText(label, (i * 13) % 800, 20 + ((i * 7) % 460))
      context.fillText(label, (i * 13) % 800, 20 + ((i * 7) % 460))
    }
    flush()

    const PAIRS_PER_BATCH = 2000
    const batchDurationsMs: number[] = []
    for (let batch = 0; batch < 9; batch += 1) {
      const start = performance.now()
      for (let i = 0; i < PAIRS_PER_BATCH; i += 1) {
        const label = labels[(batch + i) % labels.length]
        const x = (i * 13) % 800
        const y = 20 + ((i * 7) % 460)
        context.strokeText(label, x, y)
        context.fillText(label, x, y)
      }
      flush()
      batchDurationsMs.push(performance.now() - start)
    }

    batchDurationsMs.sort((a, b) => a - b)
    const medianMs = batchDurationsMs[Math.floor(batchDurationsMs.length / 2)]
    return {
      devicePixelRatioSimulated: ratio,
      pairsPerBatch: PAIRS_PER_BATCH,
      batchesMs: batchDurationsMs.map((ms) => Number(ms.toFixed(2))),
      medianUsPerPair: Number(((medianMs * 1000) / PAIRS_PER_BATCH).toFixed(2)),
    }
  })

  console.log(
    `fillText+strokeText micro-bench @ dpr ${result.devicePixelRatioSimulated}: ` +
      `${result.medianUsPerPair} µs per pair (median of ${result.batchesMs.length} × ${result.pairsPerBatch} pairs; batches ms: ${result.batchesMs.join(', ')})`,
  )
  expect(result.medianUsPerPair).toBeGreaterThan(0)
})
