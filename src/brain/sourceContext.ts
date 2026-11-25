import { cardById, cardLabel, membersOf } from '../graph/graphHelpers'
import type {
  Card,
  CardAsset,
  ConnectionGroupMode,
  OutputVersion,
  SavedBoard,
  SourceContextFingerprint,
  SourceContextSnapshot,
} from '../graph/types'
import { snapshotModPromptSource } from '../mods/snapshot'
import { stableContentHash } from '../shared/stableHash'
import type { CompiledInstruction } from './compiler'
import type { ResolvedConversation } from './conversationCompiler'
import { settledFollowUpMessages } from './followUpThread'

export type SourceContextRef = {
  cardId: string
  groupMode?: ConnectionGroupMode
}

export type SourceContextChange = {
  cardId: string
  kind: SourceContextFingerprint['kind']
  label: string
  groupMode?: ConnectionGroupMode
  reason: 'changed' | 'deleted'
  previousHash: string
  currentHash?: string
}

export type SourceChangeStatus = {
  signature: string
  changes: SourceContextChange[]
}

export function sourceRefsForCompiled(
  rootCardId: string,
  compiled: CompiledInstruction,
): SourceContextRef[] {
  const groupModes = new Map<string, ConnectionGroupMode>()
  for (const entry of [
    ...compiled.sections.buildOn,
    ...compiled.sections.influences,
    ...compiled.sections.alreadyExplored,
  ]) {
    if (entry.groupMode) groupModes.set(entry.cardId, entry.groupMode)
  }

  return normalizeRefs([
    { cardId: rootCardId },
    ...compiled.usedCardIds.map((cardId) => ({ cardId, groupMode: groupModes.get(cardId) })),
  ])
}

export function sourceRefsForConversation(
  conversationCardId: string,
  resolved: ResolvedConversation,
): SourceContextRef[] {
  return normalizeRefs([
    { cardId: conversationCardId },
    ...resolved.participants.flatMap((participant) =>
      sourceRefsForCompiled(participant.cardId, participant.privateContext),
    ),
    ...resolved.sharedContext.map((entry) => ({ cardId: entry.cardId })),
    ...resolved.alreadyExplored.map((entry) => ({ cardId: entry.cardId, groupMode: entry.groupMode })),
    ...resolved.topLevelMods.map((mod) => ({ cardId: mod.cardId })),
  ])
}

export function createSourceContextSnapshot(
  board: SavedBoard,
  refs: SourceContextRef[],
): SourceContextSnapshot {
  return {
    version: 1,
    sources: normalizeRefs(refs)
      .map((ref) => fingerprintSource(board, ref))
      .filter((source): source is SourceContextFingerprint => Boolean(source)),
  }
}

export function sourceChangeStatus(
  board: SavedBoard,
  version: OutputVersion,
): SourceChangeStatus | null {
  const snapshot = version.sourceContext
  if (!snapshot?.sources.length) return null

  const changes: SourceContextChange[] = []
  for (const previous of snapshot.sources) {
    const current = fingerprintSource(board, previous)
    if (!current) {
      changes.push({
        cardId: previous.cardId,
        kind: previous.kind,
        label: previous.label,
        groupMode: previous.groupMode,
        reason: 'deleted',
        previousHash: previous.hash,
      })
      continue
    }
    if (current.hash !== previous.hash) {
      changes.push({
        cardId: previous.cardId,
        kind: previous.kind,
        label: current.label || previous.label,
        groupMode: previous.groupMode,
        reason: 'changed',
        previousHash: previous.hash,
        currentHash: current.hash,
      })
    }
  }

  if (!changes.length) return null
  const signature = sourceChangeSignature(changes)
  if (version.sourceChangeDismissedSignature === signature) return null
  return { signature, changes }
}

export function sourceChangeSignature(changes: SourceContextChange[]): string {
  return `source:${stableContentHash(
    changes.map((change) => ({
      cardId: change.cardId,
      groupMode: change.groupMode,
      reason: change.reason,
      previousHash: change.previousHash,
      currentHash: change.currentHash,
    })),
  )}`
}

function fingerprintSource(
  board: SavedBoard,
  ref: SourceContextRef,
): SourceContextFingerprint | null {
  const card = cardById(board, ref.cardId)
  if (!card) return null
  const payload = sourcePayload(board, card, ref.groupMode)
  return {
    cardId: card.id,
    kind: card.kind,
    label: cardLabel(card),
    ...(ref.groupMode === undefined ? {} : { groupMode: ref.groupMode }),
    hash: stableContentHash(payload),
  }
}

function sourcePayload(
  board: SavedBoard,
  card: Card,
  groupMode?: ConnectionGroupMode,
): unknown {
  const payload: Record<string, unknown> = {
    kind: card.kind,
    blocks: card.blocks.map((block) => ({
      text: block.text,
      kind: block.kind,
    })),
    assets: normalizeAssets(card.assets),
  }

  if (card.kind === 'mod') {
    payload.mod = card.modV2 ? snapshotModPromptSource(card.modV2) : null
  }

  if (card.kind === 'conversation') {
    payload.conversation = {
      style: card.conversationStyle,
      turns: card.conversationTurns,
    }
  }

  if (card.kind === 'result') {
    payload.output = chosenResultPayload(board, card.id)
  }

  if (card.kind === 'group') {
    const members = membersOf(board, card.id)
    payload.group = {
      mode: groupMode ?? 'digest',
      compressionPrompt: groupMode === 'full' ? undefined : card.compressionPrompt,
      members: members.map((member) => ({
        cardId: member.id,
        hash: stableContentHash(sourcePayload(board, member)),
      })),
      digest: groupMode === 'compress' ? chosenResultPayload(board, card.id) : undefined,
    }
  }

  return payload
}

function chosenResultPayload(board: SavedBoard, resultCardId: string): unknown {
  const output = board.outputs.find((candidate) => candidate.resultCardId === resultCardId)
  if (!output) return null
  const chosenId = output.chosenVersionId ?? output.versions[output.versions.length - 1]?.id
  const chosen = output.versions.find((version) => version.id === chosenId)
  if (!chosen) return null
  const payload: Record<string, unknown> = {
    versionId: chosen.id,
    text: chosen.text,
    transcript: chosen.transcript?.map((message) => ({
      speakerKind: message.speakerKind,
      participantCardId: message.participantCardId,
      text: message.text,
      turnNumber: message.turnNumber,
    })),
    digestKey: chosen.digestKey,
  }
  // The chosen version's follow-up thread is part of what flows downstream, so
  // it is part of the fingerprint — mirroring how transcripts are hashed above.
  // settledFollowUpMessages is the same filter downstream context uses: blank,
  // failed, and still-streaming messages never reach downstream context, so
  // they never touch the hash. The field joins the payload only when real
  // content exists: thread-less results must hash byte-identically to boards
  // saved before follow-ups fed downstream context (no spurious badges).
  const followUps = settledFollowUpMessages(chosen.followUpThread?.messages ?? []).map(
    (message) => ({ role: message.role, text: message.text }),
  )
  if (followUps.length) payload.followUps = followUps
  return payload
}

function normalizeAssets(assets: CardAsset[] | undefined): unknown[] {
  return (assets ?? []).map((asset) => ({
    kind: asset.kind,
    name: asset.name,
    mimeType: asset.mimeType,
    dataUrl: asset.dataUrl,
    size: asset.size,
  }))
}

function normalizeRefs(refs: SourceContextRef[]): SourceContextRef[] {
  const seen = new Set<string>()
  const out: SourceContextRef[] = []
  for (const ref of refs) {
    const key = `${ref.cardId}:${ref.groupMode ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out
}
