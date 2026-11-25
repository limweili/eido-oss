import { describe, expect, it } from 'vitest'
import { createCompleteProfileFixture } from './fixtures/profileLogicalProjectionFixture'
import { projectProfileSnapshot, type ProfileLogicalDocument } from './profileLogicalProjection'
import {
  inspectProfileLogicalResult,
  validateProfileResultInspectionRequest,
} from './profileResultInspection'

describe('bounded Profile Result inspection', () => {
  it('walks the semantic Result closure through revision-bound deterministic pages', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const request = {
      ideaId: 'idea-main',
      resultCardId: 'card-result',
      limit: 3,
    }

    const first = inspectProfileLogicalResult(document, request)
    expect(first).toMatchObject({
      ok: true,
      value: {
        profileId: 'profile-synthetic',
        revision: 7,
        ideaId: 'idea-main',
        resultCardId: 'card-result',
        truncated: true,
      },
    })
    if (!first.ok || !first.value.nextCursor) throw new Error('Expected a second inspection page')
    expect(first.value.items.map(item => `${item.kind}:${item.recordId}`)).toEqual([
      'card:card-result',
      'output:output-result',
      'output-version:version-result-1',
    ])

    const second = inspectProfileLogicalResult(document, {
      ...request,
      cursor: first.value.nextCursor,
    })
    if (!second.ok || !second.value.nextCursor) throw new Error('Expected a third inspection page')
    expect(second.value.items.map(item => `${item.kind}:${item.recordId}`)).toEqual([
      'run:run-main',
      'follow-up-message:follow-up-user-1',
      'follow-up-message:follow-up-assistant-1',
    ])

    const third = inspectProfileLogicalResult(document, {
      ...request,
      cursor: second.value.nextCursor,
    })
    expect(third).toMatchObject({
      ok: true,
      value: {
        items: [{
          kind: 'output-version',
          recordId: 'version-empty-containers',
          payload: {
            fromRunId: 'run-retired-provenance',
            transcript: { present: true },
            followUpThread: { present: true, collapsed: true },
          },
        }],
        truncated: false,
      },
    })

    const changedDocument = {
      ...document,
      head: { ...document.head, revision: document.head.revision + 1 },
    } satisfies ProfileLogicalDocument
    expect(inspectProfileLogicalResult(changedDocument, {
      ...request,
      cursor: first.value.nextCursor,
    })).toMatchObject({ ok: false, code: 'conflict', currentRevision: 8 })
    expect(inspectProfileLogicalResult(document, {
      ...request,
      resultCardId: 'card-conversation-result',
      cursor: first.value.nextCursor,
    })).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('enforces exact bounded requests and exact UTF-8 response byte pages', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)

    expect(validateProfileResultInspectionRequest({
      ideaId: 'idea-main',
      resultCardId: 'card-result',
      unexpected: true,
    })).toMatchObject({ ok: false, code: 'invalid' })
    expect(validateProfileResultInspectionRequest({
      ideaId: 'idea-main',
      resultCardId: 'card-result',
      limit: 0,
    })).toMatchObject({ ok: false, code: 'invalid' })

    const one = inspectProfileLogicalResult(document, {
      ideaId: 'idea-main',
      resultCardId: 'card-result',
      limit: 1,
      byteLimit: 4_096,
    })
    expect(one.ok).toBe(true)
    if (!one.ok) return
    expect(new TextEncoder().encode(JSON.stringify(one.value.items)).byteLength).toBeLessThanOrEqual(4_096)
    expect(one.value.items).toHaveLength(1)

    expect(inspectProfileLogicalResult(document, {
      ideaId: 'idea-main',
      resultCardId: 'card-result',
      byteLimit: 2,
    })).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('rejects missing Ideas, non-Result Cards, and cross-Idea addresses without leaking records', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)

    expect(inspectProfileLogicalResult(document, {
      ideaId: 'idea-missing',
      resultCardId: 'card-result',
    })).toMatchObject({ ok: false, code: 'not-found', currentRevision: 7 })
    expect(inspectProfileLogicalResult(document, {
      ideaId: 'idea-main',
      resultCardId: 'card-note',
    })).toMatchObject({ ok: false, code: 'not-found', currentRevision: 7 })
    expect(inspectProfileLogicalResult(document, {
      ideaId: 'idea-second',
      resultCardId: 'card-result',
    })).toMatchObject({ ok: false, code: 'not-found', currentRevision: 7 })
  })
})
