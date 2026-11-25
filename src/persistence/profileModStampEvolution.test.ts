import { describe, expect, it } from 'vitest'
import { createCompleteProfileFixture } from './fixtures/profileLogicalProjectionFixture'
import {
  hydrateProfileLogicalDocument,
  projectProfileSnapshot,
} from './profileLogicalProjection'
import type { ProfileModTemplateInstanceRecord } from './profileModRecords'

describe('evolved stamped Mod projection (#594, #624)', () => {
  it('round-trips current controls independently from immutable stamp-time provenance', () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    const instanceIndex = snapshot.modInstances.findIndex((instance) => (
      instance.payload.source.kind === 'template'
    ))
    const stamped = snapshot.modInstances[instanceIndex]
    if (!stamped || stamped.payload.source.kind !== 'template') {
      throw new Error('Synthetic stamped Mod fixture is missing')
    }
    if (stamped.payload.mod.kind !== 'slider') throw new Error('Synthetic stamped Mod kind is unexpected')
    const mappedPart = stamped.payload.mod.state.items[0]
    if (!mappedPart) throw new Error('Synthetic stamped Mod part is missing')

    const evolved = {
      ...stamped,
      payload: {
        ...stamped.payload,
        futureStampEnvelope: { retained: ['exact', 7, false, null] },
        mod: {
          ...stamped.payload.mod,
          state: {
            ...stamped.payload.mod.state,
            items: [
              { id: 'control-added-later', label: 'ADDED LATER', v: 50, frame: '' },
              { ...mappedPart, label: 'MAPPED PART MOVED LATER', v: 8 },
            ],
          },
        },
      },
    } as unknown as ProfileModTemplateInstanceRecord
    snapshot.modInstances[instanceIndex] = evolved
    const card = snapshot.boards['idea-main']?.cards.find((candidate) => candidate.id === evolved.parentId)
    if (!card) throw new Error('Synthetic stamped Mod Card is missing')
    card.modV2 = clone(evolved.payload.mod)

    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
    expect(document.records.find((record) => record.recordId === evolved.recordId)?.payload).toEqual(
      evolved.payload,
    )
    expect(hydrateProfileLogicalDocument(document, fixture.hydrateAsset)).toEqual(snapshot)
  })
})

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}
