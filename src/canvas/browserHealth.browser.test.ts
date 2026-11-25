import { expect, test, type Page, type TestInfo } from '@playwright/test'

type EidoDevStore = {
  getState: () => { hydrated: boolean }
  setState: (state: unknown) => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

type StartupProbe = {
  documentState: string
  rootChildCount: number
  storePresent: boolean
  hydrated: boolean
  viewportHookPresent: boolean
  renderedNodeCount: number
}

type BrowserSignals = {
  pageErrorCount: number
  consoleErrorCount: number
  failedRequests: Array<{ method: string; location: string; category: string }>
}

function safeRequestLocation(rawUrl: string) {
  try {
    const url = new URL(rawUrl)
    return `${url.origin}${url.pathname}`
  } catch {
    return '[unparseable URL]'
  }
}

function requestFailureCategory(errorText: string | undefined) {
  return errorText?.match(/net::[A-Z0-9_]+/)?.[0] ?? 'REQUEST_FAILED'
}

async function readStartupProbe(page: Page): Promise<StartupProbe> {
  return page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    return {
      documentState: document.readyState,
      rootChildCount: document.querySelector('#root')?.childElementCount ?? 0,
      storePresent: Boolean(devWindow.__eido),
      hydrated: devWindow.__eido?.getState().hydrated ?? false,
      viewportHookPresent: Boolean(devWindow.__EIDO_SET_VIEWPORT__),
      renderedNodeCount: document.querySelectorAll('.react-flow__node').length,
    }
  })
}

async function attachStartupFailure(
  page: Page,
  testInfo: TestInfo,
  browserSignals: BrowserSignals,
  failure: unknown,
) {
  const probe = await readStartupProbe(page).catch(() => null)
  const diagnostic = {
    failureKind: failure instanceof Error && failure.name === 'TimeoutError' ? 'TimeoutError' : 'Error',
    location: safeRequestLocation(page.url()),
    probe,
    browserSignals: {
      ...browserSignals,
      failedRequests: browserSignals.failedRequests.slice(0, 12),
    },
  }
  await testInfo.attach('browser-startup-diagnostic.json', {
    body: JSON.stringify(diagnostic, null, 2),
    contentType: 'application/json',
  })
  return diagnostic
}

test('Eido starts, hydrates, and renders a seeded card', async ({ page }, testInfo) => {
  const browserSignals: BrowserSignals = {
    pageErrorCount: 0,
    consoleErrorCount: 0,
    failedRequests: [],
  }
  page.on('pageerror', () => { browserSignals.pageErrorCount += 1 })
  page.on('console', message => {
    if (message.type() === 'error') browserSignals.consoleErrorCount += 1
  })
  page.on('requestfailed', request => {
    browserSignals.failedRequests.push({
      method: request.method(),
      location: safeRequestLocation(request.url()),
      category: requestFailureCategory(request.failure()?.errorText),
    })
  })

  try {
    await page.goto('/')
    await page.waitForFunction(() => {
      const devWindow = window as unknown as DevWindow
      return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
    }, undefined, { timeout: 15_000 })

    await page.evaluate(() => {
      const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
      devWindow.__eido.setState({
        cards: [{
          id: 'ci-browser-health',
          kind: 'note',
          blocks: [{ id: 'ci-browser-health-block', text: 'Browser health' }],
          position: { x: 120, y: 120 },
        }],
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
      devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
    })

    await expect(page.locator('.react-flow__node[data-id="ci-browser-health"]')).toBeVisible({ timeout: 10_000 })
  } catch (failure) {
    const diagnostic = await attachStartupFailure(page, testInfo, browserSignals, failure)
    throw new Error(`Browser health failed; startup probe: ${JSON.stringify(diagnostic.probe)}. See browser-startup-diagnostic.json.`)
  }
})
