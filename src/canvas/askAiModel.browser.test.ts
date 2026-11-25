import { expect, test, type Page } from '@playwright/test'
import { activateAndRequireExactReadyMarkdownEditor } from '../performance/richCardEditorReadiness'

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    settings: Record<string, unknown>
    cards: Array<{ id: string; model?: string }>
    runs: Array<{ askAiCardId: string; model: string; status: string }>
    outputs: Array<{ resultCardId: string; versions: unknown[] }>
    addCard: (kind: 'askAi', position: { x: number; y: number }) => string
    setCardText: (id: string, text: string) => void
  }
  setState: (state: unknown) => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

async function seedAskCard(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    const current = devWindow.__eido.getState()
    const now = '2026-07-13T00:00:00.000Z'

    devWindow.__eido.setState({
      settings: {
        ...current.settings,
        apiKey: 'test-key',
        model: 'openai/gpt-4o-mini',
        models: ['openai/gpt-4o-mini', 'x-ai/grok-4.5'],
      },
      cards: [
        {
          id: 'ask-model',
          kind: 'askAi',
          blocks: [
            {
              id: 'ask-model-block',
              text: 'Write a short synthesis of this deliberately compact instruction.',
            },
          ],
          position: { x: 300, y: 80 },
          size: { width: 460, height: 600 },
        },
        {
          id: 'result-model',
          kind: 'result',
          blocks: [{ id: 'result-model-block', text: '' }],
          position: { x: 900, y: 80 },
        },
      ],
      connections: [
        {
          id: 'ask-model-result',
          from: { cardId: 'ask-model' },
          to: { cardId: 'result-model' },
          strength: 'strong',
          polarity: 'helps',
          role: 'feeds',
        },
      ],
      outputs: [
        {
          id: 'output-model',
          resultCardId: 'result-model',
          chosenVersionId: 'version-model-1',
          versions: [
            {
              id: 'version-model-1',
              number: 1,
              text: 'Existing answer from the original model.',
              createdAt: now,
              fromRunId: 'run-model-1',
            },
          ],
        },
      ],
      runs: [
        {
          id: 'run-model-1',
          startedAt: now,
          finishedAt: now,
          askAiCardId: 'ask-model',
          model: 'openai/gpt-4o-mini',
          usedCardIds: [],
          usedConnectionIds: [],
          modIds: [],
          appliedMods: [],
          compiledInstruction: 'Write a short synthesis of this deliberately compact instruction.',
          producedVersionId: 'version-model-1',
          status: 'done',
        },
      ],
      intentLog: [],
      visualDecayEnabled: false,
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
  })

  await page.waitForFunction(() => document.querySelector('[data-id="ask-model"]'))
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 120, y: 40, zoom: 1 })
  })

  return page.locator('.react-flow__node[data-id="ask-model"]')
}

async function modelFooterGap(node: ReturnType<Page['locator']>) {
  return node.locator('.card').evaluate((card) => {
    const model = card.querySelector<HTMLElement>('.model-pick')
    const footer = card.querySelector<HTMLElement>('.card-foot')
    if (!model || !footer) throw new Error('Missing Ask AI card controls')
    return Math.abs(footer.getBoundingClientRect().top - model.getBoundingClientRect().bottom)
  })
}

test('model picker stays pinned above the footer when the Ask AI card is selected or unselected', async ({ page }) => {
  const node = await seedAskCard(page)

  await expect(node.locator('.card')).not.toHaveClass(/selected/)
  expect(await modelFooterGap(node)).toBeLessThanOrEqual(16)

  await node.locator('.card-head').click()
  await expect(node.locator('.card')).toHaveClass(/selected/)
  expect(await modelFooterGap(node)).toBeLessThanOrEqual(16)
})

test('long editable Ask AI prose does not paint over the model picker', async ({ page }) => {
  const node = await seedAskCard(page)
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    const store = devWindow.__eido
    store.getState().setCardText(
      'ask-model',
      Array.from(
        { length: 24 },
        (_, index) => `Paragraph ${index + 1} keeps enough editable prose in the card to require scrolling.`,
      ).join('\n\n'),
    )
  })

  await node.locator('.card-head').click()
  await expect(node.locator('.card')).toHaveClass(/selected/)
  const { editor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node[data-id="ask-model"]',
    // The passive prompt is taller than its scroll viewport, so activate at a
    // visible point instead of Playwright's default centre, which lands below
    // the clipped Card body.
    () => node.locator('.note-render').click({ position: { x: 24, y: 24 } }),
  )
  await expect(editor).toBeEditable()
  await expect(node.locator('.markdown-card-editor-transition')).toHaveAttribute('data-editor-ready', 'true')

  const layout = await node.locator('.card').evaluate((card) => {
    const editorViewport = card.querySelector<HTMLElement>('.markdown-card-editor-transition')
    const picker = card.querySelector<HTMLElement>('.model-pick')
    const body = card.querySelector<HTMLElement>('.card-body')
    if (!editorViewport || !picker || !body) throw new Error('Missing Ask AI editor or model picker')

    body.scrollTop = 0
    const viewportRect = editorViewport.getBoundingClientRect()
    const pickerRect = picker.getBoundingClientRect()
    const bodyRect = body.getBoundingClientRect()
    const bodyStyle = getComputedStyle(body)
    const maxScrollTop = body.scrollHeight - body.clientHeight
    body.scrollTop = Math.min(40, maxScrollTop)
    const bodyCanScroll = body.scrollTop > 0
    body.scrollTop = 0

    return {
      hasOverflowingProse: viewportRect.height > bodyRect.height,
      bodyEndsAbovePicker: bodyRect.bottom <= pickerRect.top,
      bodyClipsProse: bodyStyle.overflowY !== 'visible',
      bodyCanScroll,
    }
  })

  expect(layout).toEqual({
    hasOverflowingProse: true,
    bodyEndsAbovePicker: true,
    bodyClipsProse: true,
    bodyCanScroll: true,
  })
})

test('model picker stays within the Ask AI card and truncates its selected model label', async ({ page }) => {
  const node = await seedAskCard(page)
  await page.evaluate((longModel) => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    const state = devWindow.__eido.getState()
    devWindow.__eido.setState({
      settings: {
        ...state.settings,
        model: longModel,
        models: [longModel],
      },
      cards: state.cards.map((card) =>
        card.id === 'ask-model'
          ? { ...card, model: longModel, size: { width: 280, height: 600 } }
          : card,
      ),
    })
  }, 'provider/deliberately-long-model-identifier-for-card-layout')
  await node.locator('.card-head').click()
  await expect(node.locator('.card')).toHaveClass(/selected/)
  const layout = await node.locator('.card').evaluate((card) => {
    const body = card.querySelector<HTMLElement>('.card-body')
    const picker = card.querySelector<HTMLElement>('.model-pick')
    const label = card.querySelector<HTMLElement>('.model-pick-label')
    const value = card.querySelector<HTMLElement>('.e-picker__value')
    if (!body || !picker || !label || !value) throw new Error('Missing Ask AI model picker')
    const bodyRect = body.getBoundingClientRect()
    const pickerRect = picker.getBoundingClientRect()
    return {
      pickerOverflowsBody: pickerRect.left < bodyRect.left || pickerRect.right > bodyRect.right,
      labelWidth: label.getBoundingClientRect().width,
      valueOverflows: value.scrollWidth > value.clientWidth,
    }
  })

  expect(layout.pickerOverflowsBody).toBe(false)
  expect(layout.labelWidth).toBeGreaterThan(0)
  expect(layout.valueOverflows).toBe(true)
})

test('a newly created Ask AI card pins its model picker above the footer before any resize', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  const cardId = await page.evaluate(() => {
    const store = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
    if (!store) throw new Error('Missing Eido development store')
    const id = store.getState().addCard('askAi', { x: 300, y: 80 })
    store.getState().setCardText(id, 'Write a short synthesis of this newly created Ask AI card.')
    return id
  })
  await page.evaluate(() => {
    ;(window as unknown as DevWindow).__EIDO_SET_VIEWPORT__?.({ x: 120, y: 40, zoom: 1 })
  })
  const node = page.locator(`.react-flow__node[data-id="${cardId}"]`)
  await expect(node).toBeVisible()
  await expect(node.locator('.card')).not.toHaveClass(/fixed-h/)
  expect(await modelFooterGap(node)).toBeLessThanOrEqual(16)
})

test('changing the model re-runs an otherwise fresh Ask AI card with the selected model', async ({ page }) => {
  let requestedModel: string | undefined
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    requestedModel = (route.request().postDataJSON() as { model?: string }).model
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"choices":[{"delta":{"content":"Test response"}}]}\n\ndata: [DONE]\n\n',
    })
  })

  const node = await seedAskCard(page)
  const card = node.locator('.card')
  const model = card.getByRole('combobox', { name: 'Model' })

  await expect(card).not.toHaveClass(/selected/)
  await model.click()
  await page.getByRole('option', { name: 'Grok 4.5', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
        return devWindow.__eido.getState().cards.find((candidate) => candidate.id === 'ask-model')?.model
      }),
    )
    .toBe('x-ai/grok-4.5')

  await card.getByRole('button', { name: 'Run', exact: true }).click()

  await expect.poll(() =>
    page.evaluate(() => {
      const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
      const runs = devWindow.__eido.getState().runs.filter((run) => run.askAiCardId === 'ask-model')
      return { count: runs.length, model: runs[runs.length - 1]?.model, status: runs[runs.length - 1]?.status }
    }),
  ).toEqual({ count: 2, model: 'x-ai/grok-4.5', status: 'done' })
  expect(requestedModel).toBe('x-ai/grok-4.5')
})

test('repeated Run presses create new versions when the Ask AI sources are unchanged', async ({ page }) => {
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"choices":[{"delta":{"content":"Another response"}}]}\n\ndata: [DONE]\n\n',
    })
  })

  const node = await seedAskCard(page)
  const run = node.locator('.card').getByRole('button', { name: 'Run', exact: true })

  await run.click()
  await expect.poll(() => page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    return devWindow.__eido.getState().runs.filter((entry) => entry.askAiCardId === 'ask-model').length
  })).toBe(2)

  await run.click()
  await expect.poll(() =>
    page.evaluate(() => {
      const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
      const state = devWindow.__eido.getState()
      return {
        runs: state.runs.filter((entry) => entry.askAiCardId === 'ask-model').length,
        versions: state.outputs.find((output) => output.resultCardId === 'result-model')?.versions.length,
      }
    }),
  ).toEqual({ runs: 3, versions: 3 })
})
