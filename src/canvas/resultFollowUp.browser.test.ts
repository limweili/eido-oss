import { expect, test, type Page } from '@playwright/test'

type DevWindow = {
  __eido?: {
    getState: () => { hydrated: boolean }
    setState: (state: unknown) => void
  }
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

async function seedResultWithFollowUp(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    const now = '2026-07-13T00:00:00.000Z'
    const longAnswer = Array.from(
      { length: 18 },
      (_, index) => `Paragraph ${index + 1}. The result and its follow-up should read as one continuous conversation.`,
    ).join('\n\n')

    devWindow.__eido.setState({
      cards: [
        {
          id: 'ask-card',
          kind: 'askAi',
          blocks: [{ id: 'ask-block', text: 'Explore the thought.' }],
          position: { x: 80, y: 120 },
        },
        {
          id: 'result-card',
          kind: 'result',
          blocks: [{ id: 'result-block', text: '' }],
          position: { x: 420, y: 80 },
          size: { width: 520, height: 620 },
        },
      ],
      connections: [
        {
          id: 'ask-result',
          from: { cardId: 'ask-card' },
          to: { cardId: 'result-card' },
          strength: 'strong',
          polarity: 'helps',
          role: 'feeds',
        },
      ],
      outputs: [
        {
          id: 'output',
          resultCardId: 'result-card',
          chosenVersionId: 'version',
          versions: [
            {
              id: 'version',
              number: 1,
              text: longAnswer,
              createdAt: now,
              fromRunId: 'run',
              followUpThread: {
                collapsed: true,
                messages: [
                  { id: 'question', role: 'user', text: 'What changes if we invert it?', createdAt: now, status: 'complete' },
                  { id: 'reply', role: 'assistant', text: 'The inversion becomes part of the same output context.', createdAt: now, status: 'complete' },
                ],
              },
            },
          ],
        },
      ],
      runs: [
        {
          id: 'run',
          startedAt: now,
          finishedAt: now,
          askAiCardId: 'ask-card',
          model: 'openai/gpt-4o-mini',
          usedCardIds: [],
          usedConnectionIds: [],
          modIds: [],
          appliedMods: [],
          compiledInstruction: 'Explore the thought.',
          producedVersionId: 'version',
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

  await page.waitForFunction(() => document.querySelector('[data-id="result-card"]'))
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 80, y: 20, zoom: 1 })
  })
  await page.evaluate(async () => {
    for (let index = 0; index < 2; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  })

  const resultNode = page.locator('.react-flow__node[data-id="result-card"]')
  await resultNode.locator('.card').click()
  await expect(resultNode.locator('.followup-ask')).toBeVisible()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  return resultNode
}

test('follow-up is one continuous transcript with its composer pinned to the card bottom', async ({ page }) => {
  const resultNode = await seedResultWithFollowUp(page)
  const card = resultNode.locator('.card')
  const body = card.locator('.card-body')
  const thread = card.locator('.followup-thread')
  const composer = card.locator('.followup-ask')

  await expect(thread).toContainText('What changes if we invert it?')
  await expect(thread).toContainText('The inversion becomes part of the same output context.')
  await expect(card.getByRole('button', { name: 'Collapse', exact: true })).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Expand', exact: true })).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Clear', exact: true })).toHaveCount(0)

  const layout = await card.evaluate((cardElement) => {
    const bodyElement = cardElement.querySelector<HTMLElement>('.card-body')
    const threadElement = cardElement.querySelector<HTMLElement>('.followup-thread')
    const composerElement = cardElement.querySelector<HTMLElement>('.followup-ask')
    if (!bodyElement || !threadElement || !composerElement) throw new Error('Missing follow-up layout')

    const cardRect = cardElement.getBoundingClientRect()
    const composerRect = composerElement.getBoundingClientRect()
    return {
      bodyScrollable: bodyElement.scrollHeight > bodyElement.clientHeight,
      bodyOverflowY: getComputedStyle(bodyElement).overflowY,
      composerInsideBody: bodyElement.contains(composerElement),
      composerBottomGap: Math.abs(cardRect.bottom - composerRect.bottom),
      threadOverflowY: getComputedStyle(threadElement).overflowY,
      threadHasOwnScroll: threadElement.scrollHeight > threadElement.clientHeight,
    }
  })

  expect(layout.bodyScrollable).toBe(true)
  expect(layout.bodyOverflowY).toBe('auto')
  expect(layout.composerInsideBody).toBe(false)
  expect(layout.composerBottomGap).toBeLessThanOrEqual(2)
  expect(layout.threadOverflowY).toBe('visible')
  expect(layout.threadHasOwnScroll).toBe(false)

  const before = await composer.boundingBox()
  await body.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
  const after = await composer.boundingBox()
  expect(after?.y).toBeCloseTo(before?.y ?? 0, 0)
})

test('follow-up composer starts as one line and grows with multiline input and card reflow', async ({ page }) => {
  const resultNode = await seedResultWithFollowUp(page)
  const composer = resultNode.locator('.followup-ask')
  const input = composer.getByRole('textbox')

  const initial = await input.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      borderRadius: style.borderRadius,
      height: element.getBoundingClientRect().height,
      paddingInline: style.paddingInline,
      resize: style.resize,
      lineHeight: Number.parseFloat(style.lineHeight),
      systemRadius: getComputedStyle(document.documentElement)
        .getPropertyValue('--e-r-chip')
        .trim(),
    }
  })

  expect(initial.height).toBeLessThanOrEqual(32)
  expect(initial.borderRadius).toBe(initial.systemRadius)
  expect(initial.paddingInline).toBe('10px')
  expect(initial.resize).toBe('none')

  await input.fill('First line\nSecond line\nThird line')

  await expect.poll(() => input.evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThan(initial.height + initial.lineHeight)

  await input.fill(
    'A follow-up question should keep every wrapped line visible when the Result card becomes narrower.',
  )
  const wide = await input.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    width: element.getBoundingClientRect().width,
  }))
  await resultNode.evaluate((element) => {
    element.style.width = '300px'
  })
  await expect.poll(() => input.evaluate((element) => element.getBoundingClientRect().width))
    .toBeLessThan(wide.width)
  await expect.poll(() => input.evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThan(wide.height)
})

test('Shift+click extends follow-up input selection without deselecting the Result', async ({ page }) => {
  const resultNode = await seedResultWithFollowUp(page)
  const input = resultNode.locator('.followup-ask').getByRole('textbox')
  await expect(resultNode).toHaveClass(/selected/)
  await input.fill('build out a component')
  await input.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement
    textarea.focus()
    textarea.setSelectionRange(6, 6)
  })

  const box = await input.boundingBox()
  if (!box) throw new Error('Follow-up input is not visible')
  await input.click({
    modifiers: ['Shift'],
    position: { x: box.width - 40, y: box.height / 2 },
  })

  await expect.poll(() => input.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement
    return { start: textarea.selectionStart, end: textarea.selectionEnd }
  })).toMatchObject({ start: 6 })
  expect(await input.evaluate((element) => (element as HTMLTextAreaElement).selectionEnd))
    .toBeGreaterThan(6)
  await expect(resultNode).toHaveClass(/selected/)
})

test('Result and follow-up copy actions write their exact content', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const resultNode = await seedResultWithFollowUp(page)
  const expectedResult = Array.from(
    { length: 18 },
    (_, index) => `Paragraph ${index + 1}. The result and its follow-up should read as one continuous conversation.`,
  ).join('\n\n')

  await page.evaluate(() => navigator.clipboard.writeText('clipboard sentinel'))
  const resultCopy = resultNode.locator('.card-foot').getByRole('button', { name: 'Copy' })
  await resultCopy.click()
  await expect(
    page.locator('.e-tooltip').filter({ hasText: 'Copied' }),
  ).toBeVisible({ timeout: 100 })
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expectedResult)
  await expect(
    resultNode.locator('.card-foot').getByRole('button', { name: 'Copy' }),
  ).toBeVisible({ timeout: 2_000 })

  const followUpCopy = resultNode
    .locator('.followup-bubble.assistant')
    .getByRole('button', { name: 'Copy' })
  await followUpCopy.click()
  await expect(
    page.locator('.e-tooltip').filter({ hasText: 'Copied' }),
  ).toBeVisible({ timeout: 100 })
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
    'The inversion becomes part of the same output context.',
  )
  await expect(
    resultNode.locator('.followup-bubble.assistant').getByRole('button', { name: 'Copied' }),
  ).toBeVisible()
  await expect(followUpCopy).toBeVisible({ timeout: 2_000 })
})

test('streaming a follow-up does not pull a reader who has scrolled away from the bottom', async ({ page }) => {
  const resultNode = await seedResultWithFollowUp(page)
  const body = resultNode.locator('.card-body')

  await body.evaluate((element) => {
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0)

  await page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: {
        getState: () => { outputs: Array<{ versions: Array<{ id: string; followUpThread?: { messages: unknown[] } }> }> }
        setState: (state: unknown) => void
      }
    }
    const state = devWindow.__eido.getState()
    devWindow.__eido.setState({
      outputs: state.outputs.map((output) => ({
        ...output,
        versions: output.versions.map((version) =>
          version.id !== 'version' || !version.followUpThread
            ? version
            : {
                ...version,
                followUpThread: {
                  ...version.followUpThread,
                  messages: version.followUpThread.messages.map((message) =>
                    typeof message === 'object' && message !== null && 'id' in message && message.id === 'reply'
                      ? {
                          ...message,
                          status: 'streaming',
                          text: `${'The inversion becomes part of the same output context. '.repeat(24)}new streamed chunk`,
                        }
                      : message,
                  ),
                },
              },
        ),
      })),
    })
  })

  await expect(resultNode.locator('.followup-bubble.assistant')).toContainText('new streamed chunk')
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0)

  const input = resultNode.locator('.followup-ask').getByRole('textbox')
  const send = resultNode.locator('.followup-ask').getByRole('button', { name: 'Send' })
  await expect(input).toBeEnabled()
  await input.fill('Queue this while the answer streams')
  await input.press('Enter')
  await expect(input).toHaveValue('Queue this while the answer streams\n')
  await expect(send).toBeDisabled()
})

test('selected result text is selectable without dragging the card', async ({ page }) => {
  const resultNode = await seedResultWithFollowUp(page)
  const resultText = resultNode.locator('.result-text.markdown')
  const readingRoot = resultNode.locator('.result-highlight-root')
  const body = resultNode.locator('.card-body')
  await body.evaluate((element) => { element.scrollTop = 0 })
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0)
  const initialTransform = await resultNode.evaluate((element) => element.style.transform)
  const box = await resultText.boundingBox()
  if (!box) throw new Error('Result text is not visible')

  await expect(readingRoot).toHaveClass(/nodrag/)

  await page.mouse.move(box.x + 8, box.y + 12)
  await page.mouse.down()
  await page.mouse.move(box.x + 250, box.y + 12, { steps: 8 })
  await page.mouse.up()

  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).not.toBe('')
  await expect.poll(() => resultNode.evaluate((element) => element.style.transform)).toBe(initialTransform)
})

test('selected follow-up reply text is selectable without dragging the card', async ({ page }) => {
  const resultNode = await seedResultWithFollowUp(page)
  const followUpAnswer = resultNode.locator('.followup-bubble.assistant .bubble-text')
  const readingRoot = resultNode.locator('.result-highlight-root')
  const body = resultNode.locator('.card-body')
  await body.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
  const initialTransform = await resultNode.evaluate((element) => element.style.transform)
  const box = await followUpAnswer.boundingBox()
  if (!box) throw new Error('Follow-up answer is not visible')

  await expect(readingRoot).toHaveClass(/nodrag/)
  expect(await followUpAnswer.evaluate((element) => getComputedStyle(element).userSelect)).toBe('text')

  await page.mouse.move(box.x + 8, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()

  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('inversion')
  await expect.poll(() => resultNode.evaluate((element) => element.style.transform)).toBe(initialTransform)
})

test('the highlighter can mark text in an unselected result card', async ({ page }) => {
  const resultNode = await seedResultWithFollowUp(page)
  const resultText = resultNode.locator('.result-text.markdown')
  const readingRoot = resultNode.locator('.result-highlight-root')
  const body = resultNode.locator('.card-body')

  await page.getByRole('button', { name: 'Highlighter', exact: true }).click()
  await expect(resultNode).not.toHaveClass(/selected/)
  await expect(readingRoot).toHaveClass(/nodrag/)
  await expect(readingRoot).toHaveClass(/nopan/)
  await body.evaluate((element) => { element.scrollTop = 0 })
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0)
  const box = await resultText.boundingBox()
  if (!box) throw new Error('Result text is not visible')

  await page.mouse.move(box.x + 8, box.y + 12)
  await page.mouse.down()
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('highlight-drag'))).toBe(true)
  await page.mouse.move(box.x + 250, box.y + 12, { steps: 8 })
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).not.toBe('')
  await page.mouse.up()

  await expect.poll(() => page.evaluate(() => {
    const devWindow = window as unknown as { __eido: { getState: () => { highlights: unknown[] } } }
    return devWindow.__eido.getState().highlights.length
  })).toBe(1)
})

test('the highlighter can mark follow-up text in a result card', async ({ page }) => {
  const resultNode = await seedResultWithFollowUp(page)
  const followUpAnswer = resultNode.locator('.followup-bubble.assistant .bubble-text')
  const readingRoot = resultNode.locator('.result-highlight-root')

  await page.getByRole('button', { name: 'Highlighter', exact: true }).click()
  await expect(resultNode).not.toHaveClass(/selected/)
  await expect(readingRoot).toHaveClass(/nodrag/)
  await expect(readingRoot).toHaveClass(/nopan/)
  const box = await followUpAnswer.boundingBox()
  if (!box) throw new Error('Follow-up answer is not visible')

  await page.mouse.move(box.x + 8, box.y + box.height / 2)
  await page.mouse.down()
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('highlight-drag'))).toBe(true)
  await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2, { steps: 8 })
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).not.toBe('')
  await page.mouse.up()

  await expect.poll(() => page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: { getState: () => { highlights: Array<{ text: string }> } }
    }
    return devWindow.__eido.getState().highlights[0]?.text ?? ''
  })).toContain('inversion')
  await expect(followUpAnswer.locator('mark.painted-highlight')).toContainText('inversion')
})
