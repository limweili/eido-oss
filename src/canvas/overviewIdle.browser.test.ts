import { expect, test } from '@playwright/test'

// #145: an idle board must do zero overview redraws and zero forced-layout
// reads per frame. The layer stamps counters on its canvas; we sample them
// over an idle second, then prove navigation still redraws.
test('idle board does no overview redraws or layout reads; pan still redraws', async ({ page }) => {
  await page.goto('/')
  const layer = page.locator('[data-board-overview-layer]')
  await layer.waitFor({ state: 'attached' })

  // Let mount effects, fitView, and settle timers finish.
  await page.waitForTimeout(1200)

  const before = await layer.evaluate((el) => ({
    draws: Number((el as HTMLElement).dataset.overviewDrawCount ?? 0),
    reads: Number((el as HTMLElement).dataset.overviewLayoutReadCount ?? 0),
  }))
  await page.waitForTimeout(1000)
  const afterIdle = await layer.evaluate((el) => ({
    draws: Number((el as HTMLElement).dataset.overviewDrawCount ?? 0),
    reads: Number((el as HTMLElement).dataset.overviewLayoutReadCount ?? 0),
  }))

  // Idle second: nothing drawn, no layout reads — not even cheap ones.
  expect(afterIdle.draws - before.draws).toBe(0)
  expect(afterIdle.reads - before.reads).toBe(0)

  // Navigation marks the layer dirty again: pan via wheel and expect redraws.
  await page.mouse.move(640, 400)
  await page.mouse.wheel(0, 300)
  await page.waitForTimeout(300)
  const afterPan = await layer.evaluate((el) => ({
    draws: Number((el as HTMLElement).dataset.overviewDrawCount ?? 0),
  }))
  expect(afterPan.draws).toBeGreaterThan(afterIdle.draws)
})
