import { ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { modChromeWords } from '../../shared/words'
import { Popover, TextArea } from '../../ui/primitives'
import type { Mod } from '../model'
import { defaultTreatment, normalizeTreatmentOverride, readModContext } from '../prompt'
import { modIdentityStyle } from './identityWell'

export type ModContextPopoverProps = Readonly<{
  mod: Mod
  open: boolean
  onOpenChange: (open: boolean) => void
  onTreatmentOverrideChange: (override: string | null) => void
  trigger: ReactElement
}>

export function ModContextPopover({
  mod,
  open,
  onOpenChange,
  onTreatmentOverrideChange,
  trigger,
}: ModContextPopoverProps) {
  const context = readModContext(mod)
  const computedDefault = defaultTreatment(mod)
  const suppliedOverride = normalizeTreatmentOverride(mod, mod.treatOverride ?? '')
  const treatmentId = `mod-treatment-${useId().replace(/:/g, '')}`
  const [treatmentExpanded, setTreatmentExpanded] = useState(false)
  const [treatmentDraft, setTreatmentDraft] = useState(context.treatment)
  const [draftOverride, setDraftOverride] = useState<string | null>(suppliedOverride)
  const draftOverrideRef = useRef<string | null>(suppliedOverride)
  const treatmentFocused = useRef(false)
  const lastEmittedOverride = useRef<string | null>(suppliedOverride)
  const { style } = modIdentityStyle(mod.accent)

  useEffect(() => {
    lastEmittedOverride.current = suppliedOverride
    if (treatmentFocused.current && draftOverrideRef.current !== null) return
    setTreatmentDraft(context.treatment)
    draftOverrideRef.current = suppliedOverride
    setDraftOverride(suppliedOverride)
  }, [computedDefault, context.treatment, suppliedOverride])

  const updateTreatmentDraft = (candidate: string) => {
    const normalized = normalizeTreatmentOverride(mod, candidate)
    setTreatmentDraft(candidate)
    draftOverrideRef.current = normalized
    setDraftOverride(normalized)
    if (normalized === lastEmittedOverride.current) return
    lastEmittedOverride.current = normalized
    onTreatmentOverrideChange(normalized)
  }

  const finishTreatmentEdit = () => {
    treatmentFocused.current = false
    const normalized = normalizeTreatmentOverride(mod, treatmentDraft)
    draftOverrideRef.current = normalized
    setDraftOverride(normalized)
    if (normalized === null) setTreatmentDraft(computedDefault)
  }

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      dismissOnTab={false}
      ariaHasPopup="dialog"
      trigger={trigger}
    >
      <div
        className="mod-context-popover"
        role="dialog"
        aria-label={modChromeWords.context}
        style={style}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="mod-context-popover__heading t-micro">{modChromeWords.context}</div>
        <ul className="mod-context-popover__sentences">
          {context.sentences.map((sentence, index) => (
            <li
              // The generator owns both the plain text and this escaped markup;
              // rendering its HTML preserves the one highlighted value without
              // introducing a second sentence formatter in the UI.
              key={`${index}:${sentence.text}`}
              className="mod-context-popover__sentence t-ui"
              dangerouslySetInnerHTML={{ __html: sentence.html }}
            />
          ))}
        </ul>
        <section className={`e-acc ${treatmentExpanded ? 'is-open' : ''}`}>
          <button
            id={`${treatmentId}-trigger`}
            className="e-acc-head t-ui"
            type="button"
            autoFocus
            aria-expanded={treatmentExpanded}
            aria-controls={`${treatmentId}-panel`}
            onClick={() => setTreatmentExpanded((expanded) => !expanded)}
          >
            <span>{modChromeWords.howToReadIt}</span>
            <span className="acc-state t-micro" aria-live="polite">
              {draftOverride === null
                ? modChromeWords.treatmentDefault
                : modChromeWords.treatmentEdited}
            </span>
            <ChevronDown className="acc-mark" aria-hidden="true" />
          </button>
          <div
            id={`${treatmentId}-panel`}
            className="e-acc-body"
            role="region"
            aria-labelledby={`${treatmentId}-trigger`}
            hidden={!treatmentExpanded}
          >
            <TextArea
              aria-label={modChromeWords.howToReadIt}
              aria-describedby={`${treatmentId}-help`}
              rows={2}
              value={treatmentDraft}
              onFocus={() => { treatmentFocused.current = true }}
              onBlur={finishTreatmentEdit}
              onChange={(event) => updateTreatmentDraft(event.currentTarget.value)}
            />
            <div id={`${treatmentId}-help`} className="mod-context-popover__help t-hint">
              {modChromeWords.treatmentHelp}
            </div>
          </div>
        </section>
      </div>
    </Popover>
  )
}
