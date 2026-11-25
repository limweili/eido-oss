import { expect, test, type Page } from '@playwright/test'
import { READING_BAND_MIN_ZOOM } from './boardScene'

// C4 (#321): below Reading a painted card has no editable DOM, so the pointer
// gestures land on the invisible proximity-lead PROXY node, never a full mount:
//   - double-click a painted card → fly the camera in to Reading centred on it
//     (reusing the deep-link fly-to shape; lands AT or above 0.325) — centred on
//     the card's PAINTED footprint (renderedCardSize), so non-note kinds like
//     the 360×360 group land centred too
//   - single click → store selection only (painted ring, ZERO full cards mounted)
//   - press < ~4px → a click (select), the card does not move
//   - press past ~4px → a drag (the card moves), and the release does NOT change
//     the selection — an UNSELECTED card stays unselected, a selected one stays
//     selected (selectNodesOnDrag is off below Reading)
// Proxy nodes are INVISIBLE — every wait on them is `state: 'attached'`, never
// `visible` (C1's lesson).

const MAP_ZOOM = 0.06
const NOTE_SIZE = { width: 260, height: 180 }
// A group card's PAINTED default is 360×360 (renderPlanning's renderedCardSize)
// — deliberately not note-shaped, so a note-shaped centring guess in the fly-to
// would land it visibly off-centre (50/90 board units ≈ 35/63 screen px at 0.7).
const GROUP_SIZE = { width: 360, height: 360 }
// The subjects sit far from the viewport centre at Map zoom (note screen ≈
// (1148, 575), group ≈ (911, 161) in the 1280×800 pane), so their proxies only
// ever mount under the pointer.
const SUBJECT = { x: 19_000, y: 9_500 }
const GROUP_SUBJECT = { x: 15_000, y: 2_500 }

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    cards: Array<{ id: string; position: { x: number; y: number } }>
    selection: { kind: string; id: string } | null
    selectedCardIds: string[]
  }
  setState: (state: unknown) => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
  __EIDO_FORCE_OVERVIEW_DRAW__?: () => void
  __EIDO_PERF__?: unknown
}

async function seedMapBoard(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(
      devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__ && devWindow.__EIDO_PERF__,
    )
  })

  await page.evaluate(
    ({ subject, groupSubject }) => {
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
          note('subject', subject.x, subject.y),
          {
            id: 'group-subject',
            kind: 'group',
            title: 'Group subject',
            blocks: [],
            position: { x: groupSubject.x, y: groupSubject.y },
            zIndex: 1,
          },
          ...Array.from({ length: 40 }, (_, index) =>
            note(`filler-${index}`, 6_000 + (index % 8) * 700, 5_000 + Math.floor(index / 8) * 800),
          ),
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
    },
    { subject: SUBJECT, groupSubject: GROUP_SUBJECT },
  )

  // Pin the viewport twice around a settle window so the deferred fitView cannot
  // override it (mountPlanObservability's pattern).
  for (let pin = 0; pin < 2; pin += 1) {
    await page.evaluate((zoom) => {
      const devWindow = window as unknown as DevWindow
      devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom })
    }, MAP_ZOOM)
    await page.waitForTimeout(350)
  }
  await page.evaluate(() => (window as unknown as DevWindow).__EIDO_FORCE_OVERVIEW_DRAW__?.())
  await page.waitForFunction(() => {
    const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')
    return Number(layer?.dataset.renderedCardCount ?? 0) > 0
  })
}

type Subject = { position: { x: number; y: number }; size: { width: number; height: number } }

async function cardCentreOnScreen(page: Page, subject: Subject) {
  return page.evaluate(
    ({ position, size, zoom }) => {
      const pane = document.querySelector('.react-flow')?.getBoundingClientRect()
      if (!pane) throw new Error('Missing board pane')
      return {
        x: pane.left + (position.x + size.width / 2) * zoom,
        y: pane.top + (position.y + size.height / 2) * zoom,
      }
    },
    { position: subject.position, size: subject.size, zoom: MAP_ZOOM },
  )
}

// Move onto the card in two hops so a pre-contact move lands inside the lead
// radius, then wait for its invisible proxy to attach.
async function leadMountProxy(page: Page, cardId: string, centre: { x: number; y: number }) {
  await page.mouse.move(centre.x - 120, centre.y - 60)
  await page.mouse.move(centre.x - 30, centre.y - 12)
  await page.mouse.move(centre.x, centre.y)
  await page.locator(`.react-flow__node-gestureProxy[data-id="${cardId}"]`).waitFor({
    state: 'attached',
    timeout: 10_000,
  })
}

function subjectPosition(page: Page) {
  return page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    return devWindow.__eido.getState().cards.find((card) => card.id === 'subject')!.position
  })
}

function selectionState(page: Page) {
  return page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    const state = devWindow.__eido.getState()
    return {
      selectionId: state.selection?.kind === 'card' ? state.selection.id : null,
      selectedCardIds: state.selectedCardIds,
    }
  })
}

// The full-detail card mounts, excluding the invisible interaction proxies (a
// selected card below Reading paints, never promotes — ADR 0020).
function fullDetailNodes(page: Page) {
  return page.evaluate(
    () => document.querySelectorAll('.react-flow__node:not(.react-flow__node-gestureProxy)').length,
  )
}

// zoom + card-centre screen position derived from the live viewport transform.
function viewportReading(page: Page, subject: Subject) {
  return page.evaluate(
    ({ position, size }) => {
      const pane = document.querySelector('.react-flow')?.getBoundingClientRect()
      const viewportElement = document.querySelector<HTMLElement>('.react-flow__viewport')
      const transform = viewportElement ? getComputedStyle(viewportElement).transform : 'none'
      const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null
      if (!pane || !matrix) return null
      const zoom = matrix.a
      // Viewport transform is translate(e,f) scale(a): worldX*a + e = pane-x.
      const cardScreenX = (position.x + size.width / 2) * zoom + matrix.e
      const cardScreenY = (position.y + size.height / 2) * zoom + matrix.f
      return {
        zoom,
        offsetFromCentreX: cardScreenX - pane.width / 2,
        offsetFromCentreY: cardScreenY - pane.height / 2,
      }
    },
    { position: subject.position, size: subject.size },
  )
}

async function expectFlewToReadingCentredOn(page: Page, subject: Subject) {
  // The fly-to animation settles at or above Reading, centred on the card.
  await expect
    .poll(async () => (await viewportReading(page, subject))?.zoom ?? 0, { timeout: 5_000 })
    .toBeGreaterThanOrEqual(READING_BAND_MIN_ZOOM - 1e-3)

  const reading = await viewportReading(page, subject)
  expect(reading).not.toBeNull()
  expect(reading!.zoom).toBeGreaterThanOrEqual(READING_BAND_MIN_ZOOM - 1e-3)
  // Centred on the card's painted footprint: its centre lands on the pane
  // centre (a few px of animation/rounding slack).
  expect(Math.abs(reading!.offsetFromCentreX)).toBeLessThan(6)
  expect(Math.abs(reading!.offsetFromCentreY)).toBeLessThan(6)
}

test('double-click a painted card at Map zoom flies the viewport to Reading centred on the card', async ({
  page,
}) => {
  await seedMapBoard(page)
  const subject: Subject = { position: SUBJECT, size: NOTE_SIZE }
  const centre = await cardCentreOnScreen(page, subject)

  // Below Reading nothing full mounts at rest; the proxy lead-mounts on contact.
  expect(await fullDetailNodes(page)).toBe(0)
  await leadMountProxy(page, 'subject', centre)

  await page.mouse.dblclick(centre.x, centre.y)

  await expectFlewToReadingCentredOn(page, subject)
})

test('double-click a painted GROUP card centres its 360×360 painted footprint, not a note-shaped guess', async ({
  page,
}) => {
  await seedMapBoard(page)
  const subject: Subject = { position: GROUP_SUBJECT, size: GROUP_SIZE }
  const centre = await cardCentreOnScreen(page, subject)

  await leadMountProxy(page, 'group-subject', centre)
  await page.mouse.dblclick(centre.x, centre.y)

  await expectFlewToReadingCentredOn(page, subject)
})

test('single click selects the painted card without mounting a full card, and does not move it', async ({
  page,
}) => {
  await seedMapBoard(page)
  const centre = await cardCentreOnScreen(page, { position: SUBJECT, size: NOTE_SIZE })
  await leadMountProxy(page, 'subject', centre)

  const positionBefore = await subjectPosition(page)

  // A REAL sub-threshold press: 3px of travel (under the ~4px threshold) is
  // still a click. A broken threshold (every press a drag) turns this into a
  // 50-board-unit move and no selection — both assertions below go red.
  await page.mouse.move(centre.x, centre.y)
  await page.mouse.down()
  await page.mouse.move(centre.x + 3, centre.y, { steps: 3 })
  await page.mouse.up()

  await expect.poll(() => selectionState(page).then((s) => s.selectionId)).toBe('subject')
  const selection = await selectionState(page)
  expect(selection.selectedCardIds).toEqual(['subject'])
  // The painted ring, never a full mount (ADR 0020).
  expect(await fullDetailNodes(page)).toBe(0)
  // A sub-threshold press selects but does not move the card.
  expect(await subjectPosition(page)).toEqual(positionBefore)
})

test('a past-threshold drag moves the card and does not change the selection on release', async ({
  page,
}) => {
  await seedMapBoard(page)
  const centre = await cardCentreOnScreen(page, { position: SUBJECT, size: NOTE_SIZE })
  await leadMountProxy(page, 'subject', centre)

  // Phase 1 — the card is UNSELECTED: a past-threshold drag must move it and
  // leave it unselected on release (React Flow's default selectNodesOnDrag
  // would select it the moment the threshold crosses; it is off below Reading).
  expect((await selectionState(page)).selectionId).toBe(null)
  const positionBefore = await subjectPosition(page)

  await page.mouse.move(centre.x, centre.y)
  await page.mouse.down()
  await page.mouse.move(centre.x + 60, centre.y + 30, { steps: 8 })
  await page.mouse.up()

  // 60 screen px at zoom 0.06 ≈ 1000 board units (minus the threshold): moved.
  await expect.poll(() => subjectPosition(page)).not.toEqual(positionBefore)
  const movedPosition = await subjectPosition(page)
  expect(movedPosition.x - positionBefore.x).toBeGreaterThan(500)
  expect(movedPosition.y - positionBefore.y).toBeGreaterThan(250)

  // The drag did NOT select the card.
  await page.waitForTimeout(200)
  const afterUnselectedDrag = await selectionState(page)
  expect(afterUnselectedDrag.selectionId).toBe(null)
  expect(afterUnselectedDrag.selectedCardIds).toEqual([])

  // Phase 2 — the card IS selected: the drag release must not clear it either.
  // Park away so this click cannot merge with the drag's own mouseup into a
  // double-click, recompute the moved card's REAL screen centre from the
  // store, and re-approach so its proxy lead-mounts fresh.
  await page.mouse.move(centre.x - 200, centre.y - 120)
  await page.waitForTimeout(400)
  const movedCentre = await cardCentreOnScreen(page, { position: movedPosition, size: NOTE_SIZE })
  await leadMountProxy(page, 'subject', movedCentre)
  await page.mouse.click(movedCentre.x, movedCentre.y)
  await expect.poll(() => selectionState(page).then((s) => s.selectionId)).toBe('subject')

  await page.mouse.move(movedCentre.x, movedCentre.y)
  await page.mouse.down()
  await page.mouse.move(movedCentre.x - 40, movedCentre.y + 20, { steps: 8 })
  await page.mouse.up()

  await expect.poll(() => subjectPosition(page)).not.toEqual(movedPosition)
  // Selection mirrors through a Board effect after release, so poll the
  // selection VALUE itself, then outlast a potential late clear before the
  // final read.
  await expect.poll(() => selectionState(page).then((s) => s.selectionId)).toBe('subject')
  await page.waitForTimeout(250)
  const afterSelectedDrag = await selectionState(page)
  expect(afterSelectedDrag.selectionId).toBe('subject')
  expect(afterSelectedDrag.selectedCardIds).toEqual(['subject'])
  // A drag still does not promote a full mount below Reading.
  expect(await fullDetailNodes(page)).toBe(0)
})

test('a band promotion mid-press cannot make the drag select the card (policy latched at pointer-down)', async ({
  page,
}) => {
  await seedMapBoard(page)

  // Begin on the painted Map representation, then promote the viewport past
  // the Reading crossfade while the pointer remains down. Reading mounts are
  // now driven by zoom-pure crossfade opacity, so navigation settle can no
  // longer be used to hold a Reading-capable zoom in the painted state.
  const centre = await cardCentreOnScreen(page, { position: SUBJECT, size: NOTE_SIZE })
  await leadMountProxy(page, 'subject', centre)
  await page.mouse.down()

  // Precondition: the press really started below Reading (the painted port
  // zone only exists below Reading).
  expect(
    await page.evaluate(() => document.querySelector<HTMLElement>('.board-flow')?.dataset.canvasPortZone),
  ).toBe('painted')
  expect((await selectionState(page)).selectionId).toBe(null)

  // Promote around the pressed card so it remains under the pointer while
  // the full Reading node mounts mid-press.
  const PROMOTED_ZOOM = 0.4
  const pane = await page.evaluate(() => {
    const rect = document.querySelector('.react-flow')!.getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  })
  await page.evaluate(
    ({ subject, zoom, size, pane: paneRect, pointer }) => {
      const devWindow = window as unknown as DevWindow
      devWindow.__EIDO_SET_VIEWPORT__?.({
        x: pointer.x - paneRect.left - (subject.x + size.width / 2) * zoom,
        y: pointer.y - paneRect.top - (subject.y + size.height / 2) * zoom,
        zoom,
      })
    },
    { subject: SUBJECT, zoom: PROMOTED_ZOOM, size: NOTE_SIZE, pane, pointer: centre },
  )
  await expect.poll(() => fullDetailNodes(page), { timeout: 5_000 }).toBeGreaterThan(0)

  // Only now cross the drag threshold and release. The policy latched at
  // pointer-down (below Reading: drags never select) must still govern —
  // React Flow reads the setting at threshold-cross, after the promotion.
  await page.mouse.move(centre.x + 40, centre.y + 20, { steps: 8 })
  await page.mouse.up()

  await page.waitForTimeout(250)
  const selection = await selectionState(page)
  expect(selection.selectionId).toBe(null)
  expect(selection.selectedCardIds).toEqual([])
})
