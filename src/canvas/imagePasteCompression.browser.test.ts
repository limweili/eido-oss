// Browser gate for #247: a large pasted image must arrive on the Board as a
// visible card asset whose stored payload is under the compression budget.
import { expect, test, type Page } from '@playwright/test'

type StoredAsset = {
  id: string
  kind: string
  mimeType: string
  dataUrl: string
  size: number
  width?: number
  height?: number
  originalSize?: number
  originalMimeType?: string
  compression?: string
}

// Intentional absolute anti-typo tripwire: raising the policy budget fails this
// browser gate loudly, while lowering it silently leaves this gate looser than
// the new policy; it keeps passing but no longer matches the app's actual bound.
const MAX_STORED_PAYLOAD_BYTES = 200 * 1024

const resetBoard = async (page: Page, cards: unknown[] = []) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: { getState: () => { hydrated: boolean } }
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })
  await page.evaluate((nextCards) => {
    const devWindow = window as unknown as {
      __eido: { setState: (state: unknown) => void }
      __EIDO_SET_VIEWPORT__: (viewport: { x: number; y: number; zoom: number }) => void
    }
    devWindow.__eido.setState({ cards: nextCards, connections: [], selectedCardIds: [], selection: null })
    devWindow.__EIDO_SET_VIEWPORT__({ x: 0, y: 0, zoom: 1 })
  }, cards)
}

// Draws seeded per-pixel noise so the PNG original is reliably multi-megabyte.
const makeLargeImageFile = `
  async (edge) => {
    const canvas = document.createElement('canvas')
    canvas.width = edge
    canvas.height = Math.round(edge * 0.7)
    const context = canvas.getContext('2d')
    const image = context.createImageData(canvas.width, canvas.height)
    let seed = 42
    const next = () => {
      // LCG low bits are periodic; use the high bits so the noise is real
      // and the PNG stays reliably multi-megabyte.
      seed = (seed * 1664525 + 1013904223) >>> 0
      return (seed >>> 16) & 255
    }
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = next()
      image.data[i + 1] = next()
      image.data[i + 2] = next()
      image.data[i + 3] = 255
    }
    context.putImageData(image, 0, 0)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    return new File([blob], 'big-reference.png', { type: 'image/png' })
  }
`

const firstStoredAsset = async (page: Page): Promise<StoredAsset & { cardId: string }> => {
  await page.waitForFunction(
    () => {
      const devWindow = window as unknown as {
        __eido: { getState: () => { cards: { assets?: unknown[] }[] } }
      }
      return devWindow.__eido.getState().cards.some((card) => (card.assets ?? []).length > 0)
    },
    undefined,
    { timeout: 20_000 },
  )
  return page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: { getState: () => { cards: { id: string; assets?: StoredAsset[] }[] } }
    }
    const card = devWindow.__eido.getState().cards.find((candidate) => (candidate.assets ?? []).length > 0)!
    return { ...card.assets![0], cardId: card.id }
  })
}

test('pasting a large image on the Board stores a visible compressed asset under budget', async ({ page }) => {
  await resetBoard(page)

  const originalBytes = await page.evaluate(`
    (async () => {
      const makeFile = ${makeLargeImageFile}
      const file = await makeFile(2600)
      const transfer = new DataTransfer()
      transfer.items.add(file)
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
      return file.size
    })()
  `) as number

  expect(originalBytes).toBeGreaterThan(1024 * 1024)

  const asset = await firstStoredAsset(page)
  expect(asset.kind).toBe('image')
  expect(asset.dataUrl.startsWith('data:image/')).toBe(true)
  expect(asset.dataUrl.length).toBeLessThanOrEqual(MAX_STORED_PAYLOAD_BYTES)
  expect(asset.size).toBeLessThan(originalBytes)
  expect(asset.originalSize).toBe(originalBytes)
  expect(asset.originalMimeType).toBe('image/png')
  expect(asset.compression).toBe('compressed')
  expect(asset.width ?? Infinity).toBeLessThanOrEqual(1280)

  await expect(page.locator('.card-attachment-open img').first()).toBeVisible()
})

test('pasting a large image into a Note card compresses it through the same pipeline', async ({ page }) => {
  await resetBoard(page, [
    {
      id: 'note-paste-target',
      kind: 'note',
      blocks: [{ id: 'note-paste-target-block', text: 'Paste target' }],
      position: { x: 120, y: 120 },
    },
  ])

  await expect(page.locator('.note-body').first()).toBeVisible()

  const originalBytes = await page.evaluate(`
    (async () => {
      const makeFile = ${makeLargeImageFile}
      const file = await makeFile(1800)
      const transfer = new DataTransfer()
      transfer.items.add(file)
      const body = document.querySelector('.note-body')
      body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
      return file.size
    })()
  `) as number

  const asset = await firstStoredAsset(page)
  expect(asset.cardId).toBe('note-paste-target')
  expect(asset.dataUrl.length).toBeLessThanOrEqual(MAX_STORED_PAYLOAD_BYTES)
  expect(asset.size).toBeLessThan(originalBytes)
  expect(asset.compression).toBe('compressed')

  await expect(page.locator('.card-attachment-open img').first()).toBeVisible()
})
