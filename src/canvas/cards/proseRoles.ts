import { DEFAULT_NOTE_FONT_SIZE } from '../../graph/noteFontSize'
import type { NoteFontSize } from '../../graph/noteFontSize'
import { normalizeNoteFontStep } from '../../ui/tokens'

// One prose role per step on the Note text ladder, in step order. The sizes
// themselves belong to the tokens these roles read (src/ui/tokens.ts,
// NOTE_FONT_STEP_TOKENS); this table only says which role wears which step.
const PROSE_ROLE_BY_STEP: readonly string[] = [
  't-prose-s',
  't-prose-m',
  't-prose-l',
  't-prose-xl',
  't-prose-2xl',
  't-prose-3xl',
]

/** The step a Card renders at, given whatever its stored size holds. Anything
 * this build cannot place, including a size stored by an older or newer build,
 * reads at the default step rather than disappearing. */
export function noteFontStep(size: unknown): NoteFontSize {
  return normalizeNoteFontStep(size) as NoteFontSize | undefined ?? DEFAULT_NOTE_FONT_SIZE
}

// The step reaches here already resolved by noteFontSizeOf, so the parameter
// default only covers callers that render prose with no Card behind it. It
// names the setting's documented default rather than repeating a value.
export function proseRoleClass(size: unknown = DEFAULT_NOTE_FONT_SIZE): string {
  return PROSE_ROLE_BY_STEP[noteFontStep(size) - 1] as string
}
