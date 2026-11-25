import type { CardAsset, IntentLogEvent, SavedBoard } from '../../graph/types'
import { createSeedMod } from '../../mods'
import {
  hydrateProfileLogicalAsset,
  toProfileLogicalAssetPayload,
  type ProfileLogicalAssetPayload,
} from '../profileAssetKernel'
import {
  createDirectProfileModInstance,
  createUserProfileModTemplate,
  stampProfileModTemplate,
  type ProfileModInstanceRecord,
  type ProfileModTemplateRecord,
} from '../profileModRecords'
import type { ProfileAgentEventRecord } from '../profileAgentEvent'
import {
  PROFILE_CONTRACT_VERSIONS,
  PROFILE_SETTING_RECORD_VERSION,
  type ProfileSnapshot,
} from '../profileServiceContract'
import {
  ALPHA_PROFILE_V1,
  SYNTHETIC_MAIN_BOARD,
  SYNTHETIC_MAIN_IDEA,
  SYNTHETIC_PNG_ASSET,
  SYNTHETIC_SECOND_BOARD,
  SYNTHETIC_SECOND_IDEA,
} from './profileFixtureCorpus'

export const CURRENT_ASSET_DIGEST = '1'.repeat(64)
export const HISTORICAL_ASSET_DIGEST = '2'.repeat(64)

const AT = '2026-07-19T00:00:00.000Z'

export function createCompleteProfileFixture(): {
  snapshot: ProfileSnapshot
  projectAsset: (asset: CardAsset) => ProfileLogicalAssetPayload
  hydrateAsset: (payload: ProfileLogicalAssetPayload) => CardAsset
} {
  const historicalAsset: CardAsset = {
    id: 'asset-retired-image',
    kind: 'image',
    name: 'retired-image.png',
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,aGlzdG9yaWNhbC1hc3NldA==',
    size: 16,
    createdAt: AT,
  }
  const template = mustModTemplate(createUserProfileModTemplate({
    profileId: 'profile-synthetic',
    templateId: 'mod-template-synthetic',
    createdAt: AT,
    mod: createSeedMod('slider', {
      title: 'SYNTHETIC MOD',
      createId: (role, ordinal) => `control-template-${role}-${ordinal}`,
    }),
  }))
  const stamped = mustModInstance(stampProfileModTemplate(template, {
    boardRecordId: `board:${SYNTHETIC_MAIN_IDEA.id}`,
    cardId: 'card-mod',
    instanceId: 'mod-stamp-1',
    controlIds: ['control-instance-item-0', 'control-instance-item-1'],
    stampedAt: AT,
  }))
  const direct = mustModInstance(createDirectProfileModInstance({
    boardRecordId: `board:${SYNTHETIC_MAIN_IDEA.id}`,
    cardId: 'card-mod-direct',
    instanceId: 'mod-direct-1',
    createdAt: AT,
    mod: {
      ...createSeedMod('switch', {
        title: 'DIRECT MOD',
        createId: (role, ordinal) => `control-direct-${role}-${ordinal}`,
      }),
      opaqueProvenance: { importedFrom: 'synthetic-fixture' },
    },
  }))
  const directCard = {
    id: 'card-mod-direct',
    kind: 'mod' as const,
    position: { x: 520, y: 280 },
    blocks: [{ id: 'block-mod-direct', text: 'Direct Mod', kind: 'line' as const }],
    modV2: clone(direct.payload.mod),
  }
  const emptyContainerVersion = {
    id: 'version-empty-containers',
    number: 2,
    text: 'Empty containers remain observable.',
    createdAt: AT,
    fromRunId: 'run-retired-provenance',
    transcript: [],
    followUpThread: { messages: [], collapsed: true },
  }
  const historicalDeletion: IntentLogEvent = {
    id: 'event-retired-asset',
    at: AT,
    ideaId: SYNTHETIC_MAIN_IDEA.id,
    type: 'card.deleted',
    cardId: 'card-retired',
    data: {
      card: {
        id: 'card-retired',
        kind: 'note',
        position: { x: 0, y: 0 },
        blocks: [{ id: 'block-retired', text: 'Retired asset', kind: 'line' }],
        assets: [historicalAsset],
      },
      connections: [],
    },
  }
  const mainBoard: SavedBoard = {
    ...clone(SYNTHETIC_MAIN_BOARD),
    cards: [
      ...clone(SYNTHETIC_MAIN_BOARD.cards).map((card) => {
        if (card.id !== 'card-mod') return card
        const { modV2: _fixtureMod, ...cardEnvelope } = card
        return { ...cardEnvelope, modV2: clone(stamped.payload.mod) }
      }),
      directCard,
    ],
    outputs: clone(SYNTHETIC_MAIN_BOARD.outputs).map((output, index) => (
      index === 0 ? { ...output, versions: [...output.versions, emptyContainerVersion] } : output
    )),
    intentLog: [...clone(SYNTHETIC_MAIN_BOARD.intentLog ?? []), historicalDeletion],
  }
  const { intentLog: _emptySecondIntentLog, ...secondBoard } = clone(SYNTHETIC_SECOND_BOARD)
  const snapshot: ProfileSnapshot = {
    profileId: 'profile-synthetic',
    revision: ALPHA_PROFILE_V1.revision,
    versions: PROFILE_CONTRACT_VERSIONS,
    activeIdeaId: SYNTHETIC_MAIN_IDEA.id,
    ideas: [clone(SYNTHETIC_MAIN_IDEA), clone(SYNTHETIC_SECOND_IDEA)],
    boards: {
      [SYNTHETIC_MAIN_IDEA.id]: mainBoard,
      [SYNTHETIC_SECOND_IDEA.id]: secondBoard,
    },
    modTemplates: [template],
    modInstances: [stamped, direct],
    profileSettings: [{
      id: 'profile-setting-locale',
      recordVersion: PROFILE_SETTING_RECORD_VERSION,
      classification: 'portable-profile',
      value: { locale: 'en-AU' },
    }],
    migrationLedger: [{
      id: 'migration-ledger-synthetic',
      recordVersion: PROFILE_CONTRACT_VERSIONS.record,
      source: 'friends-alpha',
      sourceVersion: 1,
      targetVersion: 1,
      completedAt: AT,
      sourceRetained: true,
    }],
    recoveryPoints: [],
    compatibility: { read: 'supported', write: 'supported', source: 'friends-alpha' },
  }
  const assets = new Map<string, { asset: CardAsset; digest: string }>([
    [SYNTHETIC_PNG_ASSET.id, { asset: SYNTHETIC_PNG_ASSET, digest: CURRENT_ASSET_DIGEST }],
    [historicalAsset.id, { asset: historicalAsset, digest: HISTORICAL_ASSET_DIGEST }],
  ])
  return {
    snapshot,
    projectAsset(asset) {
      const expected = assets.get(asset.id)
      if (!expected || JSON.stringify(expected.asset) !== JSON.stringify(asset)) {
        throw new Error(`Unexpected synthetic asset ${asset.id}`)
      }
      return toProfileLogicalAssetPayload(asset, expected.digest)
    },
    hydrateAsset(payload) {
      const expected = assets.get(payload.id)
      if (!expected) throw new Error(`Unexpected synthetic asset ${payload.id}`)
      return hydrateProfileLogicalAsset(payload, expected.asset.dataUrl)
    },
  }
}

export function createProfileAgentEventFixture(
  profileId = 'profile-synthetic',
): ProfileAgentEventRecord {
  return {
    kind: 'profile-agent-event',
    recordId: 'profile-agent-event-portable-proof',
    ownerId: profileId,
    parentId: profileId,
    recordVersion: 1,
    payload: {
      version: 1,
      id: 'profile-agent-event-portable-proof',
      seq: 1,
      at: '2026-07-20T00:00:00.000Z',
      profileId,
      commitId: 'agent:portable-proof',
      actorId: 'local-agent',
      clientTxnId: 'portable-proof',
      type: 'mod-template.deleted',
      templateId: 'mod-template-retired',
      deletedTemplateVersion: 1,
      claimedTransitionEvidence: { version: 1, count: 0, sha256: '0'.repeat(64) },
    },
  }
}

function mustModTemplate(
  result: ReturnType<typeof createUserProfileModTemplate>,
): ProfileModTemplateRecord {
  if (!result.ok) throw new Error(result.message)
  return result.value
}

function mustModInstance(
  result: ReturnType<typeof stampProfileModTemplate> | ReturnType<typeof createDirectProfileModInstance>,
): ProfileModInstanceRecord {
  if (!result.ok) throw new Error(result.message)
  return result.value
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}
