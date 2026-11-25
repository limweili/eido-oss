import { expect, test, type Page } from '@playwright/test'

type SearchStore = {
  getState: () => { hydrated: boolean }
  setState: (state: unknown) => void
}

type DevWindow = {
  __eido?: SearchStore
}

async function openSearchWithLongBody(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => Boolean((window as unknown as DevWindow).__eido?.getState().hydrated))
  await page.evaluate(() => {
    const store = (window as unknown as DevWindow).__eido
    if (!store) throw new Error('Missing Eido development store')
    store.setState({
      cards: [{
        id: 'search-long-note',
        kind: 'note',
        title: 'Long search result',
        blocks: [{
          id: 'search-long-note-body',
          text: `Visible body ${'unbroken'.repeat(80)}`,
        }],
        position: { x: 200, y: 120 },
      }],
      connections: [],
      outputs: [],
      runs: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
      visualDecayEnabled: false,
    })
  })
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const panel = page.getByRole('search', { name: 'Search' })
  await expect(panel).toBeVisible()
  return panel
}

test('Search results never expose a horizontal scrollbar', async ({ page }) => {
  const panel = await openSearchWithLongBody(page)
  const results = panel.getByRole('list', { name: 'Board search results' })
  const layout = await results.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      overflowX: style.overflowX,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }
  })

  expect(layout.overflowX).toBe('hidden')
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)
})

test('Search column expands horizontally from its left edge', async ({ page }) => {
  const panel = await openSearchWithLongBody(page)
  const separator = panel.getByRole('separator', { name: 'Resize Search panel' })
  await expect(separator).toBeVisible()

  const initialWidth = await panel.evaluate((element) => element.getBoundingClientRect().width)
  const separatorBox = await separator.boundingBox()
  if (!separatorBox) throw new Error('Missing Search resize separator')
  await page.mouse.move(separatorBox.x + separatorBox.width / 2, separatorBox.y + 120)
  await page.mouse.down()
  await page.mouse.move(separatorBox.x - 120, separatorBox.y + 120)
  await page.mouse.up()

  await expect.poll(() => panel.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(initialWidth + 100)
  await separator.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => panel.evaluate((element) => element.getBoundingClientRect().width))
    .toBeLessThan(initialWidth + 120)
})

test('Search resize bounds stay truthful near the sheet breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 800 })
  const panel = await openSearchWithLongBody(page)
  const separator = panel.getByRole('separator', { name: 'Resize Search panel' })

  await expect(separator).toHaveAttribute('aria-valuemax', '696')
  await separator.focus()
  await page.keyboard.press('End')
  await expect(separator).toHaveAttribute('aria-valuenow', '696')
  await expect.poll(() => panel.evaluate((element) => element.getBoundingClientRect().width))
    .toBe(696)
})

test('Search becomes a full-width sheet without a resize edge at 720px', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 800 })
  const panel = await openSearchWithLongBody(page)
  const separator = panel.getByRole('separator', { name: 'Resize Search panel' })

  await expect(separator).toBeHidden()
  await expect.poll(() => panel.evaluate((element) => element.getBoundingClientRect().width))
    .toBe(720)
})

test('AI-created filter jumps to the exact accented Card', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean((window as unknown as DevWindow).__eido?.getState().hydrated))
  await page.evaluate(() => {
    const store = (window as unknown as DevWindow).__eido
    if (!store) throw new Error('Missing Eido development store')
    const agent = { kind: 'agent', client: 'codex', sessionId: 'agent-session' }
    const user = { kind: 'user', client: 'eido-desktop', sessionId: 'user-session' }
    store.setState({
      cards: [
        {
          id: 'far-agent-card',
          kind: 'note',
          title: 'Far AI-created note',
          blocks: [{ id: 'far-agent-body', text: 'Agent work beyond the current residency window' }],
          position: { x: 100_000, y: 100_000 },
          createdBy: agent,
          lastModifiedBy: agent,
        },
        {
          id: 'near-user-card',
          kind: 'note',
          title: 'Nearby user-created note',
          blocks: [{ id: 'near-user-body', text: 'User work' }],
          position: { x: 200, y: 120 },
          createdBy: user,
          lastModifiedBy: user,
        },
        {
          id: 'legacy-card',
          kind: 'note',
          title: 'Legacy note',
          blocks: [{ id: 'legacy-body', text: 'Work saved before provenance existed' }],
          position: { x: 520, y: 120 },
        },
      ],
      connections: [],
      outputs: [],
      runs: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
      visualDecayEnabled: false,
    })
  })

  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const panel = page.getByRole('search', { name: 'Search' })
  await panel.getByRole('radio', { name: 'AI-created' }).click()

  await expect(panel.getByRole('button', { name: 'Far AI-created note' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Nearby user-created note' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Legacy note' })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Far AI-created note' }).focus()
  await page.keyboard.press('Enter')

  const focusedNode = page.locator('.react-flow__node[data-id="far-agent-card"]')
  await expect.poll(() => page.evaluate(() => {
    const active = document.activeElement
    return active instanceof HTMLElement
      ? active.closest('.react-flow__node[data-id]')?.getAttribute('data-id')
        ?? `${active.tagName.toLowerCase()}.${active.className}`
      : 'none'
  })).toBe('far-agent-card')
  const accentedCard = focusedNode.locator('.card.agent-unadopted')
  await expect(accentedCard).toBeVisible()
  const accent = await accentedCard.locator('.card-head').evaluate((element) => {
    const style = getComputedStyle(element)
    const tokenProbe = document.createElement('span')
    tokenProbe.style.color = 'var(--e-agent-unadopted-accent)'
    document.body.append(tokenProbe)
    const token = getComputedStyle(tokenProbe).color
    tokenProbe.remove()
    return {
      borderStyle: style.borderBottomStyle,
      borderColor: style.borderBottomColor,
      token,
    }
  })
  expect(accent.borderStyle).toBe('dashed')
  expect(accent.borderColor).toBe(accent.token)
})
