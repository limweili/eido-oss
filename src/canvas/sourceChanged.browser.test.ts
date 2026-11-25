import { expect, test } from '@playwright/test'

type DevWindow = Window & {
  __eido: {
    getState: () => { hydrated: boolean }
    setState: (state: unknown) => void
  }
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

test('Source changed closes outside and navigates to the changed Card', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    const now = '2026-08-23T00:00:00.000Z'
    devWindow.__eido.setState({
      cards: [
        {
          id: 'changed-source',
          kind: 'note',
          title: 'Live source',
          blocks: [{ id: 'source-body', text: 'The source changed after this answer.' }],
          position: { x: -720, y: 120 },
        },
        {
          id: 'result-with-change',
          kind: 'result',
          blocks: [{ id: 'result-body', text: '' }],
          position: { x: 420, y: 100 },
          size: { width: 380, height: 320 },
        },
      ],
      connections: [],
      outputs: [{
        id: 'changed-output',
        resultCardId: 'result-with-change',
        chosenVersionId: 'changed-version',
        versions: [{
          id: 'changed-version',
          number: 1,
          text: 'An answer with frozen source context.',
          createdAt: now,
          sourceContext: {
            version: 1,
            sources: [
              {
                cardId: 'changed-source',
                kind: 'note',
                label: 'Original source',
                hash: 'stale-source-hash',
              },
              {
                cardId: 'deleted-source',
                kind: 'note',
                label: 'Deleted source',
                hash: 'deleted-source-hash',
              },
            ],
          },
        }],
      }],
      runs: [],
      intentLog: [],
      visualDecayEnabled: false,
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 100, y: 40, zoom: 1 })
  })

  const result = page.locator('.react-flow__node[data-id="result-with-change"]')
  await result.locator('.card').click()
  const trigger = result.getByRole('button', { name: 'Source changed', exact: true })

  await trigger.click()
  const popover = page.getByRole('dialog', { name: 'Source changed' })
  await expect(popover).toBeVisible()
  await expect(page.getByText('Changed', { exact: true })).toHaveCount(0)
  await expect(
    popover
      .getByText('Deleted source')
      .locator('xpath=ancestor::button | ancestor::*[@role="menuitem"]'),
  ).toHaveCount(0)

  await page.mouse.click(10, 10)
  await expect(page.getByRole('dialog', { name: 'Source changed' })).toHaveCount(0)

  await trigger.click()
  const sourceRow = page.getByRole('dialog', { name: 'Source changed' })
    .getByRole('menuitem', { name: 'Live source', exact: true })
  await sourceRow.click()

  const source = page.locator('.react-flow__node[data-id="changed-source"]')
  await expect(source.locator('.card')).toHaveClass(/selected/)
  await expect(source).toBeFocused({ timeout: 5_000 })
  await expect.poll(() => source.evaluate((element) => {
    const node = element.getBoundingClientRect()
    const pane = document.querySelector<HTMLElement>('.react-flow__pane')?.getBoundingClientRect()
    if (!pane) throw new Error('Expected canvas pane')
    return Math.max(
      Math.abs((node.left + node.right) / 2 - (pane.left + pane.right) / 2),
      Math.abs((node.top + node.bottom) / 2 - (pane.top + pane.bottom) / 2),
    )
  }), { timeout: 5_000 }).toBeLessThan(3)
  await expect(page.getByRole('dialog', { name: 'Source changed' })).toHaveCount(0)

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 100, y: 40, zoom: 1 })
  })
  await result.locator('.card').click()
  await trigger.click()
  await page.getByRole('dialog', { name: 'Source changed' })
    .getByRole('button', { name: 'Dismiss', exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: 'Source changed' })).toHaveCount(0)
  await expect(trigger).toHaveCount(0)
  await expect(result).toBeFocused()
})
