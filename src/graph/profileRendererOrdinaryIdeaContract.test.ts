import { describe, expect, it, vi } from 'vitest'
import type {
  InstalledProfileBridge,
  RendererProfileProjection,
} from '../../electron/profileBridgeContract'
import { createCompleteProfileFixture } from '../persistence/fixtures/profileLogicalProjectionFixture'
import {
  mergeGuiProfileProjection,
  profileGuiProjectionFailure,
  type GuiOrdinaryNewIdeaAuthorization,
  type GuiProfileProjection,
  type ProfileGuiProjectionDependencies,
} from '../persistence/profileGuiProjection'
import { profileServiceFailure } from '../persistence/profileServiceContract'
import {
  createProfileRendererPersistence,
  type ProfileRendererHydration,
  type ProfileRendererStateSink,
} from './profileRendererPersistence'

const ACTOR_ID = 'actor-synthetic-owner'
const IDEA_ID = 'idea-owner-issued-time'
const RENDERER_TIME = '2026-07-23T01:00:00.000Z'
const OWNER_TIME = '2026-07-23T01:00:00.001Z'
const COMMIT_TIME = '2026-07-23T01:00:00.002Z'

describe('ordinary Board creation across the renderer/native contract', () => {
  it('uses the owner-issued authorization timestamp for the new Idea and Board', async () => {
    const fixture = createCompleteProfileFixture()
    let nativeSnapshot = structuredClone(fixture.snapshot)
    let nativeGeneration = 0
    let authorization: GuiOrdinaryNewIdeaAuthorization | undefined
    let nativeMergeError: unknown

    const bridge = {
      hydrate: vi.fn(async () => ({
        ok: true as const,
        value: {
          intentActorId: ACTOR_ID,
          snapshot: nativeSnapshot,
          acknowledgement: {
            epoch: `epoch-${nativeSnapshot.revision}`,
            revision: nativeSnapshot.revision,
          },
        },
      })),
      ackHydration: vi.fn(async (epoch: string, revision: number) => ({
        ok: true as const,
        value: { acknowledged: true as const, epoch, revision },
      })),
      createOrdinaryIdea: vi.fn(async (ideaId: string) => {
        authorization = {
          authorizationId: 'authorization-owner-issued-time',
          profileId: nativeSnapshot.profileId,
          baseRevision: nativeSnapshot.revision,
          ideaId,
          boardId: `board:${ideaId}`,
          createdAt: OWNER_TIME,
          expiresAt: '2026-07-23T01:05:00.001Z',
        }
        return {
          ok: true as const,
          value: { ideaId, authorized: true as const, createdAt: OWNER_TIME },
        }
      }),
      commitGuiProjection: vi.fn(async (projection: RendererProfileProjection) => {
        try {
          const merged = mergeGuiProfileProjection(
            nativeSnapshot,
            {
              generation: nativeGeneration + 1,
              expectedRevision: nativeSnapshot.revision,
              clientTxnId: 'client-txn-owner-issued-time',
              idempotencyKey: 'idempotency-owner-issued-time',
              committedAt: COMMIT_TIME,
              context: {
                trustedActorId: ACTOR_ID,
                ordinaryNewIdeas: authorization ? [authorization] : [],
              },
              projection: {
                ...projection,
                profileId: nativeSnapshot.profileId,
                profileSettings: nativeSnapshot.profileSettings as unknown as GuiProfileProjection['profileSettings'],
              } satisfies GuiProfileProjection,
            },
            projectionDependencies(fixture),
          )
          nativeSnapshot = structuredClone(merged.snapshot)
          nativeGeneration += 1
          authorization = undefined
          return {
            ok: true as const,
            value: {
              generation: nativeGeneration,
              revision: nativeSnapshot.revision,
              durable: true as const,
              dirty: false as const,
            },
          }
        } catch (error) {
          nativeMergeError = error
          return profileGuiProjectionFailure(error) ?? profileServiceFailure('internal')
        }
      }),
      flush: vi.fn(async () => ({
        ok: true as const,
        value: { generation: nativeGeneration, revision: nativeSnapshot.revision },
      })),
    } as unknown as InstalledProfileBridge
    const persistence = createProfileRendererPersistence(bridge, {
      createIdeaId: () => IDEA_ID,
      now: () => RENDERER_TIME,
    })
    const terminal = vi.fn()
    persistence.connectStateSink(stateSink({ applyTerminalFailure: terminal }))
    await persistence.hydrate()

    let created: ProfileRendererHydration | undefined
    let creationError: unknown
    try {
      created = await persistence.createOrdinaryIdea('Owner time Board')
    } catch (error) {
      creationError = error
    }

    expect.soft(creationError).toBeUndefined()
    expect.soft(nativeMergeError).toBeUndefined()
    expect.soft(terminal).not.toHaveBeenCalled()
    expect.soft({
      activeIdeaId: nativeSnapshot.activeIdeaId,
      idea: nativeSnapshot.ideas.find((idea) => idea.id === IDEA_ID),
      board: nativeSnapshot.boards[IDEA_ID],
      rendererResult: created,
    }).toMatchObject({
      activeIdeaId: IDEA_ID,
      idea: {
        createdAt: OWNER_TIME,
        updatedAt: OWNER_TIME,
        lastOpenedAt: OWNER_TIME,
      },
      board: { updatedAt: OWNER_TIME },
      rendererResult: {
        idea: { id: IDEA_ID, createdAt: OWNER_TIME },
        board: { updatedAt: OWNER_TIME },
      },
    })
  })
})

function stateSink(
  overrides: Partial<ProfileRendererStateSink> = {},
): ProfileRendererStateSink {
  return {
    applyHydration: vi.fn(() => undefined),
    applyAuthoritativeUpdate: vi.fn((update) => ({
      status: 'applied' as const,
      revision: update.revision,
    })),
    admitHydration: vi.fn(() => undefined),
    applySaveStatus: vi.fn(),
    applyTerminalFailure: vi.fn(),
    ...overrides,
  }
}

function projectionDependencies(
  fixture: ReturnType<typeof createCompleteProfileFixture>,
): ProfileGuiProjectionDependencies {
  return {
    projectAsset: fixture.projectAsset,
    materializeUserModTemplate() {
      throw new Error('Ordinary Board creation must not materialize a Mod template')
    },
    materializeNewModInstance() {
      throw new Error('Ordinary Board creation must not materialize a Mod instance')
    },
  }
}
