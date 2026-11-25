import { expect, test, type Page } from '@playwright/test'

// The top bar is a hard barrier. A floating menu that cannot fit above its
// trigger must stop at the bar's bottom edge rather than paint across it, and
// the bar must rank above popover-level surfaces so nothing can bleed over it
// anyway. Both halves are shared rules, so one Card's colour palette proves
// them for every floating surface the app has.

type EidoDevStore = {
  getState: () => { hydrated: boolean }
  setState: (state: unknown) => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

type Box = { x: number; y: number; width: number; height: number }

function boxesOverlap(a: Box, b: Box) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

// A short window with one Card placed so that its colour palette fits neither
// below the trigger nor between the trigger and the bar. That is exactly the
// case the layer used to resolve by clamping to the top of the document, which
// put the menu across the bar.
async function seedCardUnderAShortWindow(page: Page) {
  await page.setViewportSize({ width: 1280, height: 240 })
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'palette-note',
          kind: 'note',
          blocks: [{ id: 'palette-note-block', text: 'colour me' }],
          position: { x: 0, y: 76 },
        },
      ],
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

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 200, y: 0, zoom: 1 })
  })
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length > 0)
  await page.waitForTimeout(500)
}

test('a floating menu stops at the top bar instead of painting across it', async ({ page }) => {
  await seedCardUnderAShortWindow(page)

  await page.locator('.react-flow__node[data-id="palette-note"] .kind-dot').click()
  const layer = page.locator('.e-popover').first()
  await expect(layer).toBeVisible()

  const [layerBox, topbarBox] = await Promise.all([
    layer.boundingBox(),
    page.locator('.topbar').boundingBox(),
  ])
  expect(layerBox).not.toBeNull()
  expect(topbarBox).not.toBeNull()
  expect(
    boxesOverlap(layerBox!, topbarBox!),
    `floating layer ${JSON.stringify(layerBox)} must stay clear of the top bar ${JSON.stringify(topbarBox)}`,
  ).toBe(false)
})

test('the top bar paints above popover-level surfaces', async ({ page }) => {
  await seedCardUnderAShortWindow(page)

  const ranks = await page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement)
    const read = (name: string) => Number.parseFloat(rootStyle.getPropertyValue(name))
    return {
      barrier: Number.parseFloat(getComputedStyle(document.querySelector('.topbar')!).zIndex),
      popover: read('--e-z-popover'),
      modal: read('--e-z-modal'),
      toast: read('--e-z-toast'),
    }
  })

  expect(ranks.barrier).toBeGreaterThan(ranks.popover)
  // Modals and toasts legitimately cover the whole window, the bar included.
  expect(ranks.barrier).toBeLessThan(ranks.modal)
  expect(ranks.barrier).toBeLessThan(ranks.toast)
})
