import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card, Connection } from '../graph/types'
import { useGraph } from '../graph/store'
import { PROFILE_REVIEW_MODEL } from '../shared/profileReviewPolicy'
import { planAskRun, planChainRun } from './executionPlan'
import { researchJobOf } from './researchJobMeta'
import { provenanceForVersion } from './provenance'
import { createSeedMod } from '../mods/seeds'
import { snapshotModValues } from '../mods/snapshot'
import {
  cancelAiRun,
  cancelChain,
  resumeResearchRun,
  runAgentVariation,
  runCard,
  runChain,
  runGroupCompression,
  type CompletionStream,
} from './runEngine'
function resetStore() {
  useGraph.setState({
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    compactionSummaries: [],
    selection: null,
    selectedCardIds: [],
    undoStack: [],
    redoStack: [],
    saveState: 'saved',
    hydrated: false,
    currentIdeaId: null,
    keyPromptOpen: false,
    settings: {
      apiKey: 'test-key',
      model: 'default/model',
      models: ['default/model'],
      reasoningEffort: 'medium',
    },
  })
}

function card(id: string, kind: Card['kind'], extra: Partial<Card> = {}): Card {
  return { id, kind, blocks: [{ id: `${id}-b`, text: '' }], position: { x: 0, y: 0 }, ...extra }
}

function feed(id: string, from: string, to: string, meta: Connection['meta'] = undefined): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: to },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
    meta,
  }
}

function versionById(versionId: string) {
  for (const output of useGraph.getState().outputs) {
    const version = output.versions.find((candidate) => candidate.id === versionId)
    if (version) return version
  }
  return undefined
}

function streamingResponse(text = 'Done') {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`),
      )
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  }), { status: 200 })
}

beforeEach(resetStore)
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runEngine Ask AI', () => {
  it('keeps the eighth admitted variation within the provider temperature bound', async () => {
    useGraph.setState({
      cards: [card('ask', 'askAi', {
        blocks: [{ id: 'ask-b', text: 'Offer a direction.' }],
      })],
    })
    const bodies: Array<{ temperature?: number }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, request?: RequestInit) => {
      bodies.push(JSON.parse(String(request?.body)) as { temperature?: number })
      return streamingResponse()
    }))

    await expect(runAgentVariation('ask', {
      admittedPlan: planAskRun(useGraph.getState().snapshot(), 'ask'),
      chainPlan: planChainRun(useGraph.getState().snapshot(), 'ask'),
      admissionGuard: () => true,
      triggeredBy: { kind: 'agent', client: 'codex', sessionId: 'session-variation-8' },
      variationIndex: 8,
      variationCount: 8,
    })).resolves.toMatchObject({ ok: true, status: 'done' })
    expect(bodies).toHaveLength(1)
    expect(bodies[0]?.temperature).toBe(2)
  })

  it('runs a card with only its own task text and no connected context', async () => {
    useGraph.setState({
      cards: [
        card('ask', 'askAi', { blocks: [{ id: 'ask-b', text: 'Write three story ideas.' }] }),
      ],
    })

    let streamedInstruction = ''
    const stream: CompletionStream = async (instruction, opts) => {
      streamedInstruction = instruction
      opts.onChunk('1. A moonlit library.')
      return '1. A moonlit library.'
    }

    const outcome = await runCard('ask', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    if (!outcome.ok || !outcome.versionId) throw new Error('expected completed version')

    expect(streamedInstruction).toContain('## TASK\nWrite three story ideas.')
    const version = versionById(outcome.versionId)!
    expect(version.text).toBe('1. A moonlit library.')

    const run = useGraph.getState().runs.find((candidate) => candidate.producedVersionId === outcome.versionId)!
    expect(run.status).toBe('done')
    expect(run.triggeredBy).toBeUndefined()
    expect(run.usedCardIds).toEqual([])
    expect(run.usedConnectionIds).toEqual([])
  })

  it('sends the fixed v2 MODS block and records its detached applied provenance', async () => {
    const mod = createSeedMod('select')
    useGraph.setState({
      cards: [
        card('ask', 'askAi', { blocks: [{ id: 'ask-b', text: 'Write the launch note.' }] }),
        card('audience', 'mod', { modV2: mod }),
      ],
      connections: [feed('audience-ask', 'audience', 'ask')],
    })
    let sent = ''
    const stream: CompletionStream = async (instruction, opts) => {
      sent = instruction
      opts.onChunk('A launch note.')
      return 'A launch note.'
    }

    const outcome = await runCard('ask', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    expect(sent).toContain(
      '## MODS\n' +
      'Mods are hand-set controls the user tuned for this request. Each one\n' +
      'states how to read its values, then speaks them. Follow them exactly.\n\n' +
      '### AUDIENCE\n' +
      'How to read it: One option is picked at a time. Follow its prompt and ignore the rest.\n' +
      '- Write for a founder: outcomes first, no hand-holding.',
    )
    const run = useGraph.getState().runs.find((candidate) => candidate.kind === 'ask')!
    expect(run.appliedMods).toEqual([{
      modVersion: 2,
      modCardId: 'audience',
      controlValues: snapshotModValues(mod),
      appliedInstructions: [
        'One option is picked at a time. Follow its prompt and ignore the rest.',
        'Write for a founder: outcomes first, no hand-holding.',
      ],
    }])
    expect(run.modIds).toEqual(['audience'])
  })

  it('uses the fixed review model for Ask and Group execution provenance', async () => {
    vi.stubGlobal('window', {
      eidoDesktop: true,
      eidoProfileReview: true,
    })
    useGraph.setState({
      cards: [
        card('ask', 'askAi', {
          model: 'ask/override',
          blocks: [{ id: 'ask-b', text: 'Write three story ideas.' }],
        }),
        card('group', 'group', {
          model: 'group/override',
          title: 'Research',
          compressionPrompt: 'Compress this.',
        }),
        card('note', 'note', {
          groupId: 'group',
          blocks: [{ id: 'note-b', text: 'A member thought.' }],
        }),
      ],
    })
    const models: string[] = []
    const stream: CompletionStream = async (_instruction, opts) => {
      models.push(opts.model)
      opts.onChunk('done')
      return 'done'
    }

    expect(await runCard('ask', { stream })).toMatchObject({ ok: true, status: 'done' })
    expect(await runGroupCompression('group', { stream })).toMatchObject({ ok: true, status: 'done' })

    expect(models).toEqual([PROFILE_REVIEW_MODEL, PROFILE_REVIEW_MODEL])
    expect(useGraph.getState().runs.map((run) => run.model)).toEqual([
      PROFILE_REVIEW_MODEL,
      PROFILE_REVIEW_MODEL,
    ])
  })
})

describe('runEngine cancellation', () => {
  it('stops an active Ask AI stream and keeps partial output as a canceled provisional version', async () => {
    useGraph.setState({
      cards: [
        card('ask', 'askAi', { blocks: [{ id: 'ask-b', text: 'Summarise.' }] }),
        card('note', 'note', { blocks: [{ id: 'note-b', text: 'One useful thought.' }] }),
      ],
      connections: [feed('note-ask', 'note', 'ask')],
    })

    const stream: CompletionStream = async (_instruction, opts) => {
      opts.onChunk('partial answer')
      cancelAiRun('ask')
      expect(opts.signal?.aborted).toBe(true)
      throw new DOMException('Aborted', 'AbortError')
    }

    const outcome = await runCard('ask', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'canceled' })
    if (!outcome.ok || !outcome.versionId) throw new Error('expected canceled version')

    const version = versionById(outcome.versionId)!
    expect(version.text).toBe('partial answer')
    expect(version.provisional).toBe(true)
    expect(version.provisionalReason).toBe('canceled')

    const run = useGraph.getState().runs.find((candidate) => candidate.producedVersionId === outcome.versionId)!
    expect(run.status).toBe('canceled')
    expect(run.kind).toBe('ask')
  })

  it('stops a Group compression stream and keeps the partial digest as provisional', async () => {
    useGraph.setState({
      cards: [
        card('group', 'group', { title: 'Group', compressionPrompt: 'Compress this.' }),
        card('note', 'note', {
          groupId: 'group',
          blocks: [{ id: 'note-b', text: 'A member thought.' }],
        }),
      ],
    })

    const stream: CompletionStream = async (_instruction, opts) => {
      opts.onChunk('partial digest')
      cancelAiRun('group')
      expect(opts.signal?.aborted).toBe(true)
      throw new DOMException('Aborted', 'AbortError')
    }

    const outcome = await runGroupCompression('group', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'canceled' })
    if (!outcome.ok || !outcome.versionId) throw new Error('expected canceled version')

    const output = useGraph.getState().outputs.find((candidate) => candidate.resultCardId === 'group')!
    const version = output.versions.find((candidate) => candidate.id === outcome.versionId)!
    expect(version.text).toBe('partial digest')
    expect(version.provisional).toBe(true)
    expect(version.provisionalReason).toBe('canceled')

    const run = useGraph.getState().runs.find((candidate) => candidate.producedVersionId === outcome.versionId)!
    expect(run.status).toBe('canceled')
    expect(run.kind).toBe('groupDigest')
  })

  it('lets Ask AI cancellation stop an implicit compressed-group run before the Ask result begins', async () => {
    const triggeredBy = { kind: 'agent' as const, client: 'codex-desktop', sessionId: 'session-digest' }
    useGraph.setState({
      cards: [
        card('ask', 'askAi', { blocks: [{ id: 'ask-b', text: 'Use the group.' }] }),
        card('group', 'group', { title: 'Group', compressionPrompt: 'Compress this.' }),
        card('note', 'note', {
          groupId: 'group',
          blocks: [{ id: 'note-b', text: 'A grouped thought.' }],
        }),
      ],
      connections: [feed('group-ask', 'group', 'ask', { groupMode: 'compress' })],
    })

    const stream: CompletionStream = async (_instruction, opts) => {
      opts.onChunk('group partial')
      cancelAiRun('ask')
      expect(opts.signal?.aborted).toBe(true)
      throw new DOMException('Aborted', 'AbortError')
    }

    const outcome = await runCard('ask', { stream, triggeredBy })

    expect(outcome).toMatchObject({ ok: true, status: 'canceled' })
    const groupRun = useGraph.getState().runs.find((candidate) => candidate.kind === 'groupDigest')!
    expect(groupRun.status).toBe('canceled')
    expect(groupRun.triggeredBy).toEqual(triggeredBy)
    expect(versionById(groupRun.producedVersionId!)?.text).toBe('group partial')
    expect(useGraph.getState().runs.filter((candidate) => candidate.kind === 'ask')).toHaveLength(0)
    expect(useGraph.getState().undoStack).toEqual([])
  })
})

describe('runEngine context budget (ADR 0015)', () => {
  // Big enough to blow the 102.4k-token budget of the fallback 128k window.
  const HUGE = 'A fact worth keeping. '.repeat(22_000) // ~484k printable chars ≈ 121k tokens

  function budgetBoard() {
    useGraph.setState({
      cards: [
        card('ask', 'askAi', { blocks: [{ id: 'ask-b', text: 'Summarise everything.' }] }),
        card('small-note', 'note', { blocks: [{ id: 'sn-b', text: 'A small strong thought.' }] }),
        card('huge-note', 'note', { blocks: [{ id: 'hn-b', text: HUGE }] }),
      ],
      connections: [
        feed('c1', 'small-note', 'ask'),
        { ...feed('c2', 'huge-note', 'ask'), strength: 'weak' as const },
      ],
    })
  }

  function budgetStream(calls: { compaction: string[]; main: string[] }): CompletionStream {
    return async (instruction, opts) => {
      if (instruction.startsWith('Shorten the following context')) {
        calls.compaction.push(instruction)
        opts.onChunk('THE-SHORT-SUMMARY')
        return 'THE-SHORT-SUMMARY'
      }
      calls.main.push(instruction)
      opts.onChunk('final answer')
      return 'final answer'
    }
  }

  it('compacts the weakest oversized context, applies the summary, and records provenance', async () => {
    budgetBoard()
    const calls = { compaction: [] as string[], main: [] as string[] }

    const outcome = await runCard('ask', { stream: budgetStream(calls) })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    expect(calls.compaction).toHaveLength(1)
    expect(calls.compaction[0]).toContain('A fact worth keeping.')
    // The instruction sent carries the summary, not the huge original.
    expect(calls.main).toHaveLength(1)
    expect(calls.main[0]).toContain('THE-SHORT-SUMMARY')
    expect(calls.main[0]).not.toContain(HUGE.slice(0, 2000))
    // The small strong note stays full text.
    expect(calls.main[0]).toContain('A small strong thought.')

    const run = useGraph.getState().runs.find((r) => r.status === 'done')!
    expect(run.contextBudget?.compactedCardIds).toEqual(['huge-note'])
    expect(run.contextBudget?.droppedCardIds).toEqual([])
    expect(run.contextBudget?.mode).toBe('when-needed')
    // The huge card stays in usedCardIds so staleness still watches it.
    expect(run.usedCardIds).toContain('huge-note')
  })

  it('reuses the cached summary on the next run — no second compaction call', async () => {
    budgetBoard()
    const calls = { compaction: [] as string[], main: [] as string[] }
    const stream = budgetStream(calls)

    await runCard('ask', { stream })
    await runCard('ask', { stream })

    expect(calls.compaction).toHaveLength(1)
    expect(calls.main).toHaveLength(2)
    expect(calls.main[1]).toContain('THE-SHORT-SUMMARY')
    // The summary is cached on the board, fingerprint-keyed.
    const cached = useGraph.getState().compactionSummaries
    expect(cached).toHaveLength(1)
    expect(cached[0].cardId).toBe('huge-note')
  })
  it('never mode drops instead of compacting and reports it', async () => {
    budgetBoard()
    useGraph.setState({
      settings: { ...useGraph.getState().settings, compactionMode: 'never' },
    })
    const calls = { compaction: [] as string[], main: [] as string[] }

    const outcome = await runCard('ask', { stream: budgetStream(calls) })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    expect(calls.compaction).toHaveLength(0)
    expect(calls.main[0]).not.toContain('A fact worth keeping. A fact worth keeping.')

    const run = useGraph.getState().runs.find((r) => r.status === 'done')!
    expect(run.contextBudget?.droppedCardIds).toEqual(['huge-note'])
    expect(run.contextBudget?.compactedCardIds).toEqual([])
  })

  it('leaves an under-budget run untouched with no budget provenance', async () => {
    useGraph.setState({
      cards: [
        card('ask', 'askAi', { blocks: [{ id: 'ask-b', text: 'Small task.' }] }),
        card('note', 'note', { blocks: [{ id: 'n-b', text: 'Small note.' }] }),
      ],
      connections: [feed('c1', 'note', 'ask')],
    })
    const calls = { compaction: [] as string[], main: [] as string[] }

    await runCard('ask', { stream: budgetStream(calls) })

    expect(calls.compaction).toHaveLength(0)
    const run = useGraph.getState().runs.find((r) => r.status === 'done')!
    expect(run.contextBudget).toBeUndefined()
    expect(run.compiledInstruction).toContain('Small note.')
  })
})

describe('runEngine chains', () => {
  function chainBoard() {
    useGraph.setState({
      cards: [
        card('ask-a', 'askAi', { blocks: [{ id: 'a-b', text: 'Name one animal.' }] }),
        card('result-a', 'result'),
        card('ask-b', 'askAi', { blocks: [{ id: 'b-b', text: 'Describe that animal.' }] }),
      ],
      connections: [
        feed('c1', 'ask-a', 'result-a'),
        feed('c2', 'result-a', 'ask-b'),
      ],
    })
  }

  it('runs upstream ask first and feeds its fresh result into the target', async () => {
    chainBoard()

    const instructions: string[] = []
    const stream: CompletionStream = async (instruction, opts) => {
      instructions.push(instruction)
      const reply = instructions.length === 1 ? 'CHAIN-ANSWER-A' : 'CHAIN-ANSWER-B'
      opts.onChunk(reply)
      return reply
    }

    const outcome = await runChain('ask-b', { stream })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('expected chain to complete')
    expect(outcome.status).toBe('done')
    expect(outcome.steps.map((step) => step.cardId)).toEqual(['ask-a', 'ask-b'])

    // Step B's compiled instruction must contain step A's freshly streamed result.
    expect(instructions[1]).toContain('CHAIN-ANSWER-A')

    // Each step keeps its own provenance.
    const askRuns = useGraph.getState().runs.filter((run) => (run.kind ?? 'ask') === 'ask')
    expect(askRuns).toHaveLength(2)
    expect(askRuns.every((run) => run.status === 'done')).toBe(true)
  })
  it('attributes an Agent chain and retires a root Card undo that could erase its closure', async () => {
    chainBoard()
    const userCardId = useGraph.getState().addCard('note', { x: 800, y: 0 })
    expect(useGraph.getState().undoStack).toHaveLength(1)
    const triggeredBy = { kind: 'agent' as const, client: 'codex-desktop', sessionId: 'session-721' }
    const stream: CompletionStream = async (_instruction, opts) => {
      opts.onChunk('agent answer')
      return 'agent answer'
    }

    const outcome = await runChain('ask-b', { stream, triggeredBy })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    const runs = useGraph.getState().runs
    expect(runs).toHaveLength(2)
    expect(runs.every((run) => run.triggeredBy === triggeredBy)).toBe(true)
    expect(useGraph.getState().undoStack).toEqual([])
    const target = runs.find((run) => run.askAiCardId === 'ask-b')!
    expect(provenanceForVersion(useGraph.getState().snapshot(), target.producedVersionId!).run?.triggeredBy)
      .toEqual(triggeredBy)

    useGraph.getState().undo()
    const retained = useGraph.getState().snapshot()
    expect(retained.cards.some((candidate) => candidate.id === userCardId)).toBe(true)
    expect(retained.runs).toHaveLength(2)
    const targetOutput = retained.outputs.find((output) => (
      output.versions.some((version) => version.id === target.producedVersionId)
    ))
    expect(targetOutput).toBeDefined()
    expect(retained.cards.some((candidate) => candidate.id === targetOutput?.resultCardId)).toBe(true)
    expect(retained.connections.some((candidate) => (
      candidate.from.cardId === 'ask-b'
        && candidate.to.cardId === targetOutput?.resultCardId
    ))).toBe(true)
  })

  it('rejects an admitted chain before streaming or Run creation when its plan changes', async () => {
    useGraph.setState({
      cards: [card('ask-b', 'askAi', { blocks: [{ id: 'b-b', text: 'Describe an animal.' }] })],
      connections: [],
    })
    const admittedBoard = useGraph.getState().snapshot()
    const plan = planChainRun(admittedBoard, 'ask-b')
    const admission = {
      plan,
      plannedStepIds: ['ask:ask-b'],
      askPlans: [{ stepId: 'ask:ask-b', plan: planAskRun(admittedBoard, 'ask-b') }],
    }

    chainBoard()
    let streams = 0
    const outcome = await runChain('ask-b', {
      admission,
      rerunTarget: true,
      stream: async () => {
        streams += 1
        return 'must not run'
      },
    })

    expect(outcome).toMatchObject({ ok: false, reason: 'plan-changed', steps: [] })
    expect(streams).toBe(0)
    expect(useGraph.getState().runs).toEqual([])
  })

  it('rejects an admitted chain when the same plan gains another runnable step', async () => {
    chainBoard()
    const instructions: string[] = []
    const stream = countingStream(instructions)
    await runChain('ask-b', { stream })
    const admittedBoard = useGraph.getState().snapshot()
    const plan = planChainRun(admittedBoard, 'ask-b')
    const admission = {
      plan,
      plannedStepIds: ['ask:ask-b'],
      askPlans: [{ stepId: 'ask:ask-b', plan: planAskRun(admittedBoard, 'ask-b') }],
    }
    const runCount = useGraph.getState().runs.length

    editCardText('ask-a', 'Name an animal that changed after admission.')
    const outcome = await runChain('ask-b', { stream, rerunTarget: true, admission })

    expect(outcome).toMatchObject({ ok: false, reason: 'plan-changed', steps: [] })
    expect(instructions).toHaveLength(2)
    expect(useGraph.getState().runs).toHaveLength(runCount)
  })

  it('rejects a compressed-Group plan added after admission before spending', async () => {
    useGraph.setState({
      cards: [card('ask-b', 'askAi', { blocks: [{ id: 'b-b', text: 'Describe an animal.' }] })],
      connections: [],
    })
    const admittedBoard = useGraph.getState().snapshot()
    const admission = {
      plan: planChainRun(admittedBoard, 'ask-b'),
      plannedStepIds: ['ask:ask-b'],
      askPlans: [{ stepId: 'ask:ask-b', plan: planAskRun(admittedBoard, 'ask-b') }],
    }
    useGraph.setState({
      cards: [
        ...useGraph.getState().cards,
        card('group', 'group', { title: 'Group', compressionPrompt: 'Compress.' }),
        card('member', 'note', { groupId: 'group', blocks: [{ id: 'member-b', text: 'Context.' }] }),
      ],
      connections: [feed('group-ask', 'group', 'ask-b', { groupMode: 'compress' })],
    })
    let streams = 0

    const outcome = await runChain('ask-b', {
      admission,
      rerunTarget: true,
      stream: async () => {
        streams += 1
        return 'must not run'
      },
    })

    expect(outcome).toMatchObject({ ok: false, reason: 'plan-changed', steps: [] })
    expect(streams).toBe(0)
    expect(useGraph.getState().runs).toEqual([])
  })

  it('stops the chain on cancel and keeps the partial step provisional', async () => {
    chainBoard()

    const instructions: string[] = []
    const stream: CompletionStream = async (instruction, opts) => {
      instructions.push(instruction)
      opts.onChunk('partial A')
      cancelAiRun('ask-a')
      return 'partial A'
    }

    const outcome = await runChain('ask-b', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'canceled' })
    // Only step A ever streamed; the target never ran.
    expect(instructions).toHaveLength(1)
    const runs = useGraph.getState().runs
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('canceled')
  })

  it('halts loudly when a step fails and reports completed steps', async () => {
    chainBoard()

    let calls = 0
    const stream: CompletionStream = async (_instruction, opts) => {
      calls += 1
      if (calls === 2) throw new Error('boom')
      opts.onChunk('fine')
      return 'fine'
    }

    const outcome = await runChain('ask-b', { stream })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected failure')
    expect(outcome.reason).toBe('failed')
    expect(outcome.steps).toHaveLength(2)
    expect(outcome.steps[0].outcome).toMatchObject({ ok: true, status: 'done' })
    expect(outcome.steps[1].outcome).toMatchObject({ ok: false })
  })

  it('returns empty-plan for a target that is not an Ask AI card', async () => {
    useGraph.setState({ cards: [card('note-1', 'note')], connections: [] })
    const outcome = await runChain('note-1', { stream: async () => '' })
    expect(outcome).toMatchObject({ ok: false, reason: 'empty-plan' })
  })

  function editCardText(cardId: string, text: string) {
    useGraph.setState((state) => ({
      cards: state.cards.map((c) =>
        c.id === cardId ? { ...c, blocks: [{ ...c.blocks[0], text }] } : c,
      ),
    }))
  }

  function countingStream(instructions: string[]): CompletionStream {
    return async (instruction, opts) => {
      instructions.push(instruction)
      opts.onChunk(`answer ${instructions.length}`)
      return `answer ${instructions.length}`
    }
  }

  it('spends nothing when nothing changed: a second Run reuses every fresh step', async () => {
    chainBoard()
    const instructions: string[] = []
    const stream = countingStream(instructions)

    await runChain('ask-b', { stream })
    expect(instructions).toHaveLength(2)

    const second = await runChain('ask-b', { stream })

    expect(second).toMatchObject({ ok: true, status: 'fresh', steps: [] })
    if (!second.ok) throw new Error('expected fresh outcome')
    expect(second.reusedStepIds).toEqual(['ask:ask-a', 'ask:ask-b'])
    expect(instructions).toHaveLength(2)
  })

  it('heals only the stale target and reuses the fresh upstream result', async () => {
    chainBoard()
    const instructions: string[] = []
    const stream = countingStream(instructions)
    await runChain('ask-b', { stream })

    editCardText('ask-b', 'Describe that animal differently.')
    const outcome = await runChain('ask-b', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    if (!outcome.ok) throw new Error('expected chain to complete')
    expect(outcome.steps.map((step) => step.cardId)).toEqual(['ask-b'])
    expect(outcome.reusedStepIds).toEqual(['ask:ask-a'])
    expect(instructions).toHaveLength(3)
    // The reused upstream result still feeds the healed target.
    expect(instructions[2]).toContain('answer 1')
  })

  it('cascades: an upstream source change re-runs the downstream step too', async () => {
    chainBoard()
    const instructions: string[] = []
    const stream = countingStream(instructions)
    await runChain('ask-b', { stream })

    editCardText('ask-a', 'Name one different animal.')
    const outcome = await runChain('ask-b', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    if (!outcome.ok) throw new Error('expected chain to complete')
    expect(outcome.steps.map((step) => step.cardId)).toEqual(['ask-a', 'ask-b'])
    expect(outcome.reusedStepIds).toEqual([])
    expect(instructions).toHaveLength(4)
  })

  it('re-run everything executes the full plan even when every step is fresh', async () => {
    chainBoard()
    const instructions: string[] = []
    const stream = countingStream(instructions)
    await runChain('ask-b', { stream })

    const outcome = await runChain('ask-b', { stream, everything: true })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    if (!outcome.ok) throw new Error('expected chain to complete')
    expect(outcome.steps.map((step) => step.cardId)).toEqual(['ask-a', 'ask-b'])
    expect(outcome.reusedStepIds).toEqual([])
    expect(instructions).toHaveLength(4)
  })

  it('cancelChain on the target stops the chain even while an upstream step streams', async () => {
    chainBoard()
    const instructions: string[] = []
    const stream: CompletionStream = async (instruction, opts) => {
      instructions.push(instruction)
      opts.onChunk('partial A')
      // The user pressed Cancel on ask-b (the card they ran), while ask-a is
      // the card actually streaming.
      cancelChain('ask-b')
      return 'partial A'
    }

    const outcome = await runChain('ask-b', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'canceled' })
    // Only the upstream step ever streamed; the target never started.
    expect(instructions).toHaveLength(1)
    const runs = useGraph.getState().runs
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('canceled')
    expect(runs[0].askAiCardId).toBe('ask-a')
  })

  it('records the lean chain plan on the target run only (#139)', async () => {
    chainBoard()
    const stream: CompletionStream = async (_instruction, opts) => {
      opts.onChunk('fine')
      return 'fine'
    }

    await runChain('ask-b', { stream })

    const runs = useGraph.getState().runs
    const targetRun = runs.find((run) => run.askAiCardId === 'ask-b')!
    const upstreamRun = runs.find((run) => run.askAiCardId === 'ask-a')!

    // The target carries the chain's shape: ids and dependencies, no content.
    expect(targetRun.plan?.rootCardId).toBe('ask-b')
    expect(targetRun.plan?.steps.map((step) => [step.cardId, step.dependsOn])).toEqual([
      ['ask-a', []],
      ['ask-b', ['ask:ask-a']],
    ])
    // Upstream steps and single runs record nothing extra.
    expect(upstreamRun.plan).toBeUndefined()

    // The intent log's run clones stay bounded: no plan amplification.
    const runEvents = useGraph
      .getState()
      .intentLog.filter((event) => 'data' in event && event.data && typeof event.data === 'object' && 'run' in event.data)
    expect(runEvents.length).toBeGreaterThan(0)
    for (const event of runEvents) {
      const cloned = (event.data as { run?: { plan?: unknown } }).run
      expect(cloned?.plan).toBeUndefined()
    }
  })

  it('halts loudly on a failed step and the next Run resumes from it', async () => {
    chainBoard()
    let calls = 0
    const flakyStream: CompletionStream = async (_instruction, opts) => {
      calls += 1
      if (calls === 2) throw new Error('boom')
      opts.onChunk('fine')
      return 'fine'
    }

    const first = await runChain('ask-b', { stream: flakyStream })

    expect(first.ok).toBe(false)
    if (first.ok) throw new Error('expected failure')
    expect(first.failedStepId).toBe('ask:ask-b')
    expect(first.steps[0].outcome).toMatchObject({ ok: true, status: 'done' })

    const second = await runChain('ask-b', { stream: flakyStream })

    expect(second).toMatchObject({ ok: true, status: 'done' })
    if (!second.ok) throw new Error('expected resume to complete')
    // Only the failed step re-runs; the succeeded upstream step is reused.
    expect(second.steps.map((step) => step.cardId)).toEqual(['ask-b'])
    expect(second.reusedStepIds).toEqual(['ask:ask-a'])
    expect(calls).toBe(3)
  })
})

describe('runEngine instruction fidelity', () => {
  // ADR 0033 deleted pre-flight web research, which was the only thing that
  // appended to an instruction after the compile. Nothing may take its place:
  // what the compiler produced is exactly what the model was sent, and exactly
  // what "show what AI used" replays.
  it('sends the compiled instruction unchanged and records it verbatim', async () => {
    useGraph.setState({
      cards: [card('ask', 'askAi', { blocks: [{ id: 'ask-b', text: 'Write three story ideas.' }] })],
    })
    let sent = ''
    const stream: CompletionStream = async (instruction, opts) => {
      sent = instruction
      opts.onChunk('ok')
      return 'ok'
    }

    const outcome = await runCard('ask', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    const runs = useGraph.getState().runs
    expect(runs[runs.length - 1]!.compiledInstruction).toBe(sent)
  })
})

describe('runEngine Agentic Runs (ADR 0033)', () => {
  // These tests exercise user-owned tools through the ordinary run path.

  function latestRun() {
    const runs = useGraph.getState().runs
    return runs[runs.length - 1]!
  }

  function ask(extra: Partial<Card> = {}) {
    return card('ask', 'askAi', { blocks: [{ id: 'ask-b', text: 'What shipped recently?' }], ...extra })
  }

  it('asks the provider for tools only when the Card asked for them', async () => {
    const seen: Array<boolean | undefined> = []
    const stream: CompletionStream = async (_instruction, opts) => {
      seen.push(opts.agentic)
      opts.onChunk('ok')
      return 'ok'
    }

    useGraph.setState({ cards: [ask()] })
    await runCard('ask', { stream })
    useGraph.setState({ cards: [ask({ agentic: true })] })
    await runCard('ask', { stream })

    // Off is absent rather than false: a run without an Agentic Run is exactly
    // the request it was before this existed.
    expect(seen).toEqual([undefined, true])
  })

  it('records what the model did, in order, as it happens', async () => {
    useGraph.setState({ cards: [ask({ agentic: true })] })
    const stream: CompletionStream = async (_instruction, opts) => {
      opts.onToolStep?.({ kind: 'search', detail: 'electron 40' })
      opts.onToolStep?.({ kind: 'read', detail: 'https://example.test/40', title: 'Electron 40' })
      opts.onChunk('Electron 40 shipped.')
      return 'Electron 40 shipped.'
    }

    const outcome = await runCard('ask', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    expect(latestRun().toolSteps).toEqual([
      { kind: 'search', detail: 'electron 40' },
      { kind: 'read', detail: 'https://example.test/40', title: 'Electron 40' },
    ])
  })

  it('records nothing when the model chose to use no tools', async () => {
    useGraph.setState({ cards: [ask({ agentic: true })] })
    const stream: CompletionStream = async (_instruction, opts) => {
      opts.onChunk('Answered from what I already knew.')
      return 'Answered from what I already knew.'
    }

    await runCard('ask', { stream })

    expect(latestRun().toolSteps).toBeUndefined()
  })

  it('stops mid-tool when the run is canceled, and keeps no step after that', async () => {
    useGraph.setState({ cards: [ask({ agentic: true })] })
    const stream: CompletionStream = async (_instruction, opts) => {
      opts.onToolStep?.({ kind: 'search', detail: 'first' })
      cancelAiRun('ask')
      opts.onToolStep?.({ kind: 'read', detail: 'https://example.test/after-cancel' })
      opts.onChunk('never')
      return 'never'
    }

    const outcome = await runCard('ask', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'canceled' })
    expect(latestRun().toolSteps).toEqual([{ kind: 'search', detail: 'first' }])
  })

  it('runs agentically as a chain step, because a chain step is an ordinary run', async () => {
    // Gating Agent off inside a chain would silently downgrade the answer the
    // user already asked for on that Card.
    useGraph.setState({
      cards: [
        card('ask-a', 'askAi', { agentic: true, blocks: [{ id: 'ask-a-b', text: 'Look it up.' }] }),
        card('result-a', 'result', { blocks: [{ id: 'result-a-b', text: '' }] }),
        card('ask-b', 'askAi', { blocks: [{ id: 'ask-b-b', text: 'Now use it.' }] }),
      ],
      connections: [feed('c1', 'result-a', 'ask-b')],
    })
    const agenticByCard: Record<string, boolean | undefined> = {}
    const stream: CompletionStream = async (instruction, opts) => {
      agenticByCard[instruction.includes('Look it up.') ? 'ask-a' : 'ask-b'] = opts.agentic
      opts.onChunk('ok')
      return 'ok'
    }

    await runCard('ask-a', { stream })
    await runChain('ask-b', { stream, everything: true })

    expect(agenticByCard['ask-a']).toBe(true)
  })

  it('injects Eido-executed tools gated by the Card reach mode when a Linkup key exists (#961, #965)', async () => {
    useGraph.setState({ cards: [ask({ agentic: true, meta: { reachMode: 'research' } })] })
    useGraph.setState((state) => ({ settings: { ...state.settings, linkupKey: 'lk-test' } }))
    const seen: Array<{ tools?: string[]; brief?: string; restart: boolean }> = []
    const stream: CompletionStream = async (_instruction, opts) => {
      seen.push({
        tools: opts.eidoTools?.tools.map((tool) => tool.declaration.function.name),
        brief: opts.eidoTools?.brief,
        restart: typeof opts.onAnswerRestart === 'function',
      })
      opts.onChunk('ok')
      return 'ok'
    }

    await runCard('ask', { stream })

    // The mode is read from the Card's own meta: Research declares the third
    // tool, and the brief rides with the set.
    expect(seen).toEqual([{
      tools: ['search_web', 'fetch_page', 'research'],
      brief: expect.stringContaining('retrieval system') as string,
      restart: true,
    }])
  })

  it('stashes the research job id on the Card at submission and clears it once the report lands (#963)', async () => {
    // The wiring under test: the hooks runEngine hands the tool set write
    // card.meta through the store, so a job id exists on the Card for the
    // whole poll and would survive a quit mid-wait. The wire is stubbed; the
    // executor, the hooks, and the store writes are the real ones.
    useGraph.setState({ cards: [ask({ agentic: true, meta: { reachMode: 'research' } })] })
    useGraph.setState((state) => ({ settings: { ...state.settings, linkupKey: 'lk-test' } }))
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, request?: RequestInit) =>
      (request?.method ?? 'GET') === 'POST'
        ? new Response(JSON.stringify({ id: 'job-1', status: 'pending' }), { status: 200 })
        : new Response(
            JSON.stringify({ id: 'job-1', status: 'completed', output: { answer: 'The answer.', sources: [] } }),
            { status: 200 },
          ),
    ))
    const cardMetaJob = () =>
      researchJobOf(useGraph.getState().cards.find((candidate) => candidate.id === 'ask'))?.id
    const seenDuringPoll: Array<string | undefined> = []
    const stream: CompletionStream = async (_instruction, opts) => {
      const research = opts.eidoTools!.tools[2]!
      vi.useFakeTimers()
      try {
        const pending = research.execute({ query: 'q', mode: 'answer', reasoningDepth: 'S' }, opts.signal)
        await vi.advanceTimersByTimeAsync(0)
        seenDuringPoll.push(cardMetaJob())
        await vi.advanceTimersByTimeAsync(2_000)
        await pending
      } finally {
        vi.useRealTimers()
      }
      opts.onChunk('done')
      return 'done'
    }

    const outcome = await runCard('ask', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    // Stashed while the job was in flight, gone once the run consumed it.
    expect(seenDuringPoll).toEqual(['job-1'])
    expect(cardMetaJob()).toBeUndefined()
  })

  it('submits the depth the user pressed on the Card, never one from the model (#971)', async () => {
    // The whole channel under test: the press stored the choice in card.meta,
    // runCard reads it into the tool set, and the wire carries it whatever
    // the model wrote in the arguments of a parameter it was never offered.
    useGraph.setState({
      cards: [ask({ agentic: true, meta: { reachMode: 'research', researchDepth: 'XL' } })],
    })
    useGraph.setState((state) => ({ settings: { ...state.settings, linkupKey: 'lk-test' } }))
    const posted: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, request?: RequestInit) => {
      if ((request?.method ?? 'GET') === 'POST') {
        posted.push(JSON.parse(String(request?.body)) as Record<string, unknown>)
        return new Response(JSON.stringify({ id: 'job-1', status: 'pending' }), { status: 200 })
      }
      return new Response(
        JSON.stringify({ id: 'job-1', status: 'completed', output: { answer: 'The answer.', sources: [] } }),
        { status: 200 },
      )
    }))
    const stream: CompletionStream = async (_instruction, opts) => {
      const research = opts.eidoTools!.tools[2]!
      vi.useFakeTimers()
      try {
        const pending = research.execute({ query: 'q', mode: 'answer', reasoningDepth: 'S' }, opts.signal)
        await vi.advanceTimersByTimeAsync(2_000)
        await pending
      } finally {
        vi.useRealTimers()
      }
      opts.onChunk('done')
      return 'done'
    }

    await runCard('ask', { stream })

    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ q: 'q', mode: 'answer', reasoningDepth: 'XL' })
  })

  it('resumeResearchRun polls the standing job out, lands its report as a version, and clears the stash (#971)', async () => {
    useGraph.setState({
      cards: [ask({
        agentic: true,
        meta: {
          reachMode: 'research',
          researchJob: { id: 'job-7', submittedAt: '2026-08-18T00:00:00.000Z' },
        },
      })],
    })
    useGraph.setState((state) => ({ settings: { ...state.settings, linkupKey: 'lk-test' } }))
    const methods: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, request?: RequestInit) => {
      methods.push(`${request?.method ?? 'GET'} ${String(input)}`)
      return new Response(
        JSON.stringify({
          id: 'job-7',
          status: 'completed',
          output: {
            answer: 'The paid report.',
            sources: [{ name: 'Primary', url: 'https://primary.test/report', snippet: 's' }],
          },
        }),
        { status: 200 },
      )
    }))

    const outcome = await resumeResearchRun('ask')

    // Poll only, never a submit: the id is the whole request.
    expect(methods).toEqual(['GET https://api.linkup.so/v1/research/job-7'])
    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    const version = outcome.ok && outcome.status === 'done' ? versionById(outcome.versionId!) : undefined
    expect(version?.text).toContain('The paid report.')
    expect(version?.text).toContain('https://primary.test/report')
    // The run consumed the terminal state, so the stash is gone and Resume
    // with it; the trail says a research step landed.
    expect(researchJobOf(useGraph.getState().cards.find((candidate) => candidate.id === 'ask'))).toBeNull()
    expect(latestRun().status).toBe('done')
    expect(latestRun().toolSteps).toEqual([{ kind: 'research', detail: '' }])
  })

  it('resumeResearchRun keeps the stash when cancelled, because the job is still running and paid for (#971)', async () => {
    useGraph.setState({
      cards: [ask({
        agentic: true,
        meta: {
          reachMode: 'research',
          researchJob: { id: 'job-7', submittedAt: '2026-08-18T00:00:00.000Z' },
        },
      })],
    })
    useGraph.setState((state) => ({ settings: { ...state.settings, linkupKey: 'lk-test' } }))
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ id: 'job-7', status: 'processing' }), { status: 200 }),
    ))

    vi.useFakeTimers()
    let outcomePromise: ReturnType<typeof resumeResearchRun>
    try {
      outcomePromise = resumeResearchRun('ask')
      await vi.advanceTimersByTimeAsync(0)
      cancelAiRun('ask')
      await vi.advanceTimersByTimeAsync(0)
    } finally {
      vi.useRealTimers()
    }
    const outcome = await outcomePromise

    expect(outcome).toMatchObject({ ok: true, status: 'canceled' })
    expect(
      researchJobOf(useGraph.getState().cards.find((candidate) => candidate.id === 'ask'))?.id,
    ).toBe('job-7')
  })

  it('injects nothing without a Linkup key, leaving the proven provider path untouched', async () => {
    useGraph.setState({ cards: [ask({ agentic: true })] })
    const seen: Array<unknown> = []
    const stream: CompletionStream = async (_instruction, opts) => {
      seen.push(opts.eidoTools)
      opts.onChunk('ok')
      return 'ok'
    }

    await runCard('ask', { stream })

    expect(seen).toEqual([undefined])
  })

  it('keeps only the final turn when the loop restarts the answer (#961)', async () => {
    useGraph.setState({ cards: [ask({ agentic: true })] })
    useGraph.setState((state) => ({ settings: { ...state.settings, linkupKey: 'lk-test' } }))
    const stream: CompletionStream = async (_instruction, opts) => {
      opts.onChunk('Let me look. ')
      opts.onAnswerRestart?.()
      opts.onChunk('The answer.')
      return 'The answer.'
    }

    const outcome = await runCard('ask', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    const version = outcome.ok && outcome.status === 'done' ? versionById(outcome.versionId) : undefined
    expect(version?.text).toBe('The answer.')
  })
})

describe('runEngine user-owned web tools', () => {
  function latestRun() {
    const runs = useGraph.getState().runs
    return runs[runs.length - 1]!
  }

  function armedAsk(extra: Partial<Card> = {}) {
    return card('ask', 'askAi', {
      blocks: [{ id: 'ask-b', text: 'Look it up.' }],
      agentic: true,
      ...extra,
    })
  }

  function observingStream(seen: Array<Readonly<{ agentic?: boolean; tools?: string[] }>>) {
    const stream: CompletionStream = async (_instruction, opts) => {
      seen.push({
        agentic: opts.agentic,
        tools: opts.eidoTools?.tools.map((tool) => tool.declaration.function.name),
      })
      opts.onChunk('ok')
      return 'ok'
    }
    return stream
  }

  it('arms Linkup web tools with the user key', async () => {
    useGraph.setState({ cards: [armedAsk()] })
    useGraph.setState((state) => ({ settings: { ...state.settings, linkupKey: 'lk-test' } }))
    const seen: Array<Readonly<{ agentic?: boolean; tools?: string[] }>> = []

    const outcome = await runCard('ask', { stream: observingStream(seen) })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    expect(seen).toEqual([{ agentic: true, tools: ['search_web', 'fetch_page'] }])
    expect(latestRun().agentic).toBe(true)
    expect(latestRun().toolSteps).toBeUndefined()
  })

  it('runs Linkup research through the chain entry point', async () => {
    useGraph.setState({ cards: [armedAsk({ meta: { reachMode: 'research' } })] })
    useGraph.setState((state) => ({ settings: { ...state.settings, linkupKey: 'lk-test' } }))
    const seen: Array<Readonly<{ agentic?: boolean; tools?: string[] }>> = []

    // runChain is the path every entry point shares: the Card press, the
    // Agent CLI, and delegated runs all arrive here.
    const outcome = await runChain('ask', { stream: observingStream(seen) })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    expect(seen).toEqual([{ agentic: true, tools: ['search_web', 'fetch_page', 'research'] }])
    expect(latestRun().agentic).toBe(true)
  })

  it('includes the research tool when Research mode is selected', async () => {
    useGraph.setState({ cards: [armedAsk({ meta: { reachMode: 'research' } })] })
    useGraph.setState((state) => ({ settings: { ...state.settings, linkupKey: 'lk-test' } }))
    const seen: Array<Readonly<{ agentic?: boolean; tools?: string[] }>> = []

    await runCard('ask', { stream: observingStream(seen) })

    expect(seen[0]?.agentic).toBe(true)
    expect(seen[0]?.tools).toEqual(['search_web', 'fetch_page', 'research'])
  })

  it('uses OpenRouter server tools when there is no Linkup key', async () => {
    useGraph.setState({ cards: [armedAsk()] })
    const seen: Array<Readonly<{ agentic?: boolean; tools?: string[] }>> = []

    await runCard('ask', { stream: observingStream(seen) })

    expect(seen).toEqual([{ agentic: true, tools: undefined }])
  })

  it('leaves the saved reach mode on the Card untouched after keyless access denial', async () => {
    useGraph.setState((state) => ({ settings: { ...state.settings, apiKey: '' } }))
    useGraph.setState({ cards: [armedAsk({ meta: { reachMode: 'research', researchDepth: 'L' } })] })

    const outcome = await runCard('ask', { stream: observingStream([]) })

    expect(outcome).toMatchObject({ ok: false, reason: 'no-key' })
    const after = useGraph.getState().cards.find((candidate) => candidate.id === 'ask')
    expect(after?.agentic).toBe(true)
    expect(after?.meta).toMatchObject({ reachMode: 'research', researchDepth: 'L' })
  })

  it('preserves Linkup research across repeated runs', async () => {
    useGraph.setState({ cards: [armedAsk({ meta: { reachMode: 'research' } })] })
    useGraph.setState((state) => ({ settings: { ...state.settings, linkupKey: 'lk-test' } }))
    const seen: Array<Readonly<{ agentic?: boolean; tools?: string[] }>> = []

    await runCard('ask', { stream: observingStream(seen) })
    await runCard('ask', { stream: observingStream(seen) })

    expect(seen[0]?.agentic).toBe(true)
    expect(seen[0]?.tools).toEqual(['search_web', 'fetch_page', 'research'])
    expect(seen[1]?.agentic).toBe(true)
    expect(seen[1]?.tools).toEqual(['search_web', 'fetch_page', 'research'])
  })
})
