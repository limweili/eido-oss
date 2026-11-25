import { expect, test, type Page } from '@playwright/test'

type DockProofStore = {
  getState: () => {
    hydrated: boolean
    activeTool: string
    cards: Array<{ id: string; kind: string }>
  }
  setState: (state: unknown) => void
}

type DevWindow = Window & {
  __eido?: DockProofStore
}

// One tip's stadium, where it sits over its key, and where its label sits
// inside it. Read in the page so a drawn shortcut cannot quietly grow the pill
// or push the label off the pill's centre.
function measureTooltip(element: HTMLElement) {
  const box = element.getBoundingClientRect()
  const label = document.createRange()
  label.selectNode(element.childNodes[0])
  const labelBox = label.getBoundingClientRect()
  return {
    height: box.height,
    centreX: box.left + box.width / 2,
    labelOffsetY: (labelBox.top + labelBox.bottom) / 2 - (box.top + box.bottom) / 2,
  }
}

async function waitForApp(page: Page) {
  await page.waitForFunction(() => Boolean((window as DevWindow).__eido?.getState().hydrated))
}

async function seedDock(page: Page, selected: boolean) {
  await page.evaluate((withSelection) => {
    const store = (window as DevWindow).__eido
    if (!store) throw new Error('Missing Eido development store')
    const card = {
      id: 'dock-proof-note',
      kind: 'note',
      blocks: [{ id: 'dock-proof-block', text: 'Dock proof' }],
      position: { x: 120, y: 120 },
    }
    store.setState({
      cards: withSelection ? [card] : [],
      connections: [],
      outputs: [],
      runs: [],
      selection: withSelection ? { kind: 'card', id: card.id } : null,
      selectedCardIds: withSelection ? [card.id] : [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
  }, selected)
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((nextTheme) => {
    const current = JSON.parse(localStorage.getItem('eido-v3-settings') ?? '{}')
    localStorage.setItem('eido-v3-settings', JSON.stringify({ ...current, theme: nextTheme }))
  }, theme)
  await page.reload()
  await waitForApp(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
}

test('persistent dock keeps its order and machined material in both themes', async ({ page }, testInfo) => {
  await page.goto('/')
  await waitForApp(page)

  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    await seedDock(page, false)

    const toolbox = page.getByRole('toolbar', { name: 'Canvas tools' })
    await expect(toolbox.getByRole('button')).toHaveCount(10)
    expect(await toolbox.getByRole('button').evaluateAll(buttons =>
      buttons.map(button => button.getAttribute('aria-label')),
    )).toEqual([
      'Select',
      'Move',
      'Highlighter',
      'Add note',
      'Ask AI',
      'Conversation',
      'Add Mod',
      'Title',
      'Undo',
      'Redo',
    ])

    const contract = await toolbox.evaluate((element) => {
      const resolveColor = (token: string) => {
        const probe = document.createElement('span')
        probe.style.background = `var(${token})`
        document.body.append(probe)
        const color = getComputedStyle(probe).backgroundColor
        probe.remove()
        return color
      }
      const styles = getComputedStyle(element)
      const select = element.querySelector<HTMLElement>('[aria-label="Select"]')!
      const addNote = element.querySelector<HTMLElement>('[aria-label="Add note"]')!
      const selectStyles = getComputedStyle(select)
      const addNoteStyles = getComputedStyle(addNote)
      return {
        background: styles.backgroundColor,
        expectedPanel: resolveColor('--e-surface-panel'),
        border: styles.borderColor,
        expectedLine: resolveColor('--e-line-strong'),
        radius: styles.borderRadius,
        expectedRadius: getComputedStyle(document.documentElement)
          .getPropertyValue('--e-r-well')
          .trim(),
        shadow: styles.boxShadow,
        blur: styles.backdropFilter,
        selectWidth: select.getBoundingClientRect().width,
        selectHeight: select.getBoundingClientRect().height,
        selectBackground: selectStyles.backgroundColor,
        expectedInk: resolveColor('--e-ink'),
        selectColor: selectStyles.color,
        expectedOnSolid: resolveColor('--e-on-solid'),
        addNoteBackground: addNoteStyles.backgroundColor,
        addNoteColor: addNoteStyles.color,
        expectedGo: resolveColor('--e-go'),
        expectedWash: resolveColor('--e-wash'),
        goKeys: [...element.querySelectorAll<HTMLElement>('button')]
          .filter(button => getComputedStyle(button).backgroundColor === resolveColor('--e-go'))
          .map(button => button.getAttribute('aria-label')),
      }
    })

    expect(contract).toMatchObject({
      background: contract.expectedPanel,
      border: contract.expectedLine,
      radius: contract.expectedRadius,
      shadow: 'none',
      blur: 'none',
      selectWidth: 26,
      selectHeight: 26,
      selectBackground: contract.expectedInk,
      selectColor: contract.expectedOnSolid,
      // Ink marks the current tool and nothing in the bar wears go: every key
      // here fires on click, so a green key would claim a state none of them
      // holds.
      addNoteBackground: 'rgba(0, 0, 0, 0)',
      addNoteColor: contract.expectedInk,
      goKeys: [],
    })

    // Hovering the tool you are already holding dips its solid; it never falls
    // back to the ordinary ink wash, which would strand a paper glyph on an
    // almost-transparent key.
    const select = toolbox.getByRole('button', { name: 'Select' })
    await select.hover()
    const hoveredSelect = await select.evaluate((element) => {
      const styles = getComputedStyle(element)
      return { background: styles.backgroundColor, color: styles.color }
    })
    expect(hoveredSelect.color).toBe(contract.expectedOnSolid)
    expect(hoveredSelect.background).not.toBe(contract.expectedWash)
    expect(hoveredSelect.background).not.toBe(contract.expectedInk)
    await page.mouse.move(0, 0)
    await testInfo.attach(`bottom-dock-${theme}.png`, {
      body: await toolbox.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    })
  }
})

test('selection unfolds a flush tray without moving or resizing the persistent bar', async ({ page }, testInfo) => {
  await page.goto('/')
  await waitForApp(page)
  await seedDock(page, false)

  const toolbox = page.getByRole('toolbar', { name: 'Canvas tools' })
  const tray = page.locator('[role="toolbar"][aria-label="Selected card actions"]')
  const before = await toolbox.boundingBox()
  if (!before) throw new Error('Missing persistent dock geometry')
  await expect(tray).toHaveAttribute('aria-hidden', 'true')

  await seedDock(page, true)
  await expect(tray).not.toHaveAttribute('aria-hidden', 'true')
  await expect(tray.getByRole('button', { name: 'Duplicate' })).toBeVisible()
  await expect.poll(async () => {
    const trayBounds = await tray.boundingBox()
    const barBounds = await toolbox.boundingBox()
    if (!trayBounds || !barBounds) return Number.POSITIVE_INFINITY
    return Math.abs(trayBounds.y + trayBounds.height - barBounds.y)
  }).toBeLessThanOrEqual(1.5)

  const after = await toolbox.boundingBox()
  if (!after) throw new Error('Missing persistent dock geometry after selection')
  expect(after.x).toBeCloseTo(before.x, 1)
  expect(after.y).toBeCloseTo(before.y, 1)
  expect(after.width).toBeCloseTo(before.width, 1)
  expect(after.height).toBeCloseTo(before.height, 1)

  const material = await tray.evaluate((element) => {
    const styles = getComputedStyle(element)
    const barStyles = getComputedStyle(
      document.querySelector<HTMLElement>('[role="toolbar"][aria-label="Canvas tools"]')!,
    )
    return {
      backgroundMatches: styles.backgroundColor === barStyles.backgroundColor,
      borderMatches: styles.borderTopColor === barStyles.borderTopColor,
      bottomBorder: styles.borderBottomWidth,
      topRadius: styles.borderTopLeftRadius,
      bottomRadius: styles.borderBottomLeftRadius,
    }
  })
  expect(material).toMatchObject({
    backgroundMatches: true,
    borderMatches: true,
    bottomBorder: '0px',
    topRadius: '10px',
    bottomRadius: '0px',
  })
  await testInfo.attach('bottom-dock-attached-tray.png', {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  })
})

test('shortcuts and delayed tooltips preserve the production dock journey', async ({ page }) => {
  await page.goto('/')
  await waitForApp(page)
  await seedDock(page, false)

  const select = page.getByRole('button', { name: 'Select', exact: true })
  const tooltip = page.getByRole('tooltip')
  await select.hover()
  await expect(tooltip).not.toBeVisible()
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toHaveText('SELECT · V')
  await expect(tooltip).toHaveCSS('text-transform', 'uppercase')
  const typedShortcutTip = await tooltip.evaluate(measureTooltip)

  await page.mouse.move(12, 12)
  await expect(tooltip).not.toBeVisible()
  await page.keyboard.press('Tab')
  await select.focus()
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toHaveText('SELECT · V')

  const move = page.getByRole('button', { name: 'Move', exact: true })
  const moveTooltip = page.locator('.e-tooltip', { has: page.locator('.shortcut-spacebar-icon') })
  await move.hover()
  await expect(moveTooltip.locator('.shortcut-spacebar-icon')).toBeVisible()

  // A drawn shortcut buys no extra room: MOVE wears the same stadium as
  // SELECT, centred on its key, with its label on the pill's own centre.
  const drawnShortcutTip = await moveTooltip.evaluate(measureTooltip)
  const moveKey = await move.evaluate((element) => {
    const box = element.getBoundingClientRect()
    return box.left + box.width / 2
  })
  expect(Math.abs(drawnShortcutTip.height - typedShortcutTip.height)).toBeLessThan(1)
  expect(Math.abs(drawnShortcutTip.centreX - moveKey)).toBeLessThan(1)
  expect(Math.abs(drawnShortcutTip.labelOffsetY)).toBeLessThan(1)

  await page.keyboard.down('Space')
  await expect(move)
    .toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() =>
    (window as DevWindow).__eido?.getState().activeTool,
  )).toBe('pan')
  await page.keyboard.up('Space')
  await expect(move).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => page.evaluate(() =>
    (window as DevWindow).__eido?.getState().activeTool,
  )).toBe('select')

  await page.keyboard.press('n')
  await expect.poll(() => page.evaluate(() => ({
    activeTool: (window as DevWindow).__eido?.getState().activeTool,
    noteCount: (window as DevWindow).__eido?.getState().cards
      .filter(card => card.kind === 'note').length,
  }))).toEqual({ activeTool: 'select', noteCount: 1 })
})

test('narrow viewports keep the dock reachable and contain the Mod library', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('/')
  await waitForApp(page)

  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    await seedDock(page, false)

    const toolbox = page.getByRole('toolbar', { name: 'Canvas tools' })
    const responsive = await toolbox.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return {
        left: bounds.left,
        right: bounds.right,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflowX: getComputedStyle(element).overflowX,
      }
    })
    expect(responsive.left).toBeGreaterThanOrEqual(8)
    expect(responsive.right).toBeLessThanOrEqual(312)
    expect(responsive.scrollWidth).toBeGreaterThan(responsive.clientWidth)
    expect(responsive.overflowX).toBe('auto')

    await toolbox.getByRole('button', { name: 'Add Mod' }).click()
    // The library is a role="menu" (BottomDock.tsx), matching the same
    // element's assertion in BottomDock.test.tsx.
    const library = page.getByRole('menu', { name: 'Mod library' })
    await expect(library).toBeVisible()
    const libraryBounds = await library.boundingBox()
    if (!libraryBounds) throw new Error('Missing Mod library geometry')
    expect(libraryBounds.x).toBeGreaterThanOrEqual(8)
    expect(libraryBounds.x + libraryBounds.width).toBeLessThanOrEqual(312)
    await testInfo.attach(`bottom-dock-responsive-320-${theme}.png`, {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    })
  }
})
