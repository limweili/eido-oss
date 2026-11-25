// The single source for everything the user reads. Plain words only (Concept 6).
// Never let node/edge/graph/compiler/execution/persistence jargon reach this file.

import type { WebToolErrorCode } from '../brain/linkup'
export const words = {
  // Shared control copy
  none: 'None',
  choice: 'Choice',

  // Top bar
  addNote: 'Add note',
  addTitle: 'Title',
  askAi: 'Ask AI',
  addMod: 'Add Mod',
  addConversation: 'Conversation',
  groupSelection: 'Group',
  toolbox: 'Canvas tools',
  selectedCardActions: 'Selected card actions',
  toolSelect: 'Select',
  toolPan: 'Move',
  spacebar: 'Spacebar',
  toolHighlighter: 'Highlighter',
  ideas: 'Boards',
  topbarActions: 'Top bar actions',
  ideaName: 'Board name',
  ideaCreatePlaceholder: 'Name a new Board…',
  createIdea: 'Create',
  creatingIdea: 'Creating',
  renameIdea: 'Rename',
  duplicateIdea: 'Duplicate',
  loadIdea: 'Open',
  currentIdea: 'Current',
  deleteIdea: 'Delete',
  ideaShelfEmpty: 'Just this one so far.',
  today: 'today',
  yesterday: 'yesterday',
  ideaDeleteConsequence: 'Its cards and history will be removed from this computer.',
  exportIdea: 'Export',
  importIdea: 'Import',
  profileExportDialogTitle: 'Export Eido Profile',
  profileArchiveFileType: 'Eido Profile archive',
  profileImportDialogTitle: 'Import Eido Idea',
  profilePortableDataFileType: 'Eido portable data',
  ideaLocalHint: 'Boards saved on this computer.',
  ideaImportFailed: "Couldn't import that Board. Try another file.",
  board: 'Board',
  boardCanvas: 'Board canvas',

  // Saving states
  save: 'Save',
  saved: 'Saved',
  savedBrowser: 'Saved in browser',
  saving: 'Saving',
  saveFailed: "Couldn't save",
  browserStorageWarning: 'Saved in this browser for this address only.',
  // --- #1235 ADR 0048 personal-key fallback notice: begin ---
  // --- #1235 ADR 0048 personal-key fallback notice: end ---

  // Installed Profile startup and repair
  profileLoadingTitle: 'Opening your Ideas.',
  profileLoadingHint: 'Eido is checking everything before the canvas opens.',
  profileUnavailableTitle: "Eido couldn't open your Ideas.",
  profileUnavailableHint: 'Close Eido and try again.',
  profileRecoveryTitle: 'Your Ideas need repair.',
  profileRecoveryHint: 'Choose a verified recovery point to reopen them.',
  profileRecoveryEmpty: 'No verified recovery point is available.',
  restoreProfile: 'Restore',
  restoringProfile: 'Restoring',
  profileRecoveryFailed: "Couldn't restore that recovery point. Try another one.",
  startFreshProfileHint: 'You can also begin again. Your current files stay on this computer.',
  startFreshProfile: 'Start fresh with new Ideas',
  startingFreshProfile: 'Starting fresh',
  profileStartFreshFailed: "Couldn't start fresh. Close Eido and try again.",

  // Empty state
  emptyTitle: 'Start with a note.',
  emptyHint: 'Write a thought, connect a few, then ask AI to do something with them.',

  // Note card
  notePlaceholder: 'Write a thought…',
  titlePlaceholder: 'Label this area',
  noteSize: 'Text',
  noteSizeSmaller: 'Smaller text',
  noteSizeBigger: 'Bigger text',
  linkDialog: 'Link',
  linkUrl: 'URL',
  linkTitle: 'Title',
  editLink: 'Edit link',
  removeLink: 'Remove link',
  unsupportedLink: "That link type isn't supported.",
  linkPreviewLoading: 'Loading preview',
  openLinkPreview: 'Open',
  retryLinkPreview: 'Retry preview',
  refreshLinkPreview: 'Refresh preview',
  refreshingLinkPreview: 'Refreshing preview',
  removeLinkPreview: 'Remove preview',
  linkPreviewReady: 'Preview ready:',
  linkPreviewUnavailable: 'No preview found. Link address shown instead.',
  openLocalHtmlPreview: 'Open local HTML file',
  renderingLocalHtmlPreview: 'Rendering static preview',
  localHtmlPreviewUnavailable: 'File unavailable',

  // Card colour palette
  cardColour: 'Card colour',
  cardColourFillStyle: 'Fill style',
  cardColourTooltip: 'CARD COLOUR',
  cardColourNoFill: 'No fill',
  cardColourNoFillTooltip: 'NO FILL',
  cardColourSoftFill: 'Soft fill',
  cardColourSoftFillTooltip: 'SOFT FILL',
  cardColourBodyFill: 'Body fill',
  cardColourBodyFillTooltip: 'BODY FILL',
  cardColourPatternFill: 'Pattern fill',
  cardColourPatternFillTooltip: 'PATTERN FILL',
  cardIdentityCharcoal: 'Charcoal',
  cardIdentitySlate: 'Slate',
  cardIdentityOrchid: 'Orchid',
  cardIdentityPurple: 'Purple',
  cardIdentityBlue: 'Blue',
  cardIdentitySky: 'Sky',
  cardIdentityAmber: 'Amber',
  cardIdentityOrange: 'Orange',
  cardIdentityGreen: 'Green',
  cardIdentityMint: 'Mint',
  cardIdentityCoral: 'Coral',
  cardIdentityRed: 'Red',

  // Highlights
  boardSearch: 'Search',
  boardSearchLabel: 'Search this Board',
  boardSearchPlaceholder: 'Find words anywhere on this Board…',
  boardSearchCreator: 'Created by',
  boardSearchCreatorAll: 'All',
  boardSearchCreatorAi: 'AI-created',
  boardSearchCreatorUser: 'User-created',
  boardSearchResults: 'Board search results',
  boardSearchPages: 'Board search pages',
  boardSearchResize: 'Resize Search panel',
  boardSearchEmptyTitle: 'Nothing found.',
  boardSearchEmptyHint: 'Try fewer words or a different phrase.',
  previousResults: 'Previous',
  nextResults: 'Next',

  // Note sources and web tool failures.
  webErrorRateLimited: 'Too many requests just now. Wait a moment and try again.',
  webErrorUnreachable: 'Could not reach the web. Check your connection.',
  webErrorFailed: 'That did not work. Try again.',
  webSource: 'Source',
  // A Run's own reach, when it goes wrong. One line per failure the reach
  // boundary can raise; the shared lines above cover waiting, connection, and
  // the generic case. Finding nothing is an ordinary outcome, so its line
  // states a fact rather than apologising for a malfunction.
  webSearchErrorNoKey: 'Web search needs its key. Paste one in Settings.',
  webSearchErrorBadKey: 'That web search key does not work. Check it in Settings.',
  webSearchErrorOutOfCredit: 'The web search key is out of credit. Top up to keep searching.',
  webSearchErrorNoResults: 'The web had nothing for that search.',
  webSearchErrorPageTooLarge: 'That page is too big to read.',
  webSearchErrorPageUnreadable: 'That page could not be read. Try opening it yourself.',
  webSearchErrorUnsupportedContent: 'That address is not a readable page.',
  // Agentic Runs (ADR 0033). The Card's control is a globe and no word: it
  // stands in the foot among the run keys, and a globe is the one icon nobody
  // needs taught. It cycles Off, then Web, then Research, then Off again, so
  // each state's words say what is on now and what the next press does: the
  // accessible name and the tooltip are the whole story, and a screen reader
  // hears the state move without a second control existing. The concept is an
  // Agentic Run everywhere else.
  // Three words for three states, and nothing else (founder decision
  // 2026-08-18). An armed globe names the mode it is in. An off globe has no
  // state worth naming, so it names the press instead: what the button does
  // is the only useful thing to say about a control that is doing nothing.
  //
  // The reach explanations that briefly lived here (#964) are gone by the same
  // decision. A tooltip is read in the half-second before a press, and three
  // sentences of provider mechanics is not what that half-second is for.
  reachTurnOnWeb: 'Turn on Web mode',
  reachWebOn: 'Web mode',
  reachResearchOn: 'Research mode',
  // Said on the Card on every Run press of a research-armed Card, holding
  // that press: the moment before a person submits minutes of work that cannot
  // be called back. Every press asks, because every press spends the same
  // money. One fact, then what to do about it, and the sentence names the key
  // that spends, because the depth keys under it only set the dial (founder
  // decision 2026-08-18). No price here; the depth keys carry time and cost
  // where the finger is deciding, and Settings explains the key.
  reachResearchNote:
    'Research keeps working for minutes once it starts. Choose how deep you want research, and press Run again to confirm.',
  // The four depths the vendor sells, in the person paying's hands (#971).
  // The labels stay the vendor's own sizes because a shirt-size scale needs
  // no translation; each key's tooltip carries the two numbers the choice
  // actually turns on, time and dollars, verbatim from the founder decision.
  researchDepthChoiceLabel: 'How deep to look',
  researchDepthS: 'S',
  researchDepthM: 'M',
  researchDepthL: 'L',
  researchDepthXL: 'XL',
  researchDepthSHint: '2-5 min · $0.25',
  researchDepthMHint: '3-5 min · $0.50',
  researchDepthLHint: '5-10 min · $1.50',
  researchDepthXLHint: '10-20 min · $2.50',
  // Offered while a paid research job is standing with no run listening to
  // it: after a cancel, a crash, or a quit mid-poll. Resume re-attaches to
  // that job and never submits a new one, so the words promise exactly that.
  researchResume: 'Resume',
  researchResumeHint:
    'Picks the paid research back up and lands its answer. Starts nothing new.',
  // Said when the provider is a local harness. There is nothing to switch on:
  // the CLI owns its tools and activity, so the Card states the active mode
  // instead of offering a control that would change nothing (#964).
  agentHarness: 'CLI MODE',
  agentHarnessHint: 'CLI MODE',
  // The trail of what a run looked up. Each line is past tense, because it is a
  // thing that already happened; the summary above them takes the tense of the
  // run itself, which may still be working.
  toolTrailLabel: 'What this Card looked up',
  toolTrailSearched: 'Searched the web',
  toolTrailRead: 'Read a page',
  // A research job, when the step somehow carried no instruction of its own.
  toolTrailResearched: 'Investigated the web',
  // A step recorded by a build that knew a tool this one does not. Says the
  // true thing it can still say rather than dropping the line (ADR 0035).
  toolTrailUsedTool: 'Used a tool',
  // A lookup the web refused, when the step carried no words of its own.
  toolTrailTrouble: "A lookup didn't work",
  // A thinking row whose record kept no words (#966). Only an older file can
  // hold one: the trail never writes an empty passage, because a model that
  // returned proof-it-thought without words gets no row at all.
  toolTrailThought: 'Thought it through',
  // A run that got long enough to fill the model's window and wrote itself a
  // note to carry on from (#1036). The row is always the same words, unlike a
  // thinking row: this is a thing that happened to the run rather than
  // something it said, and the note itself is what opens underneath.
  toolTrailCompacted: 'Conversation recapped',
  // The chevron a trail row offers under the pointer (#966). One name in both
  // states: whether it is open is carried by the control's state, not its words.

  // Settings
  wholeBoardSelected: 'Whole Board selected. Copy includes every Card.',
  highlights: 'Highlights',
  highlightsTitle: 'Everything you highlighted, grouped by tag',
  highlightTags: 'Highlight tags',
  highlightTagPlaceholder: 'Search or create tags…',
  highlightPickTag: 'Pick a tag',
  highlightTagCreate: 'Create',
  highlightTagOptions: 'Tag options',
  highlightTagName: 'Tag name',
  highlightTagColor: 'Color',
  highlightColorYellow: 'Yellow',
  highlightColorGreen: 'Green',
  highlightColorBlue: 'Blue',
  highlightColorPink: 'Pink',
  highlightColorOrange: 'Orange',
  highlightColorPurple: 'Purple',
  highlightColorTeal: 'Teal',
  highlightColorRed: 'Red',
  highlightColorBrown: 'Brown',
  highlightColorGray: 'Gray',
  highlightTagBack: 'Back',
  highlightNoTagsHint: 'Drag over any text to highlight it, and your first tag is made for you.',
  highlightHowTo: 'Drag across text to highlight · hover one and tap its × to erase · Esc to finish',
  highlightTagEmpty: 'Nothing highlighted with this tag yet.',
  highlightsEmptyTitle: 'Nothing highlighted yet.',
  highlightsEmptyHint:
    'Pick the highlighter, then drag over any text on a note or result. Everything you mark collects here, grouped by tag.',
  highlightGoToCard: 'Go to card',
  highlightMakeNote: 'Turn into a note',
  highlightRemove: 'Remove highlight',
  highlightSourceGone: 'Card no longer on this board',
  deleteHighlightTag: 'Delete tag',
  deleteHighlightTagTitle: 'Delete this tag?',
  deleteHighlightTagMessage: 'Its highlights will be removed too. The text on your cards stays.',

  // Ask AI card
  askAiHeading: 'What should AI do?',
  askAiPlaceholder: 'Summarise the connected notes.',
  run: 'Run',
  cancel: 'Cancel',
  runningState: 'Running',
  ready: 'Ready',
  done: 'Done',
  couldntRun: "Couldn't run",
  showWhatAiUsed: 'Context',

  // Ask AI card: model picker
  modelLabel: 'Model',

  // Result card
  resultEmpty: 'Run the connected Ask AI card to see a result here.',
  resultFailureNextStep: 'Check your key or try again.',
  copy: 'Copy',
  copied: 'Copied',
  turnIntoNote: 'Turn into a note',
  makeVariations: 'Make variations',
  keepThis: 'Keep this',
  kept: 'Kept',
  unkeep: 'Unkeep',
  moreActions: 'More actions',
  resultActions: 'Result actions',
  stoppedVersion: '(stopped)',
  followUp: 'Follow up',
  followUpAssistant: 'AI',
  followUpPlaceholder: 'Ask a follow-up…',
  followUpTravelHint: 'This discussion travels with the card when you connect it to another card.',
  followUpStopped: 'Stopped early.',
  followUpFailed: "Couldn't finish.",
  stop: 'Stop',
  sourceChanged: 'Source changed',
  sourceChangedDetail: 'This version may need review.',
  sourceChangedSources: 'Changed sources',
  sourceChangedDeleted: 'Deleted',
  sourceChangedDismiss: 'Dismiss',

  // Version provenance (Result card "what was used" snapshot)
  versionContextTitle: 'What AI used',
  versionModel: 'Model',
  versionMadeAt: 'Made',
  versionContextSent: 'Context sent to AI',
  versionContextMissing: "This version's details weren't recorded.",

  // Conversation card
  conversationHeading: 'What should they talk about?',
  conversationTopicPlaceholder: 'Should we ship on Friday?',
  conversationStyle: 'Style',
  conversationTurns: 'Turns each',
  decreaseConversationTurns: 'Decrease turns',
  increaseConversationTurns: 'Increase turns',
  conversationStyleDebate: 'Debate',
  conversationStyleCritique: 'Critique',
  conversationStyleInterview: 'Interview',
  conversationStyleCollaborate: 'Explore together',
  conversationRun: 'Start',
  conversationCancel: 'Cancel',

  // Conversation Result (transcript)
  transcriptEmpty: 'Start the connected Conversation to see the exchange here.',
  transcriptStreaming: 'Writing',
  interjectionPlaceholder: 'Add to the conversation…',
  interjectionSend: 'Send',
  continueRun: 'Continue',
  provisionalCanceled: 'Stopped early, kept as a draft.',
  provisionalFailed: 'AI run failed, kept what was written.',
  you: 'You',

  // Conversation Context view
  ctxConversationTitle: 'Context',
  ctxSettings: 'Conversation settings',
  ctxTopic: 'Topic',
  ctxStyle: 'Style',
  ctxTurns: 'Turns each',
  ctxParticipants: 'Participants',
  ctxParticipantMods: 'Guidance for this participant',
  ctxSharedContext: 'Shared context',
  ctxTopLevelMods: 'Guidance for everyone',
  ctxPerTurn: 'See each turn',
  ctxNoSharedContext: 'No shared context connected.',
  ctxNoMods: 'No top-level guidance.',

  // Mod library
  modLibrary: 'Mod library',
  modLibraryIntro: 'Add a ready-made Mod or start with a blank one.',
  blankMod: 'Blank Mod',
  blankModHint: 'Create one from scratch.',
  addFromLibrary: 'Add from library',
  builtIn: 'Built-in',

  // Group card
  groupNamePlaceholder: 'Name this group',
  groupName: 'Name',
  groupDetails: 'Details',
  groupDetailsTitle: 'Group details',
  groupDetailsNote: 'Set how this group is named, compressed, and kept.',
  groupPrompt: 'Compress prompt',
  groupPromptPlaceholder: 'How should AI sum up this group?',
  groupDigest: 'Compressed versions',
  groupDigestEmpty: 'Run Compress to create a compressed version.',
  groupMembers: 'Inside this group',
  groupNoMembers: 'Nothing in this group yet.',
  groupItemSingular: 'card',
  groupItemPlural: 'cards',
  deleteGroup: 'Delete group',
  deleteGroupConfirm: 'Delete this group? Cards inside will remain on the canvas but lose their grouping.',
  removeFromGroup: 'Remove from group',
  notInGroup: 'No group',
  dragToRearrange: 'Drag to rearrange',
  cardKindNote: 'Note',
  cardKindAskAi: 'Ask AI',
  cardKindResult: 'Result',
  cardKindMod: 'Mod',
  cardKindGroup: 'Group',
  cardKindConversation: 'Conversation',
  cardKindTitle: 'Title',
  seeExactText: 'Show text',

  // Connections (midpoint pill popover)
  connectionTitle: 'Connection',
  strength: 'Strength',
  strong: 'Direct',
  weak: 'Light',
  groupMode: 'Group',
  groupFull: 'Everything',
  groupCompress: 'Compress',
  groupShares: 'This group shares',
  groupSharesEverything: 'Everything',
  groupSharesSummary: 'A summary',
  useAs: 'Connection',
  helps: 'Helps',
  pushesAgainst: 'Avoid',
  connectionReason: 'Reason',
  connectionReasonPlaceholder: 'Why avoid this?',
  modConnectionHint: 'Tunes how the run uses your notes.',
  deleteConnection: 'Remove connection',

  // Card side panel
  cardTitle: 'Card',
  selected: 'Selected',
  copyCardLink: 'Copy card link',
  cardLinkCopied: 'Card link copied',
  deleteCard: 'Delete',
  duplicateCard: 'Duplicate',
  undo: 'Undo',
  redo: 'Redo',
  duplicateWithConnections: 'Duplicate + connections',
  bringForward: 'Bring forward',
  sendBackward: 'Send back',
  backToPreviousView: 'Back',
  cardLinkMissingCard: "That card isn't in this Idea anymore.",
  cardLinkMissingIdea: "Couldn't find that Idea.",

  // Assets
  attachedImages: 'Attached images',
  attachedPreviews: 'Attached previews',
  removeAsset: 'Remove asset',
  imageGallery: 'Images',
  previousImage: 'Previous',
  nextImage: 'Next',
  removeImage: 'Remove',
  close: 'Close',

  // Context peek section headings
  peekTitle: 'Context',
  peekBuildOn: 'Build on',
  peekInfluences: 'Influences',
  peekAlreadyExplored: 'Already explored, do not retread',
  peekModifiers: 'Modifiers applied',
  peekApproach: 'How to approach it',
  peekTask: 'The task',
  peekNothing: 'No extra context is connected. AI will use the task on this card.',
  peekHop: 'Hop',
  peekConnection: 'Connection',
  peekRelationDirect: 'DIRECT',
  peekRelationLight: 'LIGHT',
  peekRelationAvoid: 'AVOID',
  peekGroupFrom: 'from',
  peekGroupFallback: 'group',
  peekUntitledContext: 'Untitled context',
  peekNoText: 'No text',
  peekAvoidReason: 'Reason this path died:',
  // An en dash, not an em dash: the house style bans the em dash outright,
  // including where it is standing in as a glyph for "no value here".
  peekEmptyValue: '–',
  peekStatusCompacted: 'Shortened',
  peekStatusCompactedDetail: 'This card will be sent shortened to fit.',
  peekStatusWillCompactDetail:
    'This card needs shortening; Run will make or reuse a short version before sending.',
  peekStatusDroppedDetail: 'This card is connected, but will be left out to fit.',
  trimsFirst: 'Trims first',
  peekStatusOmitted: 'Omitted',

  // Chain preview (what will run)
  whatWillRun: 'What will run',
  chainThisCard: 'Target',
  chainTagSourceChanged: 'Source changed',
  chainTagNeverRan: "Hasn't run yet",
  chainTagUpstream: 'Feeds from the step above',
  chainTagNew: 'New',
  chainTagUpstreamChip: 'Upstream',
  chainTagReused: 'Reused',
  chainRunEverything: 'Re-run everything',
  chainRunOne: 'Run 1 card',
  chainRunMany: 'Run', // composed as `Run N cards`
  chainCardsWord: 'cards',
  upToDate: 'Up to date',
  chainStoppedAt: 'Stopped at',

  // Context budget (compaction)
  compactionCompactedMarker: 'Some context was made smaller to fit.',
  compactionDroppedMarker: 'Some context was left out to fit.',
  compactionMarkerBoth: 'Some context was made smaller, and some left out, to fit.',
  compactionCompactedTag: 'made smaller',
  compactionDroppedTag: 'left out',

  // Settings page
  settings: 'Settings',
  settingsIntro: 'AI for this Idea.',
  settingsClose: 'Save and close settings',
  settingsCategoriesLabel: 'Settings categories',
  settingsContextNav: 'Context',
  settingsAiNav: 'AI Models',
  settingsBoardNav: 'Board',
  settingsPrivacyNav: 'Privacy',
  settingsContextTitle: 'Context',
  systemPromptLabel: 'Guidance for AI',
  // The founder's own sentence, kept word for word. Revised by them on
  // 2026-08-20; the ellipsis is the house one used by every other placeholder.
  systemPromptPlaceholder: "This is about my dog spa idea, please speak to me like an excited puppy…",
  // The founder's sentence, and only that (founder decision 2026-08-20). What
  // cards can and cannot read is not said here any more.
  systemPromptHint: 'This guidance is added every time you run something.',
  settingsAiTitle: 'AI Models',
  // One group per thing a key buys, so the heading answers "what is this for"
  // before the field asks for a secret. The tab keeps its own name above.
  settingsModelAccessTitle: 'AI Models',
  settingsWebSearchTitle: 'Web Search',
  settingsBoardTitle: 'Board',
  themeLabel: 'Theme',
  themeLight: 'Light',
  themeDark: 'Dark',
  themeMatchSystem: 'System',
  // Board Info: the section a user opens to see what the Board is doing. It
  // holds both diagnostics: the renderer counters and the wire record (#968).
  // "Performance" only ever named half of that.
  settingsBoardInfoTitle: 'Board Info',
  settingsRendererCountersLabel: 'Show counters',
  settingsRendererCountersHint: 'Shows live Board rendering counts. Eido only reads them while this is on.',
  settingsWireRecordLabel: 'Record run requests',
  settingsWireRecordHint:
    'Keeps a short record of every request a run makes: what was declared, called, and answered. It stays in memory on this device, is never saved with the Board, and is gone when Eido closes.',
  wireRecordEmptyHint: 'Nothing recorded yet. Run a card and every request it makes lands here.',
  wireRecordClear: 'Clear',
  wireRecordKindRequest: 'sent',
  wireRecordKindCall: 'call',
  wireRecordKindResult: 'result',
  wireRecordKindFailure: 'failed',
  wireRecordNoTools: 'no tools declared',
  wireRecordToolsLead: 'tools:',
  wireRecordBriefSent: 'brief sent',
  settingsPrivacyTitle: 'Privacy',
  // Both keys are one field, one line, one link, because that is the shape
  // every other control in Settings has and a key is not special enough to
  // break it (founder decision 2026-08-18). The line says what the key buys
  // and nothing else. Prices are gone from here: they belong at the press
  // that spends them, which is where the research depths now carry them.
  // The vendor is named once, above the field, as a quiet marker. The field
  // label is not shown: under "OpenRouter" a label reading "OpenRouter key"
  // says the vendor twice. It stays here as the input's accessible name.
  apiKeyVendor: 'OpenRouter',
  apiKeyLabel: 'OpenRouter key',
  // One sentence: what the key buys, then where to get it. The link is the
  // last words of the sentence, so nothing is left dangling under the field.
  apiKeyHint: 'Lets you use any AI model.',
  apiKeyGet: 'Get an OpenRouter key',
  // Where the key goes, said once and said accurately (#1359).
  //
  // Until this change the code around this field was called the keychain, the
  // bridge was `eidoKeychain`, and the key was readable JSON in a folder. A
  // person reading the word keychain concluded the operating system was holding
  // their key. It was not. The words are now true rather than the storage being
  // quietly wrong, so this line can say the plain thing and the naming around
  // it can stay.
  //
  // It names no path, no file and no mechanism. What a person can act on is
  // that the key stays on their computer, that the operating system holds it,
  // and that removing it here removes it.
  apiKeyStorageHint: 'Kept on this computer, protected by your operating system. Clear the field to remove it.',
  // Shown only when a key is on this computer and the operating system would
  // not open it on this launch. It says which of the two things went wrong,
  // because the other one, "no key set", sends a person to paste a key they
  // already have; and it promises the key is still there, because the visible
  // effect is identical to having lost it (#1360).
  //
  // One notice per credential slot, not one shared line. A slot names the
  // thing that stops working when its own key cannot be read, and the two
  // slots stop different things: this key buys AI, the Linkup key buys
  // Research. A shared line put the OpenRouter sentence under a working
  // OpenRouter field while the locked Linkup field said nothing at all, which
  // is four false clauses and one silent downgrade in the same screen (#1360).
  apiKeyLockedNotice: 'Your saved key is still on this computer, but your operating system would not unlock it this time. AI stays off until it does. Nothing has been lost.',
  linkupKeyVendor: 'Linkup',
  linkupKeyLabel: 'Linkup key',
  linkupKeyHint: 'Lets you search the web and read websites.',
  linkupKeyGet: 'Get a Linkup key',
  linkupKeyPlaceholder: 'Paste your Linkup key',
  // The `apiKeyLockedNotice` sentence, said for the slot that buys Research.
  // The operating system could not open a key already saved on this device.
  linkupKeyLockedNotice: 'Your saved key is still on this computer, but your operating system would not unlock it this time. Research stays off until it does. Nothing has been lost.',
  aiProviderOpenRouter: 'OpenRouter',
  aiProviderClaudeCode: 'Claude Code',
  aiProviderCodex: 'OpenAI Codex',
  aiProviderAntigravity: 'Google Antigravity',
  aiProviderLabel: 'Provider',
  aiProviderGroupApi: 'API',
  aiProviderGroupCli: 'CLI',
  aiProviderHint: 'Choose what AI is being used',
  localHarnessLoginHint: 'Uses your installed agent harness and your existing login.',
  localHarnessCommandLabel: 'Command',
  localHarnessCommandHint: 'The command name used to start the harness.',
  localHarnessAccessClaudeCode:
    "Starts in a temporary folder and doesn't save the chat. It can read files and use things you've already allowed; everything else is blocked.",
  localHarnessAccessCodex:
    "Starts in a temporary folder where it can only read files. It can search the web, but commands can't change files or connect to the internet.",
  localHarnessAccessAntigravity:
    'Starts in a temporary folder and can work with files there. Anything that needs your approval is blocked.',
  settingsSaveAndClose: 'Done',
  settingsSaveFailed: 'Eido could not save your key on this computer. Press Done to try again, or close Settings to leave it unsaved.',
  settingsChainTitle: 'Running cards',
  chainConfirmLabel: 'Confirm before running',
  chainConfirmDecrease: 'Fewer cards before confirming',
  chainConfirmIncrease: 'More cards before confirming',
  settingsCompactionTitle: "When context won't fit",
  compactionNever: 'Never shorten',
  compactionNeverHint: 'Drop overflow instead.',
  compactionWhenNeeded: 'Shorten as needed',
  compactionWhenNeededHint: 'Trim weaker context first.',
  compactionEager: 'Shorten early',
  compactionEagerHint: 'Keep more room for the task.',

  // AI settings
  keyNeededTitle: 'Set up an AI provider in Settings to run this card.',
  keyPlaceholder: 'sk-or-…',
  models: 'Models',
  modelsHint: 'Choose the default for new cards.',
  modelDefault: 'Default',
  modelRemove: 'Remove',
  modelRemoveLast: 'Keep at least one model',
  modelEdit: 'Edit',
  modelEditSave: 'Save',
  modelAdd: 'Add',
  modelAddPlaceholder: 'Add OpenRouter model slug, e.g. openai/gpt-5.6-luna',
  modelAddHarnessPlaceholder: 'Add model name or alias',
  // Said only when the shape is wrong, and said as the fix rather than as a
  // complaint. Only OpenRouter needs it: a local CLI answers to bare names.
  modelAddInvalid: 'OpenRouter models look like vendor/model, e.g. openai/gpt-5.6-luna',
  modelEditInvalid: 'Use a unique OpenRouter slug in vendor/model form.',
  // What the names above are, said in one line per CLI, then the vendor's own
  // list. Two of the three say the same thing because they are the same thing:
  // names that follow the vendor's latest, not pinned versions.
  modelsNoteClaudeCode: "These names use Anthropic's latest models.",
  modelsNoteCodex: "OpenAI's reasoning and coding models.",
  modelsNoteAntigravity: "These names use Google's latest models.",
  modelsDocsLink: 'See all models',
  reasoningEffort: 'Reasoning',
  // The rungs. One control, one order, least effort to most; the words on the
  // rungs are each vendor's own, so 'Deep' is Antigravity's name for the top
  // rung that Claude Code and Codex both call 'Max'.
  reasoningXHigh: 'Max',
  reasoningDeep: 'Deep',
  reasoningHigh: 'High',
  reasoningMedium: 'Medium',
  reasoningLow: 'Low',
  reasoningMinimal: 'Min',
  reasoningNone: 'Off',

  // Errors (human, no stack traces)
  errNoParticipants: 'Connect at least one Ask AI card as a participant.',
  conversationProviderChanged: 'This conversation used a different AI provider or model. Start a new version to continue.',
  errCouldNotReach: "Couldn't reach AI. Check your key or connection.",
  errHarnessUnavailable: "This AI tool isn't installed or Eido can't find it. Check its command in Settings.",
  errHarnessFailed: "The local AI tool couldn't run. Check its login and model name.",
  errHarnessIncompatible: "This AI tool's output isn't compatible. Update Eido or use a supported CLI version.",
  // A refusal for length, said as the one thing the reader can act on. The
  // generic message sends them to check a key that is working, and the run
  // that failed is one nothing in Eido could shrink: an Ask whose compiled
  // instruction is already past the model's window before a word is generated.
  errTooLong: 'Too long, reduce and try again.',
  errGeneric: "AI couldn't run. Check your key or try again.",

  // Playback
  playback: 'Playback',
  playbackPlay: 'Play',
  playbackPause: 'Pause',
  playbackPlayHint: 'Play (Space)',
  playbackPauseHint: 'Pause (Space)',
  playbackSpeed: 'Playback speed',
  playbackSpeedDouble: '2×',
  playbackSpeedFive: '5×',
  playbackSpeedTen: '10×',
  playbackScrubHint: 'Drag to scrub. Step through events with ← and →',
  playbackEmptyTitle: 'No timeline yet.',
  playbackEmptyHint: 'Make a few changes, then open Playback to scrub through them.',

  // Opt-in renderer counters
  rendererCountersTitle: 'Board performance',
  rendererCountersSamplingHint: 'Updates once a second while this panel is shown.',
  rendererCountersCards: 'Cards',
  rendererCountersResidentRichCards: 'Total Rich Cards',
  rendererCountersLiveCards: 'Live Cards (limit-exempt)',
  rendererCountersPassiveCards: 'Passive Cards',
  rendererCountersOversizePassiveCards: 'Oversized visible',
  rendererCountersTextWeight: 'Text weight',
  rendererCountersBoardTextWeight: 'Board total',
  rendererCountersPassiveTextWeight: 'Passive text weight',
  rendererCountersOversizePassiveTextWeight: 'Oversized weight',
  rendererCountersWeightDemotedCards: 'Demoted Cards',
  rendererCountersWeightBudgetState: 'Budget state',
  rendererCountersWeightWithinLimit: 'Within limit',
  rendererCountersWeightAtLimit: 'At limit',
  rendererCountersWeightOverBudget: 'Over budget',
  rendererCountersScene: 'Scene',
  rendererCountersSceneDerivations: 'Scene derivations',
  rendererCountersMetrics: 'Metrics',
  rendererCountersMetricDerivations: 'Metric derivations',
  rendererCountersMetricVisits: 'Cards visited',
  rendererCountersMetricFullRebuilds: 'Full rebuilds',
  rendererCountersRenditions: 'Renditions',
  rendererCountersRenditionEntries: 'Entries',
  rendererCountersRenditionDecodedBytes: 'Decoded bytes',
  rendererCountersRenditionBytes: 'Derived bytes',
  rendererCountersOf: 'of',
} as const

// Every web tool failure maps to user-facing copy. Cancellation needs no error message.
const webToolFailureKeys: Record<Exclude<WebToolErrorCode, 'canceled'>, keyof typeof words> = {
  'no-key': 'webSearchErrorNoKey',
  'bad-key': 'webSearchErrorBadKey',
  'out-of-credit': 'webSearchErrorOutOfCredit',
  'rate-limited': 'webErrorRateLimited',
  'no-results': 'webSearchErrorNoResults',
  'page-too-large': 'webSearchErrorPageTooLarge',
  'page-unreadable': 'webSearchErrorPageUnreadable',
  'unsupported-content': 'webSearchErrorUnsupportedContent',
  unreachable: 'webErrorUnreachable',
  failed: 'webErrorFailed',
}

// The same taxonomy as a words key rather than a sentence, for callers whose
// failure channel resolves through `words` later (a run outcome's message).
export function webToolFailureWordKey(code: string): keyof typeof words {
  const known = Object.prototype.hasOwnProperty.call(webToolFailureKeys, code)
  return known ? webToolFailureKeys[code as Exclude<WebToolErrorCode, 'canceled'>] : 'webErrorFailed'
}

export function webToolFailureLabel(code: string): string {
  const value = words[webToolFailureWordKey(code)]
  return typeof value === 'string' ? value : words.webErrorFailed
}

// The folded trail. A count is the useful thing at a glance: whether this
// answer rests on one page or on nine. Present tense while the run is still
// working, because the number is still climbing and the reader can watch it.
//
// A trail that is all thinking and no lookup gets different words. Observed on
// a real Board 2026-08-18: a run cancelled before its first lookup folded to
// "Looked up 1 thing" above a single thinking row, which is a count of
// something that did not happen. The number falls away and the trail says what
// it actually holds.
// The sentence names the live threshold, so the stepper beside it reads as the
// number the sentence is talking about.
export function chainConfirmHint(threshold: number): string {
  return `Eido will ask before running more than ${threshold} cards at a time.`
}

export function toolTrailSummaryLabel(count: number, running = false, lookups = count): string {
  if (lookups === 0) return running ? 'Working it out' : 'Worked it out'
  const thing = count === 1 ? 'thing' : 'things'
  return running ? `Looking up ${count} ${thing}` : `Looked up ${count} ${thing}`
}

// The last line of an opened trail that is only showing its first few. The
// count above it is the true total, so this says what is not drawn rather than
// pretending the list is complete. It is a control: the rest is one press away.
export function toolTrailMoreLabel(remainder: number): string {
  return remainder === 1 ? 'and 1 more' : `and ${remainder} more`
}

export function rendererCounterNumberLabel(value: number) {
  const finite = Number.isFinite(value) ? value : 0
  return Math.max(0, Math.round(finite)).toLocaleString()
}

export function rendererCounterByteLabel(bytes: number) {
  const finite = Number.isFinite(bytes) ? Math.max(0, bytes) : 0
  if (finite < 1024) return `${Math.round(finite)} B`
  if (finite < 1024 * 1024) return `${Math.round(finite / 1024)} KiB`
  return `${(finite / (1024 * 1024)).toFixed(1)} MiB`
}

export const modChromeWords = {
  title: 'Mod title',
  settings: 'Mod settings',
  context: 'Mod context',
  howToReadIt: 'How to read it',
  treatmentDefault: 'Default',
  treatmentEdited: 'Edited',
  treatmentHelp: 'Sent ahead of the prompts so the AI knows how to read the values. Clear it to get the default back.',
  colour: 'Mod colour',
  prompt: 'Prompt',
  optionPrompt: 'Option prompt',
  modPrompt: 'Mod prompt',
  valueSlotHelp: 'Insert the live value with “{value}”.',
  stops: 'Stops',
  steps: 'Steps',
  stopName: 'Stop name',
  off: 'Off',
  mode: 'Mode',
  numberMode: 'Number',
  percentMode: 'Percent',
  ratioMode: 'Ratio',
  lowEnd: 'low end',
  highEnd: 'high end',
  matrixStopsHelp: 'Clicking a cell walks through these stops.',
  countStopsHelp: 'Stops divide the percent and ratio modes.',
  name: 'Name',
  options: 'Options',
  stopNames: 'Stop names',
  stopNamesOrderHelp: 'This order between stop names.',
  turnOnStopsHelp: 'Turn on stops first.',
  switchPromptHelp: 'Spoken only while this switch is ON.',
  selectPromptHelp: 'Said verbatim while this option is picked.',
  orderPromptHelp: 'Spoken in the ranking in place of the name.',
} as const

/** The head "+" key's word per kind; kinds that never grow from the head are absent. */
export const modGrowWords: Partial<Record<string, string>> = {
  slider: 'Add a slider',
  dial: 'Add a dial',
  count: 'Add a counter',
  switch: 'Add a switch',
  select: 'Add an option',
  order: 'Add an item',
  filter: 'Add a limit',
  mixer: 'Add a channel',
  radar: 'Add an axis',
} as const

export const cardKindLabels = {
  note: words.cardKindNote,
  askAi: words.cardKindAskAi,
  result: words.cardKindResult,
  mod: words.cardKindMod,
  group: words.cardKindGroup,
  conversation: words.cardKindConversation,
  title: words.cardKindTitle,
} as const

export function ideaDeletedLabel(name: string) {
  return `Deleted "${name}".`
}

// Counted and interpolated copy lives outside `words` so the object stays a flat
// map of strings for every caller that reads it by key.

export function ideaCardCountLabel(count: number) {
  return `${count} ${count === 1 ? words.groupItemSingular : words.groupItemPlural}`
}

export function ideaUpdatedLabel(when: string) {
  return `updated ${when}`
}

export function playbackEventCountLabel(eventIndex: number, eventCount: number) {
  return `Event ${eventIndex} of ${eventCount}`
}

export function resizeCardFrom(corner: string) {
  return `Resize card from ${corner}`
}

export function resizeCardCurrentSize(width: number, height: number) {
  return `Current size ${width} by ${height} pixels. Use arrow keys to resize.`
}

export function setCardColourLabel(name: string) {
  return `Set card colour ${name}`
}

export function setModColourLabel(name: string) {
  return `Set Mod colour ${name}`
}
