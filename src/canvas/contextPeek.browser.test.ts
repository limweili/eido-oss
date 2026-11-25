import { expect, test, type Page } from '@playwright/test'

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    settings: Record<string, unknown>
  }
  setState: (state: unknown) => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

async function seedPreviewBoard(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    const card = (
      id: string,
      kind: string,
      x: number,
      y: number,
      text: string,
      extra: Record<string, unknown> = {},
    ) => ({
      id,
      kind,
      blocks: [{ id: `${id}-block`, text }],
      position: { x, y },
      ...extra,
    })
    const connection = (id: string, from: string, to: string, extra: Record<string, unknown> = {}) => ({
      id,
      from: { cardId: from },
      to: { cardId: to },
      strength: 'strong',
      polarity: 'helps',
      role: 'feeds',
      ...extra,
    })

    const current = devWindow.__eido.getState()
    devWindow.__eido.setState({
      settings: { ...current.settings, compactionMode: 'eager' },
      cards: [
        card(
          'direct-note',
          'note',
          0,
          0,
          'Lead with the **workflow pain**.\n\n- Parent point\n  - Nested point',
          { title: 'Primary note' },
        ),
        card('light-note', 'note', 0, 240, 'Keep the tone exploratory.', { title: 'Ambient note' }),
        card('upstream-note', 'note', -340, 240, 'Earlier interviews mentioned setup cost.', {
          title: 'Interview thread',
        }),
        card('avoid-note', 'note', 0, 480, 'Do not pitch it as generic productivity.', {
          title: 'Rejected path',
        }),
        card('taste-mod', 'mod', 360, 500, '', {
          title: 'Taste dials',
          modV2: {
            kind: 'switch',
            title: 'Taste dials',
            accent: '#777777',
            state: {
              items: [
                { id: 'sources', label: 'Cite sources', on: true, frame: 'Cite sources for every claim.' },
                { id: 'jargon', label: 'Jargon', on: false, frame: 'Use expert jargon.' },
              ],
            },
            treatOverride: null,
          },
        }),
        card('ask-preview', 'askAi', 620, 220, 'Find a **better** launch angle.'),
      ],
      connections: [
        connection('conn-direct', 'direct-note', 'ask-preview', { meta: { contextOrder: 0 } }),
        connection('conn-light', 'light-note', 'ask-preview', {
          strength: 'weak',
          meta: { contextOrder: 1 },
        }),
        connection('conn-upstream', 'upstream-note', 'light-note'),
        connection('conn-avoid', 'avoid-note', 'ask-preview', {
          polarity: 'pushesAgainst',
          reason: 'tried already',
          meta: { contextOrder: 2 },
        }),
        connection('conn-mod', 'taste-mod', 'ask-preview', {
          role: 'modifies',
          meta: { contextOrder: 3 },
        }),
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

  // Overview intentionally has no rich Card nodes. Enter Reading before
  // waiting for the Ask's DOM, regardless of the restored viewport.
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 160, y: 120, zoom: 0.85 })
  })
  await page.locator('.react-flow__node[data-id="ask-preview"]').waitFor()
}

test('opening Context shows the Ask preview entries with relation, hop, connection, budget status, and Mods', async ({
  page,
}) => {
  await seedPreviewBoard(page)

  await page
    .locator('.react-flow__node[data-id="ask-preview"]')
    .getByRole('button', { name: 'Context' })
    .click()

  const modal = page.getByRole('dialog', { name: 'Context' })
  await expect(modal).toBeVisible()
  await expect(modal.locator('.context-surface__task strong')).toHaveText('better')

  const direct = modal
    .getByRole('region', { name: 'Build on' })
    .getByRole('group')
    .filter({ has: page.locator('summary').getByText('Primary note', { exact: true }) })
  await expect(direct).not.toContainText('Full')
  await direct.locator('summary').click()
  await expect(direct.locator('.e-context-row__body')).toHaveCSS('padding-top', '8px')
  await expect(modal.getByText('DIRECT · HOP 1')).toBeVisible()
  await expect(modal.getByText('Connection From Primary note')).toBeVisible()
  await expect(direct.locator('.e-context-row__snippet strong').filter({ hasText: 'workflow pain' })).toHaveText(
    'workflow pain',
  )
  await expect(direct.locator('.e-context-row__snippet ul ul li')).toHaveText('Nested point')

  const influences = modal.getByRole('region', { name: 'Influences' })
  const light = influences
    .getByRole('group')
    .filter({ has: page.locator('summary').getByText('Ambient note', { exact: true }) })
  await expect(light).toContainText('Shortened')
  await light.locator('summary').click()
  await expect(modal.getByText('LIGHT · HOP 1')).toBeVisible()
  await expect(modal.getByText('Connection From Ambient note')).toBeVisible()
  await expect(light.getByText(/needs shortening/)).toBeVisible()

  const upstream = influences
    .getByRole('group')
    .filter({ has: page.locator('summary').getByText('Interview thread', { exact: true }) })
  await upstream.locator('summary').click()
  await expect(modal.getByText('LIGHT · HOP 2')).toBeVisible()
  await expect(modal.getByText('Connection From Interview thread via Ambient note')).toBeVisible()

  const avoid = modal
    .getByRole('region', { name: 'Already explored, do not retread' })
    .getByRole('group')
  await avoid.locator('summary').click()
  await expect(modal.getByText('AVOID · HOP 1')).toBeVisible()
  await expect(modal.getByText('Connection From Rejected path')).toBeVisible()
  await expect(modal.getByText('Reason this path died: tried already')).toBeVisible()

  const modTrigger = modal.getByRole('button', { name: /Taste dials/ })
  await expect(modTrigger).toHaveAttribute('aria-expanded', 'false')
  const modBodyId = await modTrigger.getAttribute('aria-controls')
  expect(modBodyId).not.toBeNull()
  await modTrigger.click()
  await expect(modTrigger).toHaveAttribute('aria-expanded', 'true')
  const modBody = modal.locator(`[id="${modBodyId}"]`)
  const modProjection = modBody.locator('.context-surface__mod-projection')
  await expect(modProjection.getByRole('heading', { level: 3 })).toHaveText('Taste dials')
  await expect(modProjection.locator('li')).toHaveText([
    'Cite sources for every claim.',
    'jargon is off, says nothing.',
  ])
  await expect(modBody.locator('pre')).toHaveCount(0)
  await expect(modBody.getByText('Connection From Taste dials')).toBeVisible()
  await expect(modal.getByText(/conn-/)).toHaveCount(0)

  await modal.getByRole('button', { name: 'Show text' }).click()
  const rawText = modal.locator('.context-surface__raw-text')
  await expect(rawText).toContainText('Find a **better** launch angle.')
  await expect(rawText.locator('strong')).toHaveCount(0)
  await expect(modal.locator('pre')).toHaveCount(1)
})

test('reordering context shows the held row moving with the drag', async ({ page }) => {
  await seedPreviewBoard(page)
  await page
    .locator('.react-flow__node[data-id="ask-preview"]')
    .getByRole('button', { name: 'Context' })
    .click()

  const modal = page.getByRole('dialog', { name: 'Context' })
  await expect(modal).toBeVisible()
  await expect.poll(() => modal.evaluate((element) =>
    element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length,
  )).toBe(0)
  const grip = modal.getByRole('button', { name: 'Drag to rearrange' }).first()
  const box = await grip.boundingBox()
  if (!box) throw new Error('Missing context drag grip')

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 80, box.y + 90, { steps: 8 })

  const overlay = page.locator('.context-drag-overlay')
  await expect(overlay).toBeVisible()
  const overlayBox = await overlay.boundingBox()
  expect(overlayBox?.x).toBeGreaterThan(box.x + 30)
  expect(overlayBox?.y).toBeGreaterThan(box.y + 30)

  await page.mouse.up()
  await expect(overlay).toHaveCount(0)
})

test('reordering context previews the surrounding row reflow before drop', async ({ page }) => {
  await seedPreviewBoard(page)
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    const current = devWindow.__eido.getState() as unknown as {
      cards: Array<Record<string, unknown>>
      connections: Array<Record<string, unknown> & {
        meta?: { contextOrder?: number }
      }>
    }
    devWindow.__eido.setState({
      cards: [
        ...current.cards,
        {
          id: 'secondary-note',
          kind: 'note',
          blocks: [{ id: 'secondary-note-block', text: 'Support it with a concrete example.' }],
          position: { x: 300, y: 0 },
          title: 'Secondary note',
        },
      ],
      connections: [
        ...current.connections.map((connection) => {
          const contextOrder = connection.meta?.contextOrder
          return typeof contextOrder === 'number' && contextOrder >= 1
            ? { ...connection, meta: { ...connection.meta, contextOrder: contextOrder + 1 } }
            : connection
        }),
        {
          id: 'conn-secondary',
          from: { cardId: 'secondary-note' },
          to: { cardId: 'ask-preview' },
          strength: 'strong',
          polarity: 'helps',
          role: 'feeds',
          meta: { contextOrder: 1 },
        },
      ],
    })
  })
  await page
    .locator('.react-flow__node[data-id="ask-preview"]')
    .getByRole('button', { name: 'Context' })
    .click()

  const modal = page.getByRole('dialog', { name: 'Context' })
  await expect(modal).toBeVisible()
  await expect.poll(() => modal.evaluate((element) =>
    element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length,
  )).toBe(0)

  const buildOn = modal.getByRole('region', { name: 'Build on' })
  const rows = buildOn.locator('.context-surface__row-slot')
  await expect(rows.locator('.e-context-row__title')).toHaveText([
    'Primary note',
    'Secondary note',
  ])

  const targetRow = rows.nth(0)
  const heldRow = rows.nth(1)
  const grip = heldRow.getByRole('button', { name: 'Drag to rearrange' })
  const gripBox = await grip.boundingBox()
  if (!gripBox) throw new Error('Missing context reorder rows')

  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(gripBox.x + gripBox.width / 2 + 32, gripBox.y + gripBox.height / 2, {
    steps: 4,
  })
  await expect(page.locator('.context-drag-overlay')).toBeVisible()
  const targetBox = await targetRow.locator('.e-context-row').boundingBox()
  if (!targetBox) throw new Error('Missing context reorder target')
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 4,
    { steps: 8 },
  )

  // Hovering a target is itself visible feedback: the prospective order is
  // already rendered and at least one surrounding row is still settling into
  // that order. Persistence remains a drop concern.
  await expect(rows.locator('.e-context-row__title')).toHaveText([
    'Secondary note',
    'Primary note',
  ])
  expect(await rows.evaluateAll((slots) => {
    const animation = slots
      .flatMap((slot) => slot.getAnimations())
      .find((candidate) => candidate.playState === 'running')
    return {
      running: Boolean(animation),
      easing: animation?.effect?.getTiming().easing,
      settleEasing: getComputedStyle(document.documentElement)
        .getPropertyValue('--e-ease-settle')
        .trim(),
    }
  })).toMatchObject({
    running: true,
    easing: 'cubic-bezier(0.2, 0.75, 0.25, 1.08)',
    settleEasing: 'cubic-bezier(.2,.75,.25,1.08)',
  })

  const modalBox = await modal.boundingBox()
  if (!modalBox) throw new Error('Missing Context dialog bounds')
  await page.mouse.move(modalBox.x - 40, modalBox.y - 40, { steps: 4 })
  await page.mouse.up()
  await expect(page.locator('.context-drag-overlay')).toHaveCount(0)
  await expect(rows.locator('.e-context-row__title')).toHaveText([
    'Primary note',
    'Secondary note',
  ])
})
