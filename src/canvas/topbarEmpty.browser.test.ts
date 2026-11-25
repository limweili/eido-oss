import { expect, test, type Page, type TestInfo } from '@playwright/test'

type SaveState = 'saving' | 'saved' | 'failed'
type StorageStatus =
  | { backend: 'disk'; dataFile: string }
  | { backend: 'browser'; warning: string }
  | null

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    cards: Array<{ kind: string; position: { x: number; y: number } }>
  }
  setState: (state: unknown) => void
}

type DevWindow = Window & { __eido?: EidoDevStore }

const DISK_FILE = '/tmp/eido-499-visual-proof.json'
const BROWSER_WARNING = 'Browser-only visual proof warning.'

const saveSpecimens: Array<{
  slug: string
  saveState: SaveState
  storageStatus: StorageStatus
  label: string
  title: string | null
  classes: string[]
}> = [
  {
    slug: 'saving-disk',
    saveState: 'saving',
    storageStatus: { backend: 'disk', dataFile: DISK_FILE },
    label: 'Saving',
    title: DISK_FILE,
    classes: [],
  },
  {
    slug: 'saved-disk',
    saveState: 'saved',
    storageStatus: { backend: 'disk', dataFile: DISK_FILE },
    label: 'Saved',
    title: DISK_FILE,
    classes: [],
  },
  {
    slug: 'saved-browser',
    saveState: 'saved',
    storageStatus: { backend: 'browser', warning: BROWSER_WARNING },
    label: 'Saved in browser',
    title: BROWSER_WARNING,
    classes: ['browser'],
  },
  {
    slug: 'failed-disk',
    saveState: 'failed',
    storageStatus: { backend: 'disk', dataFile: DISK_FILE },
    label: "Couldn't save",
    title: DISK_FILE,
    classes: ['failed'],
  },
  {
    slug: 'failed-browser',
    saveState: 'failed',
    storageStatus: { backend: 'browser', warning: BROWSER_WARNING },
    label: "Couldn't save",
    title: BROWSER_WARNING,
    classes: ['failed', 'browser'],
  },
  {
    slug: 'saved-default',
    saveState: 'saved',
    storageStatus: null,
    label: 'Saved',
    title: null,
    classes: [],
  },
]

const viewports = [
  { slug: 'desktop', width: 1280, height: 800 },
  { slug: '720', width: 720, height: 800 },
  { slug: '560', width: 560, height: 760 },
] as const

async function waitForApp(page: Page) {
  await page.waitForFunction(() => Boolean((window as DevWindow).__eido?.getState().hydrated))
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.waitForTimeout(350)
  await testInfo.attach(`${name}.png`, {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
}

async function seedTopbar(page: Page, saveState: SaveState, storageStatus: StorageStatus) {
  await page.evaluate(({ nextSaveState, nextStorageStatus }) => {
    const store = (window as DevWindow).__eido
    if (!store) throw new Error('Missing Eido development store')
    store.setState({
      cards: [{
        id: 'topbar-proof-note',
        kind: 'note',
        blocks: [{ id: 'topbar-proof-block', text: 'Rendered top-bar proof' }],
        position: { x: 80, y: 80 },
      }],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      ideas: [{
        id: 'topbar-proof-idea',
        name: 'Bakery — winter opening',
        createdAt: '2026-07-17T00:00:00.000Z',
        updatedAt: '2026-07-17T00:00:00.000Z',
        lastOpenedAt: '2026-07-17T00:00:00.000Z',
      }],
      currentIdeaId: 'topbar-proof-idea',
      saveState: nextSaveState,
      storageStatus: nextStorageStatus,
      highlights: Array.from({ length: 4 }, (_, index) => ({
        id: `topbar-proof-highlight-${index}`,
        cardId: 'topbar-proof-note',
        tagId: 'topbar-proof-tag',
        text: 'proof',
        occurrence: index,
        createdAt: '2026-07-17T00:00:00.000Z',
      })),
      highlightsPanelOpen: false,
      keyPromptOpen: false,
      ideaManagerOpen: false,
    })
  }, { nextSaveState: saveState, nextStorageStatus: storageStatus })
  await expect(page.locator('.react-flow__node[data-id="topbar-proof-note"]')).toBeVisible()
}

async function assertTopbarGeometry(page: Page) {
  const geometry = await page.evaluate(() => {
    const topbar = document.querySelector<HTMLElement>('.topbar')
    const brand = document.querySelector<HTMLElement>('.topbar .brand')
    const idea = document.querySelector<HTMLElement>('.idea-pill')
    const ideaLabel = idea?.querySelector<HTMLElement>('span')
    const save = document.querySelector<HTMLElement>('.save-state')
    const actions = document.querySelector<HTMLElement>('.topbar-actions')
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('.topbar-actions button'))
    if (!topbar || !brand || !idea || !ideaLabel || !save || !actions || buttons.length !== 4) {
      throw new Error('Missing top-bar proof elements')
    }
    const rect = (element: HTMLElement) => {
      const box = element.getBoundingClientRect()
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }
    }
    const resolveColor = (token: string, property: 'backgroundColor' | 'borderBottomColor') => {
      const probe = document.createElement('span')
      probe.style[property] = `var(${token})`
      document.body.append(probe)
      const value = getComputedStyle(probe)[property]
      probe.remove()
      return value
    }
    const styles = getComputedStyle(topbar)
    return {
      topbar: rect(topbar),
      brand: rect(brand),
      idea: rect(idea),
      ideaLabel: {
        ...rect(ideaLabel),
        clientWidth: ideaLabel.clientWidth,
        scrollWidth: ideaLabel.scrollWidth,
        overflow: getComputedStyle(ideaLabel).overflow,
        textOverflow: getComputedStyle(ideaLabel).textOverflow,
        whiteSpace: getComputedStyle(ideaLabel).whiteSpace,
      },
      save: rect(save),
      actions: rect(actions),
      buttons: buttons.map(rect),
      ideaType: {
        fontSize: getComputedStyle(idea).fontSize,
        fontWeight: getComputedStyle(idea).fontWeight,
        letterSpacing: getComputedStyle(idea).letterSpacing,
        lineHeight: getComputedStyle(idea).lineHeight,
        textTransform: getComputedStyle(idea).textTransform,
      },
      actionTypes: buttons.map(button => ({
        fontSize: getComputedStyle(button).fontSize,
        fontWeight: getComputedStyle(button).fontWeight,
        letterSpacing: getComputedStyle(button).letterSpacing,
        lineHeight: getComputedStyle(button).lineHeight,
        textTransform: getComputedStyle(button).textTransform,
      })),
      background: styles.backgroundColor,
      expectedBackground: resolveColor('--e-surface-panel', 'backgroundColor'),
      borderColor: styles.borderBottomColor,
      expectedBorderColor: resolveColor('--e-line', 'borderBottomColor'),
      borderWidth: styles.borderBottomWidth,
      boxShadow: styles.boxShadow,
      brandWeight: getComputedStyle(brand).fontWeight,
      clientWidth: topbar.clientWidth,
      scrollWidth: topbar.scrollWidth,
      viewportWidth: window.innerWidth,
    }
  })

  expect(geometry.topbar.height).toBe(44)
  expect(geometry.background).toBe(geometry.expectedBackground)
  expect(geometry.borderColor).toBe(geometry.expectedBorderColor)
  expect(geometry.borderWidth).toBe('1px')
  expect(geometry.boxShadow).toBe('none')
  expect(Number(geometry.brandWeight)).toBe(700)
  expect(geometry.ideaType).toEqual({
    fontSize: '13px',
    fontWeight: '400',
    letterSpacing: 'normal',
    lineHeight: '18.2px',
    textTransform: 'none',
  })
  for (const actionType of geometry.actionTypes) {
    expect(actionType).toEqual({
      fontSize: '12px',
      fontWeight: '500',
      letterSpacing: '0.72px',
      lineHeight: '14.4px',
      textTransform: 'uppercase',
    })
  }
  expect(geometry.brand.width).toBeGreaterThan(20)
  expect(geometry.brand.height).toBeGreaterThan(10)
  expect(geometry.idea.width).toBeGreaterThan(geometry.viewportWidth === 560 ? 30 : 44)
  expect(geometry.ideaLabel.left).toBeGreaterThanOrEqual(geometry.idea.left)
  expect(geometry.ideaLabel.right).toBeLessThanOrEqual(geometry.idea.right)
  expect(geometry.ideaLabel.overflow).toBe('hidden')
  expect(geometry.ideaLabel.textOverflow).toBe('ellipsis')
  expect(geometry.ideaLabel.whiteSpace).toBe('nowrap')
  if (geometry.viewportWidth === 560) {
    expect(geometry.ideaLabel.scrollWidth).toBeGreaterThan(geometry.ideaLabel.clientWidth)
  }
  expect(geometry.idea.right).toBeLessThanOrEqual(geometry.save.left)
  expect(geometry.save.right).toBeLessThanOrEqual(geometry.actions.left)
  expect(geometry.actions.right).toBeLessThanOrEqual(geometry.topbar.right)
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth)
  expect(geometry.topbar.right).toBeLessThanOrEqual(geometry.viewportWidth)

  for (const box of [geometry.brand, geometry.idea, geometry.save, geometry.actions, ...geometry.buttons]) {
    expect(box.top).toBeGreaterThanOrEqual(geometry.topbar.top)
    expect(box.bottom).toBeLessThanOrEqual(geometry.topbar.bottom)
  }
  for (let index = 1; index < geometry.buttons.length; index += 1) {
    expect(geometry.buttons[index - 1].right).toBeLessThanOrEqual(geometry.buttons[index].left)
  }
}

async function assertEmptyState(page: Page) {
  const region = page.getByRole('region', { name: 'Start with a note.' })
  await expect(region).toBeVisible()
  await expect(region.getByRole('heading', { name: 'Start with a note.' })).toBeVisible()
  await expect(region.getByText('Write a thought, connect a few, then ask AI to do something with them.')).toBeVisible()
  await expect(region.getByRole('button')).toHaveCount(1)
  await expect(region.getByRole('button', { name: 'Add note' })).toBeVisible()

  const ghost = region.locator('.empty-ghost')
  await expect(ghost).toHaveAttribute('aria-hidden', 'true')
  await expect(ghost).toHaveAttribute('focusable', 'false')
  await expect(ghost.locator('.empty-ghost__card')).toHaveCount(2)
  await expect(ghost.locator('.empty-ghost__wire')).toHaveCount(1)
  await expect(ghost.locator('.empty-ghost__asterisk')).toHaveCount(1)

  const decoration = await ghost.evaluate((svg) => {
    const cards = Array.from(svg.querySelectorAll<SVGRectElement>('.empty-ghost__card'))
    const wire = svg.querySelector<SVGPathElement>('.empty-ghost__wire')
    const asterisk = svg.querySelector<SVGSVGElement>('svg.empty-ghost__asterisk')
    const asteriskPath = asterisk?.querySelector<SVGPathElement>('path')
    if (!wire || !asterisk || !asteriskPath) throw new Error('Missing ghost-graph marks')
    const styles = getComputedStyle(svg)
    const wireStyles = getComputedStyle(wire)
    const rootStyles = getComputedStyle(document.documentElement)
    const colorProbe = document.createElement('span')
    colorProbe.style.color = rootStyles.getPropertyValue('--e-go')
    document.body.append(colorProbe)
    const go = getComputedStyle(colorProbe).color
    colorProbe.remove()
    const box = svg.getBoundingClientRect()
    const firstCardBox = cards[0].getBoundingClientRect()
    const asteriskPathBox = asteriskPath.getBoundingClientRect()
    const asteriskTransform = asterisk.getScreenCTM()
    if (!asteriskTransform) throw new Error('Missing ghost-asterisk screen transform')
    const viewBox = asterisk.viewBox.baseVal
    const topLeft = new DOMPoint(viewBox.x, viewBox.y).matrixTransform(asteriskTransform)
    const bottomRight = new DOMPoint(
      viewBox.x + viewBox.width,
      viewBox.y + viewBox.height,
    ).matrixTransform(asteriskTransform)
    const asteriskWidth = Math.abs(bottomRight.x - topLeft.x)
    const asteriskHeight = Math.abs(bottomRight.y - topLeft.y)
    return {
      width: box.width,
      height: box.height,
      pointerEvents: styles.pointerEvents,
      tabIndex: (svg as SVGElement).tabIndex,
      cards: cards.map(card => ({
        width: card.getAttribute('width'),
        height: card.getAttribute('height'),
        dash: getComputedStyle(card).strokeDasharray,
      })),
      wireStroke: wireStyles.stroke,
      go,
      wireDash: wireStyles.strokeDasharray,
      wireCap: wireStyles.strokeLinecap,
      asterisk: {
        width: asteriskWidth,
        height: asteriskHeight,
        centerX: Math.min(topLeft.x, bottomRight.x) + asteriskWidth / 2,
        centerY: Math.min(topLeft.y, bottomRight.y) + asteriskHeight / 2,
        cardCenterX: firstCardBox.left + firstCardBox.width / 2,
        cardCenterY: firstCardBox.top + firstCardBox.height / 2,
        pathWidth: asteriskPathBox.width,
        pathHeight: asteriskPathBox.height,
        pathCenterX: asteriskPathBox.left + asteriskPathBox.width / 2,
        pathCenterY: asteriskPathBox.top + asteriskPathBox.height / 2,
        opacity: Number(getComputedStyle(asterisk).opacity),
      },
    }
  })
  expect(decoration.width).toBe(236)
  expect(decoration.height).toBe(96)
  expect(decoration.pointerEvents).toBe('none')
  expect(decoration.tabIndex).toBe(-1)
  expect(decoration.cards).toEqual([
    { width: '102', height: '58', dash: '6px, 5px' },
    { width: '102', height: '58', dash: '6px, 5px' },
  ])
  expect(decoration.wireStroke).toBe(decoration.go)
  expect(decoration.wireDash).not.toBe('none')
  expect(decoration.wireCap).toBe('round')
  expect(decoration.asterisk).toMatchObject({ width: 16, height: 16 })
  expect(decoration.asterisk.centerX).toBeCloseTo(decoration.asterisk.cardCenterX, 4)
  expect(decoration.asterisk.centerY).toBeCloseTo(decoration.asterisk.cardCenterY, 4)
  expect(decoration.asterisk.pathWidth).toBeGreaterThan(0)
  expect(decoration.asterisk.pathWidth).toBeLessThan(decoration.asterisk.width)
  expect(decoration.asterisk.pathHeight).toBeGreaterThan(0)
  expect(decoration.asterisk.pathHeight).toBeLessThan(decoration.asterisk.height)
  expect(decoration.asterisk.pathCenterX).toBeCloseTo(decoration.asterisk.centerX, 4)
  expect(decoration.asterisk.pathCenterY).toBeCloseTo(decoration.asterisk.centerY, 4)
  expect(decoration.asterisk.opacity).toBeLessThan(1)
}

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of viewports) {
    test(`${theme} top bar and empty journey at ${viewport.slug}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.addInitScript((nextTheme) => {
        localStorage.setItem('eido-v3-settings', JSON.stringify({ theme: nextTheme }))
      }, theme)
      await page.goto('/')
      await waitForApp(page)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

      for (const specimen of saveSpecimens) {
        await seedTopbar(page, specimen.saveState, specimen.storageStatus)
        const status = page.getByRole('status')
        await expect(status).toHaveText(specimen.label)
        if (specimen.title === null) await expect(status).not.toHaveAttribute('title')
        else await expect(status).toHaveAttribute('title', specimen.title)
        for (const className of specimen.classes) await expect(status).toHaveClass(new RegExp(`(^|\\s)${className}(\\s|$)`))
        const saveTone = await status.evaluate((element) => {
          const resolveColor = (token: string) => {
            const probe = document.createElement('span')
            probe.style.color = `var(${token})`
            document.body.append(probe)
            const color = getComputedStyle(probe).color
            probe.remove()
            return color
          }
          return {
            actual: getComputedStyle(element).color,
            inkSoft: resolveColor('--e-ink-soft'),
            avoid: resolveColor('--e-avoid-ink'),
          }
        })
        expect(saveTone.actual).toBe(specimen.saveState === 'failed' ? saveTone.avoid : saveTone.inkSoft)
        await expect(page.getByRole('group', { name: 'Top bar actions' }).getByRole('button')).toHaveCount(4)
        await assertTopbarGeometry(page)

        if (specimen.saveState === 'saving') {
          const pulse = status.locator('.save-state__pulse')
          await expect(pulse).toBeVisible()
          const pulseGrammar = await pulse.evaluate((element) => {
            const styles = getComputedStyle(element)
            return {
              width: Number.parseFloat(styles.width),
              height: Number.parseFloat(styles.height),
              animationName: styles.animationName,
            }
          })
          expect(pulseGrammar).toMatchObject({ width: 7, height: 7 })
          expect(pulseGrammar.animationName).not.toBe('none')
        } else {
          await expect(status.locator('.save-state__pulse')).toHaveCount(0)
        }

        await attachScreenshot(page, testInfo, `${theme}-${viewport.slug}-${specimen.slug}`)
      }

      await page.evaluate((dataFile) => {
        const store = (window as DevWindow).__eido
        if (!store) throw new Error('Missing Eido development store')
        store.setState({ cards: [], connections: [], saveState: 'saved', storageStatus: { backend: 'disk', dataFile } })
      }, DISK_FILE)
      await assertTopbarGeometry(page)
      await assertEmptyState(page)
      await attachScreenshot(page, testInfo, `${theme}-${viewport.slug}-empty-before`)

      const addNote = page.getByRole('region', { name: 'Start with a note.' }).getByRole('button', { name: 'Add note' })
      await addNote.focus()
      await expect(addNote).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('region', { name: 'Start with a note.' })).toHaveCount(0)
      const cards = await page.evaluate(() => (window as DevWindow).__eido?.getState().cards ?? [])
      expect(cards).toHaveLength(1)
      expect(cards[0]).toMatchObject({ kind: 'note', position: { x: 0, y: 0 } })
      await attachScreenshot(page, testInfo, `${theme}-${viewport.slug}-empty-after`)
    })
  }
}
