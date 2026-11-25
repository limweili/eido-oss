import { expect, test } from '@playwright/test'

test('overview canvas repaints exact semantic pixels when the palette changes', async ({ page }) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const overviewModulePath = '/src/canvas/BoardOverviewLayer.tsx'
    const planningModulePath = '/src/canvas/renderPlanning.ts'
    const tokensModulePath = '/src/ui/tokens.ts'
    const { drawOverviewLayer } = await import(overviewModulePath)
    const { createBoardRenderIndex } = await import(planningModulePath)
    const { painterPaletteForTheme, painterPaletteIdentity } = await import(tokensModulePath)

    const cards = [
      { id: 'note', kind: 'note', blocks: [], position: { x: 40, y: 60 } },
      { id: 'mod', kind: 'mod', blocks: [], position: { x: 400, y: 60 } },
      { id: 'conversation', kind: 'conversation', blocks: [], position: { x: 760, y: 60 } },
      { id: 'group', kind: 'group', blocks: [], position: { x: 1120, y: 60 } },
    ]
    const canvas = document.createElement('canvas')
    canvas.id = 'design-token-palette-proof'
    document.body.append(canvas)
    const renderIndex = createBoardRenderIndex(cards, [])
    const viewport = { x: 0, y: 0, zoom: 0.25 }
    const viewportSize = { width: 400, height: 120 }

    const paint = (palette: ReturnType<typeof painterPaletteForTheme>) => {
      drawOverviewLayer({
        canvas,
        renderIndex,
        cards,
        connections: [],
        connectionCandidateCount: 0,
        viewport,
        viewportSize,
        renderCards: true,
        selectedCardIds: new Set(),
        reactCardIds: new Set(),
        suppressedCardIds: new Set(),
        measuredCardSizesById: new Map(),
        palette,
        paintIdentity: painterPaletteIdentity(palette),
      })
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Missing overview proof context')
      const ratio = canvas.width / viewportSize.width
      return cards.map((card) => {
        const centerX = (card.position.x + 260 / 2) * viewport.zoom
        const centerY = (card.position.y + 180 / 2) * viewport.zoom
        return Array.from(context.getImageData(Math.floor(centerX * ratio), Math.floor(centerY * ratio), 1, 1).data)
      })
    }

    const hexPixel = (hex: string) => {
      const value = Number.parseInt(hex.slice(1), 16)
      return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255]
    }
    const expected = (palette: ReturnType<typeof painterPaletteForTheme>) => [
      hexPixel(palette.cards.note.fill),
      hexPixel(palette.cards.mod.fill),
      hexPixel(palette.cards.conversation.fill),
      hexPixel(palette.cards.group.fill),
    ]

    const light = painterPaletteForTheme('light')
    const dark = painterPaletteForTheme('dark')
    const lightPixels = paint(light)
    const darkPixels = paint(dark)
    return {
      lightPixels,
      darkPixels,
      expectedLightPixels: expected(light),
      expectedDarkPixels: expected(dark),
      identitiesDiffer: painterPaletteIdentity(light) !== painterPaletteIdentity(dark),
    }
  })

  expect(result.identitiesDiffer).toBe(true)
  expect(result.lightPixels).toEqual(result.expectedLightPixels)
  expect(result.darkPixels).toEqual(result.expectedDarkPixels)
  expect(result.darkPixels).not.toEqual(result.lightPixels)

  const gridDot = page.locator('.react-flow__background circle').first()
  const gridPaint = await gridDot.evaluate((circle) => {
    const pixelFor = (paint: string) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext('2d')!
      context.fillStyle = paint
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data)
    }
    return {
      circle: pixelFor(getComputedStyle(circle).fill),
      token: pixelFor(getComputedStyle(document.documentElement).getPropertyValue('--e-grid-dot')),
    }
  })
  expect(gridPaint.circle).toEqual(gridPaint.token)
})

test('label cache misses on dark paint, settles, then reuses the light bitmap', async ({ page }) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const labelModulePath = '/src/canvas/labelLayer.ts'
    const tokensModulePath = '/src/ui/tokens.ts'
    const {
      LABEL_FONT,
      createLabelBitmapCache,
      drawLabels,
      labelHaloForPalette,
      resolveLabelInk,
    } = await import(labelModulePath)
    const { painterPaletteForTheme, painterPaletteIdentity } = await import(tokensModulePath)

    const canvas = document.createElement('canvas')
    canvas.width = 420
    canvas.height = 100
    document.body.append(canvas)
    const context = canvas.getContext('2d')!
    const bitmapContexts: CanvasRenderingContext2D[] = []
    const cache = createLabelBitmapCache({
      createBitmapContext(deviceWidth: number, deviceHeight: number) {
        const bitmap = document.createElement('canvas')
        bitmap.width = deviceWidth
        bitmap.height = deviceHeight
        const bitmapContext = bitmap.getContext('2d')
        if (!bitmapContext) return null
        bitmapContexts.push(bitmapContext)
        return { source: bitmap, context: bitmapContext }
      },
    })
    const candidate = {
      id: 'palette-label-proof',
      text: 'PALETTE LABEL PROOF',
      displayPriority: 'landmark',
      pinToRegion: false,
      color: '#6a4fb0',
      hovered: false,
      selected: false,
      mountedInReading: false,
      x: 20,
      y: 30,
      width: 320,
      height: 60,
    }
    const hash = () => {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      let value = 2166136261
      for (const channel of pixels) {
        value ^= channel
        value = Math.imul(value, 16777619)
      }
      return value >>> 0
    }
    const paint = (palette: ReturnType<typeof painterPaletteForTheme>) => {
      context.clearRect(0, 0, canvas.width, canvas.height)
      const counters = drawLabels({
        context,
        band: 'overview',
        candidates: [candidate],
        viewportSize: { width: canvas.width, height: canvas.height },
        devicePixelRatio: 1,
        palette,
        paintIdentity: painterPaletteIdentity(palette),
        fontRevision: 0,
        cache,
      })
      return { misses: counters.labelCacheMissesPerFrame, entries: counters.cacheEntries, hash: hash() }
    }

    const light = painterPaletteForTheme('light')
    const dark = painterPaletteForTheme('dark')
    const lightCold = paint(light)
    const lightHit = paint(light)
    const darkCold = paint(dark)
    const darkHit = paint(dark)
    const lightReuse = paint(light)
    return {
      sequence: { lightCold, lightHit, darkCold, darkHit, lightReuse },
      expected: {
        lightHalo: labelHaloForPalette(light),
        darkHalo: labelHaloForPalette(dark),
        lightInk: resolveLabelInk(light, candidate.color),
        darkInk: resolveLabelInk(dark, candidate.color),
        font: LABEL_FONT,
      },
      bitmapPaints: bitmapContexts.map((bitmapContext) => ({
        halo: String(bitmapContext.strokeStyle),
        ink: String(bitmapContext.fillStyle),
        font: bitmapContext.font,
      })),
    }
  })

  expect(result.sequence.lightCold).toMatchObject({ misses: 1, entries: 1 })
  expect(result.sequence.lightHit).toMatchObject({ misses: 0, entries: 1 })
  expect(result.sequence.darkCold).toMatchObject({ misses: 1, entries: 2 })
  expect(result.sequence.darkHit).toMatchObject({ misses: 0, entries: 2 })
  expect(result.sequence.lightReuse).toMatchObject({ misses: 0, entries: 2 })
  expect(result.sequence.lightHit.hash).toBe(result.sequence.lightCold.hash)
  expect(result.sequence.darkHit.hash).toBe(result.sequence.darkCold.hash)
  expect(result.sequence.lightReuse.hash).toBe(result.sequence.lightCold.hash)
  expect(result.sequence.darkCold.hash).not.toBe(result.sequence.lightCold.hash)
  expect(result.expected.lightHalo).toBe('rgba(232, 228, 220, 0.92)')
  expect(result.expected.darkHalo).toBe('rgba(30, 27, 25, 0.92)')
  expect(result.expected.darkInk).not.toBe(result.expected.lightInk)
  expect(result.bitmapPaints).toEqual([
    { halo: result.expected.lightHalo, ink: result.expected.lightInk, font: result.expected.font },
    { halo: result.expected.darkHalo, ink: result.expected.darkInk, font: result.expected.font },
  ])
})

test('label canvas repaints after the exact JetBrains face becomes ready', async ({ page }) => {
  let fontRequestObserved = false
  let releaseFontRequest = () => {}
  const fontRequestGate = new Promise<void>((resolve) => {
    releaseFontRequest = resolve
  })

  await page.route('**/jetbrains-mono-latin-wght-400-700.woff2', async (route) => {
    fontRequestObserved = true
    await fontRequestGate
    await route.continue()
  })
  await page.exposeFunction('__eidoReleaseTestFont', () => releaseFontRequest())
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const result = await page.evaluate(async () => {
    const labelModulePath = '/src/canvas/labelLayer.ts'
    const tokensModulePath = '/src/ui/tokens.ts'
    const {
      LABEL_FONT,
      LABEL_FONT_LOAD,
      LABEL_FONT_SAMPLE,
      createLabelBitmapCache,
      drawLabels,
      loadLabelFont,
    } = await import(labelModulePath)
    const { painterPaletteForTheme } = await import(tokensModulePath)

    const palette = painterPaletteForTheme('light')
    const canvas = document.createElement('canvas')
    canvas.id = 'design-token-font-proof'
    canvas.width = 420
    canvas.height = 100
    document.body.append(canvas)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Missing font proof context')
    const cache = createLabelBitmapCache()
    const text = 'MWil1 → — … 0123456789'
    const candidate = {
      id: 'font-proof',
      text,
      displayPriority: 'landmark',
      pinToRegion: false,
      color: palette.label.ink,
      hovered: false,
      selected: false,
      mountedInReading: false,
      x: 20,
      y: 30,
      width: 320,
      height: 60,
    }
    const hash = () => {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      let value = 2166136261
      for (const channel of pixels) {
        value ^= channel
        value = Math.imul(value, 16777619)
      }
      return value >>> 0
    }
    const width = () => {
      context.save()
      context.font = LABEL_FONT
      const measured = context.measureText(text).width
      context.restore()
      return measured
    }
    const paint = (fontRevision: number) =>
      drawLabels({
        context,
        band: 'overview',
        candidates: [candidate],
        viewportSize: { width: canvas.width, height: canvas.height },
        devicePixelRatio: 1,
        palette,
        fontRevision,
        cache,
      })

    const readyBefore = document.fonts.check(LABEL_FONT_LOAD, LABEL_FONT_SAMPLE)
    const widthBefore = width()
    const before = paint(0)
    const hashBefore = hash()

    await (window as unknown as { __eidoReleaseTestFont: () => Promise<void> }).__eidoReleaseTestFont()
    await loadLabelFont(document.fonts)

    context.clearRect(0, 0, canvas.width, canvas.height)
    const readyAfter = document.fonts.check(LABEL_FONT_LOAD, LABEL_FONT_SAMPLE)
    const widthAfter = width()
    const after = paint(1)
    const hashAfter = hash()

    return {
      readyBefore,
      readyAfter,
      widthBefore,
      widthAfter,
      hashBefore,
      hashAfter,
      beforeMisses: before.labelCacheMissesPerFrame,
      afterMisses: after.labelCacheMissesPerFrame,
      beforeEntries: before.cacheEntries,
      afterEntries: after.cacheEntries,
    }
  })

  expect(fontRequestObserved).toBe(true)
  expect(result.readyBefore).toBe(false)
  expect(result.readyAfter).toBe(true)
  expect(result.beforeMisses).toBe(1)
  expect(result.afterMisses).toBe(1)
  expect(result.beforeEntries).toBe(1)
  expect(result.afterEntries).toBe(2)
  expect(result.hashAfter).not.toBe(result.hashBefore)
  expect(result.widthAfter).not.toBe(result.widthBefore)
})
