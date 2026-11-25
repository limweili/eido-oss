import { expect, test, type Locator, type Page } from '@playwright/test'

type DevWindow = {
  __eido?: {
    getState: () => {
      hydrated: boolean
      cards: Array<{ id: string; position: { x: number; y: number } }>
      selectedCardIds: string[]
    }
    setState: (state: unknown) => void
  }
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

type ScrollSnapshot = {
  scrollTop: number
  maxScrollTop: number
  anchorText: string
  anchorOffset: number
}

async function seedScrollableResult(page: Page, fixture: 'long' | 'compact-follow-up' = 'long') {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate((resultFixture) => {
    const devWindow = window as unknown as DevWindow & {
      __eido: NonNullable<DevWindow['__eido']>
    }
    const now = '2026-08-20T00:00:00.000Z'
    const scenario = resultFixture === 'compact-follow-up'
      ? {
          answer: 'I’m happy to weigh in—what would you like my opinion on? Share the idea, decision, text, or situation, and I’ll give you a thoughtful take.',
          followUpQuestion: 'gimme more about how you think',
          followUpAnswer: 'I think by turning a question into a set of smaller parts rather than jumping straight to a reaction. Usually I try to:\n\n- **Clarify what’s actually being asked**\n- **Separate facts from interpretations or assumptions**\n- **Consider multiple perspectives**, including ones that may conflict\n- **Look for tradeoffs, risks, and likely consequences**\n- **Notice uncertainty** and avoid pretending to know more than I do\n- **Give a direct conclusion**, while explaining how I arrived there\n- **Adapt to what you want**—brainstorming, criticism, emotional support, decision-making, or a concise answer\n\nI don’t have private thoughts or personal experiences in the human sense. My “thinking” is a reasoning process based on the information available in the conversation. So, with only “what do you think?” and no subject specified, I don’t yet have an opinion to develop—I’d need the idea, decision, text, or situation you want me to examine.',
          neighboringCards: [{
            id: 'scroll-ask',
            kind: 'askAi' as const,
            blocks: [{ id: 'scroll-ask-block', text: 'what do you think?' }],
            position: { x: -24, y: 27 },
            zIndex: 0,
            size: { width: 260, height: 250 },
          }],
          resultPosition: { x: 544, y: 57 },
          resultSize: { width: 308, height: 405 },
          resultZIndex: {},
        }
      : {
          answer: Array.from(
            { length: 200 },
            (_, index) =>
              `Anchor paragraph ${String(index + 1).padStart(4, '0')}. Synthetic scroll-retention content.`,
          ).join('\n\n'),
          followUpQuestion: 'Synthetic follow-up question.',
          followUpAnswer: 'Synthetic follow-up answer.',
          neighboringCards: [],
          resultPosition: { x: 300, y: 100 },
          resultSize: { width: 520, height: 560 },
          resultZIndex: { zIndex: 3 },
        }

    devWindow.__eido.setState({
      cards: [
        ...scenario.neighboringCards,
        {
          id: 'scroll-result',
          kind: 'result',
          blocks: [{ id: 'scroll-result-block', text: '' }],
          position: scenario.resultPosition,
          size: scenario.resultSize,
          ...scenario.resultZIndex,
        },
      ],
      connections: [],
      outputs: [
        {
          id: 'scroll-output',
          resultCardId: 'scroll-result',
          chosenVersionId: 'scroll-version',
          versions: [
            {
              id: 'scroll-version',
              number: 1,
              text: scenario.answer,
              createdAt: now,
              fromRunId: 'scroll-run',
              followUpThread: {
                collapsed: false,
                messages: [
                  {
                    id: 'scroll-follow-up-question',
                    role: 'user',
                    text: scenario.followUpQuestion,
                    createdAt: now,
                    status: 'complete',
                  },
                  {
                    id: 'scroll-follow-up-answer',
                    role: 'assistant',
                    text: scenario.followUpAnswer,
                    createdAt: now,
                    status: 'complete',
                  },
                ],
              },
            },
          ],
        },
      ],
      runs: [
        {
          id: 'scroll-run',
          startedAt: now,
          finishedAt: now,
          askAiCardId: 'synthetic-ask',
          model: 'openai/gpt-4o-mini',
          usedCardIds: [],
          usedConnectionIds: [],
          modIds: [],
          appliedMods: [],
          compiledInstruction: 'Synthetic scroll-retention fixture.',
          producedVersionId: 'scroll-version',
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
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
  }, fixture)

  const node = page.locator('.react-flow__node[data-id="scroll-result"]')
  const body = node.locator('.card-body')
  await expect(node).toBeVisible()
  await expect.poll(() => body.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(fixture === 'long' ? 2_000 : 300)
  // Let the initial fit and Reading-residency settlement finish before the
  // user's interaction begins.
  await page.waitForTimeout(500)
  return { node, body }
}

async function seedLongNote(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & {
      __eido: NonNullable<DevWindow['__eido']>
    }
    const longNote = Array.from(
      { length: 200 },
      (_, index) =>
        `Note anchor ${String(index + 1).padStart(4, '0')}. Synthetic scroll-retention content.`,
    ).join('\n\n')
    devWindow.__eido.setState({
      cards: [
        {
          id: 'scroll-note',
          kind: 'note',
          blocks: [{ id: 'scroll-note-block', text: longNote }],
          position: { x: 300, y: 100 },
          size: { width: 520, height: 560 },
        },
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
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
  })

  const node = page.locator('.react-flow__node[data-id="scroll-note"]')
  const body = node.locator('.note-body')
  await expect(node).toBeVisible()
  await expect.poll(() => body.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(2_000)
  await page.waitForTimeout(500)
  return { node, body }
}

async function seedLongConversationResult(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & {
      __eido: NonNullable<DevWindow['__eido']>
    }
    const now = '2026-08-20T00:00:00.000Z'
    const transcript = Array.from({ length: 200 }, (_, index) => ({
      id: `scroll-transcript-${index + 1}`,
      speakerKind: index % 5 === 4 ? 'user' : 'participant',
      speakerName: index % 5 === 4 ? 'You' : 'Synthetic participant',
      text: `Transcript anchor ${String(index + 1).padStart(4, '0')}. Synthetic scroll-retention content.`,
    }))
    devWindow.__eido.setState({
      cards: [
        {
          id: 'scroll-conversation-result',
          kind: 'result',
          blocks: [{ id: 'scroll-conversation-result-block', text: '' }],
          position: { x: 300, y: 100 },
          size: { width: 520, height: 560 },
        },
      ],
      connections: [],
      outputs: [
        {
          id: 'scroll-conversation-output',
          resultCardId: 'scroll-conversation-result',
          chosenVersionId: 'scroll-conversation-version',
          versions: [
            {
              id: 'scroll-conversation-version',
              number: 1,
              text: 'Synthetic conversation transcript.',
              createdAt: now,
              fromRunId: 'scroll-conversation-run',
              transcript,
            },
          ],
        },
      ],
      runs: [
        {
          id: 'scroll-conversation-run',
          kind: 'conversation',
          startedAt: now,
          finishedAt: now,
          askAiCardId: 'synthetic-conversation',
          model: 'openai/gpt-4o-mini',
          usedCardIds: [],
          usedConnectionIds: [],
          modIds: [],
          appliedMods: [],
          compiledInstruction: 'Synthetic scroll-retention fixture.',
          producedVersionId: 'scroll-conversation-version',
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
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
  })

  const node = page.locator('.react-flow__node[data-id="scroll-conversation-result"]')
  const transcript = node.locator('.transcript')
  await expect(node).toBeVisible()
  await expect.poll(() => transcript.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(2_000)
  await page.waitForTimeout(500)
  return { node, transcript }
}

async function replaceExactSurfaceContent(
  page: Page,
  surface: 'result' | 'conversation-result',
  length: 'short' | 'long' | 'longer',
) {
  await page.evaluate(({ surfaceKind, contentLength }) => {
    const devWindow = window as unknown as {
      __eido: {
        getState: () => {
          outputs: Array<{
            resultCardId: string
            versions: Array<{
              text: string
              transcript?: Array<{
                id: string
                speakerKind: string
                speakerName: string
                text: string
              }>
            }>
          }>
          runs: Array<{ id: string; status: string }>
        }
        setState: (state: unknown) => void
      }
    }
    const targetId = surfaceKind === 'result'
      ? 'scroll-result'
      : 'scroll-conversation-result'
    const paragraphCount = contentLength === 'short'
      ? 1
      : contentLength === 'longer'
        ? 260
        : 200
    const state = devWindow.__eido.getState()
    const outputs = state.outputs.map((output) => {
      if (output.resultCardId !== targetId) return output
      return {
        ...output,
        versions: output.versions.map((version) => surfaceKind === 'result'
          ? {
              ...version,
              text: Array.from(
                { length: paragraphCount },
                (_, index) => `Replacement result ${String(index + 1).padStart(4, '0')}.`,
              ).join('\n\n'),
            }
          : {
              ...version,
              text: 'Replacement conversation transcript.',
              transcript: Array.from({ length: paragraphCount }, (_, index) => ({
                id: `replacement-transcript-${index + 1}`,
                speakerKind: index % 5 === 4 ? 'user' : 'participant',
                speakerName: index % 5 === 4 ? 'You' : 'Synthetic participant',
                text: `Replacement transcript ${String(index + 1).padStart(4, '0')}.`,
              })),
            }),
      }
    })
    const targetRunId = surfaceKind === 'result'
      ? 'scroll-run'
      : 'scroll-conversation-run'
    const runs = state.runs.map((run) => run.id === targetRunId
      ? { ...run, status: contentLength === 'short' ? 'done' : 'running' }
      : run)
    devWindow.__eido.setState({ outputs, runs })
  }, { surfaceKind: surface, contentLength: length })
}

async function evictExactSurface(page: Page, node: Locator) {
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } })
  await page.mouse.move(20, 140)
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: -3_000, y: 0, zoom: 1 })
  })
  await expect(node).toHaveCount(0)
}

async function restoreExactSurface(page: Page, node: Locator) {
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
  })
  await expect(node).toBeVisible()
}

async function scrollSnapshot(body: Locator): Promise<ScrollSnapshot> {
  return body.evaluate((element) => {
    const bodyRect = element.getBoundingClientRect()
    const anchor = Array.from(element.querySelectorAll<HTMLElement>('p')).find((candidate) => {
      const rect = candidate.getBoundingClientRect()
      return rect.bottom > bodyRect.top + 12 && rect.top < bodyRect.bottom - 12
    })
    if (!anchor) throw new Error('No visible paragraph anchor in Result body')
    const anchorRect = anchor.getBoundingClientRect()
    return {
      scrollTop: element.scrollTop,
      maxScrollTop: element.scrollHeight - element.clientHeight,
      anchorText: anchor.textContent ?? '',
      anchorOffset: anchorRect.top - bodyRect.top,
    }
  })
}

async function dragCardBy(page: Page, node: Locator, dx: number, dy: number) {
  const head = node.locator('.card-head')
  const box = await head.boundingBox()
  if (!box) throw new Error('Missing Result Card head')
  const from = { x: box.x + box.width / 2, y: box.y + 4 }

  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let step = 1; step <= 5; step += 1) {
    await page.mouse.move(from.x + (dx * step) / 5, from.y + (dy * step) / 5)
  }
  await page.mouse.up()
}

test('a deeply scrolled long Result retains its exact reading position through repeated Card drags', async ({
  page,
}) => {
  const { node, body } = await seedScrollableResult(page)

  // Internal scrolling is a Live-Card interaction. Activate the Result before
  // taking the baseline so the first drag does not conflate scroll continuity
  // with the selected Card's composer entering the layout.
  await node.locator('.card-head').click({ position: { x: 120, y: 8 } })
  await expect(node.locator('.followup-ask')).toBeVisible()
  await page.waitForTimeout(220)
  await body.evaluate((element) => {
    element.scrollTop = Math.round((element.scrollHeight - element.clientHeight) * 0.72)
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
    ;(window as unknown as { __SCROLL_BODY__?: Element }).__SCROLL_BODY__ = element
  })
  const before = await scrollSnapshot(body)
  expect(before.scrollTop).toBeGreaterThan(2_000)

  for (const [dx, dy] of [
    [70, 24],
    [-65, 18],
    [55, -22],
    [-50, -20],
    [45, 16],
    [-40, -14],
  ] as const) {
    await dragCardBy(page, node, dx, dy)
    await page.waitForTimeout(220)

    const after = await scrollSnapshot(body)
    expect(after.scrollTop).toBeCloseTo(before.scrollTop, 0)
    expect(after.maxScrollTop).toBeCloseTo(before.maxScrollTop, 0)
    expect(after.anchorText).toBe(before.anchorText)
    expect(after.anchorOffset).toBeCloseTo(before.anchorOffset, 0)
    await expect
      .poll(() =>
        body.evaluate(
          (element) =>
            (window as unknown as { __SCROLL_BODY__?: Element }).__SCROLL_BODY__ === element,
        ),
      )
      .toBe(true)
  }
})

test('Result and Conversation Result replace stale mid-scroll memory after a shrunken remount', async ({
  page,
}) => {
  const cases = [
    {
      surface: 'result' as const,
      seed: async () => {
        const { node, body } = await seedScrollableResult(page)
        return { node, scroller: body }
      },
    },
    {
      surface: 'conversation-result' as const,
      seed: async () => {
        const { node, transcript } = await seedLongConversationResult(page)
        return { node, scroller: transcript }
      },
    },
  ]

  for (const cardCase of cases) {
    const seeded = await cardCase.seed()
    const { scroller } = seeded
    await scroller.evaluate((element) => {
      element.scrollTop = Math.round((element.scrollHeight - element.clientHeight) * 0.65)
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(1_000)

    await evictExactSurface(page, seeded.node)
    await replaceExactSurfaceContent(page, cardCase.surface, 'short')
    await restoreExactSurface(page, seeded.node)
    await expect.poll(() => scroller.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    )).toBe(0)
    expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0)
    await scroller.evaluate((element) => {
      ;(window as unknown as { __CLAMPED_SCROLL_SURFACE__?: Element })
        .__CLAMPED_SCROLL_SURFACE__ = element
    })

    // Grow/stream into the immediately clamped mount. Its consumer pinned ref
    // must already reflect post-layout DOM truth; waiting for another remount
    // would miss the closure bug this journey guards.
    await replaceExactSurfaceContent(page, cardCase.surface, 'long')
    await expect.poll(() => scroller.evaluate((element) => (
      window as unknown as { __CLAMPED_SCROLL_SURFACE__?: Element }
    ).__CLAMPED_SCROLL_SURFACE__ === element)).toBe(true)
    await expect.poll(() => scroller.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    )).toBeGreaterThan(2_000)
    await expect.poll(() => scroller.evaluate((element) => Math.abs(
      element.scrollHeight - element.clientHeight - element.scrollTop,
    ))).toBeLessThanOrEqual(1)
    const grown = await scroller.evaluate((element) => ({
      scrollTop: element.scrollTop,
      maxScrollTop: element.scrollHeight - element.clientHeight,
    }))
    expect(grown.scrollTop).toBeCloseTo(grown.maxScrollTop, 0)
  }
})

test('streaming growth does not steal either Result reader from an away-from-end offset', async ({
  page,
}) => {
  const cases = [
    {
      surface: 'result' as const,
      seed: async () => {
        const { node, body } = await seedScrollableResult(page)
        return { node, scroller: body }
      },
    },
    {
      surface: 'conversation-result' as const,
      seed: async () => {
        const { node, transcript } = await seedLongConversationResult(page)
        return { node, scroller: transcript }
      },
    },
  ]

  for (const cardCase of cases) {
    const { scroller } = await cardCase.seed()
    const before = await scroller.evaluate((element) => {
      element.scrollTop = Math.round((element.scrollHeight - element.clientHeight) * 0.35)
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
      ;(window as unknown as { __AWAY_SCROLL_SURFACE__?: Element }).__AWAY_SCROLL_SURFACE__ = element
      return {
        scrollTop: element.scrollTop,
        maxScrollTop: element.scrollHeight - element.clientHeight,
      }
    })
    expect(before.scrollTop).toBeGreaterThan(500)
    expect(before.maxScrollTop - before.scrollTop).toBeGreaterThan(48)

    await replaceExactSurfaceContent(page, cardCase.surface, 'longer')
    await expect.poll(() => scroller.evaluate((element) => (
      window as unknown as { __AWAY_SCROLL_SURFACE__?: Element }
    ).__AWAY_SCROLL_SURFACE__ === element)).toBe(true)
    await expect.poll(() => scroller.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    )).toBeGreaterThan(before.maxScrollTop)
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBeCloseTo(before.scrollTop, 0)
  }
})

test('a deeply scrolled long Result restores its reading position after leaving and re-entering the viewport', async ({
  page,
}) => {
  const { node, body } = await seedScrollableResult(page)

  await node.locator('.card-head').click({ position: { x: 120, y: 8 } })
  await expect(node.locator('.followup-ask')).toBeVisible()
  const bodyBox = await body.boundingBox()
  if (!bodyBox) throw new Error('Missing Result body bounds')
  await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height / 2)
  await page.mouse.wheel(0, 5_000)
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(2_000)
  const before = await scrollSnapshot(body)
  expect(before.scrollTop).toBeGreaterThan(2_000)

  // End selection ownership while the detailed Card is still resident. The
  // Card's most recent internal scroll position must outlive ordinary
  // residency eviction and restoration.
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } })
  // Ending selection can already release rich residency. Selection belongs
  // to the Graph even when this presentation has unmounted.
  await expect.poll(() => page.evaluate(() => (
    (window as unknown as DevWindow).__eido?.getState().selectedCardIds
  ))).toEqual([])
  // Let the bounded internal-scroll Live owner end, then navigate far enough
  // to exercise the normal rich-Card residency exit and re-entry path.
  await page.mouse.move(20, 140)
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: -3_000, y: 0, zoom: 1 })
  })
  await expect(node).toHaveCount(0)

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
  })
  await expect(node).toBeVisible()
  await expect.poll(() => body.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(2_000)

  const after = await scrollSnapshot(body)
  expect(after.scrollTop).toBeCloseTo(before.scrollTop, 0)
  expect(after.anchorText).toBe(before.anchorText)
  expect(after.anchorOffset).toBeCloseTo(before.anchorOffset, 0)
})

test('a deselected Result keeps its reading position while retained outside the viewport buffer', async ({
  page,
}) => {
  const { node, body } = await seedScrollableResult(page, 'compact-follow-up')

  await node.locator('.card-head').click({ position: { x: 120, y: 8 } })
  await expect(node.locator('.followup-ask')).toBeVisible()
  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  const before = await scrollSnapshot(body)
  expect(before.scrollTop).toBeGreaterThan(300)

  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } })
  await expect(node).not.toHaveClass(/selected/)
  expect(await body.evaluate((element) => element.scrollTop)).toBeCloseTo(before.scrollTop, 0)
  await page.mouse.move(20, 140)
  await page.getByRole('button', { name: 'Move' }).click()
  expect(await body.evaluate((element) => element.scrollTop)).toBeCloseTo(before.scrollTop, 0)

  const paneBox = await page.locator('.react-flow__pane').boundingBox()
  if (!paneBox) throw new Error('Missing Board pane')
  const y = paneBox.y + 80
  await page.mouse.move(paneBox.x + paneBox.width - 80, y)
  await page.mouse.down()
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(
      paneBox.x + paneBox.width - 80 - ((paneBox.width + 320) * step) / 8,
      y,
    )
  }
  await page.mouse.up()

  // The hysteretic residency window deliberately keeps this rich Card
  // mounted briefly after it leaves the viewport. Its passive surface must
  // not reset while that retained mount remains authoritative.
  await expect(node).toBeAttached()
  await page.waitForTimeout(500)
  const after = await scrollSnapshot(body)
  expect(after.scrollTop).toBeCloseTo(before.scrollTop, 0)
  expect(after.anchorText).toBe(before.anchorText)
  expect(after.anchorOffset).toBeCloseTo(before.anchorOffset, 0)
})

test('a deeply scrolled long Note restores its reading position after leaving and re-entering the viewport', async ({
  page,
}) => {
  const { node, body } = await seedLongNote(page)

  await node.locator('.note-render').click()
  await expect(node.locator('.markdown-card-editor-content')).toBeEditable()
  const bodyBox = await body.boundingBox()
  if (!bodyBox) throw new Error('Missing Note body bounds')
  await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height / 2)
  await page.mouse.wheel(0, 5_000)
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(2_000)

  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } })
  await expect(node.locator('.markdown-card-editor-content')).not.toBeAttached()
  const before = await scrollSnapshot(body)
  expect(before.scrollTop).toBeGreaterThan(2_000)
  await page.mouse.move(20, 140)
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: -3_000, y: 0, zoom: 1 })
  })
  await expect(node).toHaveCount(0)

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
  })
  await expect(node).toBeVisible()
  await expect.poll(() => body.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(2_000)

  const after = await scrollSnapshot(body)
  expect(after.scrollTop).toBeCloseTo(before.scrollTop, 0)
  expect(after.anchorText).toBe(before.anchorText)
  expect(after.anchorOffset).toBeCloseTo(before.anchorOffset, 0)
})

test('a deeply scrolled Conversation transcript restores its reading position after leaving and re-entering the viewport', async ({
  page,
}) => {
  const { node, transcript } = await seedLongConversationResult(page)

  await node.locator('.card-head').click({ position: { x: 120, y: 8 } })
  const transcriptBox = await transcript.boundingBox()
  if (!transcriptBox) throw new Error('Missing Conversation transcript bounds')
  await page.mouse.move(
    transcriptBox.x + transcriptBox.width / 2,
    transcriptBox.y + transcriptBox.height / 2,
  )
  await page.mouse.wheel(0, 5_000)
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBeGreaterThan(2_000)
  const before = await scrollSnapshot(transcript)

  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } })
  await expect(node).not.toHaveClass(/selected/)
  await page.mouse.move(20, 140)
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: -3_000, y: 0, zoom: 1 })
  })
  await expect(node).toHaveCount(0)

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
  })
  await expect(node).toBeVisible()
  await expect.poll(() =>
    transcript.evaluate((element) => element.scrollHeight - element.clientHeight),
  ).toBeGreaterThan(2_000)

  const after = await scrollSnapshot(transcript)
  expect(after.scrollTop).toBeCloseTo(before.scrollTop, 0)
  expect(after.anchorText).toBe(before.anchorText)
  expect(after.anchorOffset).toBeCloseTo(before.anchorOffset, 0)
})
