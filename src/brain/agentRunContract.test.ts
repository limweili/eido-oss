import { describe, expect, it } from 'vitest'
import {
  AGENT_RUN_ARTIFACT_READ_LIMITS,
  AGENT_RUN_CONTRACT_VERSION,
  AGENT_RUN_VARIATION_LIMITS,
  normalizeAgentRunSubmitRequest,
  pageAgentRunArtifacts,
  type AgentRunArtifactReference,
} from './agentRunContract'

const artifacts: readonly AgentRunArtifactReference[] = Object.freeze([
  Object.freeze({
    kind: 'run-record' as const,
    recordId: 'run-record-upstream',
    cardId: 'ask-upstream',
  }),
  Object.freeze({
    kind: 'output-version' as const,
    recordId: 'version-upstream',
    outputId: 'output-upstream',
    versionId: 'version-upstream',
    cardId: 'result-upstream',
  }),
  Object.freeze({
    kind: 'run-record' as const,
    recordId: 'run-record-target',
    cardId: 'ask-target',
  }),
])

describe('Agent run live contract (#721)', () => {
  it('keeps the v1 submit shape as run mode and bounds v2 variations without execution knobs', () => {
    expect(AGENT_RUN_CONTRACT_VERSION).toBe(2)
    expect(normalizeAgentRunSubmitRequest({
      ideaId: 'idea-live',
      targetCardId: 'ask-target',
    })).toEqual({
      ideaId: 'idea-live',
      targetCardId: 'ask-target',
      mode: 'run',
      variationCount: 1,
    })

    expect(normalizeAgentRunSubmitRequest({
      ideaId: 'idea-live',
      targetCardId: 'conversation-target',
      mode: 'variations',
      variationCount: AGENT_RUN_VARIATION_LIMITS.maxCount,
    })).toEqual({
      ideaId: 'idea-live',
      targetCardId: 'conversation-target',
      mode: 'variations',
      variationCount: AGENT_RUN_VARIATION_LIMITS.maxCount,
    })

    for (const request of [
      { ideaId: 'idea-live', targetCardId: 'ask-target', mode: 'run', variationCount: 1 },
      { ideaId: 'idea-live', targetCardId: 'ask-target', mode: 'variations' },
      { ideaId: 'idea-live', targetCardId: 'ask-target', mode: 'variations', variationCount: 0 },
      {
        ideaId: 'idea-live',
        targetCardId: 'ask-target',
        mode: 'variations',
        variationCount: AGENT_RUN_VARIATION_LIMITS.maxCount + 1,
      },
      { ideaId: 'idea-live', targetCardId: 'ask-target', model: 'caller/model' },
      { ideaId: 'idea-live', targetCardId: 'ask-target', apiKey: 'caller-key' },
      { ideaId: 'idea-live', targetCardId: 'ask-target', prompt: 'caller prompt' },
      { ideaId: 'idea-live', targetCardId: 'ask-target', style: 'debate' },
      { ideaId: 'idea-live', targetCardId: 'ask-target', turns: 20 },
      { ideaId: 'idea-live', targetCardId: 'ask-target', provider: 'caller-provider' },
      { ideaId: 'idea-live', targetCardId: 'ask-target', output: 'caller-output' },
    ]) {
      expect(normalizeAgentRunSubmitRequest(request)).toBeUndefined()
    }
  })

  it('pages completed run artifacts by item and byte bounds', () => {
    const source = {
      runId: 'agent-run-synthetic',
      status: 'done' as const,
      artifacts,
    }
    const first = pageAgentRunArtifacts(source, { limit: 1 })

    expect(first).toMatchObject({
      ok: true,
      value: {
        runId: 'agent-run-synthetic',
        status: 'done',
        items: [{ recordId: 'run-record-upstream' }],
        truncated: true,
      },
    })
    if (!first.ok || !first.value.nextCursor) throw new Error('expected a cursor')

    expect(pageAgentRunArtifacts(source, {
      limit: 1,
      cursor: first.value.nextCursor,
    })).toMatchObject({
      ok: true,
      value: {
        items: [{
          recordId: 'version-upstream',
          outputId: 'output-upstream',
          versionId: 'version-upstream',
        }],
        truncated: true,
      },
    })

    const oneItemBytes = new TextEncoder().encode(JSON.stringify([
      first.value.items[0],
    ])).byteLength
    expect(pageAgentRunArtifacts(source, { byteLimit: oneItemBytes - 1 }))
      .toMatchObject({ ok: false, code: 'invalid' })
    expect(AGENT_RUN_ARTIFACT_READ_LIMITS.maxItems).toBeLessThanOrEqual(200)
  })

  it('identifies an output artifact by its version record while retaining its output owner', () => {
    expect(pageAgentRunArtifacts({
      runId: 'agent-run-synthetic',
      status: 'done',
      artifacts: [{
        kind: 'output-version',
        recordId: 'output-owner',
        outputId: 'output-owner',
        versionId: 'version-record',
        cardId: 'result-card',
      }],
    }, {})).toMatchObject({ ok: false, code: 'invalid' })
  })
})
