import { expect, test, type Page } from '@playwright/test'

// Runtime observability of the mount plan's excluded participants (ADR 0020,
// PR #338 round 2): an exclusion — a participant past the gesture bound or an
// id the board can no longer resolve (a delete racing the gesture) — must be
// visible to a RUNTIME observer, not only to unit tests. Board exposes the
// count and ids on its wrapper dataset and injects participants through the
// dev seam `__EIDO_SET_GESTURE_PARTICIPANTS__`; C1/C2 inherit both for their
// gesture gates.

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    deleteCard: (cardId: string) => void
  }
  setState: (state: unknown) => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
  __EIDO_SET_GESTURE_PARTICIPANTS__?: (cardIds: readonly string[]) => void
}

async function seedBelowReadingBoard(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(
      devWindow.__eido?.getState().hydrated &&
        devWindow.__EIDO_SET_VIEWPORT__ &&
        devWindow.__EIDO_SET_GESTURE_PARTICIPANTS__,
    )
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    const note = (id: string, x: number, y: number) => ({
      id,
      kind: 'note',
      blocks: [{ id: `${id}-block`, text: id }],
      position: { x, y },
    })
    devWindow.__eido.setState({
      cards: [note('note-a', 0, 0), note('note-b', 400, 0), note('note-c', 0, 300), note('note-d', 400, 300)],
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
  })
  await page.waitForTimeout(300)
  // Below Reading (overview band): nothing mounts, so any mounted node in
  // this test is a gesture-participant proxy. Pin the viewport twice around
  // a settle window so the deferred fitView cannot override it.
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 200, y: 200, zoom: 0.25 })
  })
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 200, y: 200, zoom: 0.25 })
  })
  await page.waitForTimeout(300)
}

function excludedDataset(page: Page) {
  return page.evaluate(() => {
    const wrap = document.querySelector<HTMLElement>('.board-flow')
    return {
      count: wrap?.dataset.excludedParticipantCount ?? null,
      ids: wrap?.dataset.excludedParticipantIds ?? null,
    }
  })
}

test('excluded gesture participants are runtime-observable on the board dataset', async ({ page }) => {
  await seedBelowReadingBoard(page)

  // Baseline: no participants, no exclusions, no mounts below Reading.
  expect(await excludedDataset(page)).toEqual({ count: '0', ids: null })
  expect(await page.locator('.react-flow__node').count()).toBe(0)

  // An unresolvable id alongside a real participant: the real card mounts as
  // a proxy, the ghost is excluded LOUDLY on the dataset.
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_GESTURE_PARTICIPANTS__?.(['note-b', 'ghost'])
  })
  await page.locator('.react-flow__node[data-id="note-b"]').waitFor({ state: 'attached', timeout: 10_000 })
  await expect.poll(() => excludedDataset(page)).toEqual({ count: '1', ids: 'ghost' })

  // The delete race: the participant card is deleted mid-gesture. Its node
  // unmounts and its id joins the exclusion set instead of vanishing.
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    devWindow.__eido.getState().deleteCard('note-b')
  })
  await expect.poll(() => excludedDataset(page)).toEqual({ count: '2', ids: 'ghost note-b' })
  expect(await page.locator('.react-flow__node[data-id="note-b"]').count()).toBe(0)

  // Gesture ends: the plan returns to the scene's own mount set and the
  // dataset reads clean again.
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_GESTURE_PARTICIPANTS__?.([])
  })
  await expect.poll(() => excludedDataset(page)).toEqual({ count: '0', ids: null })
  expect(await page.locator('.react-flow__node').count()).toBe(0)
})
