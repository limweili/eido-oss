import { expect, test, type Page } from '@playwright/test'

type HighlightState = {
  hydrated: boolean
  activeTool: string
  activeHighlightTagId: string | null
  highlightTags: Array<{ id: string; name: string; color: string }>
  highlights: Array<{ id: string; tagId: string }>
}

type EidoDevWindow = Window & {
  __eido?: {
    getState: () => HighlightState
    setState: (state: unknown) => void
  }
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

const CUSTOM_COLOR = '#D09c7B80'

function relativeLuminance(color: string): number {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  if (!channels || channels.length !== 3) throw new Error(`Expected an RGB color, received ${color}`)
  const [red, green, blue] = channels.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

function paletteBoundaryState(element: HTMLElement) {
  const probe = document.createElement('span')
  // Resolve the canon's 1.5px selection outline through the same browser
  // pixel rounding as the control, while colors remain theme-token driven.
  probe.style.outline = '1.5px solid var(--e-ink)'
  probe.style.color = 'var(--e-go)'
  probe.style.borderColor = 'var(--e-line-strong)'
  document.body.append(probe)
  const expected = getComputedStyle(probe)
  const tokens = {
    ink: expected.outlineColor,
    go: expected.color,
    lineStrong: expected.borderColor,
    selectionWidth: expected.outlineWidth,
  }
  probe.remove()
  const style = getComputedStyle(element)
  return {
    ...tokens,
    outline: style.outlineStyle,
    outlineColor: style.outlineColor,
    outlineWidth: style.outlineWidth,
    outlineOffset: style.outlineOffset,
    shadow: style.boxShadow,
    focusVisible: element.matches(':focus-visible'),
  }
}

async function seedHighlights(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const app = window as EidoDevWindow
    return Boolean(app.__eido?.getState().hydrated && app.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(({ customColor }) => {
    const app = window as unknown as EidoDevWindow & Required<Pick<EidoDevWindow, '__eido'>>
    app.__eido.setState({
      cards: [
        {
          id: 'highlight-note',
          kind: 'note',
          title: 'Pricing instinct',
          blocks: [{ id: 'highlight-note-block', text: 'prices under nine dollars chalk better' }],
          position: { x: 120, y: 100 },
        },
      ],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      highlights: [
        {
          id: 'highlight-custom',
          cardId: 'highlight-note',
          tagId: 'tag-custom',
          text: 'prices under nine dollars',
          occurrence: 0,
          createdAt: '2026-07-01T00:00:00.000Z',
        },
        {
          id: 'highlight-yellow',
          cardId: 'highlight-note',
          tagId: 'tag-yellow',
          text: 'chalk better',
          occurrence: 0,
          createdAt: '2026-07-01T00:00:01.000Z',
        },
      ],
      highlightTags: [
        {
          id: 'tag-custom',
          name: 'Custom evidence',
          color: customColor,
          createdAt: '2026-07-01T00:00:00.000Z',
        },
        {
          id: 'tag-yellow',
          name: 'Pricing',
          color: 'yellow',
          createdAt: '2026-07-01T00:00:01.000Z',
        },
        {
          id: 'tag-empty',
          name: 'No evidence',
          color: 'blue',
          createdAt: '2026-07-01T00:00:02.000Z',
        },
      ],
      activeHighlightTagId: 'tag-custom',
      highlightsPanelOpen: true,
      activeTool: 'highlight',
      visualDecayEnabled: false,
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
    })
    app.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
  }, { customColor: CUSTOM_COLOR })

  await expect(page.getByRole('complementary', { name: 'Highlights' })).toBeVisible()
}

test('highlight panel resolves custom colors through theme tokens and becomes a mobile sheet', async ({ page }) => {
  await seedHighlights(page)
  const panel = page.getByRole('complementary', { name: 'Highlights' })
  const customGroup = panel.locator('.highlights-group').filter({ hasText: 'Custom evidence' })
  const quote = customGroup.locator('.highlight-row-quote')

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((nextTheme) => {
      document.documentElement.dataset.theme = nextTheme
    }, theme)
    const paint = await quote.evaluate((element) => {
      const probe = document.createElement('span')
      probe.style.background = 'var(--e-hl-yellow)'
      probe.style.color = 'var(--e-ink)'
      document.body.append(probe)
      const expectedWash = getComputedStyle(probe).backgroundColor
      const expectedInk = getComputedStyle(probe).color
      probe.style.background = 'var(--e-surface-panel)'
      const expectedPanel = getComputedStyle(probe).backgroundColor
      probe.remove()
      return {
        wash: getComputedStyle(element).backgroundColor,
        expectedWash,
        ink: getComputedStyle(element).color,
        expectedInk,
        panel: getComputedStyle(element.closest('.highlights-panel')!).backgroundColor,
        expectedPanel,
      }
    })
    expect(paint.wash).toBe(paint.expectedWash)
    expect(paint.ink).toBe(paint.expectedInk)
    expect(paint.panel).toBe(paint.expectedPanel)
  }

  expect(await page.evaluate(() => {
    const app = window as unknown as EidoDevWindow & Required<Pick<EidoDevWindow, '__eido'>>
    return app.__eido.getState().highlightTags.find((tag) => tag.id === 'tag-custom')?.color
  })).toBe(CUSTOM_COLOR)

  await page.setViewportSize({ width: 640, height: 800 })
  const mobileBounds = await panel.boundingBox()
  expect(mobileBounds).not.toBeNull()
  expect(mobileBounds!.x).toBe(0)
  expect(mobileBounds!.width).toBe(640)
  expect(Math.round(mobileBounds!.y + mobileBounds!.height)).toBe(800)
  expect(mobileBounds!.height).toBeLessThanOrEqual(576)
})

test('highlight panel docks to the board with one desktop hairline and keeps its mobile sheet edge', async ({ page }) => {
  await seedHighlights(page)
  const panel = page.getByRole('complementary', { name: 'Highlights' })

  const desktop = await panel.evaluate((element) => {
    const board = element.closest('.board-wrap')
    if (!board) throw new Error('Highlights panel must be hosted by the board')
    const panelBounds = element.getBoundingClientRect()
    const boardBounds = board.getBoundingClientRect()
    const styles = getComputedStyle(element)
    return {
      panel: {
        top: Math.round(panelBounds.top),
        right: Math.round(panelBounds.right),
        bottom: Math.round(panelBounds.bottom),
      },
      board: {
        top: Math.round(boardBounds.top),
        right: Math.round(boardBounds.right),
        bottom: Math.round(boardBounds.bottom),
      },
      borders: {
        top: styles.borderTopWidth,
        right: styles.borderRightWidth,
        bottom: styles.borderBottomWidth,
        left: styles.borderLeftWidth,
      },
      radius: styles.borderRadius,
    }
  })
  expect(desktop.panel).toEqual(desktop.board)
  expect(desktop.borders).toEqual({ top: '0px', right: '0px', bottom: '0px', left: '1px' })
  expect(desktop.radius).toBe('0px')

  await page.setViewportSize({ width: 640, height: 800 })
  const mobile = await panel.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const styles = getComputedStyle(element)
    return {
      x: Math.round(bounds.x),
      right: Math.round(bounds.right),
      bottom: Math.round(bounds.bottom),
      height: Math.round(bounds.height),
      borders: {
        top: styles.borderTopWidth,
        right: styles.borderRightWidth,
        bottom: styles.borderBottomWidth,
        left: styles.borderLeftWidth,
      },
      radius: {
        topLeft: styles.borderTopLeftRadius,
        topRight: styles.borderTopRightRadius,
        bottomRight: styles.borderBottomRightRadius,
        bottomLeft: styles.borderBottomLeftRadius,
      },
    }
  })
  expect(mobile.x).toBe(0)
  expect(mobile.right).toBe(640)
  expect(mobile.bottom).toBe(800)
  expect(mobile.height).toBeLessThanOrEqual(576)
  expect(mobile.borders).toEqual({ top: '1px', right: '0px', bottom: '0px', left: '0px' })
  expect(mobile.radius.topLeft).not.toBe('0px')
  expect(mobile.radius.topRight).not.toBe('0px')
  expect(mobile.radius.bottomRight).toBe('0px')
  expect(mobile.radius.bottomLeft).toBe('0px')
})

test('highlight controls keep readable ink and one system focus boundary in both themes', async ({ page }) => {
  await seedHighlights(page)
  const panel = page.getByRole('complementary', { name: 'Highlights' })
  const emptyGuidance = panel
    .locator('.highlights-group')
    .filter({ hasText: 'No evidence' })
    .locator('.highlights-group-empty')
  const rowText = panel.locator('.highlight-row-text').first()

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((nextTheme) => {
      document.documentElement.dataset.theme = nextTheme
    }, theme)

    const emptyColors = await emptyGuidance.evaluate((element) => ({
      color: getComputedStyle(element).color,
      background: getComputedStyle(element.closest('.highlights-panel')!).backgroundColor,
    }))
    expect(
      contrastRatio(emptyColors.color, emptyColors.background),
      `${theme} empty-tag guidance contrast`,
    ).toBeGreaterThanOrEqual(4.5)

    await rowText.focus()
    await page.waitForTimeout(150)
    const rowFocus = await rowText.evaluate((element) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--e-go)'
      document.body.append(probe)
      const go = getComputedStyle(probe).color
      probe.remove()
      return {
        outline: getComputedStyle(element).outlineStyle,
        border: getComputedStyle(element.parentElement!).borderColor,
        go,
      }
    })
    expect(rowFocus).toEqual({ outline: 'none', border: rowFocus.go, go: rowFocus.go })
  }

  const trigger = page.getByRole('button', { name: 'Custom evidence', exact: true })
  await trigger.click()
  await page.getByRole('menuitem', { name: 'Tag options: Custom evidence' }).click()
  const name = page.getByRole('textbox', { name: 'Tag name' })
  await expect(name).toBeFocused()
  const count = page.locator('.tag-manage-count')
  const selected = page.getByRole('radio', { name: 'Yellow' })
  const blue = page.getByRole('radio', { name: 'Blue' })

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((nextTheme) => {
      document.documentElement.dataset.theme = nextTheme
    }, theme)
    await selected.click()

    const countColors = await count.evaluate((element) => ({
      color: getComputedStyle(element).color,
      background: getComputedStyle(element.closest('.e-popover')!).backgroundColor,
    }))
    expect(
      contrastRatio(countColors.color, countColors.background),
      `${theme} tag-deletion count contrast`,
    ).toBeGreaterThanOrEqual(4.5)

    await name.focus()
    await expect(selected).toHaveAttribute('aria-checked', 'true')
    const selectedState = await selected.evaluate(paletteBoundaryState)
    // Circular palette choices preserve their preview fill with one ink
    // selection outline (SYSTEM §6.2c and §7), including while focused.
    expect(selectedState).toMatchObject({
      outline: 'solid',
      outlineColor: selectedState.ink,
      outlineWidth: selectedState.selectionWidth,
      outlineOffset: '2px',
      shadow: 'none',
    })

    await selected.focus()
    // The shared palette has two rows in column-major order: Right moves
    // from Yellow to Blue; Green is below Yellow.
    await selected.press('ArrowRight')
    await expect(blue).toBeFocused()
    await expect(blue).toHaveAttribute('aria-checked', 'true')
    const focusState = await blue.evaluate(paletteBoundaryState)
    expect(focusState).toMatchObject({
      outline: 'solid',
      outlineColor: focusState.ink,
      outlineWidth: focusState.selectionWidth,
      outlineOffset: '2px',
      shadow: 'none',
      focusVisible: true,
    })
    await expect(blue).toHaveCSS('border-color', focusState.lineStrong)

    // An unchosen swatch keeps its own go-colored boundary for keyboard
    // focus, without adding the chosen swatch's outer selection outline.
    await selected.focus()
    await expect(selected).toHaveAttribute('aria-checked', 'false')
    const unchosenFocus = await selected.evaluate(paletteBoundaryState)
    expect(unchosenFocus).toMatchObject({ outline: 'none', shadow: 'none', focusVisible: true })
    await expect(selected).toHaveCSS('border-color', unchosenFocus.go)
  }
})

test('highlight menu owns arrows and one Escape, restores focus, and creates the least-used color', async ({ page }) => {
  await seedHighlights(page)
  const trigger = page.getByRole('button', { name: 'Custom evidence', exact: true })

  await trigger.click()
  const search = page.getByRole('textbox', { name: 'Search or create tags…' })
  await expect(search).toBeFocused()
  await search.fill('evidence')
  await search.press('Escape')
  await expect(page.getByRole('menu', { name: 'Highlight tags' })).toBeHidden()
  await expect(trigger).toBeFocused()
  expect(await page.evaluate(() => {
    const app = window as unknown as EidoDevWindow & Required<Pick<EidoDevWindow, '__eido'>>
    return app.__eido.getState().activeTool
  })).toBe('highlight')

  await trigger.click()
  await search.fill('Follow up')
  await page.getByRole('menuitem', { name: 'Create Follow up' }).click()
  await expect(page.getByRole('menu', { name: 'Highlight tags' })).toBeHidden()

  const result = await page.evaluate(() => {
    const app = window as unknown as EidoDevWindow & Required<Pick<EidoDevWindow, '__eido'>>
    const state = app.__eido.getState()
    return {
      created: state.highlightTags.find((tag) => tag.name === 'Follow up'),
      activeHighlightTagId: state.activeHighlightTagId,
      customColor: state.highlightTags.find((tag) => tag.id === 'tag-custom')?.color,
    }
  })
  expect(result.created).toMatchObject({ color: 'green' })
  expect(result.activeHighlightTagId).toBe(result.created?.id)
  expect(result.customColor).toBe(CUSTOM_COLOR)
})

test('tag delete confirmation exclusively owns Escape above the body popover', async ({ page }) => {
  await seedHighlights(page)
  const trigger = page.getByRole('button', { name: 'Custom evidence', exact: true })
  await trigger.click()

  const menu = page.getByRole('menu', { name: 'Highlight tags' })
  await menu.getByRole('menuitem', { name: 'Tag options: Custom evidence' }).click()
  const deleteAction = menu.getByRole('menuitem', { name: 'Delete tag 1' })
  await deleteAction.click()

  const dialog = page.getByRole('dialog', { name: 'Delete this tag?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()

  await page.keyboard.press('Escape')

  await expect(dialog).toHaveCount(0)
  await expect(menu).toBeVisible()
  await expect(deleteAction).toBeFocused()
  expect(await page.evaluate(() => {
    const app = window as unknown as EidoDevWindow & Required<Pick<EidoDevWindow, '__eido'>>
    return app.__eido.getState().highlightTags.map((tag) => tag.id)
  })).toContain('tag-custom')

  await page.keyboard.press('Escape')

  await expect(menu).toHaveCount(0)
  await expect(trigger).toBeFocused()
})
