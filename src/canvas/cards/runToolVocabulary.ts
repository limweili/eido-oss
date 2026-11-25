import {
  FileText,
  Search,
  Sparkle,
  Telescope,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { SquareText } from '../../ui/primitives/lucideForward'
import { displayHost, normalizeWebUrl } from '../../shared/webUrl'
import type { RunToolStep } from '../../graph/types'
import { words } from '../../shared/words'

// How a recorded tool step is drawn, named, and linked (ADR 0035).
//
// One place, so a new agentic tool is one entry here plus its words rather than
// an edit to the trail, the icon set, and the link rule at once. Nothing that
// renders a step reads `step.kind` directly; it asks this module.
export type RunToolPresentation = Readonly<{
  Icon: LucideIcon
  // What the line says. Never page text: a step is where the model went.
  label: (step: RunToolStep) => string
  // Where the reader can go to check it, or nothing. Only an http address the
  // main process will hand to the system browser is ever a destination.
  href: (step: RunToolStep) => string | null
  // What the row reveals when its chevron opens it (#966), or nothing. The
  // same rule as the label: the model's own question, address, or words,
  // never text a page handed back.
  body: (step: RunToolStep) => string | null
  // Whether the folded count tallies this step as a lookup. A thinking row
  // narrates the trail rather than adding to it, so it stays out of the
  // number; anything a tool actually did counts, spend included.
  lookup: boolean
}>

// The collapsed face of a thinking passage: its own opening words. The first
// line is the model stating what it is working out, which is the best one-line
// account that exists without asking a second model to write a better one.
function firstLine(passage: string): string {
  for (const line of passage.split('\n')) {
    const trimmed = line.trim()
    if (trimmed) return trimmed
  }
  return ''
}

// Models write their reasoning in markdown, and observed on a real Board a
// thinking row read `**Investigating Xcode's Latest**`, asterisks and all. The
// trail is one line of small plain type: it does not render markdown, and it
// should not, because a step is a record rather than prose to typeset. So the
// marks come off and the words stay.
//
// Only the marks that wrap something are removed, and only within a line, so a
// lone asterisk, a snake_case identifier, or a multiplication sign survives
// intact. This runs on thinking passages alone. A search query is the model's
// literal instruction to the search, where an asterisk may be load-bearing.
function withoutMarkdownMarks(passage: string): string {
  return passage
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]+/gm, '')
    .replace(/(\*\*\*|\*\*|\*)(?=\S)([^\n]*?\S)\1/g, '$2')
    .replace(/(?<![\w`])(`+)(?=\S)([^\n]*?\S)\1(?![\w`])/g, '$2')
    .replace(/(?<![\w\\])(___|__|_)(?=\S)([^\n]*?\S)\1(?![\w])/g, '$2')
}

const VOCABULARY: Readonly<Record<string, RunToolPresentation>> = Object.freeze({
  // A search is named by what was asked. It is a question, not a place, so it
  // is never a link. Opened, the row is the same question unclipped: the body
  // earns its keep only when the line above it had to trail off.
  search: {
    Icon: Search,
    label: (step) => step.detail || words.toolTrailSearched,
    href: () => null,
    body: (step) => step.detail || null,
    lookup: true,
  },
  // A page is named by its title, falling back to its host, because a bare
  // address is provenance rather than a label. Opened, the row shows that
  // address in full: where the model actually went, behind the readable name.
  read: {
    Icon: FileText,
    label: (step) => step.title || (step.detail ? displayHost(step.detail) : words.toolTrailRead),
    href: (step) => (step.detail ? normalizeWebUrl(step.detail) : null),
    body: (step) => step.detail || null,
    lookup: true,
  },
  // A whole investigation handed to the vendor's research agent (#963),
  // named by the instruction it was given. Minutes of work sit behind the
  // one line because the polling envelope exposes status and nothing else:
  // one call, one line, and the sources ride in the answer. Never a link,
  // because an instruction is not a place.
  research: {
    Icon: Telescope,
    label: (step) => step.detail || words.toolTrailResearched,
    href: () => null,
    body: (step) => step.detail || null,
    lookup: true,
  },
  // A call Eido made that the web refused (#961). The line stays, because the
  // trail reports spend as well as provenance. `detail` keeps what was being
  // looked for; the plain words for what went wrong were written into `title`
  // when the failure happened, so drawing them needs no failure taxonomy
  // here. Never a link: a failed lookup has no destination worth vouching for.
  trouble: {
    Icon: TriangleAlert,
    label: (step) => step.title || step.detail || words.toolTrailTrouble,
    href: () => null,
    body: (step) => step.detail || null,
    lookup: true,
  },
  // The run filling the model's window and writing itself a handoff note so it
  // could carry on (#1036). It gets a row for the same reason a failed lookup
  // does: a run that quietly threw away most of its own history and did not say
  // so would be misreporting how it reached its answer. The line is fixed words
  // rather than the note's first line, because what happened here is the same
  // every time; opened, the row is the note the run wrote, which is the run's
  // own words and so bends no rule about page text. Not a lookup: it looked
  // nothing up, so the folded count does not claim it as one.
  compaction: {
    Icon: SquareText,
    label: () => words.toolTrailCompacted,
    href: () => null,
    body: (step) => step.detail || null,
    lookup: false,
  },
  // What the model was working out between lookups, in its own words (#966).
  // Collapsed to its first line; opened, the whole kept passage. Never a link
  // and never page text: this is the model talking, not something it read,
  // which is why it does not bend the trail's standing rule. It is also not a
  // lookup, so the folded count does not claim it as one.
  thinking: {
    Icon: Sparkle,
    label: (step) => firstLine(withoutMarkdownMarks(step.detail)) || words.toolTrailThought,
    href: () => null,
    body: (step) => withoutMarkdownMarks(step.detail).trim() || null,
    lookup: false,
  },
})

// A kind this build does not know. It still gets a line: a Run written by a
// later build is a record of what happened, and a trail that silently drops
// what it cannot name would be lying about the answer's sources. It gets no
// link, because what an unrecognised tool's detail means is exactly what this
// build does not know. It does get the chevron, for the same reason it gets
// the line: the detail is the record, clipped or not.
const UNRECOGNISED: RunToolPresentation = {
  Icon: Wrench,
  label: (step) => step.title || step.detail || words.toolTrailUsedTool,
  href: () => null,
  body: (step) => step.detail || null,
  lookup: true,
}

export function runToolPresentation(step: RunToolStep): RunToolPresentation {
  return VOCABULARY[step.kind] ?? UNRECOGNISED
}
