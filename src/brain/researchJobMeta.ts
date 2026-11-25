// The one handle to a paid research job (#963). A submitted job cannot be
// cancelled: it runs and bills on the vendor's servers whether Eido is
// listening or not, so the job id is written into `card.meta` the moment the
// vendor acknowledges it and removed only once a run consumed a terminal
// state. A quit, a crash, or a cancel in between leaves it standing on
// purpose, because the id is the only thing that could ever fetch what was
// already paid for.
//
// It rides in `card.meta`, never a top-level Card field and never the Run
// record: the persistence validator holds both to closed key sets and fails
// the whole projection on a stranger, so a new field there is a lost Board
// rather than a lost setting. `meta` is the one part of a Card validated as
// an open record, the same escape hatch the reach mode proved, and an older
// build carries it without reading it.

import type { Card } from '../graph/types'
import { defineSetting, isSettingsEnvelope, readSetting } from '../persistence/settingsEnvelope'

export const RESEARCH_JOB_META_KEY = 'researchJob'

export type ResearchJobRef = Readonly<{
  id: string
  submittedAt: string
}>

// A malformed or half-written value reads as no job at all: this record is a
// recovery handle, and a handle that cannot be trusted is worth less than
// none. The envelope substitutes that default without ever failing the Card,
// and leaves the stored value alone so a build that can read it still can.
export const RESEARCH_JOB_SETTING = defineSetting<ResearchJobRef | null>({
  key: RESEARCH_JOB_META_KEY,
  fallback: null,
  accepts: (value) => isSettingsEnvelope(value)
    && typeof value.id === 'string'
    && value.id.trim() !== ''
    && typeof value.submittedAt === 'string',
})

export function researchJobOf(card: Pick<Card, 'meta'> | undefined): ResearchJobRef | null {
  const value = readSetting(card, RESEARCH_JOB_SETTING)
  return value === null ? null : { id: value.id, submittedAt: value.submittedAt }
}
