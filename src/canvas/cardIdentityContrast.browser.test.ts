import { expect, test, type Page } from '@playwright/test'
import type { Card, Connection, Output, RunRecord } from '../graph/types'
import {
  CARD_IDENTITIES,
  resolveCardIdentity,
  type CardBodyForegrounds,
} from '../ui/cardIdentity'
import { DESIGN_TOKENS, type DesignTokenName } from '../ui/tokens'

type EidoDevStore = {
  getState: () => { hydrated: boolean }
  setState: (state: unknown) => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

type Theme = 'light' | 'dark'
type Surface = 'live' | 'playback'
type Channels = readonly [number, number, number]

const THEMES = ['light', 'dark'] as const satisfies readonly Theme[]
const SURFACES = ['live', 'playback'] as const satisfies readonly Surface[]
const BROWSER_IDENTITIES = [
  ...CARD_IDENTITIES,
  { name: 'Custom mid-gap', solid: '#777777' },
] as const

type BoardFixture = {
  cards: Card[]
  connections?: Connection[]
  outputs?: Output[]
  runs?: RunRecord[]
  intentLog?: unknown[]
}

function parseHex(color: string): Channels {
  return [
    Number.parseInt(color.slice(1, 3), 16) / 255,
    Number.parseInt(color.slice(3, 5), 16) / 255,
    Number.parseInt(color.slice(5, 7), 16) / 255,
  ]
}

function parseComputedColor(color: string): Channels {
  const srgb = color.match(
    /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+)?\)$/,
  )
  if (srgb) return [Number(srgb[1]), Number(srgb[2]), Number(srgb[3])]

  const rgb = color.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*[\d.]+)?\s*\)$/,
  )
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255]

  throw new Error(`Expected a computed sRGB colour, received ${color}`)
}

function halfSrgb(left: string, right: string): Channels {
  const leftChannels = parseHex(left)
  const rightChannels = parseHex(right)
  return [
    (leftChannels[0] + rightChannels[0]) / 2,
    (leftChannels[1] + rightChannels[1]) / 2,
    (leftChannels[2] + rightChannels[2]) / 2,
  ]
}

function relativeLuminance(channels: Channels): number {
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(parseComputedColor(foreground))
  const backgroundLuminance = relativeLuminance(parseComputedColor(background))
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  )
}

function expectChannels(actual: string, expected: Channels, label: string) {
  parseComputedColor(actual).forEach((channel, index) => {
    expect(channel, `${label} channel ${index}`).toBeCloseTo(expected[index]!, 5)
  })
}

async function openBoard(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })
}

async function setBoardFixture(
  page: Page,
  fixture: BoardFixture,
  viewport = { x: 90, y: 70, zoom: 0.62 },
) {
  await page.evaluate(({ nextFixture }) => {
    const store = (window as unknown as DevWindow & { __eido: EidoDevStore }).__eido
    store.setState({
      cards: nextFixture.cards,
      connections: nextFixture.connections ?? [],
      outputs: nextFixture.outputs ?? [],
      runs: nextFixture.runs ?? [],
      intentLog: nextFixture.intentLog ?? [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
  }, { nextFixture: fixture })

  for (let pin = 0; pin < 2; pin += 1) {
    await page.evaluate((nextViewport) => {
      ;(window as unknown as DevWindow).__EIDO_SET_VIEWPORT__?.(nextViewport)
    }, viewport)
    await page.waitForTimeout(100)
  }
}

async function seedIdentityCards(page: Page, cards: readonly Card[]) {
  const createdAt = '2026-07-17T00:00:00.000Z'
  const completedAt = '2026-07-17T00:00:01.000Z'
  const intentLog = [
    ...cards.map((card, index) => ({
      id: `identity-contrast-created-${index}`,
      at: createdAt,
      type: 'card.created',
      cardId: card.id,
      data: { card },
    })),
    {
      id: 'identity-contrast-run-completed',
      at: completedAt,
      type: 'run.completed',
      runId: 'identity-contrast-run',
      data: {
        run: {
          id: 'identity-contrast-run',
          startedAt: createdAt,
          completedAt,
          status: 'done',
        },
      },
    },
  ]

  await openBoard(page)
  await setBoardFixture(page, { cards: [...cards], intentLog })
}

async function applyTheme(page: Page, theme: Theme) {
  await page.locator('html').evaluate((element, nextTheme) => {
    ;(element as HTMLElement).dataset.theme = nextTheme
  }, theme)
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
}

async function inspectCard(page: Page, cardId: string, surface: Surface) {
  const root = page.locator(
    `.react-flow__node[data-id="${cardId}"] ${surface === 'live' ? '.card' : '.playback-card'}`,
  )
  await expect(root).toBeVisible()
  return root.evaluate((element, nextSurface) => {
    const body = element.querySelector<HTMLElement>('.card-body')!
    const head = element.querySelector<HTMLElement>('.card-head')!
    const title = element.querySelector<HTMLElement>('.card-title-display')!
    const actualBodyText = element.querySelector<HTMLElement>(
      nextSurface === 'live' ? '.note-render' : '.playback-card-text',
    )!
    const badge = element.querySelector<HTMLElement>('.playback-asset-count')

    return {
      body: getComputedStyle(body).backgroundColor,
      head: getComputedStyle(head).backgroundColor,
      title: getComputedStyle(title).color,
      actualBodyText: getComputedStyle(actualBodyText).color,
      badge: badge
        ? {
            color: getComputedStyle(badge).color,
            background: getComputedStyle(badge).backgroundColor,
          }
        : undefined,
    }
  }, surface)
}

type ExpectedForeground =
  | { identityRole: keyof CardBodyForegrounds }
  | { token: DesignTokenName }

type AuthenticTextSample = {
  cardId: string
  selector: string
  label: string
  expected: ExpectedForeground
}

function makeRunRecord({
  id,
  askAiCardId,
  status,
  producedVersionId,
  kind,
}: {
  id: string
  askAiCardId: string
  status: RunRecord['status']
  producedVersionId?: string
  kind?: RunRecord['kind']
}): RunRecord {
  return {
    id,
    startedAt: '2026-07-17T00:00:00.000Z',
    finishedAt: status === 'running' ? undefined : '2026-07-17T00:00:01.000Z',
    askAiCardId,
    model: 'openai/test-model',
    usedCardIds: [],
    usedConnectionIds: [],
    modIds: [],
    appliedMods: [],
    compiledInstruction: 'Browser contrast fixture',
    producedVersionId,
    status,
    kind,
  }
}

function makeAuthenticFixture(identity: (typeof BROWSER_IDENTITIES)[number], index: number): {
  fixture: BoardFixture
  samples: AuthenticTextSample[]
} {
  const slug = `${index}-${identity.name.toLowerCase().replace(/ /g, '-')}`
  const noteId = `role-note-${slug}`
  const askId = `role-ask-${slug}`
  const resultId = `role-result-${slug}`
  const conversationId = `role-conversation-${slug}`
  const conversationResultId = `role-conversation-result-${slug}`
  const resultVersionId = `role-result-version-${slug}`
  const conversationVersionId = `role-conversation-version-${slug}`
  const resultRunId = `role-result-run-${slug}`
  const conversationRunId = `role-conversation-run-${slug}`
  const createdAt = '2026-07-17T00:00:00.000Z'
  const identityFields = {
    headerColor: identity.solid,
    headerFill: 'full' as const,
  }

  const cards: Card[] = [
    {
      id: noteId,
      kind: 'note',
      title: `${identity.name} note`,
      blocks: [{ id: `${noteId}-block`, text: '[Real note link](https://example.com/note)' }],
      assets: [{
        id: `${noteId}-asset`,
        kind: 'file',
        name: `${identity.name} brief.pdf`,
        mimeType: 'application/pdf',
        dataUrl: 'data:application/pdf;base64,JVBERi0=',
        size: 24_576,
        createdAt,
      }],
      position: { x: 40, y: 30 },
      size: { width: 320, height: 240 },
      ...identityFields,
    },
    {
      id: askId,
      kind: 'askAi',
      title: `${identity.name} ask`,
      blocks: [{ id: `${askId}-block`, text: 'Ask AI instruction' }],
      model: 'openai/test-model',
      position: { x: 400, y: 30 },
      size: { width: 320, height: 300 },
      ...identityFields,
    },
    {
      id: resultId,
      kind: 'result',
      title: `${identity.name} result`,
      blocks: [],
      position: { x: 760, y: 30 },
      size: { width: 320, height: 430 },
      ...identityFields,
    },
    {
      id: conversationId,
      kind: 'conversation',
      title: `${identity.name} conversation`,
      blocks: [{ id: `${conversationId}-block`, text: 'Conversation topic' }],
      conversationStyle: 'critique',
      conversationTurns: 4,
      position: { x: 40, y: 500 },
      size: { width: 320, height: 330 },
      ...identityFields,
    },
    {
      id: conversationResultId,
      kind: 'result',
      title: `${identity.name} conversation result`,
      blocks: [],
      position: { x: 400, y: 500 },
      size: { width: 320, height: 430 },
      ...identityFields,
    },
  ]

  const connections: Connection[] = [
    {
      id: `role-result-connection-${slug}`,
      from: { cardId: askId },
      to: { cardId: resultId },
      strength: 'strong',
      polarity: 'helps',
      role: 'feeds',
    },
    {
      id: `role-conversation-connection-${slug}`,
      from: { cardId: conversationId },
      to: { cardId: conversationResultId },
      strength: 'strong',
      polarity: 'helps',
      role: 'feeds',
    },
  ]

  const outputs: Output[] = [
    {
      id: `role-result-output-${slug}`,
      resultCardId: resultId,
      chosenVersionId: resultVersionId,
      versions: [{
        id: resultVersionId,
        number: 1,
        text: [
          'Rendered [result link](https://example.com/result).',
          '',
          '| Local | Surface |',
          '| --- | --- |',
          '| table | cell |',
        ].join('\n'),
        createdAt,
        fromRunId: resultRunId,
        provisional: true,
        provisionalReason: 'failed',
        provisionalMessage: 'The result stopped after an error.',
        followUpThread: {
          messages: [
            {
              id: `role-followup-user-${slug}`,
              role: 'user',
              text: 'Please clarify.',
              createdAt,
              status: 'complete',
            },
            {
              id: `role-followup-stopped-${slug}`,
              role: 'assistant',
              text: '',
              createdAt,
              status: 'stopped',
            },
            {
              id: `role-followup-failed-${slug}`,
              role: 'assistant',
              text: 'Partial answer before failure.',
              createdAt,
              status: 'failed',
            },
          ],
        },
      }],
    },
    {
      id: `role-conversation-output-${slug}`,
      resultCardId: conversationResultId,
      chosenVersionId: conversationVersionId,
      versions: [{
        id: conversationVersionId,
        number: 1,
        text: 'Participant answer\nUser interjection',
        createdAt,
        fromRunId: conversationRunId,
        provisional: true,
        provisionalReason: 'failed',
        provisionalMessage: 'Conversation stopped after an error.',
        transcript: [
          {
            id: `role-speaker-${slug}`,
            speakerKind: 'participant',
            speakerName: 'Researcher',
            participantCardId: askId,
            text: 'Participant answer',
          },
          {
            id: `role-user-${slug}`,
            speakerKind: 'user',
            speakerName: 'You',
            text: 'User interjection',
          },
          {
            id: `role-streaming-${slug}`,
            speakerKind: 'participant',
            speakerName: 'Reviewer',
            participantCardId: askId,
            text: '',
            streaming: true,
          },
        ],
      }],
    },
  ]

  const runs: RunRecord[] = [
    makeRunRecord({
      id: `role-ask-running-${slug}`,
      askAiCardId: askId,
      status: 'running',
    }),
    {
      ...makeRunRecord({
        id: resultRunId,
        askAiCardId: askId,
        status: 'done',
        producedVersionId: resultVersionId,
      }),
      contextBudget: {
        budgetTokens: 100,
        estimatedTokens: 120,
        finalTokens: 90,
        compactedCardIds: [],
        droppedCardIds: [noteId],
        mode: 'when-needed',
      },
    },
    makeRunRecord({
      id: `role-conversation-running-${slug}`,
      askAiCardId: conversationId,
      status: 'running',
      kind: 'conversation',
    }),
    makeRunRecord({
      id: conversationRunId,
      askAiCardId: conversationId,
      status: 'failed',
      producedVersionId: conversationVersionId,
      kind: 'conversation',
    }),
  ]

  return {
    fixture: { cards, connections, outputs, runs },
    samples: [
      { cardId: noteId, selector: '.note-render a', label: 'Note markdown link', expected: { identityRole: 'goInk' } },
      { cardId: noteId, selector: '.asset-file-name', label: 'Note file name', expected: { token: '--e-ink' } },
      { cardId: noteId, selector: '.asset-file-size', label: 'Note file metadata', expected: { token: '--e-ink-soft' } },
      { cardId: noteId, selector: '.asset-file-icon', label: 'Note file type badge', expected: { token: '--e-ink' } },
      { cardId: askId, selector: '.card-kind', label: 'Ask kind', expected: { identityRole: 'inkSoft' } },
      { cardId: askId, selector: '.model-pick-label', label: 'Ask model label', expected: { identityRole: 'inkSoft' } },
      { cardId: askId, selector: '.e-state-word--running', label: 'Ask running status', expected: { token: '--e-convo-ink' } },
      { cardId: resultId, selector: '.result-text', label: 'Result text', expected: { identityRole: 'ink' } },
      { cardId: resultId, selector: '.result-text a', label: 'Result markdown link', expected: { identityRole: 'goInk' } },
      { cardId: resultId, selector: '.result-text td', label: 'Result table cell', expected: { identityRole: 'ink' } },
      { cardId: resultId, selector: '.followup-bubble.assistant .bubble-text.result-empty', label: 'Result empty follow-up text', expected: { token: '--e-ink-soft' } },
      { cardId: resultId, selector: '.followup-status:not(.warn)', label: 'Result stopped follow-up status', expected: { token: '--e-ink-soft' } },
      { cardId: resultId, selector: '.followup-status.warn', label: 'Result failed follow-up status', expected: { token: '--e-avoid-ink' } },
      { cardId: resultId, selector: '.budget-marker', label: 'Result attention status', expected: { token: '--e-ink' } },
      { cardId: conversationId, selector: '.card-kind', label: 'Conversation kind', expected: { identityRole: 'inkSoft' } },
      { cardId: conversationId, selector: '.model-pick-label', label: 'Conversation setting label', expected: { identityRole: 'inkSoft' } },
      { cardId: conversationId, selector: '.e-state-word--running', label: 'Conversation running status', expected: { token: '--e-convo-ink' } },
      { cardId: conversationResultId, selector: '.bubble.participant .bubble-text.result-empty', label: 'Conversation streaming placeholder', expected: { token: '--e-ink-soft' } },
    ],
  }
}

async function inspectAuthenticText(page: Page, sample: AuthenticTextSample) {
  const target = page.locator(
    `.react-flow__node[data-id="${sample.cardId}"] .card ${sample.selector}`,
  ).first()
  await expect(target, sample.label).toHaveCount(1)
  return target.evaluate((element) => {
    type Rgba = [number, number, number, number]
    const parseColor = (color: string): Rgba => {
      const srgb = color.match(
        /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/,
      )
      if (srgb) {
        return [Number(srgb[1]), Number(srgb[2]), Number(srgb[3]), Number(srgb[4] ?? 1)]
      }
      const rgb = color.match(
        /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/,
      )
      if (rgb) {
        return [
          Number(rgb[1]) / 255,
          Number(rgb[2]) / 255,
          Number(rgb[3]) / 255,
          Number(rgb[4] ?? 1),
        ]
      }
      if (color === 'transparent') return [0, 0, 0, 0]
      throw new Error(`Cannot composite computed color ${color}`)
    }
    const paintedBackground = (start: Element): string => {
      const layers: Rgba[] = []
      let current: Element | null = start
      while (current) {
        const background = parseColor(getComputedStyle(current).backgroundColor)
        if (background[3] > 0) layers.push(background)
        if (background[3] >= 1) break
        current = current.parentElement
      }
      if (!layers.length) throw new Error('No painted ancestor background')

      let composite = layers[layers.length - 1]!
      for (let index = layers.length - 2; index >= 0; index -= 1) {
        const foreground = layers[index]!
        const alpha = foreground[3] + composite[3] * (1 - foreground[3])
        composite = [
          (foreground[0] * foreground[3] + composite[0] * composite[3] * (1 - foreground[3])) / alpha,
          (foreground[1] * foreground[3] + composite[1] * composite[3] * (1 - foreground[3])) / alpha,
          (foreground[2] * foreground[3] + composite[2] * composite[3] * (1 - foreground[3])) / alpha,
          alpha,
        ]
      }
      return `color(srgb ${composite[0]} ${composite[1]} ${composite[2]})`
    }
    const content = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.value || element.placeholder
      : element.textContent
    return {
      color: getComputedStyle(element).color,
      background: paintedBackground(element),
      content: content?.trim() ?? '',
    }
  })
}

test('palette and custom full-fill identities keep real live and Playback text AA in both themes', async ({
  page,
}) => {
  const cards = BROWSER_IDENTITIES.map((identity, index): Card => ({
    id: `body-contrast-${identity.name.toLowerCase().replace(/ /g, '-')}`,
    kind: 'note',
    blocks: [{
      id: `body-contrast-block-${index}`,
      text: `${identity.name} body text with [an actual link](https://example.com/${index})`,
    }],
    assets: [{
      id: `body-contrast-asset-${index}`,
      kind: 'file',
      name: `${identity.name}.txt`,
      mimeType: 'text/plain',
      dataUrl: 'data:text/plain;base64,WA==',
      size: 1,
      createdAt: '2026-07-17T00:00:00.000Z',
    }],
    position: { x: 70 + (index % 4) * 270, y: 60 + Math.floor(index / 4) * 190 },
    size: { width: 230, height: 150 },
    title: identity.name,
    headerColor: identity.solid,
    headerFill: 'full',
  }))
  await seedIdentityCards(page, cards)
  await expect(page.locator('.react-flow__node:not(.react-flow__node-gestureProxy) .card')).toHaveCount(
    BROWSER_IDENTITIES.length,
  )

  for (const surface of SURFACES) {
    if (surface === 'playback') {
      await page.getByRole('button', { name: 'Playback', exact: true }).click()
      // Playback opens at the first event; inspect the completed fixture.
      await page.getByRole('slider', { name: 'Playback', exact: true }).fill('1000')
      await expect(page.locator('.playback-card')).toHaveCount(BROWSER_IDENTITIES.length)
    }

    for (const theme of THEMES) {
      await applyTheme(page, theme)
      for (const identity of BROWSER_IDENTITIES) {
        const sample = await inspectCard(
          page,
          `body-contrast-${identity.name.toLowerCase().replace(/ /g, '-')}`,
          surface,
        )
        const resolved = resolveCardIdentity(identity.solid)
        const expectedBodyInk = parseHex(
          theme === 'light'
            ? resolved.bodyForegroundsLight.ink
            : resolved.bodyForegroundsDark.ink,
        )
        const label = `${surface} ${theme} ${identity.name}`

        expectChannels(
          sample.body,
          halfSrgb(identity.solid, DESIGN_TOKENS[theme]['--e-surface-card']),
          `${label} body`,
        )
        expectChannels(sample.title, parseHex(resolved.onSolid), `${label} title`)
        expect(contrastRatio(sample.title, sample.head), `${label} header contrast`).toBeGreaterThanOrEqual(4.5)
        expectChannels(sample.actualBodyText, expectedBodyInk, `${label} actual body text`)
        expect(
          contrastRatio(sample.actualBodyText, sample.body),
          `${label} actual body contrast`,
        ).toBeGreaterThanOrEqual(4.5)

        if (sample.badge) {
          const expectedAssetInk = parseHex(
            theme === 'light'
              ? resolved.bodyForegroundsLight.inkSoft
              : resolved.bodyForegroundsDark.inkSoft,
          )
          expect(sample.badge.background, `${label} asset background`).toBe('rgba(0, 0, 0, 0)')
          expectChannels(sample.badge.color, expectedAssetInk, `${label} asset text`)
          expect(
            contrastRatio(sample.badge.color, sample.body),
            `${label} asset contrast`,
          ).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  }
})

test('actual Note, Ask, Result, and Conversation text roles stay AA for every identity', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await openBoard(page)

  for (const [index, identity] of BROWSER_IDENTITIES.entries()) {
    const { fixture, samples } = makeAuthenticFixture(identity, index)
    await setBoardFixture(page, fixture, { x: 70, y: 50, zoom: 0.55 })

    for (const card of fixture.cards) {
      await expect(
        page.locator(`.react-flow__node[data-id="${card.id}"] .card`),
        `${identity.name} ${card.kind}`,
      ).toHaveCount(1)
    }

    const resolved = resolveCardIdentity(identity.solid)
    for (const theme of THEMES) {
      await applyTheme(page, theme)
      const identityForegrounds = theme === 'light'
        ? resolved.bodyForegroundsLight
        : resolved.bodyForegroundsDark

      for (const sample of samples) {
        const actual = await inspectAuthenticText(page, sample)
        const expected = 'identityRole' in sample.expected
          ? identityForegrounds[sample.expected.identityRole]
          : DESIGN_TOKENS[theme][sample.expected.token]
        const label = `${identity.name} ${theme} ${sample.label}`

        expect(actual.content, `${label} authentic content`).not.toBe('')
        expectChannels(actual.color, parseHex(expected), `${label} foreground`)
        expect(
          contrastRatio(actual.color, actual.background),
          `${label} contrast against ${actual.background}`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  }
})
