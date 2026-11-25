import { expect, test, type Locator, type Page } from '@playwright/test'
import { createSeedMod } from '../mods'
import { DEFAULT_CARD_IDENTITY, resolveCardIdentity } from '../ui/cardIdentity'

type TestCard = {
  id: string
  kind: 'note' | 'askAi' | 'group' | 'mod' | 'conversation' | 'result' | 'title'
  blocks: Array<{ id: string; text: string }>
  position: { x: number; y: number }
  size?: { width: number; height: number }
  title?: string
  headerColor?: string
  headerFill?: 'half' | 'full' | 'pattern'
  modV2?: ReturnType<typeof createSeedMod>
  zIndex?: number
}

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    cards: TestCard[]
    undoStack: unknown[]
    redoStack: unknown[]
    intentLog: Array<{ type?: string }>
    boardChangeSeq: number
    saveState: string
    undo: () => void
  }
  setState: (state: unknown) => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
  __EIDO_SET_GESTURE_PARTICIPANTS__?: (cardIds: readonly string[]) => void
}

async function seedCards(
  page: Page,
  cards: TestCard[],
  viewport = { x: 120, y: 90, zoom: 1 },
  intentLog: unknown[] = [],
  graph: { connections?: unknown[]; outputs?: unknown[]; runs?: unknown[] } = {},
) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(
      devWindow.__eido?.getState().hydrated &&
        devWindow.__EIDO_SET_VIEWPORT__ &&
        devWindow.__EIDO_SET_GESTURE_PARTICIPANTS__,
    )
  })
  await page.evaluate(({ nextCards, nextIntentLog, nextGraph }) => {
    const store = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
    store.setState({
      cards: nextCards,
      connections: nextGraph.connections ?? [],
      outputs: nextGraph.outputs ?? [],
      runs: nextGraph.runs ?? [],
      intentLog: nextIntentLog,
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
  }, { nextCards: cards, nextIntentLog: intentLog, nextGraph: graph })
  for (let pin = 0; pin < 2; pin += 1) {
    await page.evaluate((nextViewport) => {
      ;(window as unknown as DevWindow).__EIDO_SET_VIEWPORT__?.(nextViewport)
    }, viewport)
    await page.waitForTimeout(250)
  }
}

async function selectCardThroughHeader(page: Page, card: Locator) {
  const point = await card.locator('.card-head').evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    for (let y = bounds.top + 0.5; y < bounds.bottom; y += 0.5) {
      for (let x = bounds.left + 0.5; x < bounds.right; x += 1) {
        if (document.elementFromPoint(x, y) === element) return { x, y }
      }
    }
    throw new Error('Missing Card header rail selection point')
  })
  await page.mouse.click(point.x, point.y)
  await expect(card).toHaveClass(/selected/)
}

function parseRgb(color: string) {
  const values = color.match(/[\d.]+/g)?.map(Number)
  if (!values || values.length < 3) throw new Error(`Expected computed RGB colour, received ${color}`)
  return values.slice(0, 3)
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (color: string) => {
    const linear = parseRgb(color).map((channel) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
  }
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

function readScene(page: Page) {
  return page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')
    const viewportElement = document.querySelector<HTMLElement>('.react-flow__viewport')
    const firstReadingNode = document.querySelector<HTMLElement>(
      '.react-flow__node:not(.react-flow__node-gestureProxy)',
    )
    const transform = viewportElement ? getComputedStyle(viewportElement).transform : 'none'
    const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null
    return {
      zoom: matrix?.a ?? null,
      mountedReactCards: document.querySelectorAll(
        '.react-flow__node:not(.react-flow__node-gestureProxy)',
      ).length,
      canvasRenderedCards: Number(layer?.dataset.renderedCardCount ?? -1),
      canvasRepresentation: layer?.dataset.representation ?? null,
      canvasRepresentationCards: Number(layer?.dataset.representationCount ?? -1),
      readingCardOpacity: Number(layer?.dataset.readingCardOpacity ?? -1),
      overviewCardOpacity: Number(layer?.dataset.overviewCardOpacity ?? -1),
      firstReadingNodeOpacity: firstReadingNode
        ? Number(getComputedStyle(firstReadingNode).opacity)
        : null,
    }
  })
}

async function settleAt(page: Page, viewport: { x: number; y: number; zoom: number }) {
  await page.evaluate((nextViewport) => {
    ;(window as unknown as DevWindow).__EIDO_SET_VIEWPORT__?.(nextViewport)
  }, viewport)
  await page.waitForTimeout(900)
  await page.evaluate(() => window.__EIDO_FORCE_OVERVIEW_DRAW__?.())
  return readScene(page)
}

async function sourceHandleAndEdgeStartSeparation(
  sourceHandle: Locator,
  edgePath: Locator,
) {
  const handle = await sourceHandle.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  })
  const edge = await edgePath.evaluate((element) => {
    const path = element as SVGPathElement
    const point = path.getPointAtLength(0)
    const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!)
    return { x: screenPoint.x, y: screenPoint.y }
  })
  return {
    handle,
    edge,
    separation: { x: Math.abs(handle.x - edge.x), y: Math.abs(handle.y - edge.y) },
  }
}

async function overviewAlphaAt(page: Page, point: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
    const context = canvas?.getContext('2d')
    if (!canvas || !context) throw new Error('Missing overview canvas')
    const bounds = canvas.getBoundingClientRect()
    const pixelX = Math.max(
      0,
      Math.min(canvas.width - 1, Math.floor(((x - bounds.left) * canvas.width) / bounds.width)),
    )
    const pixelY = Math.max(
      0,
      Math.min(canvas.height - 1, Math.floor(((y - bounds.top) * canvas.height) / bounds.height)),
    )
    return context.getImageData(pixelX, pixelY, 1, 1).data[3]
  }, point)
}

async function overviewPortAlphaSignatureAt(page: Page, point: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
    const context = canvas?.getContext('2d')
    if (!canvas || !context) throw new Error('Missing overview canvas')
    const bounds = canvas.getBoundingClientRect()
    const pixelX = Math.floor(((x - bounds.left) * canvas.width) / bounds.width)
    const pixelY = Math.floor(((y - bounds.top) * canvas.height) / bounds.height)
    const verticalOffset = Math.max(1, Math.round((14 * canvas.height) / bounds.height))
    const positiveExcessAt = (centerX: number, centerY: number) => {
      const radius = 6
      let alpha = 0
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const sampleX = Math.max(0, Math.min(canvas.width - 1, centerX + offsetX))
          const sampleY = Math.max(0, Math.min(canvas.height - 1, centerY + offsetY))
          const centerAlpha = context.getImageData(sampleX, sampleY, 1, 1).data[3]
          const aboveAlpha = context.getImageData(
            sampleX,
            Math.max(0, sampleY - verticalOffset),
            1,
            1,
          ).data[3]
          const belowAlpha = context.getImageData(
            sampleX,
            Math.min(canvas.height - 1, sampleY + verticalOffset),
            1,
            1,
          ).data[3]
          alpha += Math.max(0, centerAlpha - (aboveAlpha + belowAlpha) / 2)
        }
      }
      return alpha
    }
    // Subtract the same straight Card-edge footprint immediately above and
    // below the port. Test adjacent mapped pixels and take the strongest
    // integrated residual so a fractional centre cannot make one rounded
    // sample miss a port that this representation is required to paint.
    let residual = 0
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const centerX = pixelX + offsetX
        const centerY = pixelY + offsetY
        residual = Math.max(
          residual,
          positiveExcessAt(centerX, centerY),
        )
      }
    }
    return residual
  }, point)
}

const PAINTER_PORT_SIGNATURE_MIN = 1_000

async function overviewPainterPortPoint(
  page: Page,
  geometry: { position: { x: number; y: number }; size: { width: number; height: number } },
) {
  return page.evaluate(({ position, size }) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')!
    const viewport = canvas.closest('.react-flow')?.querySelector<HTMLElement>('.react-flow__viewport')
    const transform = viewport ? getComputedStyle(viewport).transform : 'none'
    const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : new DOMMatrixReadOnly()
    const bounds = canvas.getBoundingClientRect()
    return {
      x: bounds.x + matrix.e + (position.x + size.width) * matrix.a,
      y: bounds.y + matrix.f + (position.y + size.height / 2) * matrix.a,
    }
  }, geometry)
}

async function overviewPaintSpanAt(page: Page, point: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
    const context = canvas?.getContext('2d')
    if (!canvas || !context) throw new Error('Missing overview canvas')
    const bounds = canvas.getBoundingClientRect()
    const pixelX = Math.max(0, Math.min(canvas.width - 1, Math.floor(
      ((x - bounds.left) * canvas.width) / bounds.width,
    )))
    const pixelY = Math.max(0, Math.min(canvas.height - 1, Math.floor(
      ((y - bounds.top) * canvas.height) / bounds.height,
    )))
    const alphaAt = (sampleX: number, sampleY: number) => (
      context.getImageData(sampleX, sampleY, 1, 1).data[3]
    )
    const bodyAlpha = alphaAt(pixelX, pixelY)
    if (bodyAlpha === 0) return null
    // Follow only the uniform body fill. Selection rings, resize anchors,
    // strokes and midpoint ports are intentionally different alpha and must
    // not inflate this geometry oracle.
    const isBody = (sampleX: number, sampleY: number) => (
      Math.abs(alphaAt(sampleX, sampleY) - bodyAlpha) <= 1
    )
    let minX = pixelX
    let maxX = pixelX
    let minY = pixelY
    let maxY = pixelY
    while (minX > 0 && isBody(minX - 1, pixelY)) minX -= 1
    while (maxX < canvas.width - 1 && isBody(maxX + 1, pixelY)) maxX += 1
    while (minY > 0 && isBody(pixelX, minY - 1)) minY -= 1
    while (maxY < canvas.height - 1 && isBody(pixelX, maxY + 1)) maxY += 1
    const scaleX = bounds.width / canvas.width
    const scaleY = bounds.height / canvas.height
    return {
      x: bounds.x + minX * scaleX,
      y: bounds.y + minY * scaleY,
      width: (maxX - minX + 1) * scaleX,
      height: (maxY - minY + 1) * scaleY,
    }
  }, point)
}

async function waitForCardMeasurementQuiescence(page: Page, cardId: string) {
  await page.evaluate(async (nextCardId) => {
    await document.fonts.ready
    const node = document.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${nextCardId}"]`,
    )!
    await new Promise<void>((resolve) => {
      let changed = false
      let quietFrames = 0
      const observer = new ResizeObserver(() => {
        changed = true
      })
      observer.observe(node)
      const waitForQuietFrame = () => {
        if (changed) {
          changed = false
          quietFrames = 0
        } else {
          quietFrames += 1
        }
        if (quietFrames >= 2) {
          observer.disconnect()
          resolve()
          return
        }
        requestAnimationFrame(waitForQuietFrame)
      }
      requestAnimationFrame(waitForQuietFrame)
    })
  }, cardId)
}

async function setThemeThroughSettings(page: Page, theme: 'light' | 'dark') {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Board' }).click()
  const picker = dialog.getByRole('radiogroup', { name: 'Theme' })
  await picker.getByRole('radio', { name: theme === 'light' ? 'Light' : 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await dialog.getByRole('button', { name: 'Save and close settings' }).click()
  await expect(dialog).toBeHidden()
}

async function inspectFocusBoundary(control: Locator) {
  return control.evaluate((element) => {
    const style = getComputedStyle(element)
    const tokenProbe = document.createElement('span')
    tokenProbe.style.color = 'var(--e-go)'
    tokenProbe.style.background = 'var(--e-field-bg)'
    document.body.append(tokenProbe)
    const go = getComputedStyle(tokenProbe).color
    const field = getComputedStyle(tokenProbe).backgroundColor
    tokenProbe.style.color = 'var(--e-on-solid)'
    const onSolid = getComputedStyle(tokenProbe).color
    tokenProbe.style.color = 'var(--e-ink)'
    const ink = getComputedStyle(tokenProbe).color
    tokenProbe.remove()
    const rect = element.getBoundingClientRect()
    return {
      focusVisible: element.matches(':focus-visible'),
      borderColor: style.borderTopColor,
      borderWidth: style.borderTopWidth,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      background: style.backgroundColor,
      visible: { width: rect.width, height: rect.height },
      go,
      ink,
      onSolid,
      field,
    }
  })
}

async function inspectCardIdentity(card: Locator, dotSelector: string) {
  return card.evaluate((element, selector) => {
    const resolveColor = (declaration: string) => {
      const probe = document.createElement('span')
      probe.style.color = declaration
      element.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    }
    const kindToken = element.classList.contains('mod')
      ? '--e-mod'
      : element.classList.contains('conversation')
        ? '--e-convo'
        : '--e-ink'
    const dot = element.querySelector<HTMLElement>(selector)!
    const head = element.querySelector<HTMLElement>('.card-head')!
    return {
      dot: getComputedStyle(dot).backgroundColor,
      head: getComputedStyle(head).backgroundColor,
      hairline: getComputedStyle(head).borderBottomColor,
      identity: resolveColor('var(--card-header-color)'),
      onIdentity: resolveColor('var(--card-header-ink)'),
      kind: resolveColor(`var(${kindToken})`),
    }
  }, dotSelector)
}

test('full and pattern body rounding belongs only to standalone card bodies', async ({ page }) => {
  await seedCards(page, [
    {
      id: 'standalone-full-body',
      kind: 'note',
      blocks: [{ id: 'standalone-full-block', text: 'Full fill without a footer' }],
      position: { x: 80, y: 80 },
      size: { width: 260, height: 180 },
      headerColor: '#F1666D',
      headerFill: 'full',
    },
    {
      id: 'standalone-pattern-body',
      kind: 'note',
      blocks: [{ id: 'standalone-pattern-block', text: 'Pattern fill without a footer' }],
      position: { x: 400, y: 80 },
      size: { width: 260, height: 180 },
      headerColor: '#1B7550',
      headerFill: 'pattern',
    },
    {
      id: 'footed-full-body',
      kind: 'conversation',
      blocks: [{ id: 'footed-full-block', text: 'Full fill above a footer' }],
      position: { x: 80, y: 340 },
      size: { width: 260, height: 220 },
      headerColor: '#3568C6',
      headerFill: 'full',
    },
    {
      id: 'footed-pattern-body',
      kind: 'group',
      blocks: [{ id: 'footed-pattern-block', text: '' }],
      position: { x: 400, y: 340 },
      size: { width: 260, height: 220 },
      headerColor: '#ECA23B',
      headerFill: 'pattern',
    },
  ])

  const radii = await page.evaluate(() =>
    Object.fromEntries(
      [
        'standalone-full-body',
        'standalone-pattern-body',
        'footed-full-body',
        'footed-pattern-body',
      ].map((cardId) => {
        const card = document.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${cardId}"] > .card`,
        )!
        const body = card.querySelector<HTMLElement>(':scope > .card-body')!
        const style = getComputedStyle(body)
        return [
          cardId,
          {
            hasFoot: Boolean(card.querySelector(':scope > .card-foot')),
            left: style.borderBottomLeftRadius,
            right: style.borderBottomRightRadius,
          },
        ]
      }),
    ),
  )

  expect(radii).toEqual({
    'standalone-full-body': { hasFoot: false, left: '7px', right: '7px' },
    'standalone-pattern-body': { hasFoot: false, left: '7px', right: '7px' },
    'footed-full-body': { hasFoot: true, left: '0px', right: '0px' },
    'footed-pattern-body': { hasFoot: true, left: '0px', right: '0px' },
  })
})

test('the Reading shell and palette match the card design contract', async ({ page }) => {
  await seedCards(page, [
    {
      id: 'full-card',
      kind: 'note',
      blocks: [{ id: 'full-block', text: 'Assigned coral on-colour' }],
      position: { x: 80, y: 80 },
      size: { width: 260, height: 180 },
      title: 'Coral identity',
      headerColor: '#F1666D',
      headerFill: 'full',
      zIndex: 2,
    },
    {
      id: 'pattern-card',
      kind: 'note',
      blocks: [{ id: 'pattern-block', text: 'Technical hatch' }],
      position: { x: 400, y: 80 },
      size: { width: 260, height: 180 },
      title: 'Pattern identity',
      headerColor: '#1b7550',
      headerFill: 'pattern',
      zIndex: 1,
    },
    {
      id: 'group-card',
      kind: 'group',
      blocks: [],
      position: { x: 720, y: 80 },
      size: { width: 260, height: 180 },
      title: 'Group frame',
      zIndex: 0,
    },
  ])

  const fullNode = page.locator('.react-flow__node[data-id="full-card"]')
  const fullCard = fullNode.locator('.card')
  await expect(fullCard).toBeVisible()
  const beforeSelection = await fullCard.boundingBox()
  const rest = await fullCard.evaluate((element) => {
    const cardStyle = getComputedStyle(element)
    const head = element.querySelector<HTMLElement>('.card-head')!
    const body = element.querySelector<HTMLElement>('.card-body')!
    const dot = element.querySelector<HTMLElement>('.kind-dot')!
    const title = element.querySelector<HTMLElement>('.card-title-display')!
    return {
      radius: cardStyle.borderRadius,
      borderWidth: cardStyle.borderTopWidth,
      borderStyle: cardStyle.borderTopStyle,
      shadow: cardStyle.boxShadow,
      headHeight: head.getBoundingClientRect().height,
      headMinHeight: getComputedStyle(head).minHeight,
      bodyBottomRadius: {
        left: getComputedStyle(body).borderBottomLeftRadius,
        right: getComputedStyle(body).borderBottomRightRadius,
      },
      dot: { width: dot.getBoundingClientRect().width, height: dot.getBoundingClientRect().height },
      title: {
        family: getComputedStyle(title).fontFamily,
        size: getComputedStyle(title).fontSize,
        weight: getComputedStyle(title).fontWeight,
        lineHeight: getComputedStyle(title).lineHeight,
        color: getComputedStyle(title).color,
      },
    }
  })
  expect(rest).toMatchObject({
    radius: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    shadow: 'none',
    headMinHeight: '36px',
    bodyBottomRadius: { left: '7px', right: '7px' },
    dot: { width: 10, height: 10 },
  })
  expect(rest.headHeight).toBeGreaterThanOrEqual(36)
  expect(rest.title.family).toContain('JetBrains Mono')
  expect(rest.title.size).toBe('14px')
  expect(rest.title.weight).toBe('500')
  expect(Number.parseFloat(rest.title.lineHeight)).toBeCloseTo(18.9, 1)
  expect(rest.title.color).toBe('rgb(35, 32, 25)')

  await fullCard.locator('.card-head').click({ position: { x: 120, y: 18 } })
  await expect(fullCard).toHaveClass(/selected/)
  // Header selection owns movement only. The full editor opens from a
  // stationary body click, never as a side effect of selecting the shell.
  await expect(fullCard.locator('[data-editor-ready="true"]')).toHaveCount(0)
  const afterSelection = await fullCard.boundingBox()
  expect(afterSelection).toEqual(beforeSelection)
  const selected = await fullNode.evaluate((element) => {
    const frameStyle = getComputedStyle(element, '::after')
    const tokenProbe = document.createElement('span')
    tokenProbe.style.color = 'var(--e-go)'
    document.body.append(tokenProbe)
    const go = getComputedStyle(tokenProbe).color
    tokenProbe.remove()
    return {
      borderColor: frameStyle.borderTopColor,
      shadow: getComputedStyle(element).boxShadow,
      go,
    }
  })
  expect(selected.shadow).toBe('none')
  await expect.poll(() => fullNode.evaluate((element) => getComputedStyle(element, '::after').borderTopColor)).toBe(selected.go)
  const handles = fullCard.locator('.card-resize-handle')
  await expect(handles).toHaveCount(4)
  await expect(handles.first()).toHaveCSS('animation-name', 'card-resize-handle-enter')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(handles.first()).toHaveCSS('animation-duration', '0.001s')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect.poll(() => handles.first().evaluate((element) => {
    const entrance = element.getAnimations().find(
      (animation) => (animation as CSSAnimation).animationName === 'card-resize-handle-enter',
    )
    return entrance?.playState ?? 'absent'
  })).toBe('finished')
  for (let index = 0; index < 4; index += 1) {
    const box = await handles.nth(index).boundingBox()
    expect(box?.width).toBeCloseTo(9, 0)
    expect(box?.height).toBeCloseTo(9, 0)
  }
  const fineResizeTarget = await handles.first().evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      visible: { width: rect.width, height: rect.height },
      outwardTarget: [
        document.elementFromPoint(rect.right - 23.5, rect.bottom - 23.5),
        document.elementFromPoint(rect.right - 0.5, rect.bottom - 23.5),
        document.elementFromPoint(rect.right - 23.5, rect.bottom - 0.5),
        document.elementFromPoint(rect.right - 0.5, rect.bottom - 0.5),
      ].map((hit) => hit === element),
    }
  })
  expect(fineResizeTarget.visible.width).toBeCloseTo(9, 0)
  expect(fineResizeTarget.visible.height).toBeCloseTo(9, 0)
  expect(fineResizeTarget.outwardTarget).toEqual([true, true, true, true])

  const kindTrigger = fullCard.getByRole('button', { name: 'Card colour' })
  const titleButton = fullCard.getByRole('button', { name: 'Note title' })
  const fineHeadTargets = await fullCard.evaluate((element) => {
    const probe = (control: HTMLElement, offset: number, verticalOnly = false) => {
      const rect = control.getBoundingClientRect()
      const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      const points = verticalOnly
        ? [
            [center.x, center.y - offset],
            [center.x, center.y + offset],
          ]
        : [
            [center.x - offset, center.y],
            [center.x + offset, center.y],
            [center.x, center.y - offset],
            [center.x, center.y + offset],
          ]
      return {
        visible: { width: rect.width, height: rect.height },
        hits: points.map(([x, y]) => document.elementFromPoint(x!, y!) === control),
      }
    }
    return {
      kind: probe(element.querySelector<HTMLElement>('.kind-dot')!, 11.5),
      title: probe(element.querySelector<HTMLElement>('.card-title-display')!, 11.5, true),
      cornerOwners: (() => {
        const resize = element.querySelector<HTMLElement>('.card-resize-handle.top.left')!
        const kind = element.querySelector<HTMLElement>('.kind-dot')!
        const resizeRect = resize.getBoundingClientRect()
        const kindRect = kind.getBoundingClientRect()
        const collisionPoint = {
          x: (resizeRect.x + resizeRect.width / 2 + kindRect.x + kindRect.width / 2) / 2,
          y: (resizeRect.y + resizeRect.height / 2 + kindRect.y + kindRect.height / 2) / 2,
        }
        return [
          ...new Set(
            document
              .elementsFromPoint(collisionPoint.x, collisionPoint.y)
              .filter((owner) => owner === resize || owner === kind)
              .map((owner) => (owner === resize ? 'resize' : 'kind')),
          ),
        ]
      })(),
    }
  })
  expect(fineHeadTargets.kind.visible).toEqual({ width: 10, height: 10 })
  expect(fineHeadTargets.kind.hits).toEqual([true, true, true, true])
  expect(fineHeadTargets.title.visible.height).toBeLessThan(24)
  expect(fineHeadTargets.title.hits).toEqual([true, true])
  expect(fineHeadTargets.cornerOwners).toEqual(['kind'])

  await kindTrigger.focus()
  await page.keyboard.press('Shift+Tab')
  const keyboardHandle = handles.last()
  await expect(keyboardHandle).toBeFocused()
  const handleFocus = await inspectFocusBoundary(keyboardHandle)
  expect(handleFocus).toMatchObject({
    focusVisible: true,
    outlineStyle: 'none',
    visible: { width: 9, height: 9 },
  })
  // Chromium snaps the authored 1.5px boundary to one device pixel at DPR 1.
  expect(Number.parseFloat(handleFocus.borderWidth)).toBeGreaterThanOrEqual(1)
  expect(handleFocus.borderColor).toBe(handleFocus.onSolid)

  await page.mouse.move(20, 20)
  await kindTrigger.focus()
  await page.keyboard.press('Tab')
  await expect(titleButton).toBeFocused()
  await expect.poll(() => titleButton.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
  await expect.poll(() => titleButton.evaluate((element) => {
    const tokenProbe = document.createElement('span')
    tokenProbe.style.color = 'var(--e-go)'
    document.body.append(tokenProbe)
    const go = getComputedStyle(tokenProbe).color
    tokenProbe.remove()
    return getComputedStyle(element).borderBottomColor === go
  })).toBe(true)

  await kindTrigger.click()
  const popover = page.locator('.e-popover .card-color-popover')
  await expect(popover).toBeVisible()
  const palette = await popover.evaluate((element) => {
    const grid = element.querySelector<HTMLElement>('.e-colour-picker__swatches')!
    const swatches = [...grid.querySelectorAll<HTMLElement>('.e-colour-picker__swatch')]
    const modes = [...element.querySelectorAll<HTMLElement>('.e-colour-picker__mode')]
    const mode = modes[0]!
    const activeMode = modes.find((candidate) => candidate.getAttribute('aria-checked') === 'true')!
    const activeModeStyle = getComputedStyle(activeMode)
    const target = (control: HTMLElement) => {
      const rect = control.getBoundingClientRect()
      const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      return {
        visible: { width: rect.width, height: rect.height },
        hits: [
          document.elementFromPoint(center.x - 11.5, center.y),
          document.elementFromPoint(center.x + 11.5, center.y),
          document.elementFromPoint(center.x, center.y - 11.5),
          document.elementFromPoint(center.x, center.y + 11.5),
        ].map((hit) => hit === control),
      }
    }
    return {
      flow: getComputedStyle(grid).gridAutoFlow,
      identities: swatches.map((swatch) => swatch.style.getPropertyValue('--e-colour-picker-swatch')),
      modeTarget: target(mode),
      activeMode: {
        count: modes.filter((candidate) => candidate.getAttribute('aria-checked') === 'true').length,
        outlineStyle: activeModeStyle.outlineStyle,
        outlineWidth: activeModeStyle.outlineWidth,
        outlineOffset: activeModeStyle.outlineOffset,
      },
      swatchTarget: target(swatches[0]!),
      centres: swatches.map((swatch) => {
        const rect = swatch.getBoundingClientRect()
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
      }),
    }
  })
  expect(palette.flow).toBe('column')
  expect(palette.identities).toEqual([
    '#f1666d', '#c9282e', '#eca23b', '#b5540f', '#65b563', '#1b7550',
    '#48a2ef', '#3568c6', '#d66be8', '#9c3fba', '#8b939c', '#2e2b25',
  ])
  expect(palette.modeTarget.visible).toEqual({ width: 18, height: 18 })
  expect(palette.modeTarget.hits).toEqual([true, true, true, true])
  expect(palette.activeMode).toMatchObject({
    count: 1,
    outlineStyle: 'solid',
    outlineOffset: '2px',
  })
  expect(Number.parseFloat(palette.activeMode.outlineWidth)).toBeGreaterThanOrEqual(1)
  expect(palette.swatchTarget.visible).toEqual({ width: 18, height: 18 })
  expect(palette.swatchTarget.hits).toEqual([true, true, true, true])
  expect(new Set(palette.centres.map(({ x }) => x)).size).toBe(6)
  expect(new Set(palette.centres.map(({ y }) => y)).size).toBe(2)
  for (let pair = 0; pair < 6; pair += 1) {
    expect(palette.centres[pair * 2]!.x).toBe(palette.centres[pair * 2 + 1]!.x)
  }

  const softFill = popover.getByRole('radio', { name: 'Soft fill' })
  await page.keyboard.press('ArrowDown')
  await softFill.focus()
  await expect(softFill).toBeFocused()
  const modeFocus = await inspectFocusBoundary(softFill)
  expect(modeFocus).toMatchObject({ focusVisible: true, outlineStyle: 'none' })
  await expect.poll(
    () => softFill.evaluate((element) => getComputedStyle(element).borderTopColor),
  ).toBe(modeFocus.go)

  const firstSwatch = popover.locator('.e-colour-picker__swatch').first()
  await page.keyboard.press('ArrowDown')
  await firstSwatch.focus()
  await expect(firstSwatch).toBeFocused()
  const swatchFocus = await inspectFocusBoundary(firstSwatch)
  expect(swatchFocus).toMatchObject({ focusVisible: true, outlineStyle: 'solid' })
  expect(Number.parseFloat(swatchFocus.outlineWidth)).toBeGreaterThanOrEqual(1)
  expect(swatchFocus.outlineColor).toBe(swatchFocus.ink)

  const pattern = await page.locator('.react-flow__node[data-id="pattern-card"] .card').evaluate((element) => {
    const head = element.querySelector<HTMLElement>('.card-head')!
    const body = element.querySelector<HTMLElement>('.card-body')!
    return {
      headImage: getComputedStyle(head).backgroundImage,
      bodyImage: getComputedStyle(body).backgroundImage,
    }
  })
  expect(pattern.headImage).toBe('none')
  expect(pattern.bodyImage).toContain('repeating-linear-gradient')
  expect(pattern.bodyImage).toContain('1px')
  expect(pattern.bodyImage).toContain('8px')

  const group = await page.locator('.react-flow__node[data-id="group-card"] .card').evaluate((element) => {
    const style = getComputedStyle(element)
    return { width: style.borderTopWidth, style: style.borderTopStyle, shadow: style.boxShadow }
  })
  expect(group.style).toBe('dashed')
  expect(group.shadow).toBe('none')
  // Chromium snaps a 1.5 CSS-pixel border to one device pixel at DPR 1; the
  // authored recipe is pinned separately while this gate proves the rendering.
  expect(Number.parseFloat(group.width)).toBeGreaterThanOrEqual(1)
})

test('selected Card boundary ink coincides with every Reading shell at every zoom', async ({
  page,
}) => {
  const positionAt = (index: number) => ({
    x: 20 + (index % 4) * 155,
    y: 20 + Math.floor(index / 4) * 120,
  })
  const size = { width: 140, height: 100 }
  const cards: TestCard[] = [
    {
      id: 'selection-frame-note',
      kind: 'note',
      blocks: [{ id: 'selection-frame-note-block', text: 'Note' }],
      position: positionAt(0),
      size,
    },
    {
      id: 'selection-frame-ask',
      kind: 'askAi',
      blocks: [{ id: 'selection-frame-ask-block', text: 'Ask AI' }],
      position: positionAt(1),
      size,
    },
    {
      id: 'selection-frame-result',
      kind: 'result',
      blocks: [{ id: 'selection-frame-result-block', text: '' }],
      position: positionAt(2),
      size,
    },
    {
      id: 'selection-frame-conversation',
      kind: 'conversation',
      blocks: [{ id: 'selection-frame-conversation-block', text: 'Conversation' }],
      position: positionAt(3),
      size,
    },
    {
      id: 'selection-frame-mod',
      kind: 'mod',
      blocks: [{ id: 'selection-frame-mod-block', text: '' }],
      position: positionAt(4),
      size,
      modV2: createSeedMod('slider', {
        createId: (role, ordinal) => `selection-frame-mod-${role}-${ordinal}`,
      }),
    },
    {
      id: 'selection-frame-group',
      kind: 'group',
      blocks: [],
      position: positionAt(5),
      size,
    },
    {
      id: 'selection-frame-title',
      kind: 'title',
      blocks: [{ id: 'selection-frame-title-block', text: 'Title' }],
      position: positionAt(6),
      size,
    },
  ]
  await seedCards(page, cards)

  const cardIds = cards.filter((card) => card.kind !== 'title').map((card) => card.id)
  await page.keyboard.down('Shift')
  for (const cardId of cardIds) {
    const node = page.locator(`.react-flow__node[data-id="${cardId}"]`)
    await selectCardThroughHeader(page, node.locator('.card'))
  }
  await page.keyboard.up('Shift')

  const expectAlignedAtCurrentZoom = async (cardId: string, zoom: number) => {
    const node = page.locator(`.react-flow__node[data-id="${cardId}"]`)
    await expect(node).toHaveClass(/selected/)
    const alignment = await node.evaluate((element) => {
      const shell = element.querySelector<HTMLElement>(':scope > .card, :scope > .title-card')
      if (!shell) throw new Error('Expected a Card shell')
      const nodeBounds = element.getBoundingClientRect()
      const shellBounds = shell.getBoundingClientRect()
      const frame = getComputedStyle(element, '::after')
      const viewport = element.closest('.react-flow')?.querySelector<HTMLElement>('.react-flow__viewport')
      const transform = viewport ? getComputedStyle(viewport).transform : 'none'
      const scale = transform && transform !== 'none'
        ? new DOMMatrixReadOnly(transform).a
        : 1
      const frameBounds = {
        left: nodeBounds.left + Number.parseFloat(frame.left) * scale,
        top: nodeBounds.top + Number.parseFloat(frame.top) * scale,
        right: nodeBounds.right - Number.parseFloat(frame.right) * scale,
        bottom: nodeBounds.bottom - Number.parseFloat(frame.bottom) * scale,
      }
      return {
        frameBounds,
        shellBounds: {
          left: shellBounds.left,
          top: shellBounds.top,
          right: shellBounds.right,
          bottom: shellBounds.bottom,
        },
      }
    })
    const maximumEdgeDelta = Math.max(
      Math.abs(alignment.frameBounds.left - alignment.shellBounds.left),
      Math.abs(alignment.frameBounds.top - alignment.shellBounds.top),
      Math.abs(alignment.frameBounds.right - alignment.shellBounds.right),
      Math.abs(alignment.frameBounds.bottom - alignment.shellBounds.bottom),
    )
    expect(maximumEdgeDelta, `${cardId} at ${zoom}×`).toBeLessThan(0.1)
  }

  for (const zoom of [0.6, 1, 2]) {
    await settleAt(page, { x: 120, y: 90, zoom })
    for (const cardId of cardIds) await expectAlignedAtCurrentZoom(cardId, zoom)
  }

  const titleId = 'selection-frame-title'
  const titleNode = page.locator(`.react-flow__node[data-id="${titleId}"]`)
  await titleNode.locator('.title-card-input').click({ position: { x: 70, y: 50 } })
  await expect(titleNode).toHaveClass(/selected/)
  for (const zoom of [0.6, 1, 2]) {
    await settleAt(page, { x: 120, y: 90, zoom })
    await expectAlignedAtCurrentZoom(titleId, zoom)
  }
})

test('an open card colour popover follows its trigger through pan and zoom', async ({ page }) => {
  await seedCards(page, [
    {
      id: 'anchored-palette-card',
      kind: 'note',
      blocks: [{ id: 'anchored-palette-block', text: 'Keep the palette attached.' }],
      position: { x: 260, y: 220 },
      size: { width: 280, height: 180 },
      title: 'Anchored palette',
      headerColor: '#9c3fba',
      headerFill: 'pattern',
    },
  ])

  const card = page.locator('.react-flow__node[data-id="anchored-palette-card"] .card')
  const trigger = card.getByRole('button', { name: 'Card colour' })
  await trigger.click()
  const popover = page.locator('.e-popover .card-color-popover')
  await expect(popover).toBeVisible()
  // Visibility can precede the popover's entrance and the trigger's hover
  // motion. Measure anchoring against their settled geometry, not a frame
  // partway through those independent transforms.
  await expect(page.locator('.e-popover')).toHaveAttribute('data-state', 'entered')
  await trigger.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished))
  })
  await popover.evaluate(async (element) => {
    await Promise.all(element.closest('.e-popover')!.getAnimations().map((animation) => animation.finished))
  })

  const anchorOffset = () => page.evaluate(() => {
    const triggerElement = document.querySelector<HTMLElement>(
      '.react-flow__node[data-id="anchored-palette-card"] .kind-dot',
    )
    const popoverElement = document.querySelector<HTMLElement>('.e-popover .card-color-popover')
    if (!triggerElement || !popoverElement) throw new Error('Missing palette anchor geometry')
    const triggerBounds = triggerElement.getBoundingClientRect()
    const popoverBounds = popoverElement.getBoundingClientRect()
    return {
      x: popoverBounds.x - triggerBounds.left,
      y: popoverBounds.y - triggerBounds.bottom,
    }
  })
  const originalOffset = await anchorOffset()
  const expectAnchored = async () => {
    await expect.poll(async () => {
      const currentOffset = await anchorOffset()
      return Math.max(
        Math.abs(currentOffset.x - originalOffset.x),
        Math.abs(currentOffset.y - originalOffset.y),
      )
    }, { timeout: 1_500 }).toBeLessThan(2)
  }

  await page.evaluate(() => {
    ;(window as unknown as DevWindow).__EIDO_SET_VIEWPORT__?.({ x: 180, y: 130, zoom: 1 })
  })
  await expectAnchored()

  await page.evaluate(() => {
    ;(window as unknown as DevWindow).__EIDO_SET_VIEWPORT__?.({ x: 180, y: 130, zoom: 0.8 })
  })
  await expectAnchored()
})

test('Fill styles keep tooltips while card colour swatches stay quiet in both themes', async ({
  page,
}) => {
  await seedCards(page, [
    {
      id: 'tooltip-card',
      kind: 'note',
      blocks: [{ id: 'tooltip-card-block', text: 'Tooltip composition' }],
      position: { x: 320, y: 180 },
      size: { width: 320, height: 220 },
      title: 'Tooltip card',
      headerColor: '#F1666D',
      headerFill: 'half',
    },
  ])
  const card = page.locator('.react-flow__node[data-id="tooltip-card"] .card')
  const trigger = card.getByRole('button', { name: 'Card colour' })
  const expectKeyboardTooltip = async (
    control: Locator,
    blurTarget: Locator,
    content: string,
  ) => {
    // Send a real key through this Tooltip's composed handler, then refocus it.
    // Card colour uses Popover's deliberate Tab-to-dismiss contract, so Tab is
    // not an in-layer navigation key for these plain controls.
    await control.focus()
    await page.keyboard.press('ArrowDown')
    await blurTarget.focus()
    await control.focus()
    await expect(control).toBeFocused()
    await expect.poll(
      () => control.evaluate((element) => element.matches(':focus-visible')),
    ).toBe(true)
    const tooltip = page.locator('.e-tooltip').filter({ hasText: content })
    await expect(tooltip).toBeVisible({ timeout: 1_500 })
    const tooltipId = await tooltip.getAttribute('id')
    expect(tooltipId).not.toBeNull()
    await expect(control).toHaveAttribute('aria-describedby', tooltipId!)
  }
  const expectHoverTooltip = async (control: Locator, content: string) => {
    await control.hover()
    const tooltip = page.locator('.e-tooltip').filter({ hasText: content })
    await expect(tooltip).toBeVisible({ timeout: 1_500 })
    const tooltipId = await tooltip.getAttribute('id')
    expect(tooltipId).not.toBeNull()
    await expect(control).toHaveAttribute('aria-describedby', tooltipId!)
    await page.mouse.move(1_000, 100)
    await expect(tooltip).toBeHidden()
  }

  for (const theme of ['light', 'dark'] as const) {
    await setThemeThroughSettings(page, theme)
    await expect(card.locator('.kind-dot[title]')).toHaveCount(0)
    await expectKeyboardTooltip(
      trigger,
      card.getByRole('button', { name: 'Note title' }),
      'CARD COLOUR',
    )
    await page.keyboard.press('Enter')

    const popover = page.locator('.e-popover .card-color-popover')
    await expect(popover).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(popover.locator('[title]')).toHaveCount(0)
    await expect(popover.locator('.e-colour-picker__modes > .e-colour-picker__mode')).toHaveCount(4)
    await expect(popover.locator('.e-colour-picker__swatches > .e-colour-picker__swatch')).toHaveCount(12)

    const noFill = popover.getByRole('radio', { name: 'No fill' })
    const softFill = popover.getByRole('radio', { name: 'Soft fill' })
    const charcoal = popover.getByRole('radio', { name: 'Set card colour Charcoal' })
    const red = popover.getByRole('radio', { name: 'Set card colour Red' })
    await expectHoverTooltip(softFill, 'SOFT FILL')
    await expectKeyboardTooltip(softFill, noFill, 'SOFT FILL')
    await charcoal.focus()
    await expect(page.locator('.e-tooltip')).toHaveCount(0)
    await expect(charcoal).not.toHaveAttribute('aria-describedby', /.+/)
    await charcoal.hover()
    await page.waitForTimeout(700)
    await expect(page.locator('.e-tooltip')).toHaveCount(0)
    await red.focus()
    await expect(page.locator('.e-tooltip')).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(popover).toBeHidden()
    await expect(trigger).toBeFocused()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  }
})

test('portalled fill specimens preview default, palette, and custom identities in both themes', async ({
  page,
}) => {
  const fixtures: readonly {
    id: string
    rawColor?: string
    headerFill?: 'half' | 'full' | 'pattern'
    x: number
  }[] = [
    { id: 'portal-default', x: 80 },
    { id: 'portal-coral', rawColor: '#F1666D', headerFill: 'pattern', x: 420 },
    { id: 'portal-custom', rawColor: '#777777', x: 760 },
  ]
  await seedCards(
    page,
    fixtures.map(({ id, rawColor, headerFill, x }) => ({
      id,
      kind: 'note',
      blocks: [{ id: `${id}-block`, text: `${rawColor ?? 'Default'} identity specimens` }],
      position: { x, y: 180 },
      size: { width: 300, height: 220 },
      title: `${rawColor ?? 'Default'} identity`,
      ...(rawColor ? { headerColor: rawColor, headerFill: headerFill ?? 'half' } : {}),
    })),
  )

  for (const theme of ['light', 'dark'] as const) {
    await setThemeThroughSettings(page, theme)
    for (const fixture of fixtures) {
      const card = page.locator(`.react-flow__node[data-id="${fixture.id}"] .card`)
      const beforeOpen = await page.evaluate((cardId) => {
        const state = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido.getState()
        return JSON.stringify({
          card: state.cards.find((candidate) => candidate.id === cardId),
          undoStack: state.undoStack,
          redoStack: state.redoStack,
        })
      }, fixture.id)
      await card.getByRole('button', { name: 'Card colour' }).click()
      const popover = page.locator('.e-popover .card-color-popover')
      await expect(popover).toBeVisible()

      const resolved = resolveCardIdentity(fixture.rawColor ?? DEFAULT_CARD_IDENTITY)
      const expectedVariables = {
        '--card-header-color': resolved.solid,
        '--card-header-soft': resolved.soft,
        '--card-header-body': resolved.body,
        '--card-header-ink': resolved.onSolid,
        '--card-header-pattern-head': resolved.patternHead,
        '--card-header-pattern': resolved.pattern,
      }

      const specimen = await popover.evaluate((element, { cardId, expectedVariables }) => {
        const sourceCard = document.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${cardId}"] .card`,
        )!
        const variables = [
          '--card-header-color',
          '--card-header-soft',
          '--card-header-body',
          '--card-header-ink',
          '--card-header-pattern-head',
          '--card-header-pattern',
        ] as const
        const modes = ['.half-fill', '.full-fill', '.pattern-fill'] as const
        const tokenProbe = document.createElement('span')
        tokenProbe.style.color = 'var(--e-ink-soft)'
        document.body.append(tokenProbe)
        const inkSoft = getComputedStyle(tokenProbe).color
        tokenProbe.style.color = 'var(--e-avoid)'
        const avoid = getComputedStyle(tokenProbe).color
        tokenProbe.remove()
        const values = (root: HTMLElement) =>
          Object.fromEntries(variables.map((name) => [name, root.style.getPropertyValue(name)]))
        const backgrounds = (identityVariables?: Record<string, string>) =>
          Object.fromEntries(
            modes.map((selector) => {
              const source = element.querySelector<HTMLElement>(selector)!
              const clone = source.cloneNode(true) as HTMLElement
              // The fill recipes are intentionally scoped to the Card colour
              // popover. Keep the oracle under that same selector without
              // inheriting the live portal's identity variables.
              const host = document.createElement('div')
              host.className = 'card-color-popover'
              if (identityVariables) {
                for (const [name, value] of Object.entries(identityVariables)) {
                  clone.style.setProperty(name, value)
                }
              }
              host.append(clone)
              document.body.append(host)
              const background = getComputedStyle(clone).backgroundImage
              host.remove()
              return [selector, background]
            }),
          )
        return {
          cardVariables: values(sourceCard),
          portalVariables: values(element as HTMLElement),
          actualBackgrounds: Object.fromEntries(
            modes.map((selector) => [
              selector,
              getComputedStyle(element.querySelector<HTMLElement>(selector)!).backgroundImage,
            ]),
          ),
          expectedBackgrounds: backgrounds(expectedVariables),
          fallbackBackgrounds: backgrounds(),
          noFill: {
            background: getComputedStyle(
              element.querySelector<HTMLElement>('.e-colour-picker__mode.no-color')!,
            ).backgroundImage,
            inkSoft,
            avoid,
          },
          cardPattern: getComputedStyle(
            sourceCard.querySelector<HTMLElement>('.card-body')!,
          ).backgroundImage,
        }
      }, { cardId: fixture.id, expectedVariables })

      if (fixture.rawColor) {
        expect(specimen.cardVariables).toEqual(expectedVariables)
      } else {
        expect(Object.values(specimen.cardVariables)).toEqual(['', '', '', '', '', ''])
      }
      expect(specimen.portalVariables).toEqual(expectedVariables)
      expect(specimen.actualBackgrounds).toEqual(specimen.expectedBackgrounds)
      expect(specimen.noFill.background).toContain(specimen.noFill.inkSoft)
      expect(specimen.noFill.background).not.toContain(specimen.noFill.avoid)
      expect(specimen.actualBackgrounds['.pattern-fill']).toContain('8px')
      if (fixture.headerFill === 'pattern') {
        expect(specimen.actualBackgrounds['.pattern-fill']).toBe(specimen.cardPattern)
      }
      for (const mode of ['.half-fill', '.full-fill', '.pattern-fill'] as const) {
        expect(specimen.actualBackgrounds[mode], `${theme} ${fixture.id} ${mode}`).not.toBe(
          specimen.fallbackBackgrounds[mode],
        )
      }
      const afterOpen = await page.evaluate((cardId) => {
        const state = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido.getState()
        return JSON.stringify({
          card: state.cards.find((candidate) => candidate.id === cardId),
          undoStack: state.undoStack,
          redoStack: state.redoStack,
        })
      }, fixture.id)
      expect(afterOpen).toBe(beforeOpen)

      await page.keyboard.press('Escape')
      await expect(popover).toBeHidden()
    }
  }
})

test('a coarse pointer gets 40px resize and palette targets without enlarging the controls', async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 1280, height: 720 },
  })
  const page = await context.newPage()
  try {
    await seedCards(page, [
      {
        id: 'coarse-resize-target',
        kind: 'note',
        blocks: [{ id: 'coarse-resize-block', text: 'Touch-safe resize target' }],
        position: { x: 240, y: 180 },
        size: { width: 300, height: 220 },
        title: 'Coarse pointer',
      },
    ])
    const card = page.locator('.react-flow__node[data-id="coarse-resize-target"] .card')
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)

    await card.locator('.card-head').click({ position: { x: 140, y: 18 } })
    const handle = card.locator('.card-resize-handle.top.left')
    await expect(handle).toBeVisible()
    await expect.poll(async () => (await handle.boundingBox())?.width ?? 0).toBeCloseTo(9, 0)
    const handleTarget = await handle.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      return {
        visible: { width: rect.width, height: rect.height },
        horizontalSpan: [
          document.elementFromPoint(center.x - 35, center.y - 10),
          document.elementFromPoint(center.x + 4, center.y - 10),
        ].map((hit) => hit === element),
        verticalSpan: [
          document.elementFromPoint(center.x - 10, center.y - 35),
          document.elementFromPoint(center.x - 10, center.y + 4),
        ].map((hit) => hit === element),
        inwardSeam: document.elementFromPoint(center.x + 4, center.y + 4) === element,
      }
    })
    expect(handleTarget.visible.width).toBeCloseTo(9, 0)
    expect(handleTarget.visible.height).toBeCloseTo(9, 0)
    expect(handleTarget.horizontalSpan).toEqual([true, true])
    expect(handleTarget.verticalSpan).toEqual([true, true])
    expect(handleTarget.inwardSeam).toBe(true)

    const coarseHeadTargets = await card.evaluate((element) => {
      const head = element.querySelector<HTMLElement>('.card-head')!
      const kind = element.querySelector<HTMLElement>('.kind-dot')!
      const kindRect = kind.getBoundingClientRect()
      const kindCenter = {
        x: kindRect.x + kindRect.width / 2,
        y: kindRect.y + kindRect.height / 2,
      }
      const title = element.querySelector<HTMLElement>('.card-title-display')!
      const titleRect = title.getBoundingClientRect()
      const titleCenter = {
        x: titleRect.x + titleRect.width / 2,
        y: titleRect.y + titleRect.height / 2,
      }
      const titleHits = [
        document.elementFromPoint(titleCenter.x, titleCenter.y - 19.5),
        document.elementFromPoint(titleCenter.x, titleCenter.y + 19.5),
      ]
      return {
        kind: {
          visible: { width: kindRect.width, height: kindRect.height },
          horizontalSpan: [
            document.elementFromPoint(kindRect.left - 21.5, kindCenter.y + 10),
            document.elementFromPoint(kindRect.right + 7.5, kindCenter.y + 10),
          ].map((hit) => hit === kind),
          verticalSpan: [
            document.elementFromPoint(kindCenter.x + 10, kindRect.top - 2.5),
            document.elementFromPoint(kindCenter.x + 10, kindRect.bottom + 26.5),
          ].map((hit) => hit === kind),
          outwardSeam:
            document.elementFromPoint(kindRect.left - 21.5, kindRect.top - 2.5) === kind,
        },
        title: {
          visible: { width: titleRect.width, height: titleRect.height },
          hits: titleHits.map((hit) => hit === title),
          upperDragRail: titleHits[0] === head,
        },
        leadingPartition: {
          kind: document.elementFromPoint(titleRect.left - 0.5, titleCenter.y) === kind,
          title: document.elementFromPoint(titleRect.left + 0.5, titleCenter.y) === title,
          owners: [
            ...new Set(
              document
                .elementsFromPoint(titleRect.left + 0.5, titleCenter.y)
                .filter((owner) => owner === kind || owner === title)
                .map((owner) => (owner === kind ? 'kind' : 'title')),
            ),
          ],
        },
      }
    })
    expect(coarseHeadTargets.kind.visible).toEqual({ width: 10, height: 10 })
    expect(coarseHeadTargets.kind.horizontalSpan).toEqual([true, true])
    expect(coarseHeadTargets.kind.verticalSpan).toEqual([true, true])
    expect(coarseHeadTargets.kind.outwardSeam).toBe(true)
    expect(coarseHeadTargets.title.visible.height).toBeLessThan(24)
    expect(coarseHeadTargets.title.hits).toEqual([false, true])
    expect(coarseHeadTargets.title.upperDragRail).toBe(true)
    expect(coarseHeadTargets.leadingPartition).toEqual({
      kind: true,
      title: true,
      owners: ['title'],
    })

    await card.getByRole('button', { name: 'Card colour' }).click()
    const popover = page.locator('.e-popover .card-color-popover')
    await expect(popover).toBeVisible()
    const paletteTargets = await popover.evaluate((element) => {
      const mode = element.querySelector<HTMLElement>('.e-colour-picker__mode')!
      const swatches = [...element.querySelectorAll<HTMLElement>('.e-colour-picker__swatch')]
      const probe = (control: HTMLElement) => {
        const rect = control.getBoundingClientRect()
        const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
        return {
          visible: { width: rect.width, height: rect.height },
          hits: [
            document.elementFromPoint(center.x - 19.5, center.y),
            document.elementFromPoint(center.x + 19.5, center.y),
            document.elementFromPoint(center.x, center.y - 19.5),
            document.elementFromPoint(center.x, center.y + 19.5),
          ].map((hit) => hit === control),
        }
      }
      const first = swatches[0]!.getBoundingClientRect()
      const third = swatches[2]!.getBoundingClientRect()
      return {
        mode: probe(mode),
        swatch: probe(swatches[0]!),
        swatchColumnPitch: third.x + third.width / 2 - (first.x + first.width / 2),
      }
    })
    expect(paletteTargets.mode.visible).toEqual({ width: 18, height: 18 })
    expect(paletteTargets.mode.hits).toEqual([true, true, true, true])
    expect(paletteTargets.swatch.visible).toEqual({ width: 18, height: 18 })
    expect(paletteTargets.swatch.hits).toEqual([true, true, true, true])
    expect(paletteTargets.swatchColumnPitch).toBeGreaterThanOrEqual(40)
  } finally {
    await context.close()
  }
})

test('resize release does not replay selection entrance while the readout exits', async ({ page }) => {
  await seedCards(page, [
    {
      id: 'resize-entrance-lifecycle',
      kind: 'note',
      blocks: [{ id: 'resize-entrance-block', text: 'One entrance, one readout exit.' }],
      position: { x: 240, y: 180 },
      size: { width: 300, height: 220 },
      title: 'Resize lifecycle',
    },
  ])
  const card = page.locator('.react-flow__node[data-id="resize-entrance-lifecycle"] .card')
  await card.locator('.card-head').click({ position: { x: 140, y: 18 } })
  const handle = card.locator('.card-resize-handle.bottom.right')
  await expect(handle).toBeVisible()
  await expect.poll(() => handle.evaluate((element) => {
    const entrance = element.getAnimations().find(
      (animation) => (animation as CSSAnimation).animationName === 'card-resize-handle-enter',
    )
    return entrance?.playState ?? 'absent'
  })).toBe('finished')

  const box = await handle.boundingBox()
  if (!box) throw new Error('Missing resize lifecycle handle')
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 24, start.y + 16, { steps: 3 })
  await expect(handle).toHaveAttribute('data-resizing', 'true')
  await expect(page.locator('.card-resize-readout')).toBeVisible()
  await expect(handle).toHaveCSS('animation-name', 'none')

  await page.mouse.up()
  const release = await page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const element = document.querySelector<HTMLElement>(
      '.react-flow__node[data-id="resize-entrance-lifecycle"] .card-resize-handle.bottom.right',
    )!
    const entrance = element.getAnimations().find(
      (animation) => (animation as CSSAnimation).animationName === 'card-resize-handle-enter',
    )
    const readout = document.querySelector<HTMLElement>('.card-resize-readout')!
    const readoutExit = readout.getAnimations().find(
      (animation) =>
        (animation as Animation & { transitionProperty?: string }).transitionProperty === 'opacity',
    )
    return {
      handle: {
        animationName: getComputedStyle(element).animationName,
        entranceState: entrance?.playState ?? 'absent',
        opacity: getComputedStyle(element).opacity,
      },
      readout: {
        state: readout.dataset.state,
        duration: getComputedStyle(readout).transitionDuration,
        property: (readoutExit as Animation & { transitionProperty?: string } | undefined)
          ?.transitionProperty,
        animationDuration: readoutExit?.effect?.getTiming().duration ?? null,
      },
    }
  })
  expect(release).toEqual({
    handle: { animationName: 'none', entranceState: 'absent', opacity: '1' },
    readout: { state: 'exiting', duration: '0.14s', property: 'opacity', animationDuration: 140 },
  })

  const readout = page.locator('.card-resize-readout')
  await expect(readout).toBeHidden()
})

test('Conversation and Conversation Result shells keep the shared rest and selected borders', async ({
  page,
}) => {
  const conversationId = 'border-conversation'
  const resultId = 'border-conversation-result'
  await seedCards(
    page,
    [
      {
        id: conversationId,
        kind: 'conversation',
        blocks: [{ id: 'border-conversation-block', text: 'Compare the evidence.' }],
        position: { x: 80, y: 80 },
        size: { width: 280, height: 220 },
        title: 'Conversation shell',
      },
      {
        id: resultId,
        kind: 'result',
        blocks: [{ id: 'border-conversation-result-block', text: '' }],
        position: { x: 420, y: 80 },
        size: { width: 280, height: 220 },
        title: 'Conversation Result shell',
      },
    ],
    { x: 120, y: 90, zoom: 1 },
    [],
    {
      connections: [
        {
          id: 'border-conversation-output',
          from: { cardId: conversationId },
          to: { cardId: resultId },
          strength: 'strong',
          polarity: 'helps',
          role: 'feeds',
        },
      ],
    },
  )

  for (const cardId of [conversationId, resultId]) {
    const node = page.locator(`.react-flow__node[data-id="${cardId}"]`)
    const card = node.locator('.card')
    await expect(card).toBeVisible()
    const rest = await card.evaluate((element) => {
      const resolveColor = (declaration: string) => {
        const probe = document.createElement('span')
        probe.style.color = declaration
        document.body.append(probe)
        const color = getComputedStyle(probe).color
        probe.remove()
        return color
      }
      return {
        border: getComputedStyle(element).borderTopColor,
        lineStrong: resolveColor('var(--e-line-strong)'),
      }
    })
    expect(rest.border, `${cardId} resting border`).toBe(rest.lineStrong)

    await card.locator('.card-head').click({ position: { x: 120, y: 18 } })
    await expect(card).toHaveClass(/selected/)
    const selected = await node.evaluate((element) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--e-go)'
      document.body.append(probe)
      const go = getComputedStyle(probe).color
      probe.remove()
      return { border: getComputedStyle(element, '::after').borderTopColor, go }
    })
    expect(selected.border, `${cardId} selected border`).toBe(selected.go)
  }
})

test('a dragged card reveals its prepainted lift shadow without repainting the card', async ({
  page,
}) => {
  await seedCards(page, [
    {
      id: 'drag-shadow-card',
      kind: 'note',
      blocks: [{ id: 'drag-shadow-block', text: 'Lift and settle with weight.' }],
      position: { x: 160, y: 120 },
      size: { width: 300, height: 220 },
      title: 'Drag shadow timing',
    },
  ])

  const node = page.locator('.react-flow__node[data-id="drag-shadow-card"]')
  const card = node.locator('.card')
  await card.locator('.card-head').click({ position: { x: 140, y: 18 } })
  await expect(card).toHaveClass(/selected/)

  const selected = await node.evaluate((element) => {
    const cardElement = element.querySelector<HTMLElement>('.card')!
    const frame = getComputedStyle(element, '::after')
    const shadow = getComputedStyle(cardElement, '::before')
    return {
      cardShadow: getComputedStyle(cardElement).boxShadow,
      frameBorderStyle: frame.borderTopStyle,
      frameBorderColor: frame.borderTopColor,
      shadowPaint: shadow.boxShadow,
      shadowOpacity: shadow.opacity,
      shadowTransition: shadow.transitionProperty,
    }
  })
  expect(selected).toMatchObject({
    cardShadow: 'none',
    frameBorderStyle: 'solid',
    shadowOpacity: '0',
    shadowTransition: 'none',
  })
  expect(selected.shadowPaint).not.toBe('none')

  const lift = await card.evaluate(async (element) => {
    const nodeElement = element.closest<HTMLElement>('.react-flow__node')!
    nodeElement.classList.add('dragging')
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const shadow = getComputedStyle(element, '::before')
    return {
      cardShadow: getComputedStyle(element).boxShadow,
      shadow: shadow.boxShadow,
      opacity: shadow.opacity,
    }
  })
  expect(lift).toMatchObject({ cardShadow: 'none', opacity: '1' })
  expect(lift.shadow).not.toBe('none')

  const drop = await card.evaluate(async (element) => {
    const nodeElement = element.closest<HTMLElement>('.react-flow__node')!
    nodeElement.classList.remove('dragging')
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    return getComputedStyle(element, '::before').opacity
  })
  expect(drop).toBe('0')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true')
  const reducedMotion = await card.evaluate(async (element) => {
    const nodeElement = element.closest<HTMLElement>('.react-flow__node')!
    const opacityFor = async (dragging: boolean) => {
      nodeElement.classList.toggle('dragging', dragging)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      return getComputedStyle(element, '::before').opacity
    }
    return { lift: await opacityFor(true), drop: await opacityFor(false) }
  })
  expect(reducedMotion).toEqual({ lift: '1', drop: '0' })
})

test('identity dots keep computed contrast across fills and kinds in live and Playback', async ({ page }) => {
  const kinds = ['note', 'mod', 'conversation'] as const
  const fills = ['none', 'half', 'full', 'pattern'] as const
  const fixtures = kinds.flatMap((kind, column) =>
    fills.map((fill, row) => ({
      fill,
      card: {
        id: `${kind}-${fill}`,
        kind,
        blocks: [{ id: `${kind}-${fill}-block`, text: `${kind} ${fill}` }],
        position: { x: 80 + column * 300, y: 60 + row * 190 },
        size: { width: 240, height: 150 },
        title: `${kind} ${fill}`,
        ...(fill === 'none'
          ? {}
          : { headerColor: '#F1666D', headerFill: fill as 'half' | 'full' | 'pattern' }),
        ...(kind === 'mod'
          ? {
              modV2: createSeedMod('slider', {
                title: `${kind} ${fill}`,
                createId: (_, ordinal) => `${kind}-${fill}-part-${ordinal}`,
              }),
            }
          : {}),
      } satisfies TestCard,
    })),
  )
  const cards = fixtures.map(({ card }) => card)
  const createdAt = '2026-07-17T00:00:00.000Z'
  const completedAt = '2026-07-17T00:00:01.000Z'
  const intentLog = [
    ...cards.map((card, index) => ({
      id: `identity-created-${index}`,
      at: createdAt,
      type: 'card.created',
      cardId: card.id,
      data: { card },
    })),
    {
      id: 'identity-run-completed',
      at: completedAt,
      type: 'run.completed',
      runId: 'identity-run',
      data: {
        run: { id: 'identity-run', startedAt: createdAt, completedAt, status: 'done' },
      },
    },
  ]
  await seedCards(page, cards, { x: 120, y: 80, zoom: 0.55 }, intentLog)
  await expect(page.locator('.react-flow__node:not(.react-flow__node-gestureProxy) .card')).toHaveCount(
    cards.length,
  )

  const assertIdentity = async (playback: boolean) => {
    for (const { card, fill } of fixtures) {
      const root = page.locator(
        `.react-flow__node[data-id="${card.id}"] ${playback ? '.playback-card' : '.card'}`,
      )
      const sample = await inspectCardIdentity(
        root,
        playback ? '.playback-kind-dot' : '.kind-dot',
      )
      // A live Mod's valid modV2 subtype owns the face accent even when the
      // Card has no explicit header fill (design-system SYSTEM §8.6). The
      // generic kind role remains the no-fill fallback for ordinary Cards and
      // the historical Playback projection.
      const expectedDot =
        fill === 'none'
          ? !playback && card.kind === 'mod'
            ? sample.identity
            : sample.kind
          : fill === 'full'
            ? sample.onIdentity
            : sample.identity
      expect(sample.dot, `${playback ? 'Playback' : 'live'} ${card.id} dot`).toBe(expectedDot)
      if (fill === 'full') {
        expect(sample.head, `${playback ? 'Playback' : 'live'} ${card.id} head`).toBe(
          sample.identity,
        )
        expect(
          contrastRatio(sample.dot, sample.head),
          `${playback ? 'Playback' : 'live'} ${card.id} contrast`,
        ).toBeGreaterThanOrEqual(4.5)
        if (card.kind === 'mod' || card.kind === 'conversation') {
          expect(sample.hairline, `${playback ? 'Playback' : 'live'} ${card.id} hairline`).toBe(
            'rgba(0, 0, 0, 0)',
          )
        }
      }
    }
  }

  await assertIdentity(false)
  await page.getByRole('button', { name: 'Playback', exact: true }).click()
  await page.locator('.timeline-panel').waitFor({ state: 'visible' })
  // Playback opens on event 1 by contract. Frame the terminal projection so
  // this matrix inspects exactly the twelve Cards it seeded.
  await page.getByRole('slider', { name: 'Playback', exact: true }).fill('1000')
  await expect(page.locator('.playback-card')).toHaveCount(cards.length)
  await assertIdentity(true)
})

test('uncoloured Group and Conversation dots keep neutral and semantic roles in both themes', async ({
  page,
}) => {
  await seedCards(page, [
    {
      id: 'neutral-group-dot',
      kind: 'group',
      blocks: [],
      position: { x: 160, y: 180 },
      size: { width: 280, height: 200 },
      title: 'Dashed group',
    },
    {
      id: 'semantic-conversation-dot',
      kind: 'conversation',
      blocks: [],
      position: { x: 520, y: 180 },
      size: { width: 280, height: 200 },
      title: 'Conversation voice',
    },
  ])

  for (const theme of ['light', 'dark'] as const) {
    await setThemeThroughSettings(page, theme)
    const sample = await page.evaluate(() => {
      const token = (name: string) => {
        const probe = document.createElement('span')
        probe.style.color = `var(${name})`
        document.body.append(probe)
        const value = getComputedStyle(probe).color
        probe.remove()
        return value
      }
      return {
        group: getComputedStyle(
          document.querySelector<HTMLElement>(
            '.react-flow__node[data-id="neutral-group-dot"] .kind-dot',
          )!,
        ).backgroundColor,
        conversation: getComputedStyle(
          document.querySelector<HTMLElement>(
            '.react-flow__node[data-id="semantic-conversation-dot"] .kind-dot',
          )!,
        ).backgroundColor,
        ink: token('--e-ink'),
        convo: token('--e-convo'),
      }
    })
    expect(sample.group, `${theme} Group dot`).toBe(sample.ink)
    expect(sample.conversation, `${theme} Conversation dot`).toBe(sample.convo)
  }
})

test('opaque custom titles and bodies stay AA in live and Playback across themes', async ({
  page,
}) => {
  const cards: TestCard[] = [
    {
      id: 'custom-mid-gap',
      kind: 'note',
      blocks: [{ id: 'custom-mid-gap-block', text: 'Custom body contrast' }],
      position: { x: 160, y: 160 },
      size: { width: 320, height: 220 },
      title: 'Custom #777777',
      headerColor: '#777777',
      headerFill: 'full',
    },
  ]
  const createdAt = '2026-07-17T00:00:00.000Z'
  const completedAt = '2026-07-17T00:00:01.000Z'
  await seedCards(
    page,
    cards,
    { x: 120, y: 90, zoom: 1 },
    [
      ...cards.map((card, index) => ({
        id: `custom-created-${index}`,
        at: createdAt,
        type: 'card.created',
        cardId: card.id,
        data: { card },
      })),
      {
        id: 'custom-mid-gap-completed',
        at: completedAt,
        type: 'run.completed',
        runId: 'custom-mid-gap-run',
        data: {
          run: {
            id: 'custom-mid-gap-run',
            startedAt: createdAt,
            completedAt,
            status: 'done',
          },
        },
      },
    ],
  )

  const inspect = async (card: TestCard, playback: boolean) => {
    const root = page.locator(
      `.react-flow__node[data-id="${card.id}"] ${playback ? '.playback-card' : '.card'}`,
    )
    await expect(root).toBeVisible()
    return root.evaluate((element, isPlayback) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext('2d', { willReadFrequently: true })!
      const normalize = (color: string, underlay = '#000000') => {
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = underlay
        context.fillRect(0, 0, 1, 1)
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
        return `rgb(${red}, ${green}, ${blue})`
      }
      const head = element.querySelector<HTMLElement>('.card-head')!
      const title = element.querySelector<HTMLElement>('.card-title-display')!
      const body = element.querySelector<HTMLElement>('.card-body')!
      const cardSurface = getComputedStyle(element).backgroundColor
      const bodyText = element.querySelector<HTMLElement>(
        isPlayback ? '.playback-card-text' : '.note-render',
      )!
      return {
        assignedSolid: element.style.getPropertyValue('--card-header-color'),
        head: normalize(getComputedStyle(head).backgroundColor, cardSurface),
        title: normalize(getComputedStyle(title).color),
        body: normalize(getComputedStyle(body).backgroundColor, cardSurface),
        bodyText: normalize(getComputedStyle(bodyText).color),
      }
    }, playback)
  }

  for (const theme of ['light', 'dark'] as const) {
    await setThemeThroughSettings(page, theme)
    for (const card of cards) {
      const live = await inspect(card, false)
      expect(live.assignedSolid).toBe(card.headerColor)
      expect(contrastRatio(live.title, live.head), `${theme} ${card.id} live title`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(live.bodyText, live.body), `${theme} ${card.id} live body`).toBeGreaterThanOrEqual(4.5)
    }

    await page.getByRole('button', { name: 'Playback', exact: true }).click()
    await expect(page.locator('.playback-card')).toHaveCount(cards.length)
    for (const card of cards) {
      const playback = await inspect(card, true)
      expect(playback.assignedSolid).toBe(card.headerColor)
      expect(contrastRatio(playback.title, playback.head), `${theme} ${card.id} Playback title`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(playback.bodyText, playback.body), `${theme} ${card.id} Playback body`).toBeGreaterThanOrEqual(4.5)
    }
    await page.getByRole('button', { name: 'Playback', exact: true }).click()
  }
})

test('captures exact Reading, crossfade, Overview, and Map visual evidence', async ({
  page,
}, testInfo) => {
  const cards: TestCard[] = Array.from({ length: 64 }, (_, index) => ({
    id: `evidence-${index}`,
    kind: index % 5 === 0 ? 'mod' : index % 7 === 0 ? 'conversation' : 'note',
    blocks: [{ id: `evidence-${index}-block`, text: `Card ${index + 1}` }],
    position: { x: (index % 8) * 300, y: Math.floor(index / 8) * 200 },
    size: { width: 240, height: 150 },
    title: `Evidence ${index + 1}`,
    ...(index % 4 === 0
      ? { headerColor: '#F1666D', headerFill: 'full' as const }
      : index % 4 === 1
        ? { headerColor: '#1B7550', headerFill: 'pattern' as const }
        : {}),
  }))
  await seedCards(page, cards, { x: 160, y: 120, zoom: 0.5 })

  const bands = [
    { name: 'reading', zoom: 0.5, representation: 'reading', reading: 1, overview: 1 },
    { name: 'crossfade', zoom: 0.325, representation: 'reading', reading: 0.5, overview: 0.5 },
    { name: 'overview', zoom: 0.22, representation: 'overview', reading: 0, overview: 1 },
    { name: 'map', zoom: 0.12, representation: 'map', reading: 0, overview: 1 },
  ] as const
  const manifest: Array<Record<string, unknown>> = []

  for (const theme of ['light', 'dark'] as const) {
    await setThemeThroughSettings(page, theme)
    for (const band of bands) {
      const scene = await settleAt(page, { x: 160, y: 120, zoom: band.zoom })
      expect(scene.zoom).toBeCloseTo(band.zoom, 5)
      expect(scene.readingCardOpacity).toBeCloseTo(band.reading, 2)
      expect(scene.overviewCardOpacity).toBeCloseTo(band.overview, 2)
      if (band.reading > 0) {
        expect(scene.mountedReactCards).toBeGreaterThan(0)
        expect(scene.firstReadingNodeOpacity).toBeCloseTo(band.reading, 2)
      } else {
        expect(scene.mountedReactCards).toBe(0)
        expect(scene.canvasRenderedCards).toBeGreaterThan(0)
        expect(scene.canvasRepresentation).toBe(band.representation)
        expect(scene.canvasRepresentationCards).toBeGreaterThan(0)
      }
      manifest.push({ theme, band: band.name, state: 'settled', requestedZoom: band.zoom, ...scene })
      await testInfo.attach(`pr-516-${theme}-${band.name}-settled.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })

      const interaction = band.reading > 0 ? 'visual-card' : 'gesture-proxy'
      const startPosition = await page.evaluate(() => {
        const state = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido.getState()
        return state.cards.find((card) => card.id === 'evidence-1')!.position
      })
      let participant: Locator
      let start: { x: number; y: number }
      if (interaction === 'visual-card') {
        participant = page.locator(
          '.react-flow__node[data-id="evidence-1"]:not(.react-flow__node-gestureProxy)',
        )
        const head = participant.locator('.card-head')
        start = await head.evaluate((element, bandName) => {
          const rect = element.getBoundingClientRect()
          // Hit-test the remaining shell rail instead of guessing around the
          // deliberately expanded dot/title controls at each transformed zoom.
          for (let y = rect.top + 0.5; y < rect.bottom; y += 0.5) {
            for (let x = rect.left + 0.5; x < rect.right; x += 1) {
              if (document.elementFromPoint(x, y) === element) return { x, y }
            }
          }
          throw new Error(`Missing dense ${bandName} card drag target`)
        }, band.name)
      } else {
        const centre = await page.evaluate(
          ({ zoom }) => {
            const state = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido.getState()
            const card = state.cards.find((candidate) => candidate.id === 'evidence-1')!
            const pane = document.querySelector('.react-flow')?.getBoundingClientRect()
            if (!pane) throw new Error('Missing dense evidence board pane')
            return {
              x: pane.left + 160 + (card.position.x + card.size!.width / 2) * zoom,
              y: pane.top + 120 + (card.position.y + card.size!.height / 2) * zoom,
            }
          },
          { zoom: band.zoom },
        )
        await page.mouse.move(centre.x, centre.y)
        // The Board's explicit browser-gate seam makes the exact low-detail
        // participant deterministic here; pointer-target mounting itself is
        // covered by lowZoomResize.browser.test.ts's natural hover→proxy drag.
        await page.evaluate(() => {
          const setParticipants = (window as unknown as DevWindow).__EIDO_SET_GESTURE_PARTICIPANTS__
          if (!setParticipants) throw new Error('Missing gesture-participant browser gate')
          setParticipants(['evidence-1'])
        })
        participant = page.locator('.react-flow__node-gestureProxy[data-id="evidence-1"]')
        await participant.waitFor({ state: 'attached', timeout: 10_000 })
        const box = await participant.boundingBox()
        if (!box) throw new Error(`Missing dense ${band.name} gesture proxy`)
        start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      }

      let pointerHeld = false
      try {
        if (interaction === 'visual-card') await page.mouse.move(start.x, start.y)
        await page.mouse.down()
        pointerHeld = true
        await page.mouse.move(start.x + 36, start.y + 24, { steps: 4 })
        await expect(participant).toHaveClass(/dragging/)
        await expect
          .poll(() => page.evaluate(() => {
            const state = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido.getState()
            return state.cards.find((card) => card.id === 'evidence-1')!.position
          }))
          .not.toEqual(startPosition)
        const heldPosition = await page.evaluate(() => {
          const state = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido.getState()
          return state.cards.find((card) => card.id === 'evidence-1')!.position
        })
        expect(heldPosition).not.toEqual(startPosition)

        const dragScene = await readScene(page)
        let shadow: string | undefined
        if (interaction === 'visual-card') {
          const lift = await participant.locator('.card').evaluate((element) => {
            const cardStyle = getComputedStyle(element)
            const shallowLiftStyle = getComputedStyle(element, '::before')
            return {
              cardShadow: cardStyle.boxShadow,
              shadow: shallowLiftStyle.boxShadow,
              opacity: shallowLiftStyle.opacity,
            }
          })
          expect(lift.cardShadow).toBe('none')
          expect(lift.opacity).toBe('1')
          shadow = lift.shadow
          expect(shadow).not.toBe('none')
        } else {
          await expect(participant.locator('.card, .title-card')).toHaveCount(0)
          expect(dragScene.mountedReactCards).toBe(0)
          expect(dragScene.canvasRepresentation).toBe(band.representation)
          expect(dragScene.canvasRepresentationCards).toBeGreaterThan(0)
        }
        manifest.push({
          theme,
          band: band.name,
          state: 'mid-drag',
          interaction,
          proxyMountCoverage:
            interaction === 'gesture-proxy'
              ? 'dev participant seam; natural hover mount covered by lowZoomResize.browser.test.ts'
              : undefined,
          requestedZoom: band.zoom,
          startPosition,
          heldPosition,
          shadow,
          ...dragScene,
        })
        await testInfo.attach(`pr-516-${theme}-${band.name}-mid-drag.png`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        })
      } finally {
        if (pointerHeld) {
          await page.mouse.up()
          await expect
            .poll(async () => {
              if ((await participant.count()) === 0) return true
              return !(await participant.getAttribute('class'))?.includes('dragging')
            })
            .toBe(true)
        }
        if (interaction === 'gesture-proxy') {
          await page.evaluate(() => {
            const setParticipants = (window as unknown as DevWindow).__EIDO_SET_GESTURE_PARTICIPANTS__
            if (!setParticipants) throw new Error('Missing gesture-participant browser gate')
            setParticipants([])
          })
        }
      }
      await expect(page.locator('.react-flow__node.dragging')).toHaveCount(0)
    }
  }

  await testInfo.attach('pr-516-zoom-band-manifest.json', {
    body: JSON.stringify(manifest, null, 2),
    contentType: 'application/json',
  })
})

test('a Reading top-left resize follows the held corner at zoom and undoes once', async ({ page }) => {
  const original = {
    id: 'resize-reading',
    kind: 'note' as const,
    blocks: [{ id: 'resize-reading-block', text: 'Resize at half zoom' }],
    position: { x: 400, y: 320 },
    size: { width: 260, height: 180 },
    title: 'Resize at zoom',
    zIndex: 1,
  }
  await seedCards(page, [original], { x: 220, y: 140, zoom: 0.5 })
  const node = page.locator('.react-flow__node[data-id="resize-reading"]')
  const card = node.locator('.card')
  await expect(card).toBeVisible()
  await selectCardThroughHeader(page, card)
  await expect(card.locator('[data-editor-ready="true"]')).toHaveCount(0)
  const handle = node.locator('.card-resize-handle.top.left')
  await expect(handle).toBeVisible()
  const selectionFrame = await node.evaluate((element) => {
    const frame = getComputedStyle(element, '::after')
    const tokenProbe = document.createElement('span')
    tokenProbe.style.color = 'var(--e-go)'
    document.body.append(tokenProbe)
    const go = getComputedStyle(tokenProbe).color
    tokenProbe.remove()
    return {
      color: frame.borderTopColor,
      style: frame.borderTopStyle,
      width: frame.borderTopWidth,
      go,
    }
  })
  expect(selectionFrame).toMatchObject({ color: selectionFrame.go, style: 'solid' })
  expect(Number.parseFloat(selectionFrame.width)).toBeGreaterThan(0)
  const start = await handle.boundingBox()
  if (!start) throw new Error('Missing top-left resize handle')
  const startPoint = { x: start.x + start.width / 2, y: start.y + start.height / 2 }
  const target = { x: startPoint.x - 50, y: startPoint.y - 30 }

  await page.mouse.move(startPoint.x, startPoint.y)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 8 })

  const held = await handle.boundingBox()
  const readout = page.locator('.card-resize-readout')
  await expect(readout).toHaveText('360 × 240')
  const readoutBox = await readout.boundingBox()
  expect(held?.x).toBeCloseTo(target.x - (held?.width ?? 0) / 2, 0)
  expect(held?.y).toBeCloseTo(target.y - (held?.height ?? 0) / 2, 0)
  expect((readoutBox?.x ?? 0) + (readoutBox?.width ?? 0)).toBeLessThan(target.x)
  expect((readoutBox?.y ?? 0) + (readoutBox?.height ?? 0)).toBeLessThan(target.y)
  const heldFrame = await node.evaluate((element) => {
    const card = element.querySelector<HTMLElement>('.card')!
    const layer = element.querySelector<HTMLElement>('.card-resize-layer')!
    const cardBounds = card.getBoundingClientRect()
    const layerBounds = layer.getBoundingClientRect()
    return {
      nodePhase: (element as HTMLElement).dataset.resizeFrame ?? null,
      nodeBorder: getComputedStyle(element, '::after').borderTopColor,
      layerPhase: layer.dataset.resizeFrame ?? null,
      layerBorder: getComputedStyle(layer, '::before').borderTopColor,
      card: { x: cardBounds.x, y: cardBounds.y, width: cardBounds.width, height: cardBounds.height },
      layer: { x: layerBounds.x, y: layerBounds.y, width: layerBounds.width, height: layerBounds.height },
    }
  })
  expect(heldFrame).toMatchObject({
    nodePhase: 'active',
    nodeBorder: 'rgba(0, 0, 0, 0)',
    layerPhase: 'active',
    layerBorder: selectionFrame.color,
  })
  expect(heldFrame.layer.x).toBeCloseTo(heldFrame.card.x + 0.5, 0)
  expect(heldFrame.layer.y).toBeCloseTo(heldFrame.card.y + 0.5, 0)
  expect(heldFrame.layer.width).toBeCloseTo(heldFrame.card.width - 1, 0)
  expect(heldFrame.layer.height).toBeCloseTo(heldFrame.card.height - 1, 0)

  await page.mouse.up()
  await expect(readout).toBeHidden()
  await expect(node).not.toHaveAttribute('data-resize-frame')
  await expect(node.locator('.card-resize-layer')).not.toHaveAttribute('data-resize-frame')
  const after = await page.evaluate((cardId) => {
    const state = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido.getState()
    return {
      card: state.cards.find((candidate) => candidate.id === cardId),
      undoDepth: state.undoStack.length,
    }
  }, original.id)
  expect(after).toMatchObject({
    card: { position: { x: 300, y: 260 }, size: { width: 360, height: 240 } },
    undoDepth: 1,
  })

  await page.evaluate(() => {
    ;(window as unknown as DevWindow & { __eido: EidoDevStore }).__eido.getState().undo()
  })
  await expect.poll(() => page.evaluate((cardId) => {
    const state = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido.getState()
    return state.cards.find((candidate) => candidate.id === cardId)
  }, original.id)).toMatchObject({ position: original.position, size: original.size })
})

test('a natural-height Reading resize keeps its measured outer frame cold while the child follows', async ({
  page,
}) => {
  const card = {
    id: 'natural-height-resize',
    kind: 'note' as const,
    blocks: [{
      id: 'natural-height-resize-block',
      text: 'Natural height stays measured while the transient child grows under the pointer.',
    }],
    position: { x: 280, y: 220 },
    title: 'Natural resize',
  }
  await page.addInitScript((cardId) => {
    const NativeResizeObserver = window.ResizeObserver
    const probeWindow = window as unknown as {
      __EIDO_TEST_RESIZE_OBSERVER_CALLBACKS__?: number
    }
    probeWindow.__EIDO_TEST_RESIZE_OBSERVER_CALLBACKS__ = 0
    class CountingResizeObserver extends NativeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          if (entries.some((entry) => (
            entry.target as HTMLElement
          ).matches(`.react-flow__node[data-id="${cardId}"]`))) {
            probeWindow.__EIDO_TEST_RESIZE_OBSERVER_CALLBACKS__! += 1
          }
          callback(entries, observer)
        })
      }
    }
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: CountingResizeObserver,
    })
  }, card.id)
  await seedCards(page, [card], { x: 100, y: 80, zoom: 1 })

  const node = page.locator(`.react-flow__node[data-id="${card.id}"]`)
  const shell = node.locator('.card')
  await selectCardThroughHeader(page, shell)
  await expect(shell.locator('[data-editor-ready="true"]')).toHaveCount(0)
  await waitForCardMeasurementQuiescence(page, card.id)
  await page.evaluate(() => {
    ;(window as unknown as { __EIDO_TEST_RESIZE_OBSERVER_CALLBACKS__: number })
      .__EIDO_TEST_RESIZE_OBSERVER_CALLBACKS__ = 0
  })
  const handle = node.locator('.card-resize-handle.bottom.right')
  const start = await handle.boundingBox()
  if (!start) throw new Error('Missing natural-height resize handle')
  const startPoint = { x: start.x + start.width / 2, y: start.y + start.height / 2 }
  const baseline = await page.evaluate((cardId) => {
    const state = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido.getState()
    ;(window as unknown as { __EIDO_NATURAL_RESIZE_PROBE__?: unknown })
      .__EIDO_NATURAL_RESIZE_PROBE__ = {
        cards: state.cards,
        undoStack: state.undoStack,
        intentLog: state.intentLog,
      }
    const nodeElement = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${cardId}"]`)!
    const shellElement = nodeElement.querySelector<HTMLElement>('.card')!
    const nodeBounds = nodeElement.getBoundingClientRect()
    const shellBounds = shellElement.getBoundingClientRect()
    return {
      node: { x: nodeBounds.x, y: nodeBounds.y, width: nodeBounds.width, height: nodeBounds.height },
      shell: { x: shellBounds.x, y: shellBounds.y, width: shellBounds.width, height: shellBounds.height },
      storedCardSize: state.cards.find((candidate) => candidate.id === cardId)?.size,
      boardChangeSeq: state.boardChangeSeq,
    }
  }, card.id)

  await page.mouse.move(startPoint.x, startPoint.y)
  await page.mouse.down()
  await page.mouse.move(startPoint.x + 80, startPoint.y + 40, { steps: 8 })
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

  const held = await page.evaluate((cardId) => {
    const state = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido.getState()
    const probe = (window as unknown as {
      __EIDO_NATURAL_RESIZE_PROBE__: {
        cards: TestCard[]
        undoStack: unknown[]
        intentLog: unknown[]
      }
    }).__EIDO_NATURAL_RESIZE_PROBE__
    const nodeElement = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${cardId}"]`)!
    const shellElement = nodeElement.querySelector<HTMLElement>('.card')!
    const nodeBounds = nodeElement.getBoundingClientRect()
    const shellBounds = shellElement.getBoundingClientRect()
    const diagnostic = (window as unknown as {
      __EIDO_RESIZE_RF_DIAGNOSTIC__?: {
        notifications: number
        dimensionChanges: number
        measuredMapClones: number
        snapshot: () => {
          renderIndexDelta: {
            gets: number
            incrementalUpdates: number
            cardsPatched: number
            boundsUpdated: number
            fullRebuilds: { initial: number; cardStructure: number; connections: number }
          }
          rankEpochDelta: number
        }
      }
    }).__EIDO_RESIZE_RF_DIAGNOSTIC__
    return {
      node: { x: nodeBounds.x, y: nodeBounds.y, width: nodeBounds.width, height: nodeBounds.height },
      shell: { x: shellBounds.x, y: shellBounds.y, width: shellBounds.width, height: shellBounds.height },
      storedCard: state.cards.find((candidate) => candidate.id === cardId),
      cardsIdentityHeld: state.cards === probe.cards,
      undoIdentityHeld: state.undoStack === probe.undoStack,
      intentIdentityHeld: state.intentLog === probe.intentLog,
      observerCallbacks: (window as unknown as {
        __EIDO_TEST_RESIZE_OBSERVER_CALLBACKS__: number
      }).__EIDO_TEST_RESIZE_OBSERVER_CALLBACKS__,
      diagnostic: diagnostic ? {
        notifications: diagnostic.notifications,
        dimensionChanges: diagnostic.dimensionChanges,
        measuredMapClones: diagnostic.measuredMapClones,
        ...diagnostic.snapshot(),
      } : null,
    }
  }, card.id)
  expect(held.node).toEqual(baseline.node)
  expect(held.shell.width).toBeCloseTo(baseline.shell.width + 80, 0)
  expect(held.shell.height).toBeCloseTo(baseline.shell.height + 40, 0)
  expect(held.storedCard).toMatchObject({ position: card.position })
  expect(held.storedCard?.size).toEqual(baseline.storedCardSize)
  expect(held.cardsIdentityHeld).toBe(true)
  expect(held.undoIdentityHeld).toBe(true)
  expect(held.intentIdentityHeld).toBe(true)
  expect(held.observerCallbacks).toBe(0)
  expect(held.diagnostic).toMatchObject({
    notifications: 0,
    dimensionChanges: 0,
    measuredMapClones: 0,
  })
  expect(held.diagnostic).toMatchObject({
    renderIndexDelta: {
      gets: 0,
      incrementalUpdates: 0,
      cardsPatched: 0,
      boundsUpdated: 0,
      fullRebuilds: { initial: 0, cardStructure: 0, connections: 0 },
    },
    rankEpochDelta: 0,
  })

  await page.mouse.up()
  const released = await page.evaluate(({ cardId, initialBoardChangeSeq }) => {
    const state = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido.getState()
    return {
      card: state.cards.find((candidate) => candidate.id === cardId),
      undoDepth: state.undoStack.length,
      resizeEvents: state.intentLog.filter((event) => event.type === 'card.resized').length,
      boardChangeDelta: state.boardChangeSeq - initialBoardChangeSeq,
    }
  }, { cardId: card.id, initialBoardChangeSeq: baseline.boardChangeSeq })
  expect(released).toMatchObject({
    card: {
      position: card.position,
      size: {
        width: held.shell.width,
        height: held.shell.height,
      },
    },
    undoDepth: 1,
    resizeEvents: 1,
    boardChangeDelta: 1,
  })
})

test('a held connected oversized Reading resize keeps its selection frame, port, and wire on one hot frame without graph work', async ({
  page,
}) => {
  const source = {
    id: 'hot-reading-source',
    kind: 'note' as const,
    blocks: [{
      id: 'hot-reading-source-block',
      text: `The wire follows while held.\n\n${'Oversized resize geometry. '.repeat(4_200)}`,
    }],
    position: { x: 240, y: 220 },
    size: { width: 260, height: 180 },
    title: 'Hot source',
  }
  const target = {
    id: 'hot-reading-target',
    kind: 'note' as const,
    blocks: [{ id: 'hot-reading-target-block', text: 'Stay connected.' }],
    position: { x: 720, y: 250 },
    size: { width: 260, height: 180 },
    title: 'Hot target',
  }
  const connectionId = 'hot-reading-connection'
  await seedCards(page, [source, target], { x: 80, y: 70, zoom: 1 }, [], {
    connections: [{
      id: connectionId,
      from: { cardId: source.id },
      to: { cardId: target.id },
      strength: 'strong',
      polarity: 'helps',
      role: 'feeds',
    }],
  })

  const node = page.locator(`.react-flow__node[data-id="${source.id}"]`)
  const sourceCard = node.locator('.card')
  await selectCardThroughHeader(page, sourceCard)
  await expect(sourceCard.locator('[data-editor-ready="true"]')).toHaveCount(0)
  await waitForCardMeasurementQuiescence(page, source.id)
  const resizeHandle = node.locator('.card-resize-handle.bottom.right')
  const sourceHandle = node.locator('.react-flow__handle.source')
  const edgePath = page.locator(
    `.react-flow__edge[data-id="${connectionId}"] path.connection-line`,
  ).first()
  await expect(edgePath).toBeVisible()
  const start = await resizeHandle.boundingBox()
  if (!start) throw new Error('Missing Reading resize handle')
  const startPoint = { x: start.x + start.width / 2, y: start.y + start.height / 2 }
  const baseline = await sourceHandleAndEdgeStartSeparation(sourceHandle, edgePath)
  expect(baseline.separation.x).toBeCloseTo(0, 1)
  expect(baseline.separation.y).toBeCloseTo(0, 1)
  const baselineFrames = await page.evaluate((cardId) => {
    const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${cardId}"]`)!
    const card = node.querySelector<HTMLElement>('.card')!
    const nodeBounds = node.getBoundingClientRect()
    const cardBounds = card.getBoundingClientRect()
    return {
      node: { x: nodeBounds.x, y: nodeBounds.y, width: nodeBounds.width, height: nodeBounds.height },
      card: { x: cardBounds.x, y: cardBounds.y, width: cardBounds.width, height: cardBounds.height },
      selectionBorder: getComputedStyle(node, '::after').borderTopColor,
    }
  }, source.id)
  const heldGraph = await page.evaluate((cardId) => {
    const state = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido.getState()
    ;(window as unknown as { __EIDO_RESIZE_HOT_PROBE__?: unknown }).__EIDO_RESIZE_HOT_PROBE__ = {
      cards: state.cards,
      undoStack: state.undoStack,
      intentLog: state.intentLog,
    }
    return {
      card: state.cards.find((candidate) => candidate.id === cardId),
      boardChangeSeq: state.boardChangeSeq,
      saveState: state.saveState,
    }
  }, source.id)

  await page.mouse.move(startPoint.x, startPoint.y)
  await page.mouse.down()
  await page.mouse.move(startPoint.x + 120, startPoint.y + 60, { steps: 8 })
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

  const held = await sourceHandleAndEdgeStartSeparation(sourceHandle, edgePath)
  expect(held.separation.x).toBeLessThanOrEqual(1)
  expect(Math.abs(held.separation.y)).toBeLessThanOrEqual(1)
  const separationDelta = {
    x: Math.abs(held.separation.x - baseline.separation.x),
    y: Math.abs(held.separation.y - baseline.separation.y),
  }
  const separationMessage = `held ${JSON.stringify(held.separation)} vs baseline ${JSON.stringify(baseline.separation)}`
  expect(separationDelta.x, separationMessage).toBeLessThanOrEqual(1)
  expect(separationDelta.y, separationMessage).toBeLessThanOrEqual(1)
  const heldFrames = await page.evaluate((cardId) => {
    const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${cardId}"]`)!
    const card = node.querySelector<HTMLElement>('.card')!
    const resizeLayer = card.querySelector<HTMLElement>('.card-resize-layer')!
    const nodeBounds = node.getBoundingClientRect()
    const cardBounds = card.getBoundingClientRect()
    const resizeLayerBounds = resizeLayer.getBoundingClientRect()
    return {
      node: { x: nodeBounds.x, y: nodeBounds.y, width: nodeBounds.width, height: nodeBounds.height },
      card: { x: cardBounds.x, y: cardBounds.y, width: cardBounds.width, height: cardBounds.height },
      resizeLayer: {
        x: resizeLayerBounds.x,
        y: resizeLayerBounds.y,
        width: resizeLayerBounds.width,
        height: resizeLayerBounds.height,
      },
      frame: {
        nodePhase: node.dataset.resizeFrame ?? null,
        nodeBorder: getComputedStyle(node, '::after').borderTopColor,
        layerPhase: resizeLayer.dataset.resizeFrame ?? null,
        layerBorder: getComputedStyle(resizeLayer, '::before').borderTopColor,
      },
    }
  }, source.id)
  expect(heldFrames.node).toEqual(baselineFrames.node)
  expect(heldFrames.card.width).toBeCloseTo(baselineFrames.card.width + 120, 0)
  expect(heldFrames.card.height).toBeCloseTo(baselineFrames.card.height + 60, 0)
  expect(heldFrames.resizeLayer.x).toBeCloseTo(heldFrames.card.x + 1, 0)
  expect(heldFrames.resizeLayer.y).toBeCloseTo(heldFrames.card.y + 1, 0)
  expect(heldFrames.resizeLayer.width).toBeCloseTo(heldFrames.card.width - 2, 0)
  expect(heldFrames.resizeLayer.height).toBeCloseTo(heldFrames.card.height - 2, 0)
  expect(heldFrames.frame).toEqual({
    nodePhase: 'active',
    nodeBorder: 'rgba(0, 0, 0, 0)',
    layerPhase: 'active',
    layerBorder: baselineFrames.selectionBorder,
  })
  const during = await page.evaluate((cardId) => {
    const state = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido.getState()
    const probe = (window as unknown as {
      __EIDO_RESIZE_HOT_PROBE__: {
        cards: TestCard[]
        undoStack: unknown[]
        intentLog: unknown[]
      }
    }).__EIDO_RESIZE_HOT_PROBE__
    const diagnostic = (window as unknown as {
      __EIDO_RESIZE_RF_DIAGNOSTIC__?: {
        notifications: number
        dimensionChanges: number
        measuredMapClones: number
        snapshot: () => {
          renderIndexDelta: {
            gets: number
            incrementalUpdates: number
            cardsPatched: number
            boundsUpdated: number
            fullRebuilds: { initial: number; cardStructure: number; connections: number }
          }
          rankEpochDelta: number
        }
      }
    }).__EIDO_RESIZE_RF_DIAGNOSTIC__
    return {
      card: state.cards.find((candidate) => candidate.id === cardId),
      cardsIdentityHeld: state.cards === probe.cards,
      undoIdentityHeld: state.undoStack === probe.undoStack,
      intentIdentityHeld: state.intentLog === probe.intentLog,
      boardChangeSeq: state.boardChangeSeq,
      saveState: state.saveState,
      reactFlowNotifications: diagnostic ? {
        notifications: diagnostic.notifications,
        dimensionChanges: diagnostic.dimensionChanges,
        measuredMapClones: diagnostic.measuredMapClones,
        ...diagnostic.snapshot(),
      } : null,
    }
  }, source.id)
  expect(during).toEqual({
    card: expect.objectContaining({ position: source.position, size: source.size }),
    cardsIdentityHeld: true,
    undoIdentityHeld: true,
    intentIdentityHeld: true,
    boardChangeSeq: heldGraph.boardChangeSeq,
    saveState: heldGraph.saveState,
    reactFlowNotifications: expect.objectContaining({
      notifications: 0,
      dimensionChanges: 0,
      measuredMapClones: 0,
    }),
  })
  expect(during.reactFlowNotifications).toMatchObject({
    renderIndexDelta: {
      gets: 0,
      incrementalUpdates: 0,
      cardsPatched: 0,
      boundsUpdated: 0,
      fullRebuilds: { initial: 0, cardStructure: 0, connections: 0 },
    },
    rankEpochDelta: 0,
  })

  const heldResizeHandle = await resizeHandle.boundingBox()
  if (!heldResizeHandle) throw new Error('Missing held Reading resize handle')
  await page.evaluate(({ cardId, nextConnectionId }) => {
    type ReleaseGeometry = {
      phase: string
      shell: { x: number; y: number; width: number; height: number }
      resizeHandle: { x: number; y: number }
      sourceHandle: { x: number; y: number }
      edge: { x: number; y: number } | null
      edgeIds: string[]
    }
    const probeWindow = window as unknown as { __EIDO_RESIZE_RELEASE_GEOMETRY__?: ReleaseGeometry[] }
    probeWindow.__EIDO_RESIZE_RELEASE_GEOMETRY__ = []
    const capture = (phase: string) => {
      const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${cardId}"]`)!
      const shellBounds = node.querySelector<HTMLElement>('.card')!.getBoundingClientRect()
      const resizeBounds = node
        .querySelector<HTMLElement>('.card-resize-handle.bottom.right')!
        .getBoundingClientRect()
      const sourceBounds = node
        .querySelector<HTMLElement>('.react-flow__handle.source')!
        .getBoundingClientRect()
      const path = document.querySelector<SVGPathElement>(
        `.react-flow__edge[data-id="${nextConnectionId}"] path.connection-line`,
      )
      const point = path?.getPointAtLength(0)
      const edgePoint = path && point
        ? new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!)
        : null
      probeWindow.__EIDO_RESIZE_RELEASE_GEOMETRY__!.push({
        phase,
        shell: {
          x: shellBounds.x,
          y: shellBounds.y,
          width: shellBounds.width,
          height: shellBounds.height,
        },
        resizeHandle: {
          x: resizeBounds.x + resizeBounds.width / 2,
          y: resizeBounds.y + resizeBounds.height / 2,
        },
        sourceHandle: {
          x: sourceBounds.x + sourceBounds.width / 2,
          y: sourceBounds.y + sourceBounds.height / 2,
        },
        edge: edgePoint ? { x: edgePoint.x, y: edgePoint.y } : null,
        edgeIds: [...document.querySelectorAll<HTMLElement>('.react-flow__edge[data-id]')]
          .map((element) => element.dataset.id ?? ''),
      })
    }
    window.addEventListener('pointerup', () => {
      capture('pointerup')
      queueMicrotask(() => {
        capture('post-event')
        requestAnimationFrame(() => {
          capture('raf-1')
          requestAnimationFrame(() => capture('raf-2'))
        })
      })
    }, { once: true, capture: true })
  }, { cardId: source.id, nextConnectionId: connectionId })
  await page.mouse.up()
  await page.waitForFunction(() => (
    (window as unknown as { __EIDO_RESIZE_RELEASE_GEOMETRY__?: unknown[] })
      .__EIDO_RESIZE_RELEASE_GEOMETRY__?.length ?? 0
  ) === 4)
  const releaseGeometry = await page.evaluate(() => (
    window as unknown as {
      __EIDO_RESIZE_RELEASE_GEOMETRY__: Array<{
        phase: string
        shell: { x: number; y: number; width: number; height: number }
        resizeHandle: { x: number; y: number }
        sourceHandle: { x: number; y: number }
        edge: { x: number; y: number } | null
        edgeIds: string[]
      }>
    }
  ).__EIDO_RESIZE_RELEASE_GEOMETRY__)
  expect(releaseGeometry.map((frame) => frame.phase)).toEqual([
    'pointerup',
    'post-event',
    'raf-1',
    'raf-2',
  ])
  for (const frame of releaseGeometry) {
    expect(frame.shell.x).toBeCloseTo(heldFrames.card.x, 0)
    expect(frame.shell.y).toBeCloseTo(heldFrames.card.y, 0)
    expect(frame.shell.width).toBeCloseTo(heldFrames.card.width, 0)
    expect(frame.shell.height).toBeCloseTo(heldFrames.card.height, 0)
    expect(frame.resizeHandle.x).toBeCloseTo(
      heldResizeHandle.x + heldResizeHandle.width / 2,
      0,
    )
    expect(frame.resizeHandle.y).toBeCloseTo(
      heldResizeHandle.y + heldResizeHandle.height / 2,
      0,
    )
    expect(frame.sourceHandle.x).toBeCloseTo(held.handle.x, 0)
    expect(frame.sourceHandle.y).toBeCloseTo(held.handle.y, 0)
    expect(
      frame.edge,
      `edge missing at ${frame.phase}; mounted ${JSON.stringify(frame.edgeIds)}`,
    ).not.toBeNull()
    expect(frame.edge?.x).toBeCloseTo(held.edge.x, 0)
    expect(frame.edge?.y).toBeCloseTo(held.edge.y, 0)
  }
  await expect.poll(async () => {
    const separation = (await sourceHandleAndEdgeStartSeparation(sourceHandle, edgePath)).separation
    return Math.max(
      Math.abs(separation.x - baseline.separation.x),
      Math.abs(separation.y - baseline.separation.y),
    )
  }).toBeLessThanOrEqual(1)
  const releasedSeparation = (await sourceHandleAndEdgeStartSeparation(sourceHandle, edgePath)).separation
  expect(releasedSeparation.x).toBeLessThanOrEqual(1)
  expect(Math.abs(releasedSeparation.y)).toBeLessThanOrEqual(1)
  const released = await page.evaluate(({ cardId, initialBoardChangeSeq }) => {
    const state = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido.getState()
    return {
      card: state.cards.find((candidate) => candidate.id === cardId),
      undoDepth: state.undoStack.length,
      resizeEvents: state.intentLog.filter((event) => event.type === 'card.resized').length,
      boardChangeDelta: state.boardChangeSeq - initialBoardChangeSeq,
    }
  }, { cardId: source.id, initialBoardChangeSeq: heldGraph.boardChangeSeq })
  expect(released).toMatchObject({
    card: { position: source.position, size: { width: 380, height: 240 } },
    undoDepth: 1,
    resizeEvents: 1,
    boardChangeDelta: 1,
  })
})

test('a held Reading↔Overview resize gives the complementary painter and DOM hit one hot frame', async ({
  page,
}) => {
  const source = {
    id: 'hot-crossfade-source',
    kind: 'note' as const,
    blocks: [{ id: 'hot-crossfade-source-block', text: 'One shared transient frame.' }],
    position: { x: 320, y: 260 },
    size: { width: 260, height: 180 },
    title: 'Crossfade source',
  }
  await seedCards(page, [source], { x: 260, y: 190, zoom: 0.325 })
  const node = page.locator(`.react-flow__node[data-id="${source.id}"]`)
  const card = node.locator('.card')
  await selectCardThroughHeader(page, card)
  await expect(card.locator('[data-editor-ready="true"]')).toHaveCount(0)
  await waitForCardMeasurementQuiescence(page, source.id)
  const handle = card.locator('.card-resize-handle.bottom.right')
  await expect(handle).toBeVisible()
  const oldCard = await card.boundingBox()
  const start = await handle.boundingBox()
  if (!oldCard || !start) throw new Error('Missing crossfade card or resize handle')
  const startPoint = { x: start.x + start.width / 2, y: start.y + start.height / 2 }
  await page.evaluate(() => window.__EIDO_FORCE_OVERVIEW_DRAW__?.())
  await page.evaluate(() => window.__EIDO_PERF__?.resetBoardScenePerfCounters())
  const baseline = await page.evaluate((cardId) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')!
    const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${cardId}"]`)!
    return {
      activeCardPainted: window.__EIDO_OVERVIEW_CARD_IDS__?.has(cardId) ?? false,
      drawCount: Number(canvas.dataset.overviewDrawCount ?? 0),
      mountPlanDerivations: window.__EIDO_MOUNT_PLAN_DERIVATIONS__ ?? 0,
      labelCacheEntries: Number(canvas.dataset.cacheEntries ?? 0),
      nodeOpacity: Number(getComputedStyle(node).opacity),
      painterOpacity: Number(canvas.dataset.overviewCardOpacity ?? 0),
      silhouetteCount: Number(canvas.dataset.silhouetteCardCount ?? 0),
      representationCount: Number(canvas.dataset.representationCount ?? 0),
      boardSceneCounters: window.__EIDO_PERF__?.boardScenePerfCounters() ?? null,
    }
  }, source.id)
  expect(baseline).toMatchObject({
    activeCardPainted: true,
    nodeOpacity: 0.5,
    painterOpacity: 0.5,
    silhouetteCount: 0,
    representationCount: 1,
    boardSceneCounters: {
      summaryComputations: 0,
      weightComputations: 0,
      summaryCardIds: [],
      weightCardIds: [],
      sceneDerivations: 0,
      cardMetricDerivations: 0,
      cardMetricVisits: 0,
      cardMetricFullRebuilds: 0,
    },
  })
  const baselinePortPoint = await node.locator('.react-flow__handle.source').evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  })
  const warmedPainterPortPoint = await overviewPainterPortPoint(page, source)
  const warmedBodyPoint = {
    x: oldCard.x + oldCard.width / 2,
    y: oldCard.y + oldCard.height / 2 + 12,
  }
  const warmedAlpha = {
    body: await overviewAlphaAt(page, warmedBodyPoint),
    port: await overviewPortAlphaSignatureAt(page, warmedPainterPortPoint),
  }
  const warmedPaintBounds = await overviewPaintSpanAt(page, warmedBodyPoint)
  if (!warmedPaintBounds) throw new Error('Missing warmed overview paint span')
  const warmedVerticalPaintBounds = await overviewPaintSpanAt(page, {
    x: oldCard.x + 12,
    y: warmedBodyPoint.y,
  })
  if (!warmedVerticalPaintBounds) throw new Error('Missing warmed overview vertical paint span')
  expect(warmedAlpha.body).toBeGreaterThan(0)
  // The crossfade is a full Overview representation (canvas-layer
  // foundation §8), so its body and both ports complement the fading DOM.
  expect(warmedAlpha.port).toBeGreaterThan(PAINTER_PORT_SIGNATURE_MIN)
  expect(Math.abs(warmedPainterPortPoint.x - baselinePortPoint.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(warmedPainterPortPoint.y - baselinePortPoint.y)).toBeLessThanOrEqual(1)

  await page.mouse.move(startPoint.x, startPoint.y)
  await page.mouse.down()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  expect(await page.evaluate((cardId) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')!
    const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${cardId}"]`)!
    return {
      activeCardPainted: window.__EIDO_OVERVIEW_CARD_IDS__?.has(cardId) ?? false,
      nodeOpacity: Number(getComputedStyle(node).opacity),
      painterOpacity: Number(canvas.dataset.overviewCardOpacity ?? 0),
      drawCount: Number(canvas.dataset.overviewDrawCount ?? 0),
      mountPlanDerivations: window.__EIDO_MOUNT_PLAN_DERIVATIONS__ ?? 0,
      boardSceneCounters: window.__EIDO_PERF__?.boardScenePerfCounters() ?? null,
    }
  }, source.id)).toEqual({
    activeCardPainted: true,
    nodeOpacity: 0.5,
    painterOpacity: 0.5,
    // Resize begin synchronously prepares the retained painter planes once so
    // the first published hot frame cannot ghost. Movement then reuses that
    // prepared frame on the ordinary one-draw cadence below.
    drawCount: baseline.drawCount + 1,
    mountPlanDerivations: baseline.mountPlanDerivations,
    boardSceneCounters: baseline.boardSceneCounters,
  })

  for (let frame = 1; frame <= 6; frame += 1) {
    await page.mouse.move(startPoint.x + frame * (65 / 6), startPoint.y + frame * (39 / 6))
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    const visual = await page.evaluate((cardId) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')!
      const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${cardId}"]`)!
      const shellBounds = node.querySelector<HTMLElement>('.card')!.getBoundingClientRect()
      const portBounds = node
        .querySelector<HTMLElement>('.react-flow__handle.source')!
        .getBoundingClientRect()
      const bodyPoint = {
        x: shellBounds.x + shellBounds.width / 2,
        y: shellBounds.y + shellBounds.height / 2 + 12,
      }
      const portPoint = {
        x: portBounds.x + portBounds.width / 2,
        y: portBounds.y + portBounds.height / 2,
      }
      const diagnostic = (window as unknown as {
        __EIDO_RESIZE_RF_DIAGNOSTIC__?: {
          notifications: number
          dimensionChanges: number
          measuredMapClones: number
          snapshot: () => {
            renderIndexDelta: {
              gets: number
              incrementalUpdates: number
              cardsPatched: number
              boundsUpdated: number
              fullRebuilds: { initial: number; cardStructure: number; connections: number }
            }
            rankEpochDelta: number
          }
        }
      }).__EIDO_RESIZE_RF_DIAGNOSTIC__
      return {
        drawCount: Number(canvas.dataset.overviewDrawCount ?? 0),
        resizeHotCardVisits: Number(canvas.dataset.resizeHotCardVisits ?? 0),
        resizeHotConnectionVisits: Number(canvas.dataset.resizeHotConnectionVisits ?? 0),
        mountPlanDerivations: window.__EIDO_MOUNT_PLAN_DERIVATIONS__ ?? 0,
        labelCacheEntries: Number(canvas.dataset.cacheEntries ?? 0),
        labelCacheMisses: Number(canvas.dataset.labelCacheMissesPerFrame ?? 0),
        renderedConnections: Number(canvas.dataset.renderedConnectionCount ?? 0),
        boardSceneCounters: window.__EIDO_PERF__?.boardScenePerfCounters() ?? null,
        nodeOpacity: Number(getComputedStyle(node).opacity),
        painterOpacity: Number(canvas.dataset.overviewCardOpacity ?? 0),
        silhouetteCount: Number(canvas.dataset.silhouetteCardCount ?? 0),
        representationCount: Number(canvas.dataset.representationCount ?? 0),
        drawnHotSize: canvas.dataset.resizeHotWidth && canvas.dataset.resizeHotHeight
          ? {
              width: Number(canvas.dataset.resizeHotWidth),
              height: Number(canvas.dataset.resizeHotHeight),
            }
          : null,
        activeCardPainted: window.__EIDO_OVERVIEW_CARD_IDS__?.has(cardId) ?? false,
        shell: {
          x: shellBounds.x,
          y: shellBounds.y,
          width: shellBounds.width,
          height: shellBounds.height,
        },
        bodyPoint,
        portPoint,
        hitCardId: document.elementFromPoint(bodyPoint.x, bodyPoint.y)
          ?.closest('.react-flow__node[data-id]')?.getAttribute('data-id') ?? null,
        hotAdapter: diagnostic ? {
          notifications: diagnostic.notifications,
          dimensionChanges: diagnostic.dimensionChanges,
          measuredMapClones: diagnostic.measuredMapClones,
          ...diagnostic.snapshot(),
        } : null,
      }
    }, source.id)
    expect(visual).toMatchObject({
      drawCount: baseline.drawCount + 1,
      resizeHotCardVisits: frame,
      resizeHotConnectionVisits: 0,
      mountPlanDerivations: baseline.mountPlanDerivations,
      labelCacheEntries: baseline.labelCacheEntries,
      labelCacheMisses: 0,
      renderedConnections: 0,
      boardSceneCounters: baseline.boardSceneCounters,
      nodeOpacity: 0.5,
      painterOpacity: 0.5,
      silhouetteCount: 0,
      representationCount: 1,
      activeCardPainted: true,
      hitCardId: source.id,
      hotAdapter: {
        notifications: 0,
        dimensionChanges: 0,
        measuredMapClones: 0,
        renderIndexDelta: {
          gets: 0,
          incrementalUpdates: 0,
          cardsPatched: 0,
          boundsUpdated: 0,
          fullRebuilds: { initial: 0, cardStructure: 0, connections: 0 },
        },
        rankEpochDelta: 0,
      },
    })
    const paintBounds = await overviewPaintSpanAt(page, visual.bodyPoint)
    if (!paintBounds) throw new Error(`Missing overview paint span at hot frame ${frame}`)
    const verticalPaintBounds = await overviewPaintSpanAt(page, {
      x: visual.shell.x + 12,
      y: visual.bodyPoint.y,
    })
    if (!verticalPaintBounds) throw new Error(`Missing overview vertical paint span at hot frame ${frame}`)
    expect(Math.abs(paintBounds.x - warmedPaintBounds.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(verticalPaintBounds.y - warmedVerticalPaintBounds.y)).toBeLessThanOrEqual(1)
    expect(
      Math.abs(
        (paintBounds.width - warmedPaintBounds.width) - (visual.shell.width - oldCard.width)
      ),
      `painter width growth diverged at hot frame ${frame}: shell ${JSON.stringify(visual.shell)}, paint ${JSON.stringify(paintBounds)}, consumed ${JSON.stringify(visual.drawnHotSize)}`,
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(
        (verticalPaintBounds.height - warmedVerticalPaintBounds.height) - (visual.shell.height - oldCard.height)
      ),
      `painter height growth diverged at hot frame ${frame}: shell ${JSON.stringify(visual.shell)}, paint ${JSON.stringify(verticalPaintBounds)}`,
    ).toBeLessThanOrEqual(1)
    expect(await overviewAlphaAt(page, visual.bodyPoint)).toBeCloseTo(warmedAlpha.body, 0)
    if (!visual.drawnHotSize) throw new Error(`Missing consumed hot size at frame ${frame}`)
    const hotPainterPortPoint = await overviewPainterPortPoint(page, {
      position: source.position,
      size: visual.drawnHotSize,
    })
    expect(Math.abs(hotPainterPortPoint.x - visual.portPoint.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(hotPainterPortPoint.y - visual.portPoint.y)).toBeLessThanOrEqual(1)
    const hotPortAlpha = await overviewPortAlphaSignatureAt(page, hotPainterPortPoint)
    expect(
      hotPortAlpha,
      `painter port disappeared at hot frame ${frame}: signature ${hotPortAlpha}`,
    ).toBeGreaterThan(PAINTER_PORT_SIGNATURE_MIN)
  }

  const bodyPoint = {
    x: oldCard.x + oldCard.width / 2,
    y: oldCard.y + oldCard.height + 15,
  }
  const portPoint = await node.locator('.react-flow__handle.source').evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  })
  const coherence = await page.evaluate(({ x, y, cardId }) => ({
    hitCardId: document.elementFromPoint(x, y)?.closest('.react-flow__node[data-id]')?.getAttribute('data-id') ?? null,
    storedSize: (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
      .getState()
      .cards.find((candidate) => candidate.id === cardId)?.size,
  }), { ...bodyPoint, cardId: source.id })
  expect(coherence.hitCardId).toBe(source.id)
  expect(coherence.storedSize).toEqual(source.size)
  expect(await overviewAlphaAt(page, bodyPoint)).toBeGreaterThan(0)
  expect(await overviewAlphaAt(page, portPoint)).toBeGreaterThan(0)
  expect(await page.evaluate((cardId) =>
    window.__EIDO_OVERVIEW_CARD_IDS__?.has(cardId) ?? false, source.id)).toBe(true)

  const heldReleaseGeometry = await page.evaluate((cardId) => {
    const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${cardId}"]`)!
    const shell = node.querySelector<HTMLElement>('.card')!.getBoundingClientRect()
    const resizeHandle = node
      .querySelector<HTMLElement>('.card-resize-handle.bottom.right')!
      .getBoundingClientRect()
    const sourceHandle = node
      .querySelector<HTMLElement>('.react-flow__handle.source')!
      .getBoundingClientRect()
    return {
      shell: { x: shell.x, y: shell.y, width: shell.width, height: shell.height },
      resizeHandle: {
        x: resizeHandle.x + resizeHandle.width / 2,
        y: resizeHandle.y + resizeHandle.height / 2,
      },
      sourceHandle: {
        x: sourceHandle.x + sourceHandle.width / 2,
        y: sourceHandle.y + sourceHandle.height / 2,
      },
    }
  }, source.id)
  const heldPainterEdgeAlpha = {
    right: await overviewAlphaAt(page, {
      x: heldReleaseGeometry.shell.x + heldReleaseGeometry.shell.width - 2,
      y: heldReleaseGeometry.shell.y + heldReleaseGeometry.shell.height / 2 + 12,
    }),
    bottom: await overviewAlphaAt(page, {
      x: heldReleaseGeometry.shell.x + heldReleaseGeometry.shell.width / 2,
      y: heldReleaseGeometry.shell.y + heldReleaseGeometry.shell.height - 2,
    }),
  }
  expect(heldPainterEdgeAlpha.right).toBeGreaterThan(0)
  expect(heldPainterEdgeAlpha.bottom).toBeGreaterThan(0)
  await page.evaluate(({ cardId, position }) => {
    type Geometry = {
      phase: string
      shell: { x: number; y: number; width: number; height: number }
      resizeHandle: { x: number; y: number }
      sourceHandle: { x: number; y: number }
      bodyAlpha: number
      rightEdgeAlpha: number
      bottomEdgeAlpha: number
      portAlpha: number
      diagnostic: {
        silhouetteCount: number
        representationCount: number
        suppressedReactCount: number
        hotSessionId: string | null
        hotWidth: string | null
        activeCardPainted: boolean
        nodeConnected: boolean
        nodeClass: string
        handleFromShellRight: number
        handleFromShellMidY: number
        handleFromPainterX: number
        handleFromPainterY: number
      }
    }
    const probeWindow = window as unknown as { __EIDO_CROSSFADE_RELEASE_GEOMETRY__?: Geometry[] }
    probeWindow.__EIDO_CROSSFADE_RELEASE_GEOMETRY__ = []
    const capture = (phase: string) => {
      const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${cardId}"]`)!
      const shell = node.querySelector<HTMLElement>('.card')!.getBoundingClientRect()
      const resizeHandle = node
        .querySelector<HTMLElement>('.card-resize-handle.bottom.right')!
        .getBoundingClientRect()
      const sourceHandle = node
        .querySelector<HTMLElement>('.react-flow__handle.source')!
        .getBoundingClientRect()
      const sourcePoint = {
        x: sourceHandle.x + sourceHandle.width / 2,
        y: sourceHandle.y + sourceHandle.height / 2,
      }
      const bodyPoint = {
        x: shell.x + shell.width / 2,
        y: shell.y + shell.height - 10,
      }
      const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')!
      const context = canvas.getContext('2d')!
      const canvasBounds = canvas.getBoundingClientRect()
      const viewportElement = canvas.closest('.react-flow')?.querySelector<HTMLElement>('.react-flow__viewport')
      const transform = viewportElement ? getComputedStyle(viewportElement).transform : 'none'
      const matrix = transform && transform !== 'none'
        ? new DOMMatrixReadOnly(transform)
        : new DOMMatrixReadOnly()
      const graphCard = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
        .getState().cards.find((candidate) => candidate.id === cardId)
      const painterSize = {
        width: Number(canvas.dataset.resizeHotWidth) || graphCard?.size?.width || shell.width / matrix.a,
        height: Number(canvas.dataset.resizeHotHeight) || graphCard?.size?.height || shell.height / matrix.a,
      }
      const painterPortPoint = {
        x: canvasBounds.x + matrix.e + (position.x + painterSize.width) * matrix.a,
        y: canvasBounds.y + matrix.f + (position.y + painterSize.height / 2) * matrix.a,
      }
      const alphaAt = (point: { x: number; y: number }, radius = 0) => {
        const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(
          ((point.x - canvasBounds.left) * canvas.width) / canvasBounds.width,
        )))
        const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(
          ((point.y - canvasBounds.top) * canvas.height) / canvasBounds.height,
        )))
        let alpha = 0
        for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
          for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
            const sampleX = Math.max(0, Math.min(canvas.width - 1, x + offsetX))
            const sampleY = Math.max(0, Math.min(canvas.height - 1, y + offsetY))
            alpha = Math.max(alpha, context.getImageData(sampleX, sampleY, 1, 1).data[3])
          }
        }
        return alpha
      }
      const portAlphaSignatureAt = (point: { x: number; y: number }) => {
        const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(
          ((point.x - canvasBounds.left) * canvas.width) / canvasBounds.width,
        )))
        const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(
          ((point.y - canvasBounds.top) * canvas.height) / canvasBounds.height,
        )))
        const verticalOffset = Math.max(1, Math.round((14 * canvas.height) / canvasBounds.height))
        const positiveExcessAt = (centerX: number, centerY: number) => {
          let alpha = 0
          for (let offsetY = -6; offsetY <= 6; offsetY += 1) {
            for (let offsetX = -6; offsetX <= 6; offsetX += 1) {
              const sampleX = Math.max(0, Math.min(canvas.width - 1, centerX + offsetX))
              const sampleY = Math.max(0, Math.min(canvas.height - 1, centerY + offsetY))
              const centerAlpha = context.getImageData(sampleX, sampleY, 1, 1).data[3]
              const aboveAlpha = context.getImageData(
                sampleX,
                Math.max(0, sampleY - verticalOffset),
                1,
                1,
              ).data[3]
              const belowAlpha = context.getImageData(
                sampleX,
                Math.min(canvas.height - 1, sampleY + verticalOffset),
                1,
                1,
              ).data[3]
              alpha += Math.max(0, centerAlpha - (aboveAlpha + belowAlpha) / 2)
            }
          }
          return alpha
        }
        let residual = 0
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const centerX = x + offsetX
            const centerY = y + offsetY
            residual = Math.max(residual, positiveExcessAt(centerX, centerY))
          }
        }
        return residual
      }
      probeWindow.__EIDO_CROSSFADE_RELEASE_GEOMETRY__!.push({
        phase,
        shell: { x: shell.x, y: shell.y, width: shell.width, height: shell.height },
        resizeHandle: {
          x: resizeHandle.x + resizeHandle.width / 2,
          y: resizeHandle.y + resizeHandle.height / 2,
        },
        sourceHandle: sourcePoint,
        bodyAlpha: alphaAt(bodyPoint),
        rightEdgeAlpha: alphaAt({
          x: shell.x + shell.width - 2,
          y: shell.y + shell.height / 2 + 12,
        }),
        bottomEdgeAlpha: alphaAt({
          x: shell.x + shell.width / 2,
          y: shell.y + shell.height - 2,
        }),
        portAlpha: portAlphaSignatureAt(painterPortPoint),
        diagnostic: {
          silhouetteCount: Number(canvas.dataset.silhouetteCardCount ?? 0),
          representationCount: Number(canvas.dataset.representationCount ?? 0),
          suppressedReactCount: Number(canvas.dataset.suppressedReactCardCount ?? 0),
          hotSessionId: canvas.dataset.resizeHotSessionId ?? null,
          hotWidth: canvas.dataset.resizeHotWidth ?? null,
          activeCardPainted: window.__EIDO_OVERVIEW_CARD_IDS__?.has(cardId) ?? false,
          nodeConnected: node.isConnected,
          nodeClass: node.className,
          handleFromShellRight: sourcePoint.x - shell.right,
          handleFromShellMidY: sourcePoint.y - (shell.y + shell.height / 2),
          handleFromPainterX: sourcePoint.x - painterPortPoint.x,
          handleFromPainterY: sourcePoint.y - painterPortPoint.y,
        },
      })
    }
    window.addEventListener('pointerup', () => {
      capture('pointerup')
      queueMicrotask(() => {
        capture('post-event')
        requestAnimationFrame(() => {
          capture('raf-1')
          requestAnimationFrame(() => capture('raf-2'))
        })
      })
    }, { once: true, capture: true })
  }, { cardId: source.id, position: source.position })
  await page.mouse.up()
  await page.waitForFunction(() => (
    (window as unknown as { __EIDO_CROSSFADE_RELEASE_GEOMETRY__?: unknown[] })
      .__EIDO_CROSSFADE_RELEASE_GEOMETRY__?.length ?? 0
  ) === 4)
  const crossfadeReleaseGeometry = await page.evaluate(() => (
    window as unknown as {
      __EIDO_CROSSFADE_RELEASE_GEOMETRY__: Array<{
        phase: string
        shell: { x: number; y: number; width: number; height: number }
        resizeHandle: { x: number; y: number }
        sourceHandle: { x: number; y: number }
        bodyAlpha: number
        rightEdgeAlpha: number
        bottomEdgeAlpha: number
        portAlpha: number
        diagnostic: {
          silhouetteCount: number
          representationCount: number
          suppressedReactCount: number
          hotSessionId: string | null
          hotWidth: string | null
          activeCardPainted: boolean
          nodeConnected: boolean
          nodeClass: string
          handleFromShellRight: number
          handleFromShellMidY: number
          handleFromPainterX: number
          handleFromPainterY: number
        }
      }>
    }
  ).__EIDO_CROSSFADE_RELEASE_GEOMETRY__)
  expect(crossfadeReleaseGeometry.map((frame) => frame.phase)).toEqual([
    'pointerup',
    'post-event',
    'raf-1',
    'raf-2',
  ])
  for (const frame of crossfadeReleaseGeometry) {
    expect(frame.shell.x).toBeCloseTo(heldReleaseGeometry.shell.x, 0)
    expect(frame.shell.y).toBeCloseTo(heldReleaseGeometry.shell.y, 0)
    expect(frame.shell.width).toBeCloseTo(heldReleaseGeometry.shell.width, 0)
    expect(frame.shell.height).toBeCloseTo(heldReleaseGeometry.shell.height, 0)
    expect(frame.resizeHandle.x).toBeCloseTo(heldReleaseGeometry.resizeHandle.x, 0)
    expect(frame.resizeHandle.y).toBeCloseTo(heldReleaseGeometry.resizeHandle.y, 0)
    expect(frame.sourceHandle.x).toBeCloseTo(heldReleaseGeometry.sourceHandle.x, 0)
    expect(frame.sourceHandle.y).toBeCloseTo(heldReleaseGeometry.sourceHandle.y, 0)
    expect(frame.bodyAlpha).toBeCloseTo(warmedAlpha.body, 0)
    expect(frame.rightEdgeAlpha).toBeCloseTo(heldPainterEdgeAlpha.right, 0)
    expect(frame.bottomEdgeAlpha).toBeCloseTo(heldPainterEdgeAlpha.bottom, 0)
    expect(frame.diagnostic).toMatchObject({
      silhouetteCount: 0,
      representationCount: 1,
      suppressedReactCount: 0,
      activeCardPainted: true,
      nodeConnected: true,
    })
    expect(Math.abs(frame.diagnostic.handleFromPainterX)).toBeLessThanOrEqual(1)
    expect(Math.abs(frame.diagnostic.handleFromPainterY)).toBeLessThanOrEqual(1)
    expect(
      frame.portAlpha,
      `painter port disappeared at ${frame.phase}: signature ${frame.portAlpha}, diagnostic ${JSON.stringify(frame.diagnostic)}`,
    ).toBeGreaterThan(PAINTER_PORT_SIGNATURE_MIN)
  }
  await expect.poll(() => page.evaluate((cardId) => {
    const state = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido.getState()
    return state.cards.find((candidate) => candidate.id === cardId)?.size
  }, source.id)).toEqual({ width: 460, height: 300 })
  await expect.poll(() => node.evaluate((element) => Number(getComputedStyle(element).opacity))).toBe(0.5)
})
