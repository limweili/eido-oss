import { expect, test, type Page } from '@playwright/test'

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    selectedCardIds: string[]
    selection: { kind: 'card' | 'connection'; id: string } | null
  }
  setState: (state: unknown) => void
}

const dragBox = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.waitForTimeout(50)
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
}

// Board mounts with fitView enabled, and React Flow defers that one-shot
// fitView until the first nodes are measured — under load it can land seconds
// in, and when the shared dev server still holds a previous test's sprawling
// board it lands at a far-out zoom. If it fires after the card rects are
// measured, the drag rectangles select the wrong cards. So: first wait for
// the mount fitView to actually fire (the viewport transform leaves its
// identity default), then pin the viewport to zoom 1 at the origin and keep
// re-pinning until the pin survives two consecutive reads.
const PINNED_TRANSFORM = 'matrix(1, 0, 0, 1, 0, 0)'

const readTransform = (page: Page) =>
  page.evaluate(() => {
    const viewportElement = document.querySelector<HTMLElement>('.react-flow__viewport')
    return viewportElement ? getComputedStyle(viewportElement).transform : 'missing'
  })

const waitForMountFitView = async (page: Page) => {
  await expect
    .poll(() => readTransform(page), { timeout: 15_000 })
    .not.toMatch(new RegExp(`^(none|missing|${PINNED_TRANSFORM.replace(/[().]/g, '\\$&')})$`))
}

const pinViewport = async (page: Page) => {
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          const devWindow = window as unknown as {
            __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
          }
          devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
        })
        await page.waitForTimeout(150)
        if ((await readTransform(page)) !== PINNED_TRANSFORM) return 'moved'
        await page.waitForTimeout(150)
        return (await readTransform(page)) === PINNED_TRANSFORM ? 'pinned' : 'moved'
      },
      { timeout: 15_000 },
    )
    .toBe('pinned')
}

test('selection box selects any card it touches, not only fully enclosed cards', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    const note = (id: string, x: number) => ({
      id,
      kind: 'note',
      blocks: [{ id: `${id}-block`, text: id }],
      position: { x, y: 200 },
      zIndex: 1,
    })
    devWindow.__eido.setState({
      cards: [note('note-a', 100), note('note-b', 500), note('note-c', 900)],
      connections: [
        {
          id: 'note-a-to-b',
          from: { cardId: 'note-a' },
          to: { cardId: 'note-b' },
          strength: 'strong',
          polarity: 'helps',
          role: 'feeds',
        },
      ],
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

  const nodeA = page.locator('.react-flow__node[data-id="note-a"]')
  const nodeB = page.locator('.react-flow__node[data-id="note-b"]')
  const nodeC = page.locator('.react-flow__node[data-id="note-c"]')
  await nodeA.waitFor({ state: 'visible' })
  await nodeB.waitFor({ state: 'visible' })
  await nodeC.waitFor({ state: 'visible' })

  await waitForMountFitView(page)
  await pinViewport(page)

  const rectA = await nodeA.boundingBox()
  const rectB = await nodeB.boundingBox()
  if (!rectA || !rectB) throw new Error('Missing card bounding boxes')

  // All drag anchors stay in the central screen area: a box drag near the
  // pane edge triggers React Flow's edge auto-pan, which shifts the viewport
  // mid-drag and corrupts the intended selection rectangle.
  // A box overlapping only note-b's top-left corner: no card is fully
  // enclosed, so Full mode selects nothing while Partial selects note-b.
  await page.mouse.move(rectB.x - 40, rectB.y - 40)
  await page.mouse.down()
  await page.waitForTimeout(50)
  await page.mouse.move(rectB.x + 30, rectB.y + 30, { steps: 8 })
  expect(await page.locator('.marquee-card-preview-layer').count()).toBe(0)
  // Live marquee selection must be the real card selection system: the card
  // border and its resize handles arrive in one render, with no parallel
  // preview-only class that can lead or lag the controls.
  const liveSelectionSnapshot = await nodeB.evaluate((node) => ({
    selected: node.querySelector('.card')?.classList.contains('selected') ?? false,
    resizeHandles: node.querySelectorAll('.react-flow__resize-control.handle').length,
  }))
  expect(liveSelectionSnapshot).toEqual({ selected: true, resizeHandles: 4 })
  expect(await nodeB.locator('.card.marquee-preview-selected').count()).toBe(0)
  await expect(nodeA.locator('.card')).not.toHaveClass(/selected/)
  await expect(nodeA.locator('.react-flow__resize-control.handle')).toHaveCount(0)
  await expect(nodeC.locator('.card')).not.toHaveClass(/selected/)
  await expect(nodeC.locator('.react-flow__resize-control.handle')).toHaveCount(0)
  const liveCardStyle = await nodeB.locator('.card').evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      borderColor: style.borderTopColor,
      borderWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
    }
  })
  await page.mouse.up()
  await expect(nodeB).toHaveClass(/selected/)
  await expect(nodeA).not.toHaveClass(/selected/)
  await expect(nodeC).not.toHaveClass(/selected/)
  const selectedCardStyle = await nodeB.locator('.card').evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      borderColor: style.borderTopColor,
      borderWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
    }
  })
  expect(liveCardStyle).toEqual(selectedCardStyle)
  expect(await readTransform(page), 'marquee selection must not move or zoom the viewport').toBe(PINNED_TRANSFORM)

  // Starting the next marquee replaces the previous visual selection in the
  // same pointer frame. The old card must not keep either its border or
  // handles while the new card waits for a second selection system to catch up.
  await page.mouse.move(rectA.x - 40, rectA.y - 40)
  await page.mouse.down()
  await page.mouse.move(rectA.x + 30, rectA.y + 30)
  const replacementSnapshot = await page.evaluate(() => {
    const snapshot = (id: string) => {
      const node = document.querySelector(`.react-flow__node[data-id="${id}"]`)
      return {
        selected: node?.querySelector('.card')?.classList.contains('selected') ?? false,
        resizeHandles: node?.querySelectorAll('.react-flow__resize-control.handle').length ?? 0,
      }
    }
    return { previous: snapshot('note-b'), next: snapshot('note-a') }
  })
  expect(replacementSnapshot).toEqual({
    previous: { selected: false, resizeHandles: 0 },
    next: { selected: true, resizeHandles: 4 },
  })
  await page.mouse.up()
  await expect(nodeA).toHaveClass(/selected/)
  await expect(nodeB).not.toHaveClass(/selected/)

  // Clear selection with a click on empty pane between note-a and note-b.
  await page.mouse.click(rectB.x - 80, rectB.y + rectB.height + 120)
  await expect(nodeB).not.toHaveClass(/selected/)

  // A late fitView (or anything else) may have nudged the viewport since the
  // rects were measured; re-pin so the second drag uses the same geometry.
  await pinViewport(page)

  // A box grazing note-a's right edge and note-b's left edge but never
  // reaching note-c selects exactly those two.
  await dragBox(
    page,
    { x: rectA.x + rectA.width - 20, y: rectA.y - 40 },
    { x: rectB.x + 30, y: rectB.y + 30 },
  )
  await expect(nodeA).toHaveClass(/selected/)
  await expect(nodeB).toHaveClass(/selected/)
  await expect(nodeC).not.toHaveClass(/selected/)

  // The original report was intermittent. Repeat the small marquee enough
  // times to catch a controlled-node rebuild that briefly makes React Flow
  // treat every unmeasured card as inside the box.
  await page.mouse.click(rectB.x - 80, rectB.y + rectB.height + 120)
  for (let run = 0; run < 25; run += 1) {
    await dragBox(page, { x: rectB.x - 40, y: rectB.y - 40 }, { x: rectB.x + 30, y: rectB.y + 30 })
    await expect(nodeB).toHaveClass(/selected/)
    await expect(nodeA).not.toHaveClass(/selected/)
    await expect(nodeC).not.toHaveClass(/selected/)
    expect(await readTransform(page), `marquee run ${run + 1} must not move or zoom the viewport`).toBe(
      PINNED_TRANSFORM,
    )
    await page.mouse.click(rectB.x - 80, rectB.y + rectB.height + 120)
    await expect(nodeB).not.toHaveClass(/selected/)
  }

  // A tight marquee around only the connector's midpoint selects the line
  // while leaving both endpoint cards outside the box.
  const connection = page.locator('.react-flow__edge[data-id="note-a-to-b"]')
  await connection.waitFor({ state: 'attached' })
  const connectionMidpoint = {
    x: (rectA.x + rectA.width + rectB.x) / 2,
    y: rectA.y + rectA.height / 2,
  }
  await page.mouse.move(connectionMidpoint.x - 20, connectionMidpoint.y - 30)
  await page.mouse.down()
  await page.mouse.move(connectionMidpoint.x + 20, connectionMidpoint.y + 30, { steps: 8 })
  const connectionPill = page.locator('[data-connection-id="note-a-to-b"]')
  await expect(connectionPill).toHaveClass(/selected/)
  expect(await connectionPill.evaluate((element) => element.classList.contains('marquee-preview-selected'))).toBe(false)
  const liveConnectionOutline = await connectionPill.evaluate(
    (element) => getComputedStyle(element).outline,
  )
  await page.mouse.up()
  await expect(connection).toHaveClass(/selected/)
  await expect(nodeA).not.toHaveClass(/selected/)
  await expect(nodeB).not.toHaveClass(/selected/)
  const selectedConnectionOutline = await connectionPill.evaluate(
    (element) => getComputedStyle(element).outline,
  )
  expect(liveConnectionOutline).toBe(selectedConnectionOutline)
})

const readSceneMarqueeAvailable = (page: Page) =>
  page.evaluate(() => {
    const board = document.querySelector<HTMLElement>('.board-flow')
    return board?.dataset.sceneMarqueeAvailable ?? null
  })

// Reading can legitimately mix mounted rich Cards (P/L) with painter-owned
// safety Cards (S). The marquee must union both ownership planes, and the
// selected tool must keep that same authority in Map.
test('marquee and additive selection work for painter-owned Cards through Map', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    const budgetAssets = (cardId: string) => Array.from({ length: 5 }, (_, index) => ({
      id: `${cardId}-file-${index}`,
      kind: 'file',
      name: `${cardId}-${index}.pdf`,
      mimeType: 'application/pdf',
      dataUrl: 'data:application/pdf;base64,JVBERi0=',
      size: 8,
      createdAt: '2026-07-23T00:00:00.000Z',
    }))
    const ordinaryBudgetCards = Array.from({ length: 6 }, (_, index) => ({
      id: index === 0 ? 'marquee-mounted-budget' : `marquee-budget-${index}`,
      kind: 'note',
      blocks: [{ id: `marquee-budget-${index}-block`, text: '' }],
      assets: budgetAssets(`marquee-budget-${index}`),
      position: index === 0 ? { x: 120, y: 180 } : { x: 1_200, y: 20 },
      size: { width: 260, height: 180 },
      zIndex: index + 1,
    }))
    const cards = [
      ...ordinaryBudgetCards,
      {
        id: 'marquee-painted-overflow',
        kind: 'note',
        blocks: [{
          id: 'marquee-painted-overflow-block',
          text: 'Small painter overflow keeps a bounded readable excerpt while its complete native Card waits for Live ownership.',
        }],
        position: { x: 620, y: 180 },
        size: { width: 260, height: 180 },
        zIndex: 1,
      },
    ]
    devWindow.__eido.setState({
      cards,
      connections: [
        {
          id: 'marquee-mixed-wire',
          from: { cardId: 'marquee-mounted-budget' },
          to: { cardId: 'marquee-painted-overflow' },
          strength: 'strong',
          polarity: 'helps',
          role: 'feeds',
        },
      ],
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

  const mountedCard = page.locator('.react-flow__node[data-id="marquee-mounted-budget"]')
  await mountedCard.waitFor({ state: 'visible' })
  await waitForMountFitView(page)
  await pinViewport(page)

  // Six exact-visible Cards at the 100K individual boundary consume the
  // ordinary 600K residency pool without entering O; the later small Card
  // stays on the painter. This legitimate mixed Reading scene must still
  // offer marquee independently of the oversize-visible pool.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const board = document.querySelector<HTMLElement>('.board-flow')
        return {
          passive: board?.dataset.passiveCardCount,
          safety: board?.dataset.safetyCardCount,
          demoted: board?.dataset.weightDemotedCardCount,
          oversized: board?.dataset.oversizePassiveCardCount,
        }
      }),
    )
    .toEqual({ passive: '6', safety: '1', demoted: '1', oversized: '0' })
  await expect.poll(() => readSceneMarqueeAvailable(page), { timeout: 5_000 }).toBe('true')
  await expect(page.locator('.react-flow__node[data-id="marquee-painted-overflow"]')).toHaveCount(0)
  await expect(page.locator('.react-flow__edge[data-id="marquee-mixed-wire"]')).toHaveCount(0)
  await expect
    .poll(() =>
      page.locator('[data-board-overview-layer]').evaluate((canvas) =>
        Number((canvas as HTMLCanvasElement).dataset.safetyPreviewLineCount ?? 0),
      ),
    )
    .toBeGreaterThan(0)

  const mountedBox = await mountedCard.boundingBox()
  if (!mountedBox) throw new Error('Missing mounted Reading card box')
  const paintedLeft = mountedBox.x + 500
  const dragStart = { x: Math.max(40, mountedBox.x - 80), y: mountedBox.y + mountedBox.height + 150 }
  const dragEnd = { x: paintedLeft + mountedBox.width + 150, y: Math.max(180, mountedBox.y - 40) }

  // Jump directly between two empty points outside the proximity lead. The
  // overflow Card remains painter-owned during the gesture, proving selection
  // comes from scene geometry rather than a hover-promoted React Flow proxy.
  await page.mouse.move(dragStart.x, dragStart.y)
  await page.mouse.down()
  await page.mouse.move(dragEnd.x, dragEnd.y)
  await expect(page.locator('.react-flow__selection')).toBeVisible()
  await expect(page.locator('.react-flow__node[data-id="marquee-painted-overflow"]')).toHaveCount(0)
  await page.mouse.up()
  const paintedCard = page.locator('.react-flow__node[data-id="marquee-painted-overflow"]')
  await expect(paintedCard).toHaveCount(0)
  await expect(mountedCard).toHaveClass(/selected/)
  await expect
    .poll(() =>
      page.locator('[data-board-overview-layer]').evaluate((canvas) =>
        Number((canvas as HTMLCanvasElement).dataset.safetyPreviewLineCount ?? 0),
      ),
    )
    .toBeGreaterThan(0)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const devWindow = window as unknown as { __eido: EidoDevStore }
        return [...devWindow.__eido.getState().selectedCardIds].sort()
      }),
    )
    .toEqual(['marquee-mounted-budget', 'marquee-painted-overflow'])
  expect(await readTransform(page), 'Reading marquee must not move or zoom the viewport').toBe(PINNED_TRANSFORM)

  // Return the overflow Card to S before the line-only pass. This makes the
  // crossing wire painter-owned for the whole gesture instead of relying on
  // the previous Card selection to retire after the next drag starts.
  await page.mouse.click(dragStart.x, dragStart.y)
  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    devWindow.__eido.setState({ selection: null, selectedCardIds: [] })
  })
  await expect(mountedCard).not.toHaveClass(/selected/)
  await expect(page.locator('.react-flow__node[data-id="marquee-painted-overflow"]')).toHaveCount(0)
  await expect(page.locator('.react-flow__edge[data-id="marquee-mixed-wire"]')).toHaveCount(0)

  // The visible P↔S wire is painter-owned because its S endpoint has no DOM
  // node. A tight line-only marquee must select that same bounded painter
  // member without pulling either endpoint Card into the result.
  const mixedConnectionMidpoint = {
    x: mountedBox.x + (mountedBox.width + 500) / 2,
    y: mountedBox.y + mountedBox.height / 2,
  }
  await dragBox(
    page,
    { x: mixedConnectionMidpoint.x - 24, y: mixedConnectionMidpoint.y - 30 },
    { x: mixedConnectionMidpoint.x + 24, y: mixedConnectionMidpoint.y + 30 },
  )
  await expect
    .poll(() =>
      page.evaluate(() => {
        const devWindow = window as unknown as { __eido: EidoDevStore }
        return devWindow.__eido.getState().selection
      }),
    )
    .toEqual({ kind: 'connection', id: 'marquee-mixed-wire' })
  await expect(mountedCard).not.toHaveClass(/selected/)
  await expect(page.locator('.react-flow__node[data-id="marquee-painted-overflow"]')).toHaveCount(0)

  // Clear BOTH selection owners before the Map phase.
  await page.mouse.click(dragStart.x, dragStart.y)
  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    devWindow.__eido.setState({ selection: null, selectedCardIds: [] })
  })
  await expect(mountedCard).not.toHaveClass(/selected/)
  await expect(paintedCard).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const devWindow = window as unknown as { __eido: EidoDevStore }
        return (
          devWindow.__eido.getState().selectedCardIds.length +
          document.querySelectorAll('.react-flow__node.selected').length
        )
      }),
    )
    .toBe(0)
  // The extra ordinary Cards exist only to prove the Reading P/S budget
  // boundary. Remove them before the much wider Map-space marquee so this
  // second journey keeps its original two-Card selection oracle.
  await page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: {
        getState: () => { cards: Array<{ id: string }> }
        setState: (state: unknown) => void
      }
    }
    devWindow.__eido.setState({
      cards: devWindow.__eido.getState().cards.filter((card) =>
        card.id === 'marquee-mounted-budget' || card.id === 'marquee-painted-overflow',
      ),
    })
  })
  await page.evaluate(() => {
    const devWindow = window as unknown as {
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 360, y: 220, zoom: 0.06 })
  })
  await page.waitForTimeout(900)

  await expect.poll(() => readSceneMarqueeAvailable(page), { timeout: 5_000 }).toBe('true')

  const mapStart = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow')?.getBoundingClientRect()
    if (!pane) throw new Error('Missing board pane')
    return { x: pane.left + 320, y: pane.top + 180 }
  })
  const transformBefore = await readTransform(page)
  await page.mouse.move(mapStart.x, mapStart.y)
  await page.mouse.down()
  await page.mouse.move(mapStart.x + 440, mapStart.y + 380, { steps: 12 })
  const selectionVisibleWhileDragging = await page.locator('.react-flow__selection').isVisible()
  await expect
    .poll(() =>
      page.locator('canvas[data-board-overview-layer]').evaluate(
        (canvas) => Number((canvas as HTMLCanvasElement).dataset.resizeAnchorCount ?? 0),
      ),
    )
    .toBe(8)
  await page.mouse.up()

  const readSelectedCount = () =>
    page.evaluate(() => {
      const devWindow = window as unknown as { __eido: EidoDevStore }
      return devWindow.__eido.getState().selectedCardIds.length
    })
  await expect
    .poll(readSelectedCount, { timeout: 3_000 })
    .toBe(2)
  const mapTransform = await readTransform(page)
  expect(selectionVisibleWhileDragging, 'Map drag with the select tool must draw a selection box').toBe(true)
  expect(mapTransform, 'Map marquee must not pan the board').toBe(transformBefore)

  // The two selected painter-owned Cards remain one manipulation set. Moving
  // either selected Card through the one bounded gesture proxy applies the
  // same board-space delta to both, without fitting or centring the viewport.
  const selectedPositionsBefore = await page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: {
        getState: () => {
          cards: Array<{ id: string; position: { x: number; y: number } }>
        }
      }
    }
    return Object.fromEntries(
      devWindow.__eido.getState().cards.map((card) => [card.id, { ...card.position }]),
    )
  })
  const firstSelectedCentre = {
    x: 360 + (120 + 130) * 0.06,
    y: 220 + (180 + 90) * 0.06,
  }
  await page.mouse.move(firstSelectedCentre.x, firstSelectedCentre.y)
  const selectedProxy = page.locator(
    '.react-flow__node-gestureProxy[data-id="marquee-mounted-budget"]',
  )
  await selectedProxy.waitFor({ state: 'attached' })
  const selectedProxyBox = await selectedProxy.boundingBox()
  if (!selectedProxyBox) throw new Error('Missing selected Map gesture proxy box')
  const selectedProxyCentre = {
    x: selectedProxyBox.x + selectedProxyBox.width / 2,
    y: selectedProxyBox.y + selectedProxyBox.height / 2,
  }
  await page.mouse.move(selectedProxyCentre.x, selectedProxyCentre.y)
  await page.mouse.down()
  await page.mouse.move(selectedProxyCentre.x + 36, selectedProxyCentre.y + 24, { steps: 8 })
  await page.mouse.up()
  const selectedPositionsAfter = await page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: {
        getState: () => {
          cards: Array<{ id: string; position: { x: number; y: number } }>
        }
      }
    }
    return Object.fromEntries(
      devWindow.__eido.getState().cards.map((card) => [card.id, { ...card.position }]),
    )
  })
  const firstDelta = {
    x:
      selectedPositionsAfter['marquee-mounted-budget'].x -
      selectedPositionsBefore['marquee-mounted-budget'].x,
    y:
      selectedPositionsAfter['marquee-mounted-budget'].y -
      selectedPositionsBefore['marquee-mounted-budget'].y,
  }
  const secondDelta = {
    x:
      selectedPositionsAfter['marquee-painted-overflow'].x -
      selectedPositionsBefore['marquee-painted-overflow'].x,
    y:
      selectedPositionsAfter['marquee-painted-overflow'].y -
      selectedPositionsBefore['marquee-painted-overflow'].y,
  }
  expect(firstDelta.x).not.toBe(0)
  expect(firstDelta.y).not.toBe(0)
  expect(secondDelta).toEqual(firstDelta)
  expect(await readTransform(page), 'moving a Map selection must not fit or centre the viewport').toBe(
    transformBefore,
  )

  const pane = await page.locator('.react-flow').boundingBox()
  if (!pane) throw new Error('Missing board pane')
  await page.mouse.click(pane.x + pane.width - 80, pane.y + 80)
  await expect.poll(readSelectedCount).toBe(0)
  await page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: {
        getState: () => {
          moveCard: (id: string, position: { x: number; y: number }) => void
        }
      }
    }
    devWindow.__eido.getState().moveCard('marquee-painted-overflow', { x: 1620, y: 180 })
  })
  await page.waitForTimeout(300)
  const cardCentre = (x: number, y = 180) => ({
    x: pane.x + 360 + (x + 130) * 0.06,
    y: pane.y + 220 + (y + 90) * 0.06,
  })
  const firstCentre = cardCentre(
    selectedPositionsAfter['marquee-mounted-budget'].x,
    selectedPositionsAfter['marquee-mounted-budget'].y,
  )
  const secondCentre = cardCentre(1620)
  await page.mouse.click(firstCentre.x, firstCentre.y)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const devWindow = window as unknown as { __eido: EidoDevStore }
        return devWindow.__eido.getState().selectedCardIds
      }),
    )
    .toEqual(['marquee-mounted-budget'])
  await page.keyboard.down('Shift')
  await page.mouse.move(secondCentre.x, secondCentre.y)
  await page.mouse.down()
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect
    .poll(() =>
      page.evaluate(() => {
        const devWindow = window as unknown as { __eido: EidoDevStore }
        return [...devWindow.__eido.getState().selectedCardIds].sort()
      }),
    )
    .toEqual(['marquee-mounted-budget', 'marquee-painted-overflow'])

  // Modifier release reconciles React Flow's mounted proxy plane two frames
  // later. Hold those frames, clear on the pane, then release the queued work:
  // stale reconciliation must not resurrect the old two-Card selection.
  await page.keyboard.down('Shift')
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __EIDO_SELECTION_RAF_TEST__?: {
        original: typeof window.requestAnimationFrame
        callbacks: FrameRequestCallback[]
      }
    }
    const callbacks: FrameRequestCallback[] = []
    testWindow.__EIDO_SELECTION_RAF_TEST__ = {
      original: window.requestAnimationFrame,
      callbacks,
    }
    window.requestAnimationFrame = (callback) => {
      callbacks.push(callback)
      return callbacks.length
    }
  })
  await page.keyboard.up('Shift')
  await page.mouse.click(pane.x + pane.width - 80, pane.y + 80)
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __EIDO_SELECTION_RAF_TEST__?: {
        original: typeof window.requestAnimationFrame
        callbacks: FrameRequestCallback[]
      }
    }
    const harness = testWindow.__EIDO_SELECTION_RAF_TEST__
    if (!harness) throw new Error('Missing selection RAF harness')
    const callbacks = harness.callbacks.splice(0)
    window.requestAnimationFrame = harness.original
    delete testWindow.__EIDO_SELECTION_RAF_TEST__
    for (const callback of callbacks) callback(performance.now())
  })
  await page.waitForTimeout(100)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const devWindow = window as unknown as { __eido: EidoDevStore }
        return devWindow.__eido.getState().selectedCardIds
      }),
    )
    .toEqual([])
})

test('holding a Map marquee at the viewport edge pans to and live-selects Cards below the original view', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    const note = (id: string, y: number) => ({
      id,
      kind: 'note',
      blocks: [{ id: `${id}-block`, text: id }],
      position: { x: 320, y },
      size: { width: 260, height: 180 },
      zIndex: 1,
    })
    devWindow.__eido.setState({
      cards: [note('marquee-near', 140), note('marquee-below-fold', 11_000)],
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

  await waitForMountFitView(page)
  await page.evaluate(() => {
    const devWindow = window as unknown as {
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 300, y: 160, zoom: 0.06 })
  })
  await expect.poll(() => readSceneMarqueeAvailable(page), { timeout: 5_000 }).toBe('true')

  const pane = await page.locator('.react-flow').boundingBox()
  if (!pane) throw new Error('Missing board pane')
  const before = await readTransform(page)
  await page.mouse.move(pane.x + 260, pane.y + 80)
  await page.mouse.down()
  await page.mouse.move(pane.x + 640, pane.y + pane.height - 4, { steps: 10 })
  await expect(page.locator('.react-flow__selection')).toBeVisible()

  await expect
    .poll(() => readTransform(page), { timeout: 5_000 })
    .not.toBe(before)

  await expect
    .poll(() =>
      page.locator('canvas[data-board-overview-layer]').evaluate(
        (canvas) => Number((canvas as HTMLCanvasElement).dataset.resizeAnchorCount ?? 0),
      ),
      { timeout: 5_000 },
    )
    .toBe(8)

  await page.mouse.up()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const devWindow = window as unknown as { __eido: EidoDevStore }
        return [...devWindow.__eido.getState().selectedCardIds].sort()
      }),
    )
    .toEqual(['marquee-below-fold', 'marquee-near'])
})

// #210: press-and-move anywhere on an UNSELECTED card drags it; a stationary
// click still goes "into" the card (title editor, buttons). Movement-threshold
// disambiguation, like touch UIs.

const seedSingleNote = async (page: Page) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'grab-note',
          kind: 'note',
          blocks: [{ id: 'grab-note-block', text: 'grab me anywhere on this body text' }],
          position: { x: 300, y: 240 },
          size: { width: 260, height: 160 },
          zIndex: 1,
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

  const node = page.locator('.react-flow__node[data-id="grab-note"]')
  await node.waitFor({ state: 'visible' })
  await waitForMountFitView(page)
  await pinViewport(page)
  return node
}

const nodeTranslate = (page: Page, id: string) =>
  page.evaluate((nodeId) => {
    const element = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${nodeId}"]`)
    if (!element) throw new Error(`Missing node ${nodeId}`)
    const transform = getComputedStyle(element).transform
    if (!transform || transform === 'none') return { x: 0, y: 0 }
    const matrix = new DOMMatrixReadOnly(transform)
    return { x: matrix.e, y: matrix.f }
  }, id)

const pressAndMove = async (page: Page, from: { x: number; y: number }, byX: number) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + byX, from.y, { steps: 8 })
  await page.waitForTimeout(120)
  await page.mouse.up()
}

test('press-and-move on an unselected card body drags the card', async ({ page }) => {
  const node = await seedSingleNote(page)
  const body = node.locator('.note-render')
  const bodyBox = await body.boundingBox()
  if (!bodyBox) throw new Error('Missing note body box')

  const start = await nodeTranslate(page, 'grab-note')
  await pressAndMove(page, { x: bodyBox.x + bodyBox.width / 2, y: bodyBox.y + bodyBox.height / 2 }, 50)

  await expect
    .poll(async () => (await nodeTranslate(page, 'grab-note')).x)
    .toBeGreaterThan(start.x + 30)
})

test('press-and-move on an unselected card title drags without opening the title editor', async ({ page }) => {
  const node = await seedSingleNote(page)
  const title = node.locator('.card-title-display')
  const titleBox = await title.boundingBox()
  if (!titleBox) throw new Error('Missing title box')

  const start = await nodeTranslate(page, 'grab-note')
  await pressAndMove(page, { x: titleBox.x + titleBox.width / 2, y: titleBox.y + titleBox.height / 2 }, 60)

  await expect
    .poll(async () => (await nodeTranslate(page, 'grab-note')).x)
    .toBeGreaterThan(start.x + 30)
  await expect(node.locator('.card-title-input')).toHaveCount(0)
})

test('a stationary click on a selected card title opens the title editor', async ({ page }) => {
  const node = await seedSingleNote(page)
  const head = node.locator('.card-head')
  const headBox = await head.boundingBox()
  if (!headBox) throw new Error('Missing card head box')

  // First click (head padding) selects the card without entering the title.
  await page.mouse.click(headBox.x + headBox.width / 2, headBox.y + 3)
  await expect(node).toHaveClass(/selected/)

  const title = node.locator('.card-title-display')
  await expect(title).toHaveClass(/nodrag/)
  const titleBox = await title.boundingBox()
  if (!titleBox) throw new Error('Missing title box')
  await page.mouse.click(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2)

  await expect(node.locator('.card-title-input')).toBeVisible()
  const moved = await nodeTranslate(page, 'grab-note')
  expect(moved.x).toBe(300)
})

test('a stationary click on a card button fires the action without moving the card', async ({ page }) => {
  const node = await seedSingleNote(page)
  const colorButton = node.locator('.kind-dot')
  const buttonBox = await colorButton.boundingBox()
  if (!buttonBox) throw new Error('Missing colour button box')

  await page.mouse.click(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2)

  await expect(page.locator('.e-popover .card-color-popover')).toBeVisible()
  const after = await nodeTranslate(page, 'grab-note')
  expect(after.x).toBe(300)
  expect(after.y).toBe(240)
})

const documentSelectionLength = (page: Page) =>
  page.evaluate(() => (window.getSelection()?.toString() ?? '').length)

test('the selection box selects cards without selecting the text inside them', async ({ page }) => {
  const node = await seedSingleNote(page)
  const nodeBox = await node.boundingBox()
  if (!nodeBox) throw new Error('Missing note box')

  // Drag from empty pane straight across the note body. The box selects the
  // Card; the browser's own text-selection drag must never start, so no wash
  // appears over the body and a following copy takes Cards, not prose.
  await page.mouse.move(nodeBox.x - 40, nodeBox.y - 30)
  await page.mouse.down()
  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2, { steps: 8 })
  expect(await documentSelectionLength(page)).toBe(0)
  await page.mouse.up()

  await expect(node).toHaveClass(/selected/)
  expect(await documentSelectionLength(page)).toBe(0)
})

test('refusing the marquee text drag leaves ordinary in-card text selection intact', async ({
  page,
}) => {
  const node = await seedSingleNote(page)
  const head = node.locator('.card-head')
  const headBox = await head.boundingBox()
  if (!headBox) throw new Error('Missing card head box')
  await page.mouse.click(headBox.x + headBox.width / 2, headBox.y + 3)
  // Wait for the Card itself, not React Flow's wrapper: only the Card's own
  // selected render stops the drag being a Card drag, and it arrives one paint
  // behind the wrapper class.
  await expect(node.locator('.card')).toHaveClass(/selected/)

  const bodyBox = await node.locator('.note-render').boundingBox()
  if (!bodyBox) throw new Error('Missing note body box')
  await page.mouse.move(bodyBox.x + 6, bodyBox.y + 10)
  await page.mouse.down()
  await page.mouse.move(bodyBox.x + bodyBox.width - 8, bodyBox.y + bodyBox.height / 2, { steps: 10 })
  await page.mouse.up()

  await expect.poll(() => documentSelectionLength(page)).toBeGreaterThan(0)
})

const seedThreeNotes = async (page: Page) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })
  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    const note = (id: string, x: number) => ({
      id,
      kind: 'note',
      blocks: [{ id: `${id}-block`, text: `${id} body text` }],
      position: { x, y: 240 },
      size: { width: 260, height: 160 },
      zIndex: 1,
    })
    devWindow.__eido.setState({
      cards: [note('note-a', 200), note('note-b', 620), note('note-c', 1040)],
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
  for (const id of ['note-a', 'note-b', 'note-c']) {
    await page.locator(`.react-flow__node[data-id="${id}"]`).waitFor({ state: 'visible' })
  }
  await waitForMountFitView(page)
  await pinViewport(page)
}

const cardPositions = (page: Page) =>
  page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: { getState: () => { cards: Array<{ id: string; position: { x: number; y: number } }> } }
    }
    return Object.fromEntries(
      devWindow.__eido.getState().cards.map((card) => [card.id, { ...card.position }]),
    )
  })

const headGrip = async (page: Page, id: string) => {
  const box = await page.locator(`.react-flow__node[data-id="${id}"] .card-head`).boundingBox()
  if (!box) throw new Error(`Missing card head for ${id}`)
  return { x: box.x + box.width / 2, y: box.y + 3 }
}

const dragBy = async (page: Page, from: { x: number; y: number }, by: number) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + by / 2, from.y + by / 2, { steps: 6 })
  await page.mouse.move(from.x + by, from.y + by, { steps: 8 })
  await page.mouse.up()
}

// A box selection must leave exactly what a shift-click multi selection
// leaves. React Flow answers its own box selection with an invisible
// rectangle over the selected bounding box, which took the grab cursor,
// swallowed presses on the blank canvas between the Cards, and dragged the
// whole set from there. The founder interacts with the real Cards, never with
// an invisible region.
test('a box selection leaves no invisible region between the selected cards', async ({ page }) => {
  await seedThreeNotes(page)
  const rectA = await page.locator('.react-flow__node[data-id="note-a"]').boundingBox()
  const rectB = await page.locator('.react-flow__node[data-id="note-b"]').boundingBox()
  if (!rectA || !rectB) throw new Error('Missing card bounding boxes')

  await dragBox(
    page,
    { x: rectA.x - 30, y: rectA.y - 30 },
    { x: rectB.x + rectB.width + 20, y: rectB.y + rectB.height + 20 },
  )
  await expect
    .poll(() => page.evaluate(() => (window as unknown as {
      __eido: { getState: () => { selectedCardIds: string[] } }
    }).__eido.getState().selectedCardIds.length))
    .toBe(2)
  expect(await page.locator('.react-flow__nodesselection-rect').count()).toBe(0)

  // The blank canvas between the two selected Cards is still the pane: it
  // keeps the pane's own cursor and starts a new box, never a selection move.
  const gap = { x: rectA.x + rectA.width + (rectB.x - rectA.x - rectA.width) / 2, y: rectA.y + 20 }
  const gapSurface = await page.evaluate(
    ([x, y]) => {
      const element = document.elementFromPoint(x, y)
      return element
        ? { className: element.className, cursor: getComputedStyle(element).cursor }
        : null
    },
    [gap.x, gap.y],
  )
  expect(gapSurface?.className).toContain('react-flow__pane')
  expect(gapSurface?.cursor).not.toBe('grab')

  const before = await cardPositions(page)
  await dragBy(page, gap, 120)
  expect(await cardPositions(page)).toEqual(before)
})

test('a box selection drags from a selected card exactly like a shift-click selection', async ({
  page,
}) => {
  await seedThreeNotes(page)
  const rectA = await page.locator('.react-flow__node[data-id="note-a"]').boundingBox()
  const rectB = await page.locator('.react-flow__node[data-id="note-b"]').boundingBox()
  if (!rectA || !rectB) throw new Error('Missing card bounding boxes')

  await dragBox(
    page,
    { x: rectA.x - 30, y: rectA.y - 30 },
    { x: rectB.x + rectB.width + 20, y: rectB.y + rectB.height + 20 },
  )
  await expect(page.locator('.react-flow__node[data-id="note-b"] .card')).toHaveClass(/selected/)
  const beforeBoxDrag = await cardPositions(page)
  await dragBy(page, await headGrip(page, 'note-a'), 100)
  await expect.poll(async () => (await cardPositions(page))['note-a']!.x).toBeGreaterThan(
    beforeBoxDrag['note-a']!.x + 50,
  )
  const afterBoxDrag = await cardPositions(page)
  const boxDelta = {
    a: afterBoxDrag['note-a']!.x - beforeBoxDrag['note-a']!.x,
    b: afterBoxDrag['note-b']!.x - beforeBoxDrag['note-b']!.x,
    c: afterBoxDrag['note-c']!.x - beforeBoxDrag['note-c']!.x,
  }

  await page.keyboard.press('Escape')
  await seedThreeNotes(page)
  const shiftRectA = await page.locator('.react-flow__node[data-id="note-a"]').boundingBox()
  const shiftRectB = await page.locator('.react-flow__node[data-id="note-b"]').boundingBox()
  if (!shiftRectA || !shiftRectB) throw new Error('Missing card bounding boxes')
  await page.mouse.click(shiftRectA.x + shiftRectA.width / 2, shiftRectA.y + 3)
  await page.keyboard.down('Shift')
  await page.mouse.click(shiftRectB.x + shiftRectB.width / 2, shiftRectB.y + 3)
  await page.keyboard.up('Shift')
  await expect(page.locator('.react-flow__node[data-id="note-b"] .card')).toHaveClass(/selected/)
  const beforeShiftDrag = await cardPositions(page)
  await dragBy(page, await headGrip(page, 'note-a'), 100)
  await expect.poll(async () => (await cardPositions(page))['note-a']!.x).toBeGreaterThan(
    beforeShiftDrag['note-a']!.x + 50,
  )
  const afterShiftDrag = await cardPositions(page)

  expect(boxDelta).toEqual({
    a: afterShiftDrag['note-a']!.x - beforeShiftDrag['note-a']!.x,
    b: afterShiftDrag['note-b']!.x - beforeShiftDrag['note-b']!.x,
    c: afterShiftDrag['note-c']!.x - beforeShiftDrag['note-c']!.x,
  })
})

// Dismissal is one-way. A Card reads its committed selection from node data
// the paint barrier publishes one paint late, so handing the Cards back to it
// at gesture end used to repaint the dismissed selection for a frame.
test('dismissing a box selection never repaints it', async ({ page }) => {
  await seedThreeNotes(page)
  const rectA = await page.locator('.react-flow__node[data-id="note-a"]').boundingBox()
  const rectB = await page.locator('.react-flow__node[data-id="note-b"]').boundingBox()
  if (!rectA || !rectB) throw new Error('Missing card bounding boxes')

  await dragBox(
    page,
    { x: rectA.x - 30, y: rectA.y - 30 },
    { x: rectB.x + rectB.width + 20, y: rectB.y + rectB.height + 20 },
  )
  await expect(page.locator('.react-flow__node[data-id="note-a"] .card')).toHaveClass(/selected/)

  await page.evaluate(() => {
    const sampled = window as unknown as { __eidoSelectionFrames?: number[][]; __eidoFrame?: number }
    sampled.__eidoSelectionFrames = []
    const tick = () => {
      sampled.__eidoSelectionFrames!.push([
        document.querySelectorAll('.card.selected').length,
        document.querySelectorAll('.eido-visual-card-node.selected').length,
      ])
      sampled.__eidoFrame = requestAnimationFrame(tick)
    }
    tick()
  })

  // Dismiss on empty canvas below the row, with the small travel a real press
  // always carries.
  const away = { x: rectA.x - 60, y: rectA.y + rectA.height + 120 }
  await page.mouse.move(away.x, away.y)
  await page.mouse.down()
  await page.mouse.move(away.x + 3, away.y + 2, { steps: 2 })
  await page.mouse.up()
  await expect(page.locator('.card.selected')).toHaveCount(0)
  await page.waitForTimeout(400)

  const frames = await page.evaluate(() => {
    const sampled = window as unknown as { __eidoSelectionFrames: number[][]; __eidoFrame: number }
    cancelAnimationFrame(sampled.__eidoFrame)
    return sampled.__eidoSelectionFrames
  })
  const repainted = frames.some(
    (frame, index) =>
      index > 0 && (frame[0]! > frames[index - 1]![0]! || frame[1]! > frames[index - 1]![1]!),
  )
  expect(repainted).toBe(false)
})

test('a marquee press ends the editing session that would otherwise wash text', async ({ page }) => {
  const node = await seedSingleNote(page)
  const bodyBox = await node.locator('.note-render').boundingBox()
  if (!bodyBox) throw new Error('Missing note body box')

  await page.mouse.click(bodyBox.x + 30, bodyBox.y + 8)
  await expect(node.locator('.markdown-card-editor-content')).toBeVisible()
  await page.keyboard.type(' edited')

  // Refusing the press's default action also refuses the focus and caret
  // change it would have made, so the editing session survived into the drag
  // and the browser grew its wash from that anchor. The press ends the
  // session instead: no editor holds the caret while the box is drawn.
  const nodeBox = await node.boundingBox()
  if (!nodeBox) throw new Error('Missing note box')
  await page.mouse.move(nodeBox.x - 40, nodeBox.y - 30)
  await page.mouse.down()
  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2, { steps: 8 })
  const duringDrag = await page.evaluate(() => ({
    editing: Boolean(
      document.activeElement?.closest?.('input, textarea, [contenteditable="true"]'),
    ),
    ranges: window.getSelection()?.rangeCount ?? 0,
    selectionLength: (window.getSelection()?.toString() ?? '').length,
  }))
  await page.mouse.up()

  expect(duringDrag).toEqual({ editing: false, ranges: 0, selectionLength: 0 })
  expect(await documentSelectionLength(page)).toBe(0)
})
