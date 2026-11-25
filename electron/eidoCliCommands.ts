/**
 * One table describing every ergonomic Eido CLI command. Help text at every
 * level (index, group, leaf) is generated from this table, and usage failures
 * are attributed back to the matched command so an agent can self-correct from
 * the error it just received.
 */

export type EidoCliOptionSpec = Readonly<{
  flag: string
  summary: string
}>

export type EidoCliCommandSpec = Readonly<{
  /** Canonical path, for example ['card', 'create']. */
  path: readonly string[]
  /** Accepted older spellings kept working so installed scripts do not break. */
  aliases?: readonly (readonly string[])[]
  group: string
  summary: string
  synopsis: string
  mutating?: boolean
  options: readonly EidoCliOptionSpec[]
  /** Real copy-pasteable invocations. Never empty. */
  examples: readonly string[]
  notes?: readonly string[]
}>

export type EidoCliGroupSpec = Readonly<{
  name: string
  summary: string
}>

export type EidoCliUsageError = Readonly<{
  code: string
  message: string
  command?: readonly string[]
  hint?: string
}>

export type EidoCliHelpTopic =
  | Readonly<{ kind: 'index' }>
  | Readonly<{ kind: 'group'; group: string }>
  | Readonly<{ kind: 'command'; command: EidoCliCommandSpec }>
  | Readonly<{ kind: 'unknown'; argv: readonly string[] }>

const MUTATION_OPTIONS: readonly EidoCliOptionSpec[] = Object.freeze([
  Object.freeze({
    flag: '--expected-revision N',
    summary: 'Required. Refuse a stale Profile head. Read N from `eido status`.',
  }),
  Object.freeze({
    flag: '--dry-run | --apply',
    summary: 'Required, exactly one. --apply is the confirmation bypass (the --yes equivalent).',
  }),
  Object.freeze({
    flag: '--idempotency-key KEY',
    summary: 'Optional. Omitted, the key is derived from this exact command, so rerunning it is a safe retry.',
  }),
  Object.freeze({
    flag: '--request-id ID  --command-id ID',
    summary: 'Optional exact-envelope replay overrides.',
  }),
])

const PAGING_OPTIONS: readonly EidoCliOptionSpec[] = Object.freeze([
  Object.freeze({ flag: '--limit N', summary: 'Bound the number of returned items.' }),
  Object.freeze({ flag: '--byte-limit N', summary: 'Bound the returned payload size.' }),
  Object.freeze({ flag: '--cursor VALUE', summary: 'Continue from a returned cursor.' }),
])

const IDEA_OPTION: EidoCliOptionSpec = Object.freeze({
  flag: '--idea IDEA_OR_LINK',
  summary: 'Idea scope. Optional when the address is a Card Deep Link.',
})

/** Notes for every command whose value can come from stdin or a file. */
const EIDO_CLI_VALUE_SOURCE_NOTES: readonly string[] = Object.freeze([
  'Large values: pass `-` to read that flag from stdin, or `@PATH` to read it from a file.',
  'At most one flag per command may read stdin. One trailing newline is removed.',
  'Escaping: `--` is the literal `-`, and `@@text` is the literal `@text`.',
])

function safeSequence(invocation: string): string {
  return [
    'eido status',
    `${invocation} --expected-revision 12 --dry-run`,
    `${invocation} --expected-revision 12 --apply`,
  ].join('\n')
}

function command(spec: EidoCliCommandSpec): EidoCliCommandSpec {
  return Object.freeze({
    ...spec,
    path: Object.freeze([...spec.path]),
    options: Object.freeze([...spec.options]),
    examples: Object.freeze([...spec.examples]),
  })
}

export const EIDO_CLI_GROUPS: readonly EidoCliGroupSpec[] = Object.freeze([
  Object.freeze({ name: 'discovery', summary: 'Learn the surface: capabilities and operation schemas.' }),
  Object.freeze({ name: 'read', summary: 'Read Profile state: status, ideas, graph, records, results, changes.' }),
  Object.freeze({ name: 'idea', summary: 'Create and activate Ideas.' }),
  Object.freeze({ name: 'card', summary: 'Create, update, delete, and style Cards.' }),
  Object.freeze({ name: 'connection', summary: 'Create, re-mean, and delete Connections.' }),
  Object.freeze({ name: 'organize', summary: 'Arrange, layer, and group Cards on the Board.' }),
  Object.freeze({ name: 'result', summary: 'Choose, accept, and unaccept Result versions.' }),
  Object.freeze({ name: 'run', summary: 'Submit and poll delegated Runs (live app required).' }),
  Object.freeze({ name: 'mod', summary: 'Inspect, create, configure, and stamp Mods and Mod templates.' }),
  Object.freeze({ name: 'raw', summary: 'Pass one unchanged Gateway envelope through stdin.' }),
])

export const EIDO_CLI_COMMANDS: readonly EidoCliCommandSpec[] = Object.freeze([
  command({
    path: ['agent', 'capabilities'],
    aliases: [['capabilities']],
    group: 'discovery',
    summary: 'Print the Agent-filtered capability classes and limits.',
    synopsis: 'eido agent capabilities [--pretty]',
    options: [],
    examples: ['eido agent capabilities --pretty', 'eido capabilities'],
    notes: ['`eido capabilities` is the accepted short alias for the same read.'],
  }),
  command({
    path: ['describe'],
    group: 'discovery',
    summary: 'Summarize every Agent-facing operation, or describe one in full.',
    synopsis: 'eido describe [OPERATION] [--full] [--pretty]',
    options: [
      { flag: '--full', summary: 'Print the whole registry with every schema, bound, and failure.' },
    ],
    examples: [
      'eido describe',
      'eido describe graph.query --pretty',
      'eido describe --full',
    ],
    notes: ['Bare `eido describe` prints one summary line per operation.'],
  }),
  command({
    path: ['status'],
    group: 'read',
    summary: 'Print the Profile head revision and current Idea.',
    synopsis: 'eido status [--pretty]',
    options: [],
    examples: ['eido status', 'eido status --pretty'],
    notes: ['Read --expected-revision for any mutation from this command.'],
  }),
  command({
    path: ['idea', 'list'],
    group: 'read',
    summary: 'List Ideas.',
    synopsis: 'eido idea list [--limit N] [--byte-limit N] [--cursor VALUE] [--projection FIELD]',
    options: [
      ...PAGING_OPTIONS,
      { flag: '--projection FIELD', summary: 'Return only the named fields. Repeatable.' },
    ],
    examples: ['eido idea list --limit 20'],
  }),
  command({
    path: ['graph', 'query'],
    group: 'read',
    summary: 'Query records by creator, kind, owner, parent, or Idea.',
    synopsis: 'eido graph query FILTERS',
    options: [
      { flag: '--creator agent|user', summary: 'Match the recorded authorship.' },
      { flag: '--kind KIND', summary: 'Match a record kind. Repeatable.' },
      { flag: '--record ID  --card ID_OR_LINK', summary: 'Match exact records. Repeatable.' },
      { flag: '--parent ID_OR_LINK', summary: 'Match children of a record. Repeatable.' },
      IDEA_OPTION,
      { flag: '--owner OWNER_ID', summary: 'Match the exact logical-record ownerId.' },
      ...PAGING_OPTIONS,
      { flag: '--projection FIELD', summary: 'Return only the named fields. Repeatable.' },
    ],
    examples: ['eido graph query --idea idea-main --kind card --limit 25'],
    notes: ['At least one filter is required.'],
  }),
  command({
    path: ['graph', 'neighbors'],
    group: 'read',
    summary: 'Read one Card and everything directly connected to it.',
    synopsis: 'eido graph neighbors CARD_OR_LINK [--idea IDEA] [--limit N] [--byte-limit N]',
    options: [IDEA_OPTION, PAGING_OPTIONS[0]!, PAGING_OPTIONS[1]!],
    examples: ['eido graph neighbors card-7 --idea idea-main --limit 25'],
  }),
  command({
    path: ['graph', 'bounds'],
    group: 'read',
    summary: 'Read the spatial bounds of one or more Cards.',
    synopsis: 'eido graph bounds CARD_OR_LINK... [--idea IDEA]',
    options: [IDEA_OPTION],
    examples: ['eido graph bounds card-7 card-8 --idea idea-main'],
  }),
  command({
    path: ['record', 'get'],
    group: 'read',
    summary: 'Read one authoritative record by id or Card Deep Link.',
    synopsis: 'eido record get RECORD_OR_CARD_LINK [--byte-limit N] [--projection FIELD]',
    options: [
      { flag: '--byte-limit N', summary: 'Bound the returned payload size.' },
      { flag: '--projection FIELD', summary: 'Return only the named fields. Repeatable.' },
    ],
    examples: ['eido record get card-7 --projection payload'],
    notes: [
      '`record get` reads exactly one record, so --limit and --cursor are not supported.',
      'Use `eido graph query` when you need a paged list.',
    ],
  }),
  command({
    path: ['result', 'inspect'],
    group: 'read',
    summary: 'Read a Result version history, Run provenance, and follow-ups.',
    synopsis: 'eido result inspect RESULT_OR_LINK [--idea IDEA] [--limit N] [--byte-limit N] [--cursor VALUE]',
    options: [IDEA_OPTION, ...PAGING_OPTIONS],
    examples: ['eido result inspect result-3 --idea idea-main'],
  }),
  command({
    path: ['changes', 'list'],
    aliases: [['changes']],
    group: 'read',
    summary: 'List Agent-attributed changes, newest first.',
    synopsis: 'eido changes list [--since REVISION] [--limit N] [--byte-limit N] [--cursor VALUE]',
    options: [
      { flag: '--since REVISION', summary: 'Only changes after this Profile revision.' },
      ...PAGING_OPTIONS,
    ],
    examples: ['eido changes list --since 12 --limit 20', 'eido changes --limit 5'],
    notes: ['Bare `eido changes` is the accepted short alias.'],
  }),
  command({
    path: ['run'],
    group: 'run',
    summary: 'Run an Ask or Conversation Card (live app required).',
    synopsis: 'eido run CARD_OR_LINK [--idea IDEA] [--variations N]',
    options: [
      IDEA_OPTION,
      { flag: '--variations N', summary: 'Request bounded parallel variations.' },
    ],
    examples: ['eido run ask-1 --idea idea-main --variations 3'],
  }),
  command({
    path: ['run', 'status'],
    group: 'run',
    summary: 'Poll a Run for queued, running, or terminal state.',
    synopsis: 'eido run status RUN',
    options: [],
    examples: ['eido run status agent-run_1'],
  }),
  command({
    path: ['run', 'read'],
    group: 'run',
    summary: 'Read bounded Run and output-version references.',
    synopsis: 'eido run read RUN [--limit N] [--byte-limit N] [--cursor VALUE]',
    options: [...PAGING_OPTIONS],
    examples: ['eido run read agent-run_1 --limit 10'],
    notes: ['Read the authoritative content with `eido record get` on a returned reference.'],
  }),
  command({
    path: ['idea', 'create'],
    group: 'idea',
    mutating: true,
    summary: 'Create one named inactive Idea with an empty Board.',
    synopsis: 'eido idea create NAME MUTATION_SAFETY',
    options: [...MUTATION_OPTIONS],
    examples: [safeSequence('eido idea create "Research plan"')],
  }),
  command({
    path: ['idea', 'activate'],
    group: 'idea',
    mutating: true,
    summary: 'Switch the current canvas to an existing Idea.',
    synopsis: 'eido idea activate IDEA_OR_LINK MUTATION_SAFETY',
    options: [...MUTATION_OPTIONS],
    examples: [safeSequence('eido idea activate idea-main')],
  }),
  command({
    path: ['card', 'create'],
    group: 'card',
    mutating: true,
    summary: 'Create one Card, optionally fed by an existing Card.',
    synopsis: 'eido card create --idea IDEA --kind note|askAi|title|group|conversation PLACEMENT [KIND FIELDS] MUTATION_SAFETY',
    options: [
      IDEA_OPTION,
      { flag: '--kind KIND', summary: 'One of note, askAi, title, group, conversation.' },
      { flag: '--x N --y N', summary: 'Placement, exactly one of this or --near.' },
      { flag: '--near CARD_OR_LINK', summary: 'Place beside one or more live anchors. Repeatable.' },
      { flag: '--body TEXT', summary: 'Content for note, askAi, and title Cards.' },
      { flag: '--group-title TEXT  --compression-prompt TEXT', summary: 'Content for group Cards.' },
      {
        flag: '--topic TEXT  --conversation-style debate|critique|interview|collaborate  --conversation-turns N',
        summary: 'Content for conversation Cards.',
      },
      { flag: '--connect-from CARD_OR_LINK', summary: 'Existing Card that feeds the new Card, in one atomic batch.' },
      {
        flag: '--strength strong|weak  --polarity helps|pushesAgainst  --reason TEXT  --group-mode full|compress',
        summary: 'Connection meaning, only with --connect-from.',
      },
      ...MUTATION_OPTIONS,
    ],
    examples: [
      safeSequence('eido card create --idea idea-main --kind note --x 120 --y 40 --body "First thought"'),
      'eido card create --idea idea-main --kind askAi --near card-7 --body "What breaks first?" --connect-from card-7 --strength strong --expected-revision 12 --apply',
      'cat note.md | eido card create --idea idea-main --kind note --x 0 --y 0 --body - --expected-revision 12 --apply',
      'eido card create --idea idea-main --kind note --x 0 --y 0 --body @note.md --expected-revision 12 --apply',
      [
        '# Chain a created id into the next command with jq:',
        'REV=$(eido status | jq -r .result.revision)',
        'NEW=$(eido card create --idea idea-main --kind note --x 0 --y 0 --body @note.md \\',
        '  --expected-revision "$REV" --apply | jq -r .result.affectedIds[0])',
        'eido connection create card-7 "$NEW" --idea idea-main --strength strong \\',
        '  --expected-revision $((REV + 1)) --apply',
      ].join('\n'),
    ],
    notes: [
      '--text TEXT is a deprecated alias for --body where unambiguous.',
      ...EIDO_CLI_VALUE_SOURCE_NOTES,
    ],
  }),
  command({
    path: ['card', 'update'],
    group: 'card',
    mutating: true,
    summary: 'Update the content of one Card.',
    synopsis: 'eido card update CARD_OR_LINK [--idea IDEA] UPDATE_FIELDS MUTATION_SAFETY',
    options: [
      IDEA_OPTION,
      { flag: '--body TEXT', summary: 'New body for note, askAi, and title Cards.' },
      { flag: '--group-title TEXT  --compression-prompt TEXT', summary: 'New group Card content.' },
      {
        flag: '--topic TEXT  --conversation-style STYLE  --conversation-turns N',
        summary: 'New conversation Card content.',
      },
      { flag: '--block BLOCK --text TEXT', summary: 'Legacy block update, still accepted.' },
      ...MUTATION_OPTIONS,
    ],
    examples: [
      safeSequence('eido card update card-7 --idea idea-main --body "Sharper thought"'),
      'eido card update card-7 --idea idea-main --body @rewrite.md --expected-revision 12 --apply',
    ],
    notes: [...EIDO_CLI_VALUE_SOURCE_NOTES],
  }),
  command({
    path: ['card', 'delete'],
    group: 'card',
    mutating: true,
    summary: 'Delete one Card, with any stale Result cascade recorded.',
    synopsis: 'eido card delete CARD_OR_LINK [--idea IDEA] MUTATION_SAFETY',
    options: [IDEA_OPTION, ...MUTATION_OPTIONS],
    examples: [safeSequence('eido card delete card-7 --idea idea-main')],
  }),
  command({
    path: ['card', 'identity'],
    group: 'card',
    mutating: true,
    summary: 'Set or clear the visual identity of one Card.',
    synopsis: 'eido card identity CARD_OR_LINK (--identity PRESET --fill soft|body|pattern | --clear) [--idea IDEA] MUTATION_SAFETY',
    options: [
      IDEA_OPTION,
      { flag: '--identity PRESET', summary: 'Identity preset name, with --fill.' },
      { flag: '--fill soft|body|pattern', summary: 'How the identity paints the Card.' },
      { flag: '--clear', summary: 'Remove the identity. On Mods the accent is kept.' },
      ...MUTATION_OPTIONS,
    ],
    examples: [safeSequence('eido card identity card-7 --idea idea-main --identity mint --fill soft')],
    notes: ['Title Cards are spatial labels and do not accept visual identity.'],
  }),
  command({
    path: ['ask', 'model'],
    group: 'card',
    mutating: true,
    summary: 'Set the model on one Ask Card.',
    synopsis: 'eido ask model CARD_OR_LINK --model MODEL [--idea IDEA] MUTATION_SAFETY',
    options: [
      { flag: '--model MODEL', summary: 'Model identifier to record on the Ask.' },
      IDEA_OPTION,
      ...MUTATION_OPTIONS,
    ],
    examples: [safeSequence('eido ask model ask-1 --idea idea-main --model openai/gpt-5.6')],
  }),
  command({
    path: ['connection', 'create'],
    group: 'connection',
    mutating: true,
    summary: 'Connect one Card to another.',
    synopsis: 'eido connection create FROM_CARD TO_CARD [--idea IDEA] [MEANING] MUTATION_SAFETY',
    options: [
      IDEA_OPTION,
      {
        flag: '--strength strong|weak  --polarity helps|pushesAgainst  --reason TEXT  --group-mode full|compress',
        summary: 'Connection meaning.',
      },
      ...MUTATION_OPTIONS,
    ],
    examples: [
      safeSequence('eido connection create card-7 ask-1 --idea idea-main --strength strong'),
      'eido connection create card-7 ask-1 --idea idea-main --reason @why.txt --expected-revision 12 --apply',
    ],
    notes: [
      'Title Connections are prohibited.',
      ...EIDO_CLI_VALUE_SOURCE_NOTES,
    ],
  }),
  command({
    path: ['connection', 'update-meaning'],
    group: 'connection',
    mutating: true,
    summary: 'Change what an existing Connection means.',
    synopsis: 'eido connection update-meaning CONNECTION --idea IDEA [MEANING] MUTATION_SAFETY',
    options: [
      IDEA_OPTION,
      {
        flag: '--strength strong|weak  --polarity helps|pushesAgainst  --reason TEXT  --group-mode full|compress',
        summary: 'Connection meaning. At least one is required.',
      },
      { flag: '--clear-reason', summary: 'Remove the recorded reason.' },
      ...MUTATION_OPTIONS,
    ],
    examples: [safeSequence('eido connection update-meaning connection-3 --idea idea-main --polarity pushesAgainst')],
  }),
  command({
    path: ['connection', 'delete'],
    group: 'connection',
    mutating: true,
    summary: 'Delete one Connection.',
    synopsis: 'eido connection delete CONNECTION --idea IDEA MUTATION_SAFETY',
    options: [IDEA_OPTION, ...MUTATION_OPTIONS],
    examples: [safeSequence('eido connection delete connection-3 --idea idea-main')],
  }),
  command({
    path: ['card', 'arrange'],
    aliases: [['cards', 'arrange']],
    group: 'organize',
    mutating: true,
    summary: 'Move and resize Cards in one atomic batch.',
    synopsis: 'eido card arrange --idea IDEA --frames JSON MUTATION_SAFETY',
    options: [
      IDEA_OPTION,
      {
        flag: '--frames JSON',
        summary: 'Frames are [{"card":"ID_OR_LINK","x":N,"y":N,"width"?:N,"height"?:N}].',
      },
      ...MUTATION_OPTIONS,
    ],
    examples: [
      safeSequence('eido card arrange --idea idea-main --frames \'[{"card":"card-7","x":0,"y":0}]\''),
      'eido card arrange --idea idea-main --frames @frames.json --expected-revision 12 --apply',
      'jq -c . frames.json | eido card arrange --idea idea-main --frames - --expected-revision 12 --apply',
    ],
    notes: [
      '`eido cards arrange` remains an accepted alias.',
      ...EIDO_CLI_VALUE_SOURCE_NOTES,
    ],
  }),
  command({
    path: ['card', 'layer'],
    aliases: [['cards', 'layer']],
    group: 'organize',
    mutating: true,
    summary: 'Send Cards to the front or the back.',
    synopsis: 'eido card layer front|back CARD_OR_LINK... [--idea IDEA] MUTATION_SAFETY',
    options: [IDEA_OPTION, ...MUTATION_OPTIONS],
    examples: [safeSequence('eido card layer front card-7 card-8 --idea idea-main')],
    notes: ['`eido cards layer` remains an accepted alias.'],
  }),
  command({
    path: ['group', 'add'],
    group: 'organize',
    mutating: true,
    summary: 'Put Cards into a group Card.',
    synopsis: 'eido group add GROUP_OR_LINK MEMBER_OR_LINK... [--idea IDEA] MUTATION_SAFETY',
    options: [IDEA_OPTION, ...MUTATION_OPTIONS],
    examples: [safeSequence('eido group add group-1 card-7 card-8 --idea idea-main')],
  }),
  command({
    path: ['group', 'remove'],
    group: 'organize',
    mutating: true,
    summary: 'Take Cards out of whatever group holds them.',
    synopsis: 'eido group remove MEMBER_OR_LINK... [--idea IDEA] MUTATION_SAFETY',
    options: [IDEA_OPTION, ...MUTATION_OPTIONS],
    examples: [safeSequence('eido group remove card-7 --idea idea-main')],
  }),
  command({
    path: ['result', 'choose'],
    group: 'result',
    mutating: true,
    summary: 'Choose which version of an Output is shown.',
    synopsis: 'eido result choose OUTPUT --version VERSION --idea IDEA MUTATION_SAFETY',
    options: [
      { flag: '--version VERSION', summary: 'Stable version identity from `eido result inspect`.' },
      IDEA_OPTION,
      ...MUTATION_OPTIONS,
    ],
    examples: [safeSequence('eido result choose output-2 --version version-5 --idea idea-main')],
  }),
  command({
    path: ['result', 'accept'],
    group: 'result',
    mutating: true,
    summary: 'Accept one Output version.',
    synopsis: 'eido result accept OUTPUT --version VERSION --idea IDEA MUTATION_SAFETY',
    options: [
      { flag: '--version VERSION', summary: 'Stable version identity from `eido result inspect`.' },
      IDEA_OPTION,
      ...MUTATION_OPTIONS,
    ],
    examples: [safeSequence('eido result accept output-2 --version version-5 --idea idea-main')],
  }),
  command({
    path: ['result', 'unaccept'],
    group: 'result',
    mutating: true,
    summary: 'Withdraw acceptance of one Output version.',
    synopsis: 'eido result unaccept OUTPUT --version VERSION --idea IDEA MUTATION_SAFETY',
    options: [
      { flag: '--version VERSION', summary: 'Stable version identity from `eido result inspect`.' },
      IDEA_OPTION,
      ...MUTATION_OPTIONS,
    ],
    examples: [safeSequence('eido result unaccept output-2 --version version-5 --idea idea-main')],
  }),
  command({
    path: ['mod', 'inspect'],
    group: 'mod',
    summary: 'Read a round-trippable Mod spec plus derived prompt context.',
    synopsis: 'eido mod inspect MOD_CARD_OR_LINK [--idea IDEA]',
    options: [IDEA_OPTION],
    examples: ['eido mod inspect mod-card-1 --idea idea-main'],
  }),
  command({
    path: ['mod', 'create'],
    group: 'mod',
    mutating: true,
    summary: 'Create one direct Mod instance from an ergonomic spec.',
    synopsis: 'eido mod create --idea IDEA --spec JSON --x N --y N [--connect-to CARD] [--strength strong|weak] MUTATION_SAFETY',
    options: [
      IDEA_OPTION,
      { flag: '--spec JSON', summary: '{version:1,kind,title,identity,treatment,state}.' },
      { flag: '--x N --y N', summary: 'Board placement.' },
      { flag: '--connect-to ASK_OR_CONVERSATION', summary: 'Feed an Ask or Conversation Card.' },
      { flag: '--strength strong|weak', summary: 'Strength of the created Connection.' },
      ...MUTATION_OPTIONS,
    ],
    examples: [
      safeSequence('eido mod create --idea idea-main --x 0 --y 0 --spec \'{"version":1,"kind":"switch","title":"EVIDENCE LENS","identity":"mint","treatment":null,"state":{"items":[{"label":"SKEPTICAL","on":true,"frame":"Challenge every claim."}]}}\''),
      'eido mod create --idea idea-main --x 0 --y 0 --spec @lens.json --expected-revision 12 --apply',
    ],
    notes: [
      'Kinds: mixer, filter, slider, dial, count, switch, pad, select, order, radar, matrix.',
      'Identity: coral, red, amber, orange, mint, green, sky, blue, orchid, purple, slate, charcoal.',
      ...EIDO_CLI_VALUE_SOURCE_NOTES,
    ],
  }),
  command({
    path: ['mod', 'configure'],
    group: 'mod',
    mutating: true,
    summary: 'Replace the spec of one Mod instance.',
    synopsis: 'eido mod configure MOD_CARD_OR_LINK --spec JSON [--idea IDEA] MUTATION_SAFETY',
    options: [
      { flag: '--spec JSON', summary: 'Full ergonomic spec, normally read with `eido mod inspect`.' },
      IDEA_OPTION,
      ...MUTATION_OPTIONS,
    ],
    examples: [safeSequence('eido mod configure mod-card-1 --idea idea-main --spec \'{"version":1,"kind":"switch","title":"EVIDENCE LENS","identity":"mint","treatment":null,"state":{"items":[{"label":"SKEPTICAL","on":false,"frame":"Challenge every claim."}]}}\''),
      'eido mod inspect mod-card-1 --idea idea-main | jq .result.spec > spec.json',
      'eido mod configure mod-card-1 --idea idea-main --spec @spec.json --expected-revision 12 --apply',
    ],
    notes: [
      'Omitted nested ids on growable kinds allocate fresh parts.',
      ...EIDO_CLI_VALUE_SOURCE_NOTES,
    ],
  }),
  command({
    path: ['mod', 'delete'],
    group: 'mod',
    mutating: true,
    summary: 'Delete one Mod instance.',
    synopsis: 'eido mod delete MOD_CARD_OR_LINK [--idea IDEA] MUTATION_SAFETY',
    options: [IDEA_OPTION, ...MUTATION_OPTIONS],
    examples: [safeSequence('eido mod delete mod-card-1 --idea idea-main')],
  }),
  command({
    path: ['mod', 'connect'],
    group: 'mod',
    mutating: true,
    summary: 'Connect a Mod to an Ask or Conversation Card.',
    synopsis: 'eido mod connect MOD_CARD_OR_LINK ASK_OR_CONVERSATION [--idea IDEA] [--strength strong|weak] MUTATION_SAFETY',
    options: [
      IDEA_OPTION,
      { flag: '--strength strong|weak', summary: 'Strength of the created Connection.' },
      ...MUTATION_OPTIONS,
    ],
    examples: [safeSequence('eido mod connect mod-card-1 ask-1 --idea idea-main')],
  }),
  command({
    path: ['mod', 'stamp'],
    group: 'mod',
    mutating: true,
    summary: 'Stamp a Mod template onto the Board.',
    synopsis: 'eido mod stamp TEMPLATE --template-version N --idea IDEA --x N --y N [--connect-to CARD] MUTATION_SAFETY',
    options: [
      { flag: '--template-version N', summary: 'Template version you inspected.' },
      IDEA_OPTION,
      { flag: '--x N --y N', summary: 'Board placement.' },
      { flag: '--connect-to ASK_OR_CONVERSATION', summary: 'Feed an Ask or Conversation Card.' },
      { flag: '--strength strong|weak', summary: 'Strength of the created Connection.' },
      ...MUTATION_OPTIONS,
    ],
    examples: [safeSequence('eido mod stamp template-1 --template-version 2 --idea idea-main --x 0 --y 0')],
  }),
  command({
    path: ['mod', 'template', 'list'],
    group: 'mod',
    summary: 'List Mod templates.',
    synopsis: 'eido mod template list [--limit N] [--byte-limit N] [--cursor VALUE]',
    options: [...PAGING_OPTIONS],
    examples: ['eido mod template list --limit 20'],
  }),
  command({
    path: ['mod', 'template', 'inspect'],
    group: 'mod',
    summary: 'Read one Mod template spec.',
    synopsis: 'eido mod template inspect TEMPLATE',
    options: [],
    examples: ['eido mod template inspect template-1'],
  }),
  command({
    path: ['mod', 'template', 'create'],
    group: 'mod',
    mutating: true,
    summary: 'Create one Mod template.',
    synopsis: 'eido mod template create TEMPLATE --spec JSON MUTATION_SAFETY',
    options: [
      { flag: '--spec JSON', summary: 'Ergonomic Mod spec.' },
      ...MUTATION_OPTIONS,
    ],
    examples: [safeSequence('eido mod template create template-1 --spec \'{"version":1,"kind":"switch","title":"EVIDENCE LENS","identity":"mint","treatment":null,"state":{"items":[{"label":"SKEPTICAL","on":true,"frame":"Challenge every claim."}]}}\''),
      'eido mod template create template-1 --spec @lens.json --expected-revision 12 --apply',
    ],
    notes: [...EIDO_CLI_VALUE_SOURCE_NOTES],
  }),
  command({
    path: ['mod', 'template', 'configure'],
    group: 'mod',
    mutating: true,
    summary: 'Replace the spec of one Mod template.',
    synopsis: 'eido mod template configure TEMPLATE --template-version N --spec JSON MUTATION_SAFETY',
    options: [
      { flag: '--template-version N', summary: 'Template version you inspected.' },
      { flag: '--spec JSON', summary: 'Ergonomic Mod spec.' },
      ...MUTATION_OPTIONS,
    ],
    examples: [safeSequence('eido mod template configure template-1 --template-version 2 --spec \'{"version":1,"kind":"switch","title":"EVIDENCE LENS","identity":"mint","treatment":null,"state":{"items":[{"label":"SKEPTICAL","on":true,"frame":"Challenge every claim."}]}}\''),
      'eido mod template configure template-1 --template-version 2 --spec @spec.json --expected-revision 12 --apply',
    ],
    notes: [...EIDO_CLI_VALUE_SOURCE_NOTES],
  }),
  command({
    path: ['mod', 'template', 'delete'],
    group: 'mod',
    mutating: true,
    summary: 'Delete one Mod template.',
    synopsis: 'eido mod template delete TEMPLATE --template-version N MUTATION_SAFETY',
    options: [
      { flag: '--template-version N', summary: 'Template version you inspected.' },
      ...MUTATION_OPTIONS,
    ],
    examples: [safeSequence('eido mod template delete template-1 --template-version 2')],
  }),
  command({
    path: ['batch'],
    group: 'raw',
    summary: 'Pass one complete Gateway envelope from stdin unchanged.',
    synopsis: 'eido batch < request.json',
    options: [],
    examples: [
      'echo \'{"version":1,"requestId":"r1","operation":"profile.status","params":{}}\' | eido batch',
    ],
    notes: [
      'batch emits the unchanged Gateway envelope, so --pretty is not accepted here.',
      'batch reads raw stdin as the whole envelope. The `-` and @PATH value sources never apply here.',
      'This is the only route to compatibility-only operations.',
    ],
  }),
])

const EIDO_CLI_MUTATION_SAFETY_LINES: readonly string[] = Object.freeze([
  'Mutation safety (every mutating command):',
  '  --expected-revision N   Required. Read N from `eido status`.',
  '  --dry-run | --apply     Required, exactly one. --apply is the confirmation bypass.',
  '  Rerunning the exact same command is a safe retry, never a second change.',
])

/** The longer retry story belongs in leaf help, not in the short index. */
const EIDO_CLI_MUTATION_RETRY_LINES: readonly string[] = Object.freeze([
  'Retries:',
  '  With --idempotency-key omitted the key is derived from this exact command,',
  '  so rerunning it after a timeout returns the first outcome instead of making',
  '  a second change. Change any value and it is a new operation with a new key.',
  '  To see what landed instead, read `eido changes --since REVISION` with the',
  '  revision `eido status` reported before the mutation.',
])


const EIDO_CLI_MACHINE_LINES: readonly string[] = Object.freeze([
  'Machine contract:',
  '  stdout carries the outcome as one JSON envelope. stderr carries diagnostics',
  '  only, so a machine caller can ignore stderr and read stdout plus the exit code.',
])

/** Short index. One line per group plus a pointer to the group help. */
export function renderEidoCliIndex(): string {
  const lines: string[] = [
    'Eido is a local visual thinking board. This command works with the installed',
    'Eido Profile through the bounded Agent Gateway; it never accepts a Profile path',
    'or storage credentials.',
    '',
    'Usage: eido <command> [options]',
    '       eido <command> --help        Options and examples for one command.',
    '       eido <group> --help          The commands in one group.',
    '',
    'Command groups:',
  ]
  for (const group of EIDO_CLI_GROUPS) {
    lines.push(`  ${group.name.padEnd(12)}${group.summary}`)
  }
  lines.push(
    '',
    'Start here:',
    '  eido status                    Profile head revision, needed by every mutation.',
    '  eido agent capabilities        Capability classes and limits.',
    '  eido describe                  One summary line per Agent-facing operation.',
    '',
    ...EIDO_CLI_MUTATION_SAFETY_LINES,
    '',
    ...EIDO_CLI_MACHINE_LINES,
    '',
    '`help`, `-h`, and `--help` are synonyms, at any position.',
    'A Card Deep Link (eido://app/?idea=...&card=...) works anywhere an address is accepted.',
  )
  return `${lines.join('\n')}\n`
}

export function renderEidoCliGroupHelp(group: string): string | undefined {
  const members = EIDO_CLI_COMMANDS.filter(spec => spec.group === group)
  const described = EIDO_CLI_GROUPS.find(entry => entry.name === group)
  if (members.length === 0 || !described) return undefined
  const lines: string[] = [
    `eido ${group}: ${described.summary}`,
    '',
    'Commands:',
  ]
  for (const spec of members) {
    lines.push(`  ${spec.path.join(' ').padEnd(26)}${spec.summary}${spec.mutating ? ' (mutating)' : ''}`)
  }
  lines.push('', `Run \`eido ${members[0]!.path.join(' ')} --help\` for options and examples.`)
  return `${lines.join('\n')}\n`
}

export function renderEidoCliCommandHelp(spec: EidoCliCommandSpec): string {
  const lines: string[] = [
    `eido ${spec.path.join(' ')}: ${spec.summary}`,
    '',
    'Synopsis:',
    `  ${spec.synopsis}`,
  ]
  if (spec.options.length > 0) {
    lines.push('', 'Options:')
    for (const option of spec.options) lines.push(`  ${option.flag}`, `      ${option.summary}`)
  }
  const children = EIDO_CLI_COMMANDS.filter(candidate => (
    candidate.path.length > spec.path.length
      && spec.path.every((segment, index) => candidate.path[index] === segment)
  ))
  if (children.length > 0) {
    lines.push('', 'Subcommands:')
    for (const child of children) {
      lines.push(`  ${child.path.join(' ').padEnd(26)}${child.summary}`)
    }
  }
  if (spec.aliases && spec.aliases.length > 0) {
    lines.push('', `Accepted aliases: ${spec.aliases.map(alias => `eido ${alias.join(' ')}`).join(', ')}`)
  }
  if (spec.notes && spec.notes.length > 0) {
    lines.push('', 'Notes:')
    for (const note of spec.notes) lines.push(`  ${note}`)
  }
  if (spec.mutating) {
    lines.push('', ...EIDO_CLI_MUTATION_SAFETY_LINES, '', ...EIDO_CLI_MUTATION_RETRY_LINES)
  }
  lines.push('', 'Examples:')
  for (const example of spec.examples) {
    for (const line of example.split('\n')) lines.push(`  ${line}`)
    lines.push('')
  }
  lines.push(...EIDO_CLI_MACHINE_LINES)
  return `${lines.join('\n')}\n`
}

export function renderEidoCliHelp(topic: EidoCliHelpTopic): string {
  if (topic.kind === 'command') return renderEidoCliCommandHelp(topic.command)
  if (topic.kind === 'group') return renderEidoCliGroupHelp(topic.group) ?? renderEidoCliIndex()
  return renderEidoCliIndex()
}

/** The bare `eido` and `eido --help` index. */
export const EIDO_CLI_HELP = renderEidoCliIndex()

function pathsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => right[index] === segment)
}

function isPrefix(prefix: readonly string[], argv: readonly string[]): boolean {
  return prefix.length <= argv.length && prefix.every((segment, index) => argv[index] === segment)
}

export function findEidoCliCommand(path: readonly string[]): EidoCliCommandSpec | undefined {
  return EIDO_CLI_COMMANDS.find(spec => (
    pathsEqual(spec.path, path)
      || spec.aliases?.some(alias => pathsEqual(alias, path)) === true
  ))
}

/** Longest canonical or alias prefix of argv, so a failure can name its command. */
export function matchEidoCliCommand(argv: readonly string[]): EidoCliCommandSpec | undefined {
  let matched: EidoCliCommandSpec | undefined
  let matchedLength = 0
  for (const spec of EIDO_CLI_COMMANDS) {
    for (const candidate of [spec.path, ...(spec.aliases ?? [])]) {
      if (!isPrefix(candidate, argv) || (matched && candidate.length <= matchedLength)) continue
      matched = spec
      matchedLength = candidate.length
    }
  }
  return matched
}

export function isEidoCliGroup(name: string): boolean {
  return EIDO_CLI_GROUPS.some(group => group.name === name)
}

/** Rewrites an accepted alias prefix to its canonical path. */
export function canonicalEidoCliArgv(argv: readonly string[]): readonly string[] {
  for (const spec of EIDO_CLI_COMMANDS) {
    if (isPrefix(spec.path, argv)) return argv
    for (const alias of spec.aliases ?? []) {
      if (isPrefix(alias, argv)) return [...spec.path, ...argv.slice(alias.length)]
    }
  }
  return argv
}

export function resolveEidoCliHelpTopic(argv: readonly string[]): EidoCliHelpTopic {
  if (argv.length === 0) return { kind: 'index' }
  const exact = findEidoCliCommand(argv)
  if (exact) return { kind: 'command', command: exact }
  if (argv.length === 1 && isEidoCliGroup(argv[0]!)) return { kind: 'group', group: argv[0]! }
  const matched = matchEidoCliCommand(argv)
  if (matched) return { kind: 'command', command: matched }
  return { kind: 'unknown', argv }
}

/** Names closest to a candidate, by shared prefix then edit distance. */
export function closestEidoCliNames(
  candidate: string,
  names: readonly string[],
  limit = 5,
): readonly string[] {
  return [...names]
    .map(name => Object.freeze({ name, distance: editDistance(candidate, name) }))
    .sort((left, right) => (
      left.distance - right.distance || left.name.localeCompare(right.name)
    ))
    .filter(entry => entry.distance <= Math.max(3, Math.ceil(candidate.length / 2)))
    .slice(0, limit)
    .map(entry => entry.name)
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_value, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= right.length; column += 1) {
      current.push(Math.min(
        previous[column]! + 1,
        current[column - 1]! + 1,
        previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1),
      ))
    }
    previous = current
  }
  return previous[right.length]!
}

/**
 * Parse helpers report the exact offending token here so the planner can name
 * it without threading a distinct result type through every return site. The
 * planner clears the sink before it starts, and takes it when it fails.
 */
let usageDetail: EidoCliUsageError | undefined

export function clearEidoCliUsageDetail(): void {
  usageDetail = undefined
}

export function recordEidoCliUsageDetail(detail: EidoCliUsageError): void {
  if (usageDetail === undefined) usageDetail = Object.freeze(detail)
}

export function takeEidoCliUsageDetail(): EidoCliUsageError | undefined {
  const taken = usageDetail
  usageDetail = undefined
  return taken
}

export function unknownOptionDetail(option: string): EidoCliUsageError {
  return { code: 'cli.usage', message: `Unknown option ${option}.` }
}

export function missingOptionValueDetail(option: string): EidoCliUsageError {
  return { code: 'cli.usage', message: `Option ${option} needs a value.` }
}

export function duplicateOptionDetail(option: string): EidoCliUsageError {
  return { code: 'cli.usage', message: `Option ${option} was given more than once.` }
}

export function invalidOptionValueDetail(option: string, value: string): EidoCliUsageError {
  return { code: 'cli.usage', message: `Value ${JSON.stringify(value)} is not valid for ${option}.` }
}

export function invalidAddressDetail(value: string): EidoCliUsageError {
  return {
    code: 'cli.usage',
    message: `Address ${JSON.stringify(value)} is not a usable id or Card Deep Link.`,
  }
}

/** Builds the reported failure, attributing it to the matched subcommand. */
export function eidoCliUsageError(
  argv: readonly string[],
  detail?: EidoCliUsageError,
): EidoCliUsageError {
  const matched = matchEidoCliCommand(canonicalEidoCliArgv(argv))
  const named = matched ? `eido ${matched.path.join(' ')}` : 'eido'
  const message = detail?.message ?? (matched
    ? `Arguments for ${named} are not valid.`
    : `Unknown command ${argv.length === 0 ? '(empty)' : JSON.stringify(argv.join(' '))}.`)
  const hint = detail?.hint ?? (matched
    ? `Run \`${named} --help\`. Example: ${matched.examples[0]!.split('\n').at(-1)!}`
    : 'Run `eido --help` for the command index.')
  return Object.freeze({
    code: detail?.code ?? 'cli.usage',
    message,
    ...(matched ? { command: matched.path } : {}),
    hint,
  })
}

/** Human diagnostic for stderr. stdout keeps the machine-readable envelope. */
export function renderEidoCliUsageDiagnostic(error: EidoCliUsageError): string {
  const lines = [error.message]
  if (error.hint) lines.push(error.hint)
  const matched = error.command === undefined ? undefined : findEidoCliCommand(error.command)
  if (matched) {
    lines.push('Example:')
    for (const line of matched.examples[0]!.split('\n')) lines.push(`  ${line}`)
  }
  return `${lines.join('\n')}\n`
}
