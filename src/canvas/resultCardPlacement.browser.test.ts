import { expect, test } from '@playwright/test'

type CardState = {
  id: string
  kind: string
  position: { x: number; y: number }
}

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    settings: Record<string, unknown>
    cards: CardState[]
  }
  setState: (state: unknown) => void
}

type DevWindow = Window & {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

test('Run places a new Result to the right with three times the previous spacing', async ({ page }) => {
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"choices":[{"delta":{"content":"Placed safely."}}]}\n\ndata: [DONE]\n\n',
    })
  })

  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    const current = devWindow.__eido.getState()
    devWindow.__eido.setState({
      settings: {
        ...current.settings,
        apiKey: 'test-key',
        model: 'openai/gpt-4o-mini',
        models: ['openai/gpt-4o-mini'],
      },
      cards: [
        {
          id: 'ask-placement',
          kind: 'askAi',
          blocks: [{ id: 'ask-placement-block', text: 'Place this result safely.' }],
          position: { x: 900, y: 300 },
          size: { width: 260, height: 180 },
        },
        {
          id: 'occupied-below',
          kind: 'note',
          blocks: [{ id: 'occupied-below-block', text: 'This space is occupied.' }],
          position: { x: 900, y: 510 },
          size: { width: 260, height: 180 },
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
      visualDecayEnabled: false,
    })
  })

  const ask = page.locator('.react-flow__node[data-id="ask-placement"]')
  await expect(ask).toBeVisible()
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
  })
  await expect
    .poll(() => ask.evaluate((node) => Math.round(node.getBoundingClientRect().left)))
    .toBe(900)
  await ask.getByRole('button', { name: 'Run', exact: true }).click()

  await expect
    .poll(() =>
      page.evaluate(() => {
        const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
        return devWindow.__eido.getState().cards.find((card) => card.kind === 'result')?.position
      }),
    )
    .toEqual({ x: 1250, y: 300 })
})
