// A Note's attachment panels are pinned to the bottom of its Card, so every
// pixel a panel occupies is a pixel the Note body no longer has. On a Card the
// founder already gave a height to, the first link preview therefore reads as
// the Note shrinking: the text did not change, but a third of it went behind
// the fold. This module holds the one rule that answers it. When a PANEL first
// appears on a Card, the Card grows by exactly one panel floor, so the body
// keeps the room it had and the panel is paid for out of new height.
//
// IT IS PER PANEL, NOT PER TILE. A second link preview joins the track the
// first one created; the track scrolls, the panel does not get taller, and the
// Card must not grow again. The two panels a Note can carry (its images and its
// previews) each earn the growth once, independently.
//
// WHY THE DECISION IS PERSISTED AND NOT DERIVED. "Has this Card already been
// grown for its previews" cannot be read back out of the height: a Card the
// founder then resized by hand, or one reopened from a save file, looks exactly
// like a Card that was never grown. Without a durable marker the growth would
// fire again on every reload, every undo, and every re-render, and a Note with
// one link would walk down the Board a panel at a time. So the marker is the
// state, and the height is only its effect.
//
// The marker is presentation state by ADR 0040's definition: no projection
// reads it to decide what the Card IS, and a build that has never heard of it
// loses nothing but one automatic resize. It therefore rides in the Card's
// settings envelope (`card.meta`) through the tolerant helpers, never as a new
// top-level Card field. See docs/agents/persisting-a-new-setting.md.
//
// IT ANSWERS AN ARRIVAL, NOT A PRESENCE. A Note that already had its previews
// when the Board was opened is a Note whose height the founder has already
// lived with, and quite possibly set by hand. Opening it must not move it. So a
// Card mounting with panels already on it only RECORDS them as paid; the height
// is granted to a panel that appears while the Note is on screen, which is the
// moment the founder actually watched the body lose its room. Recording on
// mount is what makes the two cases one rule instead of two: after it, "already
// marked" means "not this Card's problem" whichever way the panel got there.
//
// GROWTH ONLY, DELIBERATELY. Removing the last preview does not shrink the Card
// back, because a height the founder has since set by hand is theirs and this
// rule has no way to tell it apart from the height it granted. The inverse is
// one branch inside `attachmentPanelGrowth` if it is ever wanted.
import { defineSetting, readSetting, writeSetting, type SettingsEnvelope } from '../persistence/settingsEnvelope'
import { designTokensForTheme } from '../ui/tokens'

export type AttachmentPanelKind = 'images' | 'previews'

// Declared in the order the Card paints them, so a marker written by this build
// reads the same way whichever panel arrived first.
export const ATTACHMENT_PANEL_KINDS: readonly AttachmentPanelKind[] = Object.freeze([
  'images',
  'previews',
])

/**
 * The panels this Card has already been paid for. A value from a build that
 * knows a third panel kind is not one this build can act on, so the whole
 * setting reads as its default rather than half of somebody's saved state; the
 * stored value stays where it is (envelope rule 1).
 */
export const ATTACHMENT_PANELS_GROWN_SETTING = defineSetting<AttachmentPanelKind[]>({
  key: 'attachmentPanelsGrown',
  fallback: [],
  accepts: (value) => (
    Array.isArray(value)
    && value.every((entry): entry is AttachmentPanelKind => (
      ATTACHMENT_PANEL_KINDS.includes(entry as AttachmentPanelKind)
    ))
  ),
})

/**
 * How much height one panel costs the Card, read from the design token that
 * already states it rather than restated as a number here. The token is the
 * panel's floor: the height every panel has, and the only height a panel on an
 * auto-height Card ever has, so it is exactly what a panel takes away from the
 * body when it appears.
 */
export const ATTACHMENT_PANEL_HEIGHT_MIN = Number.parseFloat(
  // The panel floor is theme-invariant, so either theme's map answers.
  designTokensForTheme('light')['--e-attachment-panel-height-min'],
)

type GrowableCard = {
  meta?: SettingsEnvelope
  size?: { width: number; height: number }
}

export type AttachmentPanelGrowth = Readonly<{
  /** The Card's next settings envelope, carrying the updated marker. */
  meta: SettingsEnvelope | undefined
  /**
   * The Card's next size, or undefined for an auto-height Card, which must
   * keep measuring itself. See the note in `attachmentPanelGrowth`.
   */
  size?: { width: number; height: number }
}>

/**
 * What this Card owes for the panels it is now showing, or null when it owes
 * nothing. Pure, so the same answer can be asserted in a test without a store.
 *
 * `present` is the set of panels the Card actually renders right now, not the
 * set it could render: a Note whose images were all removed is not showing an
 * images panel, and a panel that never appeared was never paid for.
 */
export function attachmentPanelGrowth(
  card: GrowableCard,
  present: readonly AttachmentPanelKind[],
  // 'arrived' means these panels appeared while the founder was looking at the
  // Note, and the Card owes them height. 'already-there' means the Note mounted
  // carrying them, so they are recorded as paid and nothing is resized.
  how: 'arrived' | 'already-there' = 'arrived',
): AttachmentPanelGrowth | null {
  const alreadyGrown = readSetting(card, ATTACHMENT_PANELS_GROWN_SETTING)
  const unpaid = ATTACHMENT_PANEL_KINDS.filter(
    (kind) => present.includes(kind) && !alreadyGrown.includes(kind),
  )
  // The whole idempotence guarantee is this one line: a reload, an undo, or a
  // re-render finds every present panel already marked and stops here.
  if (!unpaid.length) return null

  const grown = ATTACHMENT_PANEL_KINDS.filter(
    (kind) => alreadyGrown.includes(kind) || unpaid.includes(kind),
  )
  const meta = writeSetting(card, ATTACHMENT_PANELS_GROWN_SETTING, grown)

  // AN AUTO-HEIGHT CARD IS MARKED AND NOT RESIZED. It has no stored height to
  // add to, and it already grows on its own: the panel is a block appended
  // below the body, so the Card the browser measures is taller by exactly the
  // panel floor without anyone writing a number. Writing one instead would
  // convert the Card to fixed height and freeze a body that used to follow its
  // own text. The marker still has to be written, because that Card's rendered
  // height is adopted as a stored size later (`adoptRenderedCardSizes`), and
  // the adopted height ALREADY INCLUDES the panel: without the marker the next
  // mount would find a fixed-height Card with an unpaid panel and grow it a
  // second time for the same panel.
  const height = card.size?.height
  if (how === 'already-there' || height === undefined || card.size === undefined) return { meta }

  return {
    meta,
    size: {
      width: card.size.width,
      height: height + unpaid.length * ATTACHMENT_PANEL_HEIGHT_MIN,
    },
  }
}
