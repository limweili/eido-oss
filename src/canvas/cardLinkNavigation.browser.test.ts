import { expect, test, type Page } from '@playwright/test'

// A card link pasted into a note is real navigation: clicking it moves the
// viewport to the linked card's saved coordinates (same as opening the link
// URL), and the Back control returns to where the reader was.

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    currentIdeaId: string | null
    cards: Array<{ id: string; position: { x: number; y: number } }>
  }
  setState: (state: unknown) => void
}

const LINK_VIEWPORT = { x: -3900, y: -2900, zoom: 1 }
const ORIGIN_VIEWPORT = { x: 40, y: 40, zoom: 1 }

async function readViewport(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector('.react-flow__viewport')
    if (!(element instanceof HTMLElement)) return null
    const transform = getComputedStyle(element).transform
    if (!transform || transform === 'none') return { x: 0, y: 0, zoom: 1 }
    const matrix = new DOMMatrixReadOnly(transform)
    return { x: matrix.e, y: matrix.f, zoom: matrix.a }
  })
}

async function expectViewport(page: Page, expected: { x: number; y: number; zoom: number }) {
  await expect
    .poll(async () => {
      const viewport = await readViewport(page)
      if (!viewport) return 'missing'
      const close = (a: number, b: number) => Math.abs(a - b) < 1
      return close(viewport.x, expected.x) && close(viewport.y, expected.y) && close(viewport.zoom, expected.zoom)
        ? 'there'
        : JSON.stringify(viewport)
    })
    .toBe('there')
}

test('a card link inside a note navigates to the card and Back returns', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(
    ({ linkViewport }) => {
      const devWindow = window as unknown as {
        __eido: EidoDevStore
      }
      const ideaId = devWindow.__eido.getState().currentIdeaId
      const href = `${window.location.origin}/?idea=${ideaId}&card=far-note&x=${linkViewport.x}&y=${linkViewport.y}&zoom=${linkViewport.zoom}`
      devWindow.__eido.setState({
        cards: [
          {
            id: 'link-note',
            kind: 'note',
            blocks: [{ id: 'link-note-block', text: `Jump here: ${href}` }],
            position: { x: 120, y: 120 },
            size: { width: 460, height: 220 },
            zIndex: 2,
          },
          {
            id: 'far-note',
            kind: 'note',
            blocks: [{ id: 'far-note-block', text: 'you made it' }],
            position: { x: 4200, y: 3100 },
            size: { width: 260, height: 160 },
            zIndex: 1,
          },
        ],
      })
    },
    { linkViewport: LINK_VIEWPORT },
  )

  const backControl = page.locator('.viewport-back-control')
  await expect(backControl).toBeHidden()

  // Below Reading the note is painted, not mounted (ADR 0020), so pin a
  // Reading viewport before following the in-note link.
  await page.evaluate((viewport) => {
    const devWindow = window as unknown as {
      __EIDO_SET_VIEWPORT__?: (next: { x: number; y: number; zoom: number }) => void
    }
    devWindow.__EIDO_SET_VIEWPORT__?.(viewport)
  }, ORIGIN_VIEWPORT)
  await expectViewport(page, ORIGIN_VIEWPORT)

  // The pasted URL renders as a clickable link inside the note body.
  const cardLink = page.locator('.react-flow__node-note a[href*="card=far-note"]')
  await cardLink.click()

  await expect(page).toHaveURL(/card=far-note/)
  await expectViewport(page, LINK_VIEWPORT)
  await expect(backControl).toBeVisible()
  await expect(backControl).toHaveClass(/\be-button\b/)
  await expect(backControl).toHaveClass(/\be-button--quiet\b/)

  // The note the link points at is now selected and on screen.
  const target = page.locator('.react-flow__node-note', { hasText: 'you made it' })
  await expect(target).toBeVisible()
  await expect(target).toHaveClass(/\bcard-link-target\b/)
  const targetChrome = await target.evaluate((node) => {
    const ring = getComputedStyle(node, '::after')
    const card = node.querySelector<HTMLElement>('.card')
    if (!card) throw new Error('target card missing')
    return {
      ringContent: ring.content,
      ringPosition: ring.position,
      ringBorderStyle: ring.borderStyle,
      ringAnimationName: ring.animationName,
      ringAnimationDuration: ring.animationDuration,
      ringTransform: ring.transform,
      cardShadow: getComputedStyle(card).boxShadow,
    }
  })
  expect(targetChrome).toMatchObject({
    ringPosition: 'absolute',
    ringBorderStyle: 'solid',
    ringAnimationName: 'card-link-ring',
    ringAnimationDuration: '1.65s',
    ringTransform: 'none',
    cardShadow: 'none',
  })
  expect(targetChrome.ringContent).not.toBe('none')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(() => document.documentElement.dataset.reducedMotion === 'true')
  expect(await target.evaluate((node) => getComputedStyle(node, '::after').animationDuration)).toBe('0.08s')

  await backControl.click()
  await expect(page).not.toHaveURL(/card=/)
  await expectViewport(page, ORIGIN_VIEWPORT)
})

test('a missing card link speaks through the shared failure toast', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as { __eido?: EidoDevStore }
    return Boolean(devWindow.__eido?.getState().hydrated)
  })
  const ideaId = await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    return devWindow.__eido.getState().currentIdeaId
  })
  if (!ideaId) throw new Error('current Idea missing')

  await page.goto(`/?idea=${encodeURIComponent(ideaId)}&card=missing-card`)
  const toast = page.getByRole('status').filter({ hasText: "That card isn't in this Idea anymore." })
  await expect(toast).toBeVisible()
  await expect(toast).toHaveClass(/\be-toast\b/)
  await expect(toast).toHaveClass(/\bdeep-link-toast\b/)
  await expect(toast.locator('.e-toast__dot--avoid')).toHaveCount(1)

  const chrome = await toast.evaluate((element) => {
    const styles = getComputedStyle(element)
    return {
      position: styles.position,
      zIndex: styles.zIndex,
      shadow: styles.boxShadow,
    }
  })
  expect(chrome.position).toBe('absolute')
  expect(chrome.zIndex).toBe('90')
  expect(chrome.shadow).not.toBe('none')

  await expect(toast).toBeHidden({ timeout: 5_000 })
})
