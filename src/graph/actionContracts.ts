import type { GraphState } from './store'
import type { IntentLogEvent } from './types'


export type ActionCommitShape =
  | 'mutating'
  | 'interaction-summary'
  | 'narrative'
  | 'progress'
  | 'ephemeral'

export type ActionUndoContract = 'patch-ring' | 'semantic-history' | 'none'
export type ActionPlaybackContract = 'intent-log' | 'none'
export type ActionBoardChangeContract = 'emits' | 'none' | 'mixed'
export type ActionCollection =
  | 'cards'
  | 'connections'
  | 'outputs'
  | 'runs'
  | 'highlights'
  | 'highlightTags'
  | 'compactionSummaries'
export type IntentEventType = IntentLogEvent['type']

export type GraphActionContract = {
  id: string
  version: 1
  storeActions: readonly GraphActionName[]
  commitShapes: readonly ActionCommitShape[]
  undo: ActionUndoContract
  playback: ActionPlaybackContract
  boardChange: ActionBoardChangeContract
  collections: readonly ActionCollection[]
  intentEvents: readonly IntentEventType[]
}

export const GRAPH_ACTION_SURFACE = [
  'addCard',
  'duplicateCard',
  'duplicateCards',
  'pasteCards',
  'deleteCard',
  'setCardTitle',
  'setCardHeaderColor',
  'recordCardContentEdited',
  'setCardText',
  'setCardFontSize',
  'addCardAssets',
  'removeCardAsset',
  'setCardModel',
  'moveCard',
  'moveCards',
  'setCardSize',
  'adoptRenderedCardSizes',
  'growCardForAttachmentPanels',
  'bringCardsToFront',
  'sendCardsToBack',
  'createGroupFromSelection',
  'addCardToGroup',
  'removeCardFromGroup',
  'reorderGroupMembers',
  'recordCardStructuralChange',
  'setGroupCompressionPrompt',
  'setConversationStyle',
  'setConversationTurns',
  'addMod',
  'addConnection',
  'setConnectionStrength',
  'setConnectionPolarity',
  'setConnectionGroupMode',
  'setConnectionReason',
  'reorderContextItems',
  'deleteConnection',
  'deleteConnections',
  'createHighlightTag',
  'renameHighlightTag',
  'setHighlightTagColor',
  'addHighlight',
  'removeHighlight',
  'deleteHighlightTag',
  'createNoteFromHighlight',
  'recordCompactionSummary',
  'beginRun',
  'beginGroupDigestRun',
  'appendVersionText',
  'finishRun',
  'failRun',
  'cancelRun',
  'chooseVersion',
  'setVersionAccepted',
  'appendFollowUpMessage',
  'appendFollowUpChunk',
  'finishFollowUpMessage',
  'setFollowUpCollapsed',
  'clearFollowUpThread',
  'createVersionNote',
  'beginConversationRun',
  'continueConversationRun',
  'updateConversationProvenance',
  'appendTranscriptMessage',
  'appendTranscriptChunk',
  'finishTranscriptMessage',
  'recordConversationTurn',
  'finishConversationRun',
  'failConversationRun',
  'cancelConversationRun',
  'dismissSourceChanges',
] as const satisfies readonly (keyof GraphState)[]

export type GraphActionName = (typeof GRAPH_ACTION_SURFACE)[number]

export const GRAPH_ACTION_CONTRACTS: readonly GraphActionContract[] = [
  {
    id: 'card.lifecycle',
    version: 1,
    storeActions: [
      'addCard',
      'duplicateCard',
      'duplicateCards',
      'pasteCards',
      'deleteCard',
      'createNoteFromHighlight',
    ],
    commitShapes: ['mutating'],
    undo: 'patch-ring',
    playback: 'intent-log',
    boardChange: 'emits',
    collections: ['cards', 'connections', 'outputs'],
    intentEvents: ['card.created', 'card.deleted'],
  },
  {
    id: 'card.content',
    version: 1,
    storeActions: [
      'setCardTitle',
      'setCardHeaderColor',
      'recordCardContentEdited',
      'setCardText',
      'setCardFontSize',
      'addCardAssets',
      'removeCardAsset',
      'setCardModel',
      'setGroupCompressionPrompt',
      'setConversationStyle',
      'setConversationTurns',
      'addMod',
    ],
    commitShapes: ['progress', 'narrative'],
    undo: 'none',
    playback: 'intent-log',
    boardChange: 'mixed',
    collections: ['cards'],
    intentEvents: ['card.content.edited'],
  },
  {
    id: 'card.structure',
    version: 1,
    storeActions: [
      'moveCard',
      'moveCards',
      'setCardSize',
      'bringCardsToFront',
      'sendCardsToBack',
      'createGroupFromSelection',
      'addCardToGroup',
      'removeCardFromGroup',
      'reorderGroupMembers',
      'recordCardStructuralChange',
    ],
    commitShapes: ['mutating', 'interaction-summary', 'progress'],
    undo: 'patch-ring',
    playback: 'intent-log',
    boardChange: 'emits',
    collections: ['cards'],
    intentEvents: ['card.moved', 'card.resized', 'group.created', 'group.members.changed'],
  },
  {
    // Both members here answer the same question: what footprint does the
    // Card need in order to show what it already carries? Neither is a resize
    // the founder performed, so neither leaves an undo entry or a playback
    // event, and both persist because their whole point is to be found again.
    id: 'card.rendered-footprint',
    version: 1,
    storeActions: ['adoptRenderedCardSizes', 'growCardForAttachmentPanels'],
    commitShapes: ['progress'],
    undo: 'none',
    playback: 'none',
    boardChange: 'emits',
    collections: ['cards'],
    intentEvents: [],
  },
  {
    id: 'connection.lifecycle',
    version: 1,
    storeActions: [
      'addConnection',
      'setConnectionStrength',
      'setConnectionPolarity',
      'setConnectionGroupMode',
      'setConnectionReason',
      'reorderContextItems',
      'deleteConnection',
      'deleteConnections',
    ],
    commitShapes: ['mutating'],
    undo: 'patch-ring',
    playback: 'intent-log',
    boardChange: 'emits',
    collections: ['connections'],
    intentEvents: ['connection.created', 'connection.changed', 'connection.deleted'],
  },
  {
    id: 'highlighting',
    version: 1,
    storeActions: [
      'createHighlightTag',
      'renameHighlightTag',
      'setHighlightTagColor',
      'addHighlight',
      'removeHighlight',
      'deleteHighlightTag',
    ],
    commitShapes: ['progress'],
    undo: 'none',
    playback: 'none',
    boardChange: 'none',
    collections: ['highlights', 'highlightTags'],
    intentEvents: [],
  },
  {
    id: 'run.lifecycle',
    version: 1,
    storeActions: [
      'beginRun',
      'beginGroupDigestRun',
      'finishRun',
      'failRun',
      'cancelRun',
      'beginConversationRun',
      'continueConversationRun',
      'finishConversationRun',
      'failConversationRun',
      'cancelConversationRun',
    ],
    commitShapes: ['mutating'],
    undo: 'patch-ring',
    playback: 'intent-log',
    boardChange: 'emits',
    collections: ['cards', 'outputs', 'runs'],
    intentEvents: [
      'run.started',
      'run.continued',
      'run.completed',
      'run.failed',
      'run.canceled',
      'group.compression.started',
      'group.compression.completed',
      'group.compression.failed',
      'group.compression.canceled',
    ],
  },
  {
    id: 'run.progress',
    version: 1,
    storeActions: [
      'appendVersionText',
      'appendFollowUpChunk',
      'updateConversationProvenance',
      'appendTranscriptMessage',
      'appendTranscriptChunk',
      'finishTranscriptMessage',
      'recordConversationTurn',
      'dismissSourceChanges',
    ],
    commitShapes: ['progress'],
    undo: 'none',
    playback: 'none',
    boardChange: 'emits',
    collections: ['outputs', 'runs'],
    intentEvents: [],
  },
  {
    id: 'version.follow-up',
    version: 1,
    storeActions: [
      'chooseVersion',
      'setVersionAccepted',
      'appendFollowUpMessage',
      'finishFollowUpMessage',
      'setFollowUpCollapsed',
      'clearFollowUpThread',
      'createVersionNote',
    ],
    commitShapes: ['mutating', 'progress'],
    undo: 'patch-ring',
    playback: 'intent-log',
    boardChange: 'emits',
    collections: ['cards', 'outputs'],
    intentEvents: [
      'version.chosen',
      'version.note.created',
      'followup.message.added',
      'followup.message.finished',
      'followup.thread.cleared',
      'card.created',
    ],
  },
  {
    id: 'cache-and-preferences',
    version: 1,
    storeActions: ['recordCompactionSummary'],
    commitShapes: ['ephemeral', 'progress'],
    undo: 'none',
    playback: 'none',
    boardChange: 'none',
    collections: ['compactionSummaries'],
    intentEvents: [],
  },
]

export function graphActionContracts(): readonly GraphActionContract[] {
  return GRAPH_ACTION_CONTRACTS
}
