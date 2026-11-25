import { expect, test, type Page } from '@playwright/test'

// C2 (#314): canvas-driven hover, proximity-lead single-proxy mount, and
// body press-drag at any zoom. These are the epic's hot/cold-contract gates:
// hover and drag must work below Reading (where a card has no DOM unless its
// proxy is mounted), and a pointer storm with an unchanged target must
// rebuild NOTHING (scene, nodes, store, label cache) while the canvas stays
// rAF-coalesced. Proxy nodes are INVISIBLE — every wait on them is
// `state: 'attached'`, never `visible` (C1's lesson).

const MAP_ZOOM = 0.06
const CARD_WIDTH = 260
const CARD_HEIGHT = 180
// Board-space seed position of the hover/drag subject: far from the viewport
// centre at Map zoom (screen ≈ (1140, 570) in the 1280×800 pane).
const FAR_CARD = { x: 19_000, y: 9_500 }

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    boardChangeSeq: number
    cards: Array<{ id: string; position: { x: number; y: number } }>
  }
  setState: (state: unknown) => void
  subscribe: (listener: () => void) => () => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
  __EIDO_FORCE_OVERVIEW_DRAW__?: () => void
  __EIDO_OVERVIEW_CARD_IDS__?: Set<string>
  __EIDO_PERF__?: {
    resetBoardScenePerfCounters: () => void
    boardScenePerfCounters: () => {
      sceneDerivations: number
      cardMetricDerivations: number
      cardMetricVisits: number
    }
  }
  __EIDO_STORE_NOTIFY_COUNT__?: number
  __EIDO_MOUNT_PLAN_DERIVATIONS__?: number
}

async function seedMapBoard(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(
      devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__ && devWindow.__EIDO_PERF__,
    )
  })

  await page.evaluate((farCard) => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    const note = (id: string, x: number, y: number) => ({
      id,
      kind: 'note',
      blocks: [{ id: `${id}-block`, text: id }],
      position: { x, y },
      zIndex: 1,
    })
    devWindow.__eido.setState({
      cards: [
        note('far-card', farCard.x, farCard.y),
        note('neighbour-a', 2_000, 2_000),
        note('neighbour-b', 6_000, 2_000),
        note('neighbour-c', 10_000, 2_000),
        // Fillers well clear of far-card so the proximity lead is unambiguous.
        ...Array.from({ length: 30 }, (_, index) => ({
          ...note(`filler-${index}`, 2_000 + (index % 10) * 900, 4_500 + Math.floor(index / 10) * 900),
        })),
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
  }, FAR_CARD)

  await page.waitForFunction(() => {
    const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')
    return Number(layer?.dataset.renderedCardCount ?? 0) > 0
  })
  // Pin the viewport twice around a settle window so the deferred fitView
  // cannot override it (mountPlanObservability's pattern).
  for (let pin = 0; pin < 2; pin += 1) {
    await page.evaluate((zoom) => {
      const devWindow = window as unknown as DevWindow
      devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom })
    }, MAP_ZOOM)
    await page.waitForTimeout(350)
  }
  await page.evaluate(() => (window as unknown as DevWindow).__EIDO_FORCE_OVERVIEW_DRAW__?.())
}

function cardCentreOnScreen(card: { x: number; y: number }) {
  return {
    x: (card.x + CARD_WIDTH / 2) * MAP_ZOOM,
    y: (card.y + CARD_HEIGHT / 2) * MAP_ZOOM,
  }
}

async function paneCentrePoint(page: Page, card: { x: number; y: number }) {
  const centre = cardCentreOnScreen(card)
  return page.evaluate((point) => {
    const pane = document.querySelector('.react-flow')?.getBoundingClientRect()
    if (!pane) throw new Error('Missing board pane')
    return { x: pane.left + point.x, y: pane.top + point.y }
  }, centre)
}

function hoveredCardId(page: Page) {
  return page.evaluate(() => document.querySelector<HTMLElement>('.board-flow')?.dataset.hoveredCardId ?? null)
}

function farCardPosition(page: Page) {
  return page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    return devWindow.__eido.getState().cards.find((card) => card.id === 'far-card')!.position
  })
}

function layerCounters(page: Page) {
  return page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')
    if (!layer) throw new Error('Missing overview layer')
    return {
      draws: Number(layer.dataset.overviewDrawCount ?? 0),
      renderedCardCount: Number(layer.dataset.renderedCardCount ?? 0),
      representationCount: Number(layer.dataset.representationCount ?? 0),
      silhouetteCardCount: Number(layer.dataset.silhouetteCardCount ?? 0),
      suppressedReactCardCount: Number(layer.dataset.suppressedReactCardCount ?? 0),
      labelCacheMissesPerFrame: Number(layer.dataset.labelCacheMissesPerFrame ?? 0),
      cacheEntries: Number(layer.dataset.cacheEntries ?? 0),
    }
  })
}

test('hover at map zoom far from centre: proximity mounts the invisible proxy and paints the affordance', async ({
  page,
}) => {
  await seedMapBoard(page)
  const centre = await paneCentrePoint(page, FAR_CARD)

  // Below Reading, nothing mounts at rest.
  expect(await page.locator('.react-flow__node').count()).toBe(0)
  const before = await layerCounters(page)

  // Pixel baseline of the ring region around the card BEFORE hover.
  const ringRegion = {
    x: FAR_CARD.x * MAP_ZOOM - 6,
    y: FAR_CARD.y * MAP_ZOOM - 6,
    width: CARD_WIDTH * MAP_ZOOM + 12,
    height: CARD_HEIGHT * MAP_ZOOM + 12,
  }
  const paintedPixels = (region: typeof ringRegion) =>
    page.evaluate((r) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
      const context = canvas?.getContext('2d')
      if (!canvas || !context) throw new Error('Missing overview canvas')
      const ratio = canvas.width / canvas.getBoundingClientRect().width
      const data = context.getImageData(
        Math.floor(r.x * ratio),
        Math.floor(r.y * ratio),
        Math.ceil(r.width * ratio),
        Math.ceil(r.height * ratio),
      ).data
      let painted = 0
      for (let index = 3; index < data.length; index += 4) if (data[index] > 0) painted += 1
      return painted
    }, region)
  const paintedBefore = await paintedPixels(ringRegion)

  // Approach in two hops so a pre-contact move lands inside the lead radius.
  await page.mouse.move(centre.x - 120, centre.y - 60)
  await page.mouse.move(centre.x - 30, centre.y - 12)
  await page.mouse.move(centre.x, centre.y)

  // The invisible proxy mounts (attached, never visible) and hover locks.
  await page
    .locator('.react-flow__node[data-id="far-card"]')
    .waitFor({ state: 'attached', timeout: 10_000 })
  await expect.poll(() => hoveredCardId(page)).toBe('far-card')
  expect(await page.locator('.react-flow__node').count()).toBe(1)

  // The hover affordance paints: the ring region gains painted pixels.
  await page.waitForTimeout(120)
  const paintedAfter = await paintedPixels(ringRegion)
  expect(paintedAfter).toBeGreaterThan(paintedBefore)

  // The card keeps its full Map representation while the proxy is mounted —
  // not a silhouette, not suppressed (the proxy representation gate has the
  // full accounting; this is the hover-path half).
  const during = await layerCounters(page)
  expect(during.representationCount).toBe(before.representationCount)
  expect(during.silhouetteCardCount).toBe(0)
  expect(during.suppressedReactCardCount).toBe(0)

  // Leave: hover clears, the proxy lingers briefly, then unmounts — the
  // participant set is empty at rest.
  await page.mouse.move(centre.x - 200, centre.y - 120)
  await expect.poll(() => hoveredCardId(page)).toBe(null)
  await expect
    .poll(() => page.locator('.react-flow__node').count(), { timeout: 5_000 })
    .toBe(0)
})

test('drag at map zoom: body press past the threshold moves the card in the store', async ({ page }) => {
  await seedMapBoard(page)
  const centre = await paneCentrePoint(page, FAR_CARD)

  await page.mouse.move(centre.x - 60, centre.y - 20)
  await page.mouse.move(centre.x, centre.y)
  await page.locator('.react-flow__node[data-id="far-card"]').waitFor({ state: 'attached', timeout: 10_000 })

  const positionBefore = await farCardPosition(page)

  await page.mouse.down()
  await page.mouse.move(centre.x + 60, centre.y + 30, { steps: 8 })
  await page.mouse.up()

  // 60 screen px at zoom 0.06 ≈ 1000 board units (minus the 5px threshold).
  await expect.poll(() => farCardPosition(page)).not.toEqual(positionBefore)
  const positionAfter = await farCardPosition(page)
  expect(positionAfter.x - positionBefore.x).toBeGreaterThan(500)
  expect(positionAfter.y - positionBefore.y).toBeGreaterThan(250)

  // Participant set ≤ 1 at rest (pointer still on the moved card), no
  // exclusions, and the store knows exactly one gesture happened.
  expect(await page.locator('.react-flow__node').count()).toBeLessThanOrEqual(1)
  expect(
    await page.evaluate(() => document.querySelector<HTMLElement>('.board-flow')?.dataset.excludedParticipantCount),
  ).toBe('0')
})

test('fast flick-then-press lands the proxy: reliability measured', async ({ page }) => {
  await seedMapBoard(page)
  const centre = await paneCentrePoint(page, FAR_CARD)
  const trials = 12
  let successes = 0

  for (let trial = 0; trial < trials; trial += 1) {
    // Park far away and let the linger fully drain so every trial starts cold.
    // Park in genuinely empty pane space: every seeded card is > 100 screen px
    // away here, so no proximity lead can hold a proxy mounted.
    await page.mouse.move(200, 700)
    await page.waitForTimeout(400)
    expect(await page.locator('.react-flow__node').count()).toBe(0)

    const before = await farCardPosition(page)

    // The flick: two fast hops into the card, then an immediate press-drag.
    await page.mouse.move(centre.x, centre.y, { steps: 2 })
    await page.mouse.down()
    await page.mouse.move(centre.x + 12, centre.y + 8, { steps: 2 })
    await page.mouse.up()
    await page.waitForTimeout(80)

    const after = await farCardPosition(page)
    const moved = after.x !== before.x || after.y !== before.y
    if (moved) {
      successes += 1
      // Restore the seed position so every trial aims at the same point.
      await page.evaluate((position) => {
        const devWindow = window as unknown as { __eido: EidoDevStore }
        const state = devWindow.__eido.getState() as unknown as {
          moveCard: (id: string, position: { x: number; y: number }, options?: unknown) => void
        }
        state.moveCard('far-card', position, { recordHistory: false })
      }, FAR_CARD)
      await page.waitForTimeout(80)
    }
  }

  console.log(`[C2 gate] flick-then-press reliability: ${successes}/${trials}`)
  expect(successes).toBeGreaterThanOrEqual(Math.ceil(trials * 0.9))
})

test('pointer-storm hot-path gate: an unchanged target rebuilds nothing; draws stay rAF-coalesced', async ({
  page,
}) => {
  await seedMapBoard(page)
  const centre = await paneCentrePoint(page, FAR_CARD)

  // Lock the target once.
  await page.mouse.move(centre.x - 60, centre.y - 20)
  await page.mouse.move(centre.x, centre.y)
  await page.locator('.react-flow__node[data-id="far-card"]').waitFor({ state: 'attached', timeout: 10_000 })
  await expect.poll(() => hoveredCardId(page)).toBe('far-card')
  await page.waitForTimeout(400)
  // One warm draw after the lock so the transition frame's own label raster
  // work (the hovered variant's first paint) is not misread as storm work.
  await page.evaluate(() => (window as unknown as DevWindow).__EIDO_FORCE_OVERVIEW_DRAW__?.())
  await page.waitForTimeout(100)

  // Arm counters AFTER the lock: scene counters reset, store notifications
  // counted from here, node/draw/label/mount-plan baselines snapshotted.
  const before = await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    devWindow.__EIDO_PERF__!.resetBoardScenePerfCounters()
    devWindow.__EIDO_STORE_NOTIFY_COUNT__ = 0
    devWindow.__eido.subscribe(() => {
      devWindow.__EIDO_STORE_NOTIFY_COUNT__! += 1
    })
    const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')!
    return {
      nodes: document.querySelectorAll('.react-flow__node').length,
      draws: Number(layer.dataset.overviewDrawCount ?? 0),
      cacheEntries: Number(layer.dataset.cacheEntries ?? 0),
      boardChangeSeq: devWindow.__eido.getState().boardChangeSeq,
      mountPlanDerivations: devWindow.__EIDO_MOUNT_PLAN_DERIVATIONS__ ?? 0,
    }
  })

  // The storm: 60 frames × 4 pointermove events per frame = 240 events, all
  // inside the locked card's body (±2px jitter), dispatched on the board
  // wrapper the hover tracker listens on. Each frame ALSO samples the layer
  // counters, so label-cache misses are accumulated across every draw that
  // happens DURING the storm — the post-storm dataset read alone only shows
  // the last frame's misses.
  const storm = await page.evaluate(
    ({ x, y }) =>
      new Promise<{ frames: number; events: number; labelCacheMisses: number }>((resolve) => {
        const wrap = document.querySelector<HTMLElement>('.board-flow')!
        const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')!
        let frames = 0
        let events = 0
        let labelCacheMisses = 0
        let lastDraws = Number(layer.dataset.overviewDrawCount ?? 0)
        const sampleFrame = () => {
          // dataset.labelCacheMissesPerFrame is rewritten on each draw; sum
          // it whenever a draw landed since the previous frame sample.
          const draws = Number(layer.dataset.overviewDrawCount ?? 0)
          if (draws !== lastDraws) {
            lastDraws = draws
            labelCacheMisses += Number(layer.dataset.labelCacheMissesPerFrame ?? 0)
          }
        }
        const step = () => {
          frames += 1
          for (let burst = 0; burst < 4; burst += 1) {
            events += 1
            wrap.dispatchEvent(
              new PointerEvent('pointermove', {
                clientX: x + ((events % 5) - 2),
                clientY: y + ((events % 3) - 1),
                bubbles: true,
              }),
            )
          }
          sampleFrame()
          if (frames < 60) requestAnimationFrame(step)
          else {
            // One trailing frame so a draw scheduled by the storm's last
            // events is still sampled.
            requestAnimationFrame(() => {
              sampleFrame()
              resolve({ frames, events, labelCacheMisses })
            })
          }
        }
        requestAnimationFrame(step)
      }),
    centre,
  )

  const after = await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')!
    return {
      scene: devWindow.__EIDO_PERF__!.boardScenePerfCounters(),
      nodes: document.querySelectorAll('.react-flow__node').length,
      draws: Number(layer.dataset.overviewDrawCount ?? 0),
      cacheEntries: Number(layer.dataset.cacheEntries ?? 0),
      labelCacheMissesPerFrame: Number(layer.dataset.labelCacheMissesPerFrame ?? 0),
      boardChangeSeq: devWindow.__eido.getState().boardChangeSeq,
      storeNotifications: devWindow.__EIDO_STORE_NOTIFY_COUNT__ ?? 0,
      mountPlanDerivations: devWindow.__EIDO_MOUNT_PLAN_DERIVATIONS__ ?? 0,
      excluded: document.querySelector<HTMLElement>('.board-flow')?.dataset.excludedParticipantCount,
      hovered: document.querySelector<HTMLElement>('.board-flow')?.dataset.hoveredCardId ?? null,
    }
  })

  const drawDelta = after.draws - before.draws
  const mountPlanDelta = after.mountPlanDerivations - before.mountPlanDerivations
  console.log(
    `[C2 gate] pointer storm: events=${storm.events} frames=${storm.frames} ` +
      `sceneDerivations=${after.scene.sceneDerivations} cardMetricDerivations=${after.scene.cardMetricDerivations} ` +
      `cardMetricVisits=${after.scene.cardMetricVisits} mountPlanDerivations=${mountPlanDelta} ` +
      `nodes=${before.nodes}->${after.nodes} ` +
      `storeMutations=${after.storeNotifications} boardChangeSeqDelta=${after.boardChangeSeq - before.boardChangeSeq} ` +
      `stormLabelCacheMisses=${storm.labelCacheMisses} lastFrameLabelCacheMisses=${after.labelCacheMissesPerFrame} ` +
      `cacheEntriesDelta=${after.cacheEntries - before.cacheEntries} ` +
      `drawDelta=${drawDelta} drawsPerFrame=${(drawDelta / storm.frames).toFixed(3)}`,
  )

  expect(storm.events).toBeGreaterThanOrEqual(200)
  // After the first target lock, a same-identity pointer storm rebuilds
  // NOTHING:
  expect(after.scene.sceneDerivations).toBe(0)
  expect(after.scene.cardMetricDerivations).toBe(0)
  expect(after.scene.cardMetricVisits).toBe(0)
  // The seam-level identity-stability proof: zero mount-plan recomputations
  // across the storm. A fresh participant Set per pointermove would rebuild
  // the plan (and the nodes array) ~once per event while leaving the
  // mounted-node COUNT unchanged — the count assertion below cannot catch
  // it, this delta does.
  expect(mountPlanDelta).toBe(0)
  expect(after.nodes).toBe(before.nodes)
  expect(after.storeNotifications).toBe(0)
  expect(after.boardChangeSeq).toBe(before.boardChangeSeq)
  // Cumulative across the storm (sampled every frame), not just the last
  // frame's dataset value: zero label-cache misses in ANY frame drawn during
  // the storm, and the entry count is unchanged — no eviction/replacement
  // churn hiding behind a stable size.
  expect(storm.labelCacheMisses).toBe(0)
  expect(after.labelCacheMissesPerFrame).toBe(0)
  expect(after.cacheEntries).toBe(before.cacheEntries)
  expect(after.excluded).toBe('0')
  // The affordance stays locked and responsive throughout.
  expect(after.hovered).toBe('far-card')
  // The B4 escape-hatch verdict: draws never track event count — at most one
  // per animation frame (rAF-coalesced).
  expect(drawDelta).toBeLessThanOrEqual(storm.frames)

  // Responsive after the storm: a real transition still retargets.
  await page.mouse.move(centre.x - 300, centre.y - 200)
  await expect.poll(() => hoveredCardId(page)).toBe(null)
})

test('proxy representation gate: the hovered card keeps its Map representation while the proxy is mounted', async ({
  page,
}) => {
  await seedMapBoard(page)
  const centre = await paneCentrePoint(page, FAR_CARD)

  const forceDrawAndCount = () =>
    page.evaluate(() => {
      const devWindow = window as unknown as DevWindow
      devWindow.__EIDO_FORCE_OVERVIEW_DRAW__?.()
      const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')!
      return {
        mounted: document.querySelectorAll('.react-flow__node').length,
        overviewRendered: Number(layer.dataset.renderedCardCount ?? 0),
        representationCount: Number(layer.dataset.representationCount ?? 0),
        silhouetteCardCount: Number(layer.dataset.silhouetteCardCount ?? 0),
        suppressedReactCardCount: Number(layer.dataset.suppressedReactCardCount ?? 0),
        farCardPainted: Boolean(devWindow.__EIDO_OVERVIEW_CARD_IDS__?.has('far-card')),
      }
    })

  const before = await forceDrawAndCount()
  expect(before.mounted).toBe(0)
  expect(before.farCardPainted).toBe(true)

  await page.mouse.move(centre.x - 60, centre.y - 20)
  await page.mouse.move(centre.x, centre.y)
  await page.locator('.react-flow__node[data-id="far-card"]').waitFor({ state: 'attached', timeout: 10_000 })
  const during = await forceDrawAndCount()

  // Park in genuinely empty pane space (no card within the lead radius).
  await page.mouse.move(200, 700)
  await expect.poll(() => page.locator('.react-flow__node').count(), { timeout: 5_000 }).toBe(0)
  const after = await forceDrawAndCount()

  console.log(
    `[C2 gate] proxy representation: mounted ${before.mounted}->${during.mounted}->${after.mounted} ` +
      `overviewRendered ${before.overviewRendered}->${during.overviewRendered}->${after.overviewRendered} ` +
      `representation ${before.representationCount}->${during.representationCount}->${after.representationCount} ` +
      `silhouettes ${before.silhouetteCardCount}->${during.silhouetteCardCount}->${after.silhouetteCardCount} ` +
      `suppressed ${before.suppressedReactCardCount}->${during.suppressedReactCardCount}->${after.suppressedReactCardCount}`,
  )

  // While the proxy is mounted the card stays in canvas representation
  // accounting with its normal Map shape and label eligibility: same
  // rendered/representation counts as before the mount, zero silhouettes,
  // zero suppression — and it is still painted by id.
  expect(during.mounted).toBe(1)
  expect(during.farCardPainted).toBe(true)
  expect(during.overviewRendered).toBe(before.overviewRendered)
  expect(during.representationCount).toBe(before.representationCount)
  expect(during.silhouetteCardCount).toBe(0)
  expect(during.suppressedReactCardCount).toBe(0)

  // Unmount restores the identical accounting — nothing missing, nothing
  // doubled.
  expect(after.mounted).toBe(0)
  expect(after.farCardPainted).toBe(true)
  expect(after.overviewRendered).toBe(before.overviewRendered)
  expect(after.representationCount).toBe(before.representationCount)
})
