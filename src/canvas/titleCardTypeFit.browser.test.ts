import { expect, test, type Page } from '@playwright/test'

// A Title card is a canvas landmark: the box the founder draws is the type
// size. These proofs run against the real editor because the answer comes from
// browser text layout, which no unit environment can report.
const CARD_ID = 'title-fit-card'
const CARD_POSITION = { x: 300, y: 250 }
const EDITOR = 'textarea.title-card-input'

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    cards: Array<{ id: string; size?: { width: number; height: number } }>
    setCardSize: (cardId: string, size: { width: number; height: number }) => void
  }
  setState: (state: unknown) => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

async function seedTitleCard(
  page: Page,
  input: { text: string; size: { width: number; height: number } },
) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })
  await page.evaluate(
    ({ cardId, position, text, size }) => {
      const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
      devWindow.__eido.setState({
        cards: [
          {
            id: cardId,
            kind: 'title',
            blocks: [{ id: `${cardId}-block`, text }],
            position,
            size,
            zIndex: 1,
          },
        ],
        connections: [],
        outputs: [],
        runs: [],
        intentLog: [],
        selection: null,
        selectedCardIds: [],
        undoStack: [],
        redoStack: [],
        activeTool: 'select',
      })
    },
    { cardId: CARD_ID, position: CARD_POSITION, text: input.text, size: input.size },
  )
  await page.evaluate((viewport) => {
    ;(window as unknown as DevWindow).__EIDO_SET_VIEWPORT__?.(viewport)
  }, { x: 0, y: 0, zoom: 1 })
  await expect(page.locator(EDITOR)).toBeVisible()
}

async function fittedFontSize(page: Page): Promise<number> {
  return page.evaluate((selector) => {
    const editor = document.querySelector<HTMLTextAreaElement>(selector)
    return editor ? Number.parseFloat(getComputedStyle(editor).fontSize) : 0
  }, EDITOR)
}

async function cardSize(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate((cardId) => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    const size = devWindow.__eido.getState().cards.find((card) => card.id === cardId)?.size
    return { width: size?.width ?? 0, height: size?.height ?? 0 }
  }, CARD_ID)
}

async function editorOverflow(page: Page): Promise<{ height: number; width: number }> {
  return page.evaluate((selector) => {
    const editor = document.querySelector<HTMLTextAreaElement>(selector)!
    return {
      height: editor.scrollHeight - editor.clientHeight,
      width: editor.scrollWidth - editor.clientWidth,
    }
  }, EDITOR)
}

// What the canvas half of the same card would choose for the same box. The
// painter is the other reader of this rule, so it is the only honest answer to
// compare the editor's fit against.
async function paintedFontSize(
  page: Page,
  text: string,
  width: number,
  height: number,
): Promise<number | undefined> {
  return page.evaluate(async (input) => {
    // A dev-server URL import: the proof runs against the same module the
    // canvas painter uses, not a copy of its rule.
    const specifier = '/src/canvas/titleCardCanvasText.ts'
    const module = await import(/* @vite-ignore */ specifier) as
      typeof import('./titleCardCanvasText')
    const context = document.createElement('canvas').getContext('2d')!
    return module.titleCardTextLayout({
      text: input.text,
      boardWidth: input.width,
      boardHeight: input.height,
      measure: (value: string, fontSize: number) => {
        context.font = module.titleCardCanvasFont(fontSize)
        return context.measureText(value).width
      },
    })?.fontSize
  }, { text, width, height })
}

test.describe('Title card type fits the drawn box', () => {
  test('sizes the same label to the card it was drawn at', async ({ page }) => {
    await seedTitleCard(page, { text: 'Quarterly planning', size: { width: 200, height: 64 } })
    const small = await fittedFontSize(page)
    expect(await editorOverflow(page)).toEqual({ height: 0, width: 0 })

    await seedTitleCard(page, { text: 'Quarterly planning', size: { width: 900, height: 300 } })
    const large = await fittedFontSize(page)
    expect(await editorOverflow(page)).toEqual({ height: 0, width: 0 })

    expect(small).toBeGreaterThan(0)
    expect(large).toBeGreaterThan(small * 2)
  })

  test('follows a live resize drag in both directions', async ({ page }) => {
    await seedTitleCard(page, { text: 'Drag me bigger', size: { width: 320, height: 90 } })
    const node = page.locator(`.react-flow__node[data-id="${CARD_ID}"]`)
    await node.click({ position: { x: 40, y: 20 } })
    await expect(page.locator('.title-card-resize-handle').first()).toBeVisible()
    const resting = await fittedFontSize(page)

    // React Flow can swallow the first drag while it re-measures a freshly
    // seeded node, so the gesture is proven by the box it actually produced.
    const dragCornerTo = async (target: { width: number; height: number }) => {
      await expect(async () => {
        // A retry only helps from a selected card: without handles the same
        // press starts a marquee instead of a resize.
        if (!(await page.locator('.title-card-resize-handle').first().isVisible())) {
          await node.click({ position: { x: 40, y: 20 } })
        }
        const box = (await node.boundingBox())!
        await page.mouse.move(box.x + box.width, box.y + box.height)
        await page.mouse.down()
        await page.mouse.move(
          box.x + target.width,
          box.y + target.height,
          { steps: 8 },
        )
        await page.mouse.up()
        expect(await cardSize(page)).toEqual(target)
      }).toPass()
    }

    await dragCornerTo({ width: 720, height: 250 })
    const grown = await fittedFontSize(page)
    expect(grown).toBeGreaterThan(resting)
    expect((await editorOverflow(page)).height).toBe(0)

    await dragCornerTo({ width: 200, height: 60 })
    const shrunk = await fittedFontSize(page)
    expect(shrunk).toBeLessThan(resting)
    expect((await editorOverflow(page)).height).toBe(0)
  })

  test('keeps a growing label inside a fixed box while it is typed', async ({ page }) => {
    await seedTitleCard(page, { text: 'Roadmap', size: { width: 320, height: 90 } })
    const editor = page.locator(EDITOR)
    await editor.click()
    const beforeTyping = await fittedFontSize(page)

    await page.keyboard.press('End')
    await page.keyboard.type(' for the whole of next year and the one after that')

    expect(await fittedFontSize(page)).toBeLessThan(beforeTyping)
    expect((await editorOverflow(page)).height).toBe(0)
    // The fit must never cost the founder their place in the text.
    await expect(editor).toBeFocused()
    expect(await editor.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(
      await editor.evaluate((el: HTMLTextAreaElement) => el.value.length),
    )
  })
  // The founder's own Title card, at the box that exposed the split. A line a
  // fraction of a pixel too wide read as "fits" to the DOM's integer
  // `scrollWidth` and "too wide" to the painter's fractional measurement, so
  // the two halves of the same card chose different sizes: the painter wrapped
  // "Untitled label" at the space, while the DOM broke "Untitled" in half. The
  // two must agree at every board zoom, because client rects are screen
  // geometry and the painter's are not.
  test('fits the same size the painter does, at every zoom', async ({ page }) => {
    await seedTitleCard(page, { text: 'Untitled label', size: { width: 712, height: 429 } })

    for (const zoom of [1, 0.5, 0.33]) {
      await page.evaluate((viewport) => {
        ;(window as unknown as DevWindow).__EIDO_SET_VIEWPORT__?.(viewport)
      }, { x: 0, y: 0, zoom })
      await page.evaluate((cardId) => {
        // Re-run the fit for the current zoom the way a real edit would.
        const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
        devWindow.__eido.getState().setCardSize(cardId, { width: 712, height: 429 })
      }, CARD_ID)

      expect({ zoom, size: await fittedFontSize(page) })
        .toEqual({ zoom, size: await paintedFontSize(page, 'Untitled label', 712, 429) })
      expect(await editorOverflow(page)).toEqual({ height: 0, width: 0 })
    }
  })
})
