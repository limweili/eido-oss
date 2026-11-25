import { expect, test, type Page } from '@playwright/test'

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    settings: Record<string, unknown>
    outputs: Array<{ resultCardId: string; versions: unknown[] }>
    runs: Array<{ askAiCardId: string; status: string }>
  }
  setState: (state: unknown) => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

async function seedCompletedResult(
  page: Page,
  { multipleVersions = false, research = false, partialRunning = false } = {},
) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(({ multipleVersions, research, partialRunning }) => {
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
      linkupKeyPresent: research,
      cards: [
        {
          id: 'ask-source',
          kind: 'askAi',
          blocks: [{ id: 'ask-block', text: 'Explore the idea from three genuinely different angles.' }],
          position: { x: 80, y: 120 },
          model: 'x-ai/grok-4.5',
          ...(research ? { agentic: true, meta: { reachMode: 'research' } } : {}),
        },
        {
          id: 'result-variations',
          kind: 'result',
          blocks: [{ id: 'result-block', text: '' }],
          position: { x: 440, y: 80 },
          size: { width: 460, height: 520 },
        },
      ],
      connections: [
        {
          id: 'ask-result',
          from: { cardId: 'ask-source' },
          to: { cardId: 'result-variations' },
          strength: 'strong',
          polarity: 'helps',
          role: 'feeds',
        },
      ],
      outputs: [
        {
          id: 'output-variations',
          resultCardId: 'result-variations',
          chosenVersionId: partialRunning ? 'version-running' : 'version-1',
          versions: [
            {
              id: 'version-1',
              number: 1,
              text: 'The original completed answer.',
              createdAt: now,
              fromRunId: 'run-1',
            },
            ...(multipleVersions ? [{
              id: 'version-2',
              number: 2,
              text: 'A second completed answer.',
              createdAt: now,
              fromRunId: 'run-1',
            }] : []),
            ...(partialRunning ? [{
              id: 'version-running',
              number: 2,
              text: 'A partial answer still streaming.',
              createdAt: now,
              fromRunId: 'run-running',
              provisional: true,
            }] : []),
          ],
        },
      ],
      runs: [
        {
          id: 'run-1',
          startedAt: now,
          finishedAt: now,
          askAiCardId: 'ask-source',
          model: 'x-ai/grok-4.5',
          usedCardIds: [],
          usedConnectionIds: [],
          modIds: [],
          appliedMods: [],
          compiledInstruction: 'Explore the idea from three genuinely different angles.',
          producedVersionId: 'version-1',
          status: 'done',
        },
        ...(partialRunning ? [{
          id: 'run-running',
          startedAt: now,
          askAiCardId: 'ask-source',
          model: 'x-ai/grok-4.5',
          usedCardIds: [],
          usedConnectionIds: [],
          modIds: [],
          appliedMods: [],
          compiledInstruction: 'Explore the idea from three genuinely different angles.',
          producedVersionId: 'version-running',
          status: 'running',
        }] : []),
      ],
      intentLog: [],
      visualDecayEnabled: false,
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
  }, { multipleVersions, research, partialRunning })

  await page.waitForFunction(() => document.querySelector('[data-id="result-variations"]'))
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 100, y: 40, zoom: 1 })
  })

  const result = page.locator('.react-flow__node[data-id="result-variations"]')
  await result.locator('.card').click()
  await expect(result.locator('.card')).toHaveClass(/selected/)
  return result
}

test('Make variations creates one new version and then settles', async ({ page }) => {
  let requestCount = 0
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    requestCount += 1
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: {"choices":[{"delta":{"content":"Variation ${requestCount}"}}]}\n\ndata: [DONE]\n\n`,
    })
  })

  const result = await seedCompletedResult(page)
  await result.getByRole('button', { name: 'Make variations', exact: true }).click()

  await expect.poll(() => requestCount).toBe(1)
  await page.waitForTimeout(750)
  expect(requestCount).toBe(1)

  const counts = await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    const state = devWindow.__eido.getState()
    return {
      runs: state.runs.filter((run) => run.askAiCardId === 'ask-source').length,
      versions: state.outputs.find((output) => output.resultCardId === 'result-variations')?.versions.length,
    }
  })
  expect(counts).toEqual({ runs: 2, versions: 2 })
  await expect(result.getByRole('button', { name: 'Make variations', exact: true })).toBeEnabled()
  await expect(result.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
})

test('Make variations exposes Cancel and a named pulse while its request is pending', async ({
  page,
}) => {
  let releaseRequest: () => void = () => undefined
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve
  })
  let requestCount = 0
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    requestCount += 1
    await requestGate
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"choices":[{"delta":{"content":"Pending variation"}}]}\n\ndata: [DONE]\n\n',
    })
  })

  const result = await seedCompletedResult(page, { multipleVersions: true })
  try {
    await result.getByRole('button', { name: 'Make variations', exact: true }).click()
    await expect.poll(() => requestCount).toBe(1)
    await expect(result.getByText('The original completed answer.')).toBeVisible()
    await expect(result.getByText('A second completed answer.')).toHaveCount(0)
    await expect(result.getByRole('button', { name: 'Version 1', exact: true })).toHaveClass(/active/)
    await expect(result.getByRole('button', { name: 'Version 3', exact: true })).not.toHaveClass(/active/)
    await expect(result.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
    await expect(result.getByRole('status', { name: 'Running' })).toBeVisible()
    const keep = result.getByRole('button', { name: 'Keep this', exact: true })
    await keep.click()
    await expect(keep).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => page.evaluate(() => {
      const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
      const output = devWindow.__eido.getState().outputs
        .find((candidate) => candidate.resultCardId === 'result-variations')
      const versions = output?.versions as Array<{ id: string; accepted?: boolean }> | undefined
      return {
        originalAccepted: versions?.find((version) => version.id === 'version-1')?.accepted,
        provisionalAccepted: versions?.find((version) => version.id !== 'version-1' && version.id !== 'version-2')?.accepted,
      }
    })).toEqual({ originalAccepted: true, provisionalAccepted: undefined })
  } finally {
    releaseRequest()
  }

  await expect(result.getByRole('button', { name: 'Make variations', exact: true })).toBeEnabled()
})

test('an in-flight variation keeps existing prose while showing Cancel and a named pulse', async ({
  page,
}) => {
  const result = await seedCompletedResult(page, { partialRunning: true })

  await expect(result.getByText('A partial answer still streaming.')).toBeVisible()
  await expect(result.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
  await expect(result.getByRole('status', { name: 'Running' })).toBeVisible()
})

test('Research focus keeps a visible go ring around its armed boundary', async ({ page }) => {
  await seedCompletedResult(page, { research: true })
  const research = page
    .locator('.react-flow__node[data-id="ask-source"]')
    .getByRole('button', { name: 'Research mode', exact: true })

  await research.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(research).toBeFocused()
  await expect.poll(() => research.evaluate((element) => {
    const style = getComputedStyle(element)
    const probe = document.createElement('button')
    probe.style.border = '1px solid var(--e-go)'
    probe.style.boxShadow = 'inset 0 0 0 1px var(--e-go)'
    probe.style.outline = '1.5px solid var(--e-go)'
    document.body.append(probe)
    const expected = getComputedStyle(probe)
    const result = {
      outline: style.outlineStyle,
      outlineColorMatches: style.outlineColor === expected.borderColor,
      outlineWidthMatches: style.outlineWidth === expected.outlineWidth,
      outlineOffset: style.outlineOffset,
      borderMatches: style.borderColor === expected.borderColor,
      shadowMatches: style.boxShadow === expected.boxShadow,
    }
    probe.remove()
    return result
  })).toEqual({
    outline: 'solid',
    outlineColorMatches: true,
    outlineWidthMatches: true,
    outlineOffset: '2px',
    borderMatches: true,
    shadowMatches: true,
  })
})

test('a kept result uses the same selected go treatment as Web mode', async ({ page }) => {
  const result = await seedCompletedResult(page, { multipleVersions: true })
  const keep = result.getByRole('button', { name: 'Keep this', exact: true })
  const webMode = page
    .locator('.react-flow__node[data-id="ask-source"]')
    .locator('.web-reach-toggle')

  const unselectedKeepStyles = await keep.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      background: style.backgroundColor,
      border: style.borderColor,
      color: style.color,
    }
  })

  await keep.click()
  await webMode.click()

  await expect(keep).toHaveAttribute('aria-pressed', 'true')
  await expect(webMode).toHaveAttribute('aria-pressed', 'true')
  await page.mouse.move(0, 0)

  const selectedStyles = async (button: typeof keep) => button.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      background: style.backgroundColor,
      border: style.borderColor,
      color: style.color,
    }
  })

  const expectedSelectedStyles = await page.evaluate(() => {
    const probe = document.createElement('button')
    probe.style.background = 'color-mix(in srgb, var(--e-go) 12%, var(--e-wash-base))'
    probe.style.border = '1px solid var(--e-go)'
    probe.style.color = 'var(--e-go-ink)'
    document.body.append(probe)
    const style = getComputedStyle(probe)
    const result = {
      background: style.backgroundColor,
      border: style.borderColor,
      color: style.color,
    }
    probe.remove()
    return result
  })

  await expect.poll(() => selectedStyles(keep)).toEqual(expectedSelectedStyles)
  await expect.poll(() => selectedStyles(webMode)).toEqual(expectedSelectedStyles)
  await expect.poll(async () => selectedStyles(keep)).not.toEqual(unselectedKeepStyles)

  await keep.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(keep).toBeFocused()
  const focusStyles = await keep.evaluate((element) => {
    const style = getComputedStyle(element)
    const probe = document.createElement('button')
    probe.style.boxShadow = 'inset 0 0 0 1px var(--e-go)'
    document.body.append(probe)
    const expectedShadow = getComputedStyle(probe).boxShadow
    probe.remove()
    return { outline: style.outlineStyle, shadow: style.boxShadow, expectedShadow }
  })
  expect(focusStyles.outline).toBe('none')
  expect(focusStyles.shadow).toBe(focusStyles.expectedShadow)
})
