import { memo, useCallback, useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { dragBlockingClass } from '../cardInteraction'
import { runToolPresentation } from './runToolVocabulary'
import type { RunToolStep } from '../../graph/types'
import { toolTrailMoreLabel, toolTrailSummaryLabel } from '../../shared/words'

// How many steps an opened trail draws before it offers the rest. A run may use
// as many tools as the model decides, because Eido sets no ceiling (ADR 0033),
// and this is not a ceiling either: it bounds the state the trail is almost
// always in, not what the reader is allowed to see. The Board keeps hundreds of
// Cards mounted as real DOM and budgets that residency by text weight alone,
// which a trail's rows do not enter, so the default has to be small. Past this,
// one press draws every remaining step (ADR 0035).
export const TOOL_TRAIL_FIRST_STEPS = 5

// What the model looked up while it answered (ADR 0033), drawn through the one
// vocabulary that knows how a kind is named and linked (ADR 0035).
//
// One element for the whole life of a run. It arrives with the first step and
// stays: through the remaining lookups, through the streamed answer, and into
// the settled Card. Nothing about it is swapped out as the run changes phase,
// because a strip that vanishes mid-answer reads as a bug even when the record
// behind it is intact.
//
// Open while the run works, and every step is drawn as it arrives. A lookup is
// the answer beginning to exist, so it streams like the answer does: hiding it
// behind a count leaves the reader watching a pulse and nothing else. No cap and
// no scrolling window in this phase, for the same reason. When the answer lands
// the answer is the point, so the trail folds itself back up.
//
// It never shows page text. A step is where the model went, or the model's own
// words about what it was working out between lookups (#966), never what a
// page said back; the answer is the content.
//
// Memoised, and mounted only when there are steps to show, because a board
// holds thousands of Result Cards and almost none of them used a tool. A Card
// that used none pays nothing at all: no element, no state, no effect.
export const RunToolTrail = memo(function RunToolTrail({
  steps,
  running,
  selected,
}: {
  steps: readonly RunToolStep[]
  running: boolean
  selected: boolean
}) {
  const [open, setOpen] = useState(running)
  // On a settled Card the rows are not built until the reader reaches for them.
  // Measured on a real Card, a drawn trail is roughly two thirds of that Card's
  // entire DOM, and almost every Card on a Board is one nobody has opened. Once
  // built they stay built, because the closing half of the animation has to have
  // something to close over, and because a reader who opened a trail once is the
  // reader most likely to open it again.
  const [drawn, setDrawn] = useState(running)
  const [showAll, setShowAll] = useState(running)
  // Which opening of the trail the drawn rows belong to. Each row owns whether
  // its own drawer is open, so folding the trail would otherwise leave those
  // drawers standing and the next opening would start mid-conversation with
  // itself. Bumping this on the open remounts the rows closed, the same rule
  // and the same timing as the first-five reset below: nothing is torn down
  // while the trail is collapsing (founder decision 2026-08-18).
  const [opening, setOpening] = useState(0)

  // The two edges of a run. Working: open, drawn, and complete, because the
  // steps are what there is to watch. Landed: folded, because the answer is now
  // the point. Only the fold changes on landing, so the rows stay and the fold
  // is a movement rather than a disappearance.
  useEffect(() => {
    setOpen(running)
    if (running) {
      setDrawn(true)
      setShowAll(true)
    }
  }, [running])

  const onToggle = useCallback((event: { currentTarget: HTMLDetailsElement }) => {
    const nowOpen = event.currentTarget.open
    setOpen(nowOpen)
    if (nowOpen) {
      setDrawn(true)
      // Each opening of a settled trail starts from the top of it again, and
      // with every row folded. Resetting here rather than on the close means
      // nothing ever shrinks while it is collapsing, including the collapse a
      // landing run triggers.
      if (!running) {
        setShowAll(false)
        setOpening((count) => count + 1)
      }
    }
  }, [running])

  const shown = showAll ? steps : steps.slice(0, TOOL_TRAIL_FIRST_STEPS)
  const remainder = steps.length - shown.length

  // The folded number is the useful thing at a glance: how many places this
  // answer rests on. A thinking row narrates the trail rather than adding a
  // place, so it stays out of the count (#966). A trail that is all narration
  // and no lookup, which is what a run cancelled before its first call leaves
  // behind, drops the number instead of counting the wrong thing.
  const lookups = steps.filter((step) => runToolPresentation(step).lookup).length
  const counted = lookups > 0 ? lookups : steps.length

  return (
    <details
      className={`tool-trail ${dragBlockingClass(selected)}`}
      open={open}
      onToggle={onToggle}
      onClick={(event) => event.stopPropagation()}
    >
      {/* Built on the press and on the focus, both of which land a beat before
          the toggle they precede. Built on the toggle itself, the first frame of
          the opening animation would measure an empty box and the trail would
          snap open instead of moving. */}
      <summary
        className="tool-trail__summary"
        onPointerDown={() => setDrawn(true)}
        onFocus={() => setDrawn(true)}
      >
        <ChevronDown className="tool-trail__chevron" size={12} aria-hidden="true" />
        {toolTrailSummaryLabel(counted, running, lookups)}
      </summary>
      {drawn && (
        <ToolSteps
          key={opening}
          steps={shown}
          remainder={remainder}
          onShowAll={() => setShowAll(true)}
        />
      )}
    </details>
  )
})

function ToolSteps({
  steps,
  remainder,
  onShowAll,
}: {
  steps: readonly RunToolStep[]
  remainder: number
  onShowAll: () => void
}) {
  return (
    <ol className="tool-trail__steps">
      {steps.map((step, index) => (
        <ToolStepRow step={step} key={`${step.kind}:${step.detail}:${index}`} />
      ))}
      {remainder > 0 && (
        <li className="tool-trail__step tool-trail__step--rest">
          <button type="button" className="tool-trail__more" onClick={onShowAll}>
            {toolTrailMoreLabel(remainder)}
          </button>
        </li>
      )}
    </ol>
  )
}

// One row, and the drawer under it (#966). Every row with anything behind its
// line carries the same affordance: a chevron that shows itself under the
// pointer or the focus, and opens the row to what the step actually was, in
// full. A search opens to its whole question, a page to its whole address, a
// thinking row to its whole kept passage. The row never measures whether its
// line was clipped: the chevron costs nothing while unhovered, and an opened
// short row telling its one line again is cheaper than overflow bookkeeping
// across every Card resize.
//
// A self-contained component on purpose: its open state is its own, and a
// later per-row state (#964) is another hook here rather than a change to the
// list that draws it.
function ToolStepRow({ step }: { step: RunToolStep }) {
  const [open, setOpen] = useState(false)
  // Like the trail itself, the drawer is not built until the reader reaches
  // for it, and stays built once it has been: the closing half of the
  // animation needs something to close over. Built on the press and on the
  // focus, both a beat before the click that opens it, so the first frame of
  // the opening move starts from a drawn, closed drawer instead of snapping.
  const [drawn, setDrawn] = useState(false)
  const { Icon, label, href, body } = runToolPresentation(step)
  const destination = href(step)
  const text = label(step)
  const passage = body(step)

  // The whole line is the press, not the chevron alone (founder decision
  // 2026-08-18). A trail row is a line of small type on a Card, and a target
  // the width of one glyph asks for aim the reader should not have to give;
  // the chevron stays as the sign that there is more, and stops being the
  // only way to ask for it.
  //
  // That costs a read row its one-press link, because a line cannot both open
  // a page and open itself. The address moves into the drawer, where it is
  // the whole address rather than the host the line had room for, and it is
  // still the only thing here that is ever a link.
  return (
    <li className="tool-trail__step">
      {passage === null ? (
        <div className="tool-trail__step-line">
          <Icon size={12} aria-hidden="true" />
          {destination ? (
            <a
              className="tool-trail__what tool-trail__link"
              href={destination}
              target="_blank"
              rel="noreferrer"
              onClick={openAway}
            >
              {text}
            </a>
          ) : (
            <span className="tool-trail__what">{text}</span>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="tool-trail__step-line tool-trail__step-line--pressable"
          aria-expanded={open}
          onPointerDown={() => setDrawn(true)}
          onFocus={() => setDrawn(true)}
          onClick={() => {
            setDrawn(true)
            setOpen((wasOpen) => !wasOpen)
          }}
        >
          <Icon size={12} aria-hidden="true" />
          <span className="tool-trail__what">{text}</span>
          <span className="tool-trail__reveal" aria-hidden="true">
            <ChevronDown size={12} />
          </span>
        </button>
      )}
      {drawn && passage !== null && (
        <div className="tool-trail__step-drawer" data-open={open || undefined}>
          <div className="tool-trail__step-body">
            {destination ? (
              <a
                className="tool-trail__step-passage tool-trail__link"
                href={destination}
                target="_blank"
                rel="noreferrer"
                onClick={openAway}
              >
                {passage}
              </a>
            ) : (
              <p className="tool-trail__step-passage">{passage}</p>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

function openAway(event: { currentTarget: HTMLAnchorElement; preventDefault: () => void }): void {
  event.preventDefault()
  window.open(event.currentTarget.href, '_blank', 'noopener,noreferrer')
}
