import { expect, test, type Page } from '@playwright/test'

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    connectionPulse: { connectionId: string; seq: number } | null
  }
  setState: (state: unknown) => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
  __EIDO_FORCE_OVERVIEW_DRAW__?: () => void
}

async function waitForApp(page: Page) {
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })
}

async function pinViewport(
  page: Page,
  viewport: { x: number; y: number; zoom: number },
) {
  await expect.poll(() => page.evaluate((next) => {
    const element = document.querySelector<HTMLElement>('.react-flow__viewport')
    const board = document.querySelector<HTMLElement>('.board-flow')
    if (!element || !board) return false
    const matrix = new DOMMatrix(getComputedStyle(element).transform)
    const atTarget = Math.abs(matrix.e - next.x) < 0.5
      && Math.abs(matrix.f - next.y) < 0.5
      && Math.abs(matrix.a - next.zoom) < 0.001
    if (!atTarget) {
      ;(window as unknown as DevWindow).__EIDO_SET_VIEWPORT__?.(next)
      return false
    }
    // Do not keep re-setting an already-correct camera: the board's settled
    // painted-band signal proves no deferred fit raced the pin afterward.
    return board.dataset.canvasPortZone === 'painted'
  }, viewport)).toBe(true)
}

async function setViewport(
  page: Page,
  viewport: { x: number; y: number; zoom: number },
) {
  await expect.poll(() => page.evaluate((next) => {
    const element = document.querySelector<HTMLElement>('.react-flow__viewport')
    if (!element) return false
    const matrix = new DOMMatrix(getComputedStyle(element).transform)
    const atTarget = Math.abs(matrix.e - next.x) < 0.5
      && Math.abs(matrix.f - next.y) < 0.5
      && Math.abs(matrix.a - next.zoom) < 0.001
    if (!atTarget) (window as unknown as DevWindow).__EIDO_SET_VIEWPORT__?.(next)
    return atTarget
  }, viewport)).toBe(true)
}

async function seedThemeProofCard(page: Page) {
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    devWindow.__eido.setState({
      cards: [{
        id: 'theme-proof',
        kind: 'note',
        blocks: [{ id: 'theme-proof-block', text: '' }],
        position: { x: 100, y: 100 },
      }],
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
  await pinViewport(page, { x: 100, y: 100, zoom: 0.2 })
  await page.waitForFunction(() => {
    const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')
    return Number(layer?.dataset.renderedCardCount ?? 0) === 1
  })
}

async function paintedNoteProbe(page: Page) {
  return page.evaluate(() => {
    ;(window as unknown as DevWindow).__EIDO_FORCE_OVERVIEW_DRAW__?.()
    const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
    const pane = document.querySelector<HTMLElement>('.react-flow')
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    const context = canvas?.getContext('2d')
    if (!canvas || !pane || !viewport || !context) throw new Error('Missing board painter')

    const matrix = new DOMMatrix(getComputedStyle(viewport).transform)
    const paneRect = pane.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    const ratio = canvas.width / canvasRect.width
    // An interior point away from the note border, ports, and label baseline.
    const flowX = 100 + 260 * 0.2
    const flowY = 100 + 180 * 0.8
    const canvasX = paneRect.left + matrix.e + flowX * matrix.a - canvasRect.left
    const canvasY = paneRect.top + matrix.f + flowY * matrix.d - canvasRect.top
    const actual = Array.from(
      context.getImageData(Math.floor(canvasX * ratio), Math.floor(canvasY * ratio), 1, 1).data,
    )

    const colorProbe = document.createElement('canvas')
    colorProbe.width = 1
    colorProbe.height = 1
    const colorContext = colorProbe.getContext('2d')!
    colorContext.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--e-surface-card')
      .trim()
    colorContext.fillRect(0, 0, 1, 1)
    const expected = Array.from(colorContext.getImageData(0, 0, 1, 1).data)
    return { actual, expected }
  })
}

test('device theme drives startup, Settings, board chrome, and the live painter', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript(() => {
    localStorage.setItem('eido-v3-settings', JSON.stringify({ theme: 'system' }))
  })
  await page.goto('/')
  await waitForApp(page)

  const root = page.locator('html')
  await expect(root).toHaveAttribute('data-theme', 'dark')
  await seedThemeProofCard(page)
  const darkPaint = await paintedNoteProbe(page)
  expect(darkPaint.actual).toEqual(darkPaint.expected)

  const chrome = await page.evaluate(() => {
    const board = document.querySelector<HTMLElement>('.board-wrap')
    const control = document.querySelector<HTMLElement>('.react-flow__controls-button')
    if (!board || !control) throw new Error('Missing board chrome')
    const rootStyles = getComputedStyle(document.documentElement)
    const resolveColor = (token: string) => {
      const probe = document.createElement('span')
      probe.style.background = `var(${token})`
      document.body.append(probe)
      const color = getComputedStyle(probe).backgroundColor
      probe.remove()
      return color
    }
    return {
      board: getComputedStyle(board).backgroundColor,
      expectedBoard: resolveColor('--e-surface-ground'),
      control: getComputedStyle(control).backgroundColor,
      expectedControl: resolveColor('--e-surface-panel'),
      controlInk: getComputedStyle(control).color,
      expectedControlInk: resolveColor('--e-ink'),
      controlShadow: getComputedStyle(control).boxShadow,
      gridHook: getComputedStyle(document.querySelector<HTMLElement>('.board-flow')!)
        .getPropertyValue('--xy-background-color')
        .trim(),
      expectedGridHook: rootStyles.getPropertyValue('--e-surface-ground').trim(),
    }
  })
  expect(chrome).toMatchObject({
    board: chrome.expectedBoard,
    control: chrome.expectedControl,
    controlInk: chrome.expectedControlInk,
    controlShadow: 'none',
    gridHook: chrome.expectedGridHook,
  })

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Board' }).click()
  const theme = page.getByRole('radiogroup', { name: 'Theme' })
  await expect(theme.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true')

  await theme.getByRole('radio', { name: 'Light' }).click()
  await expect(root).toHaveAttribute('data-theme', 'light')
  await expect
    .poll(async () => (await paintedNoteProbe(page)).actual)
    .toEqual((await paintedNoteProbe(page)).expected)
  const lightPaint = await paintedNoteProbe(page)
  expect(lightPaint.actual).not.toEqual(darkPaint.actual)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('eido-v3-settings') ?? '{}').theme))
    .toBe('light')

  await theme.getByRole('radio', { name: 'System' }).click()
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(root).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(root).toHaveAttribute('data-theme', 'dark')
})

test('React Flow controls render the complete state grammar in both themes', async ({ page }) => {
  await page.goto('/')
  await waitForApp(page)

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((nextTheme) => {
      const current = JSON.parse(localStorage.getItem('eido-v3-settings') ?? '{}')
      localStorage.setItem('eido-v3-settings', JSON.stringify({ ...current, theme: nextTheme }))
    }, theme)
    await page.reload()
    await waitForApp(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await seedThemeProofCard(page)
    await setViewport(page, { x: 40, y: 40, zoom: 1 })

    const controls = page.locator('.react-flow__controls')
    const zoomIn = controls.locator('.react-flow__controls-zoomin')
    const zoomOut = controls.locator('.react-flow__controls-zoomout')
    const fitView = controls.locator('.react-flow__controls-fitview')
    await expect(zoomIn).toBeEnabled()
    await expect(zoomOut).toBeEnabled()
    await page.mouse.move(640, 120)

    const chrome = await page.evaluate(() => {
      const board = document.querySelector<HTMLElement>('.board-wrap')
      const control = document.querySelector<HTMLElement>('.react-flow__controls-button')
      if (!board || !control) throw new Error('Missing board chrome')
      const resolveColor = (token: string, property: 'color' | 'backgroundColor') => {
        const probe = document.createElement('span')
        probe.style[property] = `var(${token})`
        document.body.append(probe)
        const color = getComputedStyle(probe)[property]
        probe.remove()
        return color
      }
      return {
        board: getComputedStyle(board).backgroundColor,
        expectedBoard: resolveColor('--e-surface-ground', 'backgroundColor'),
        expectedControl: resolveColor('--e-surface-panel', 'backgroundColor'),
        expectedControlInk: resolveColor('--e-ink', 'color'),
      }
    })
    expect(chrome.board).toBe(chrome.expectedBoard)
    await expect(zoomIn).toHaveCSS('background-color', chrome.expectedControl)
    await expect(zoomIn).toHaveCSS('color', chrome.expectedControlInk)

    const verticalCorners = await controls.evaluate((cluster) => {
      const buttons = [...cluster.querySelectorAll<HTMLElement>('.react-flow__controls-button')]
      const first = getComputedStyle(buttons[0]!)
      const middle = getComputedStyle(buttons[1]!)
      const last = getComputedStyle(buttons[buttons.length - 1]!)
      return {
        clusterRadius: getComputedStyle(cluster).borderRadius,
        first: [
          first.borderTopLeftRadius,
          first.borderTopRightRadius,
          first.borderBottomRightRadius,
          first.borderBottomLeftRadius,
        ],
        middle: [
          middle.borderTopLeftRadius,
          middle.borderTopRightRadius,
          middle.borderBottomRightRadius,
          middle.borderBottomLeftRadius,
        ],
        last: [
          last.borderTopLeftRadius,
          last.borderTopRightRadius,
          last.borderBottomRightRadius,
          last.borderBottomLeftRadius,
        ],
      }
    })
    expect(verticalCorners.first).toEqual([
      verticalCorners.clusterRadius,
      verticalCorners.clusterRadius,
      '0px',
      '0px',
    ])
    expect(verticalCorners.middle).toEqual(Array(4).fill('0px'))
    expect(verticalCorners.last).toEqual([
      '0px',
      '0px',
      verticalCorners.clusterRadius,
      verticalCorners.clusterRadius,
    ])

    const transition = await zoomIn.evaluate((control) => {
      const styles = getComputedStyle(control)
      return {
        properties: styles.transitionProperty.split(',').map(value => value.trim()),
        durations: styles.transitionDuration.split(',').map(value => value.trim()),
      }
    })
    expect(transition.properties).toEqual([
      'background-color',
      'border-color',
      'color',
      'transform',
    ])
    expect(transition.durations.every(duration => duration === '0.12s')).toBe(true)

    await zoomIn.focus()
    await page.keyboard.press('Tab')
    await expect(zoomOut).toBeFocused()
    const expectedFocusBoundary = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--e-go)'
      document.body.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    })
    await expect(zoomOut).toHaveCSS('border-top-color', expectedFocusBoundary)
    await expect(zoomOut).toHaveCSS('border-right-color', expectedFocusBoundary)
    await expect(zoomOut).toHaveCSS('border-bottom-color', expectedFocusBoundary)
    await expect(zoomOut).toHaveCSS('border-left-color', expectedFocusBoundary)
    await expect(zoomIn).toHaveCSS('border-bottom-color', 'rgba(0, 0, 0, 0)')
    const keyboard = await zoomOut.evaluate((control) => {
      const styles = getComputedStyle(control)
      const clusterStyles = getComputedStyle(control.parentElement!)
      return {
        boundaryWidths: [
          styles.borderTopWidth,
          styles.borderRightWidth,
          styles.borderBottomWidth,
          styles.borderLeftWidth,
        ],
        outline: styles.outlineStyle,
        shadow: styles.boxShadow,
        clusterBoundary: clusterStyles.borderTopWidth,
      }
    })
    expect(keyboard.boundaryWidths).toEqual(Array(4).fill('1px'))
    expect(keyboard.outline).toBe('none')
    expect(keyboard.shadow).toBe('none')
    expect(keyboard.clusterBoundary).toBe('0px')

    const box = await fitView.boundingBox()
    if (!box) throw new Error('Missing Fit view control bounds')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    try {
      await expect
        .poll(() => fitView.evaluate(control => getComputedStyle(control).transform))
        .toBe('matrix(0.97, 0, 0, 0.97, 0, 0)')
    } finally {
      await page.mouse.up()
    }

    await setViewport(page, { x: 0, y: 0, zoom: 4 })
    await expect(zoomIn).toBeDisabled()
    await zoomIn.hover({ force: true })
    const expectedDisabled = await page.evaluate(() => {
      const token = (name: string, property: 'color' | 'backgroundColor') => {
        const probe = document.createElement('span')
        probe.style[property] = `var(${name})`
        document.body.append(probe)
        const color = getComputedStyle(probe)[property]
        probe.remove()
        return color
      }
      return {
        background: token('--e-surface-panel', 'backgroundColor'),
        boundary: token('--e-line', 'color'),
        color: token('--e-ink-faint', 'color'),
      }
    })
    await expect(zoomIn).toHaveCSS('background-color', expectedDisabled.background)
    await expect(zoomIn).toHaveCSS('border-top-color', expectedDisabled.boundary)
    await expect(zoomIn).toHaveCSS('border-right-color', expectedDisabled.boundary)
    await expect(zoomIn).toHaveCSS('border-bottom-color', expectedDisabled.boundary)
    await expect(zoomIn).toHaveCSS('border-left-color', expectedDisabled.boundary)
    await expect(zoomIn).toHaveCSS('color', expectedDisabled.color)
    const disabled = await zoomIn.evaluate((control) => {
      const styles = getComputedStyle(control)
      const iconStyles = getComputedStyle(control.querySelector('svg')!)
      return {
        background: styles.backgroundColor,
        boundary: [
          styles.borderTopColor,
          styles.borderRightColor,
          styles.borderBottomColor,
          styles.borderLeftColor,
        ],
        color: styles.color,
        cursor: styles.cursor,
        fillOpacity: iconStyles.fillOpacity,
        opacity: styles.opacity,
        iconOpacity: iconStyles.opacity,
        pointerEvents: styles.pointerEvents,
        transform: styles.transform,
      }
    })
    expect(disabled).toMatchObject({
      background: expectedDisabled.background,
      boundary: Array(4).fill(expectedDisabled.boundary),
      color: expectedDisabled.color,
      cursor: 'default',
      fillOpacity: '1',
      opacity: '1',
      iconOpacity: '1',
      pointerEvents: 'auto',
      transform: 'none',
    })

    await setViewport(page, { x: 40, y: 40, zoom: 1 })
    await expect(zoomIn).toBeEnabled()
    await expect(zoomOut).toBeEnabled()
    await page.mouse.move(640, 120)
    await controls.evaluate((cluster) => {
      cluster.classList.remove('vertical')
      cluster.classList.add('horizontal')
    })
    await expect(controls).toHaveClass(/\bhorizontal\b/)
    await expect(controls).toHaveCSS('flex-direction', 'row')

    const horizontalCorners = await controls.evaluate((cluster) => {
      const buttons = [...cluster.querySelectorAll<HTMLElement>('.react-flow__controls-button')]
      const first = getComputedStyle(buttons[0]!)
      const last = getComputedStyle(buttons[buttons.length - 1]!)
      return {
        clusterRadius: getComputedStyle(cluster).borderRadius,
        first: [
          first.borderTopLeftRadius,
          first.borderTopRightRadius,
          first.borderBottomRightRadius,
          first.borderBottomLeftRadius,
        ],
        last: [
          last.borderTopLeftRadius,
          last.borderTopRightRadius,
          last.borderBottomRightRadius,
          last.borderBottomLeftRadius,
        ],
      }
    })
    expect(horizontalCorners.first).toEqual([
      horizontalCorners.clusterRadius,
      '0px',
      '0px',
      horizontalCorners.clusterRadius,
    ])
    expect(horizontalCorners.last).toEqual([
      '0px',
      horizontalCorners.clusterRadius,
      horizontalCorners.clusterRadius,
      '0px',
    ])

    const horizontalTransition = await zoomIn.evaluate((control) => {
      const styles = getComputedStyle(control)
      return {
        properties: styles.transitionProperty.split(',').map(value => value.trim()),
        durations: styles.transitionDuration.split(',').map(value => value.trim()),
      }
    })
    expect(horizontalTransition.properties).toEqual([
      'background-color',
      'border-color',
      'color',
      'transform',
    ])
    expect(horizontalTransition.durations.every(duration => duration === '0.12s')).toBe(true)

    const expectedStrongBoundary = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--e-line-strong)'
      document.body.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    })
    await expect(fitView).toHaveCSS('border-right-color', expectedStrongBoundary)

    await zoomIn.focus()
    await page.keyboard.press('Tab')
    await expect(zoomOut).toBeFocused()
    await expect(zoomOut).toHaveCSS('border-top-color', expectedFocusBoundary)
    await expect(zoomOut).toHaveCSS('border-right-color', expectedFocusBoundary)
    await expect(zoomOut).toHaveCSS('border-bottom-color', expectedFocusBoundary)
    await expect(zoomOut).toHaveCSS('border-left-color', expectedFocusBoundary)
    await expect(zoomIn).toHaveCSS('border-right-color', 'rgba(0, 0, 0, 0)')
    await expect(zoomIn).toHaveCSS('border-bottom-color', expectedStrongBoundary)
    await expect(fitView).toHaveCSS('border-left-width', '0px')
    await expect(fitView).toHaveCSS('border-right-color', expectedStrongBoundary)

    const horizontalBox = await fitView.boundingBox()
    if (!horizontalBox) throw new Error('Missing horizontal Fit view control bounds')
    await page.mouse.move(
      horizontalBox.x + horizontalBox.width / 2,
      horizontalBox.y + horizontalBox.height / 2,
    )
    await page.mouse.down()
    try {
      await expect
        .poll(() => fitView.evaluate(control => getComputedStyle(control).transform))
        .toBe('matrix(0.97, 0, 0, 0.97, 0, 0)')
    } finally {
      await page.mouse.up()
    }

    await setViewport(page, { x: 40, y: 40, zoom: 1 })
    for (let attempt = 0; attempt < 32 && await zoomOut.isEnabled(); attempt += 1) {
      await zoomOut.click()
    }
    await expect(zoomOut).toBeDisabled()
    await expect(zoomOut).toHaveCSS('border-top-color', expectedDisabled.boundary)
    await expect(zoomOut).toHaveCSS('border-right-color', expectedDisabled.boundary)
    await expect(zoomOut).toHaveCSS('border-bottom-color', expectedDisabled.boundary)
    await expect(zoomOut).toHaveCSS('border-left-color', expectedDisabled.boundary)
    await expect(zoomIn).toHaveCSS('border-right-color', 'rgba(0, 0, 0, 0)')
    await expect(zoomIn).toHaveCSS('border-bottom-color', expectedStrongBoundary)
    await expect(fitView).toHaveCSS('border-left-width', '0px')
    await expect(fitView).toHaveCSS('border-right-color', expectedStrongBoundary)
  }
})

test('reduced motion holds pulse dots and retires connection beats', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await waitForApp(page)
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true')

  const motion = await page.evaluate(() => {
    const dot = document.createElement('span')
    dot.className = 'streaming-dot'
    document.body.append(dot)
    const rootStyles = getComputedStyle(document.documentElement)
    const dotStyles = getComputedStyle(dot)
    return {
      fast: rootStyles.getPropertyValue('--e-t-fast').trim(),
      fade: rootStyles.getPropertyValue('--e-t-fade').trim(),
      intent: rootStyles.getPropertyValue('--e-t-intent').trim(),
      dotAnimation: dotStyles.animationName,
      dotOpacity: dotStyles.opacity,
    }
  })
  expect(motion).toEqual({
    fast: '1ms',
    fade: '80ms',
    intent: '0ms',
    dotAnimation: 'none',
    dotOpacity: '1',
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'motion-a',
          kind: 'note',
          blocks: [{ id: 'motion-a-block', text: 'A' }],
          position: { x: 80, y: 100 },
        },
        {
          id: 'motion-b',
          kind: 'note',
          blocks: [{ id: 'motion-b-block', text: 'B' }],
          position: { x: 560, y: 100 },
        },
      ],
      connections: [{
        id: 'motion-connection',
        from: { cardId: 'motion-a' },
        to: { cardId: 'motion-b' },
        strength: 'strong',
        polarity: 'helps',
        role: 'feeds',
      }],
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
  })
  await page.waitForSelector('.react-flow__edge[data-id="motion-connection"]', { state: 'attached' })
  await page.evaluate(() => {
    const record = { appearances: 0, present: false }
    ;(window as unknown as Record<string, unknown>).__reducedPulseWatch = record
    const check = () => {
      const present = Boolean(document.querySelector('.connection-pulse'))
      if (present && !record.present) record.appearances += 1
      record.present = present
    }
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true })
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    devWindow.__eido.setState({
      connectionPulse: { connectionId: 'motion-connection', seq: 1 },
    })
  })
  await expect
    .poll(() => page.evaluate(() => (
      window as unknown as Record<string, { appearances: number }>
    ).__reducedPulseWatch.appearances))
    .toBe(1)
  await expect
    .poll(() => page.evaluate(() => (
      window as unknown as DevWindow & { __eido: EidoDevStore }
    ).__eido.getState().connectionPulse))
    .toBeNull()
  await expect(page.locator('.connection-pulse')).toHaveCount(0)
})

test('reduced motion makes the painted-card camera flight an immediate jump', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await waitForApp(page)
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true')
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    devWindow.__eido.setState({
      cards: [{
        id: 'camera-proof',
        kind: 'note',
        blocks: [{ id: 'camera-proof-block', text: 'Camera proof' }],
        position: { x: 9_000, y: 4_000 },
      }],
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
  await pinViewport(page, { x: 200, y: 80, zoom: 0.06 })
  await page.waitForFunction(() => window.__EIDO_OVERVIEW_CARD_IDS__?.has('camera-proof'))

  const centre = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('.react-flow')
    if (!pane) throw new Error('Missing board pane')
    const rect = pane.getBoundingClientRect()
    return {
      x: rect.left + 200 + (9_000 + 130) * 0.06,
      y: rect.top + 80 + (4_000 + 90) * 0.06,
    }
  })
  await page.mouse.move(centre.x - 100, centre.y - 40)
  await page.mouse.move(centre.x - 25, centre.y - 10)
  await page.mouse.move(centre.x, centre.y)
  await page.locator('.react-flow__node-gestureProxy[data-id="camera-proof"]').waitFor({
    state: 'attached',
  })
  await expect
    .poll(() => page.evaluate(({ x, y }) => {
      const hit = document.elementFromPoint(x, y)
      return hit
        ?.closest<HTMLElement>('.react-flow__node-gestureProxy')
        ?.dataset.id ?? null
    }, centre))
    .toBe('camera-proof')
  await page.mouse.dblclick(centre.x, centre.y)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))

  const landing = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('.react-flow')
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    if (!pane || !viewport) throw new Error('Missing camera')
    const paneRect = pane.getBoundingClientRect()
    const matrix = new DOMMatrix(getComputedStyle(viewport).transform)
    return {
      zoom: matrix.a,
      offsetX: matrix.e + (9_000 + 130) * matrix.a - paneRect.width / 2,
      offsetY: matrix.f + (4_000 + 90) * matrix.d - paneRect.height / 2,
    }
  })
  expect(landing.zoom).toBeGreaterThanOrEqual(0.325)
  expect(Math.abs(landing.offsetX)).toBeLessThan(6)
  expect(Math.abs(landing.offsetY)).toBeLessThan(6)
})
