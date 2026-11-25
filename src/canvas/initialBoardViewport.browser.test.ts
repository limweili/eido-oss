import { expect, test, type Page } from '@playwright/test'

type Viewport = { x: number; y: number; zoom: number }

type EidoDevStore = {
  getState: () => { hydrated: boolean }
  setState: (state: unknown) => void
}

async function readViewport(page: Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('.react-flow__viewport')
    const pane = document.querySelector('.react-flow__pane')
    if (!(viewport instanceof HTMLElement) || !(pane instanceof HTMLElement)) return null
    const transform = getComputedStyle(viewport).transform
    if (!transform || transform === 'none') return null
    const matrix = new DOMMatrixReadOnly(transform)
    const rect = pane.getBoundingClientRect()
    return { x: matrix.e, y: matrix.f, zoom: matrix.a, paneWidth: rect.width, paneHeight: rect.height }
  })
}

test('a loaded board is framed from all saved-card bounds', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as { __eido?: EidoDevStore; __EIDO_SET_VIEWPORT__?: (viewport: Viewport) => void }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })
  await page.waitForTimeout(300)

  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore; __EIDO_SET_VIEWPORT__: (viewport: Viewport) => void }
    devWindow.__eido.setState({
      currentIdeaId: 'loaded-board',
      cards: [
        {
          id: 'loaded-left', kind: 'note', blocks: [{ id: 'loaded-left-block', text: 'Left edge' }],
          position: { x: 8_000, y: 6_000 }, size: { width: 300, height: 200 },
        },
        {
          id: 'loaded-right', kind: 'note', blocks: [{ id: 'loaded-right-block', text: 'Right edge' }],
          position: { x: 10_000, y: 7_000 }, size: { width: 400, height: 300 },
        },
      ],
      connections: [],
    })
    // A board load must not retain the previous, blank camera position.
    devWindow.__EIDO_SET_VIEWPORT__({ x: 0, y: 0, zoom: 1 })
  })

  await expect.poll(async () => {
    const viewport = await readViewport(page)
    if (!viewport) return 'missing viewport'
    const boardCenter = { x: (8_000 + 10_400) / 2, y: (6_000 + 7_300) / 2 }
    const screenCenter = {
      x: viewport.x + boardCenter.x * viewport.zoom,
      y: viewport.y + boardCenter.y * viewport.zoom,
    }
    return Math.abs(screenCenter.x - viewport.paneWidth / 2) < 12 && Math.abs(screenCenter.y - viewport.paneHeight / 2) < 12
      ? 'centered'
      : JSON.stringify({ viewport, screenCenter })
  }).toBe('centered')
})

test('an exact dev viewport request lands while the initial fit is pending', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as { __eido?: EidoDevStore; __EIDO_SET_VIEWPORT__?: (viewport: Viewport) => void }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  const target = { x: 340, y: 180, zoom: 0.12 }
  await page.evaluate((requestedViewport) => {
    const devWindow = window as unknown as { __eido: EidoDevStore; __EIDO_SET_VIEWPORT__: (viewport: Viewport) => void }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'camera-left', kind: 'note', blocks: [{ id: 'camera-left-block', text: 'Left edge' }],
          position: { x: 0, y: 0 }, size: { width: 300, height: 200 },
        },
        {
          id: 'camera-right', kind: 'note', blocks: [{ id: 'camera-right-block', text: 'Right edge' }],
          position: { x: 2_400, y: 1_000 }, size: { width: 400, height: 300 },
        },
      ],
      connections: [],
    })
    devWindow.__EIDO_SET_VIEWPORT__(requestedViewport)
  }, target)

  // Outlast the queued initial fit and zero-duration camera work. The dev seam
  // is exact: a pending fit must not replace or clamp this explicit request.
  await page.waitForTimeout(900)
  const viewport = await readViewport(page)
  expect(viewport).not.toBeNull()
  expect(viewport?.x).toBeCloseTo(target.x, 5)
  expect(viewport?.y).toBeCloseTo(target.y, 5)
  expect(viewport?.zoom).toBeCloseTo(target.zoom, 5)
})
