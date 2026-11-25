import { expect, test, type Page } from '@playwright/test'
import { activateAndRequireExactReadyMarkdownEditor } from '../performance/richCardEditorReadiness'

type DevStore = {
  getState: () => { hydrated: boolean; settings: Record<string, unknown> }
  setState: (state: unknown) => void
}

type DevWindow = Window & {
  __eido?: DevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

async function seedLongAsk(
  page: Page,
  selected: boolean,
  size = { width: 380, height: 280 },
  research = false,
) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(({ withSelection, cardSize, withResearch }) => {
    const devWindow = window as unknown as DevWindow
    const store = devWindow.__eido
    if (!store) throw new Error('Missing Eido development store')
    const prompt = Array.from(
      { length: 36 },
      (_, index) => `Prompt line ${index + 1}: preserve this deliberately long instruction while it scrolls.`,
    ).join('\n')
    const card = {
      id: 'fixed-ask-dock',
      kind: 'askAi',
      blocks: [{ id: 'fixed-ask-dock-block', text: prompt }],
      position: { x: 180, y: 90 },
      size: cardSize,
      agentic: withResearch,
      meta: withResearch ? { reachMode: 'research' } : undefined,
    }
    store.setState({
      cards: [card],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      visualDecayEnabled: false,
      selection: withSelection ? { kind: 'card', id: card.id } : null,
      selectedCardIds: withSelection ? [card.id] : [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
      linkupKeyPresent: withResearch,
    })
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 80, y: 20, zoom: 1 })
  }, { withSelection: selected, cardSize: size, withResearch: research })

  const node = page.locator('.react-flow__node[data-id="fixed-ask-dock"]')
  await expect(node).toBeVisible()
  await expect.poll(() => node.locator('.card-body').evaluate((element) =>
    element.scrollHeight - element.clientHeight,
  )).toBeGreaterThan(0)
  return node
}

test('minimum-size Ask AI keeps its body, model dock, and footer inside the Card', async ({ page }) => {
  const node = await seedLongAsk(page, false, { width: 200, height: 120 }, true)
  const layout = await node.locator('.card').evaluate((card) => {
    const body = card.querySelector<HTMLElement>('.card-body')
    const dock = card.querySelector<HTMLElement>('.card-run-dock')
    const footer = card.querySelector<HTMLElement>('.card-foot')
    if (!body || !dock || !footer) throw new Error('Missing minimum-size Ask AI geometry')
    const cardRect = card.getBoundingClientRect()
    const bodyRect = body.getBoundingClientRect()
    const dockRect = dock.getBoundingClientRect()
    const footerRect = footer.getBoundingClientRect()
    return {
      bodyHeight: bodyRect.height,
      dockFollowsBody: dockRect.top >= bodyRect.bottom - 1,
      footerFollowsDock: footerRect.top >= dockRect.bottom - 1,
      footerInsideCard: footerRect.bottom <= cardRect.bottom + 1,
    }
  })

  expect(layout.bodyHeight).toBeGreaterThan(0)
  expect(layout.dockFollowsBody).toBe(true)
  expect(layout.footerFollowsDock).toBe(true)
  expect(layout.footerInsideCard).toBe(true)

  await node.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(node.locator('.web-reach-note')).toBeAttached()
  const calloutLayout = await node.locator('.card').evaluate((card) => {
    const dock = card.querySelector<HTMLElement>('.card-run-dock')
    const footer = card.querySelector<HTMLElement>('.card-foot')
    if (!dock || !footer) throw new Error('Missing minimum-size research geometry')
    const cardRect = card.getBoundingClientRect()
    const dockRect = dock.getBoundingClientRect()
    const footerRect = footer.getBoundingClientRect()
    return {
      dockCanScrollCallout: dock.scrollHeight > dock.clientHeight,
      dockClipsOverflow: getComputedStyle(dock).overflowY !== 'visible',
      footerFollowsDock: footerRect.top >= dockRect.bottom - 1,
      footerInsideCard: footerRect.bottom <= cardRect.bottom + 1,
    }
  })
  expect(calloutLayout).toEqual({
    dockCanScrollCallout: true,
    dockClipsOverflow: true,
    footerFollowsDock: true,
    footerInsideCard: true,
  })
})

async function inspectLayout(node: ReturnType<Page['locator']>) {
  return node.locator('.card').evaluate((card) => {
    const body = card.querySelector<HTMLElement>('.card-body')
    const dock = card.querySelector<HTMLElement>('.card-run-dock')
    const picker = card.querySelector<HTMLElement>('.model-pick')
    const footer = card.querySelector<HTMLElement>('.card-foot')
    const prompt = card.querySelector<HTMLElement>('.markdown-card-editor-content')
      ?? card.querySelector<HTMLElement>('.note-render')
    if (!body || !dock || !picker || !footer || !prompt) throw new Error('Missing Ask AI geometry')

    const finalLine = Array.from(prompt.childNodes)
      .flatMap((node) => {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
        const textNodes: Text[] = []
        let textNode = walker.nextNode()
        while (textNode) {
          textNodes.push(textNode as Text)
          textNode = walker.nextNode()
        }
        return textNodes
      })
      .find((node) => node.textContent?.includes('Prompt line 36:'))
    if (!finalLine) throw new Error('Missing final prompt line')

    const before = {
      dock: dock.getBoundingClientRect(),
      picker: picker.getBoundingClientRect(),
      footer: footer.getBoundingClientRect(),
    }
    const dockStyle = getComputedStyle(dock)
    const maxScrollTop = body.scrollHeight - body.clientHeight
    body.scrollTop = maxScrollTop
    const finalRange = document.createRange()
    const finalText = finalLine.textContent ?? ''
    const finalIndex = finalText.indexOf('Prompt line 36:')
    finalRange.setStart(finalLine, finalIndex)
    finalRange.setEnd(finalLine, finalText.length)
    const atEnd = {
      picker: picker.getBoundingClientRect(),
      footer: footer.getBoundingClientRect(),
      finalPromptLine: finalRange.getBoundingClientRect(),
    }
    body.scrollTop = 0

    return {
      bodyCanScroll: maxScrollTop > 0,
      pickerAboveFooter: before.picker.bottom <= before.footer.top,
      dockHasTopPadding: Number.parseFloat(dockStyle.paddingTop) > 0,
      dockDoesNotMoveWithPrompt: Math.abs(atEnd.picker.top - before.picker.top) <= 1,
      finalPromptLineAbovePicker: atEnd.finalPromptLine.bottom <= atEnd.picker.top,
      footerDoesNotMove: Math.abs(atEnd.footer.top - before.footer.top) <= 1,
    }
  })
}

for (const selected of [false, true]) {
  test(`${selected ? 'selected' : 'passive'} fixed-height Ask AI keeps the prompt below its model dock`, async ({ page }) => {
    const node = await seedLongAsk(page, selected)
    if (selected) {
      await node.locator('.card-head').click()
      await expect(node.locator('.card')).toHaveClass(/selected/)
    } else {
      await expect(node.locator('.card')).not.toHaveClass(/selected/)
    }
    const layout = await inspectLayout(node)
    console.log(JSON.stringify({ selected, layout }))
    expect(layout).toEqual({
      bodyCanScroll: true,
      pickerAboveFooter: true,
      dockHasTopPadding: true,
      dockDoesNotMoveWithPrompt: true,
      finalPromptLineAbovePicker: true,
      footerDoesNotMove: true,
    })
  })
}

test('editing a fixed-height Ask AI keeps its final prompt line above the pinned model dock', async ({ page }) => {
  const node = await seedLongAsk(page, false)
  await node.locator('.card-head').click()
  await expect(node.locator('.card')).toHaveClass(/selected/)
  const { editor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-askAi[data-id="fixed-ask-dock"]',
    // The passive prompt is intentionally taller than its scroll viewport.
    // Activate through a visible point instead of Playwright's default centre,
    // which lies below the clipped Card body after the dock is truly pinned.
    () => node.locator('.note-render').click({ position: { x: 24, y: 24 } }),
  )
  await expect(editor).toBeEditable()
  const layout = await inspectLayout(node)
  console.log(JSON.stringify({ selected: true, editing: true, layout }))
  expect(layout).toEqual({
    bodyCanScroll: true,
    pickerAboveFooter: true,
    dockHasTopPadding: true,
    dockDoesNotMoveWithPrompt: true,
    finalPromptLineAbovePicker: true,
    footerDoesNotMove: true,
  })
})
