import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type DragEventHandler,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import { ChevronDown, GripVertical, Minus, Plus } from 'lucide-react'
import { DESIGN_TIMING_MS } from '../tokens'
import { useExitPresence } from './presence'
import { Tooltip } from './Tooltip'

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'quiet' | 'ghost' | 'danger' | 'danger-confirm'
  size?: 'standard' | 'compact' | 'inline' | 'field-mate'
  typographyRole?: 'label' | 'ui'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'quiet',
    size = 'standard',
    typographyRole = 'label',
    className,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={classes(
        'e-button',
        `t-${typographyRole}`,
        `e-button--${variant}`,
        `e-button--${size}`,
        className,
      )}
      {...props}
    />
  )
})

export type IconButtonProps = Omit<ButtonProps, 'children' | 'aria-label'> & {
  label: string
  icon: ReactNode
  tooltip?: ReactNode
  tooltipOpen?: boolean
  pressed?: boolean
  keyStyle?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    icon,
    tooltip = label,
    tooltipOpen,
    pressed,
    keyStyle = false,
    className,
    ...props
  },
  ref,
) {
  return (
    <Tooltip content={tooltip} open={tooltipOpen}>
      <Button
        ref={ref}
        className={classes('e-icon-button', keyStyle && 'e-icon-button--key', className)}
        aria-label={label}
        aria-pressed={pressed}
        data-pressed={pressed || undefined}
        {...props}
      >
        {icon}
      </Button>
    </Tooltip>
  )
})

export type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  prose?: boolean
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { prose = false, className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={classes('e-field', prose && 'e-field--prose', className)}
      {...props}
    />
  )
})

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { prose?: boolean }

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { prose = true, className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={classes('e-field', 'e-textarea', prose && 'e-field--prose', className)}
      {...props}
    />
  )
})

export function FieldLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={classes('e-field-label', 't-label', className)} {...props} />
}

export function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  decrementLabel,
  incrementLabel,
  onValueChange,
  className,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  decrementLabel: string
  incrementLabel: string
  onValueChange: (value: number) => void
  className?: string
}) {
  const setBoundedValue = (next: number) => onValueChange(Math.min(max, Math.max(min, next)))
  return (
    <div className={classes('e-stepper', className)} role="group" aria-label={label}>
      <button
        type="button"
        aria-label={decrementLabel}
        disabled={value <= min}
        onClick={() => setBoundedValue(value - step)}
      >
        <Minus aria-hidden="true" />
      </button>
      <input
        className="e-stepper__value t-value"
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          const next = Number(event.currentTarget.value)
          if (Number.isFinite(next)) setBoundedValue(next)
        }}
      />
      <button
        type="button"
        aria-label={incrementLabel}
        disabled={value >= max}
        onClick={() => setBoundedValue(value + step)}
      >
        <Plus aria-hidden="true" />
      </button>
    </div>
  )
}

export function Toggle({
  label,
  checked,
  onCheckedChange,
  disabled = false,
  className,
}: {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      className={classes('e-toggle', className)}
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      data-checked={checked || undefined}
      onClick={() => onCheckedChange(!checked)}
    />
  )
}

export function Chip({
  tone = 'neutral',
  interactive = false,
  selected = false,
  expanded,
  controls,
  disabled = false,
  onClick,
  className,
  tooltip,
  ariaLabel,
  children,
}: {
  tone?: 'neutral' | 'scope' | 'go' | 'avoid' | 'mod' | 'convo' | 'attention'
  interactive?: boolean
  selected?: boolean
  expanded?: boolean
  controls?: string
  disabled?: boolean
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>['onClick']
  className?: string
  tooltip?: string
  ariaLabel?: string
  children: ReactNode
}) {
  const classNames = classes(
    'e-chip',
    `e-chip--${tone}`,
    interactive && 'e-chip--interactive',
    tooltip && 'e-chip--tooltip',
    className,
  )
  const chip = interactive ? (
    <button
      type="button"
      className={classNames}
      aria-pressed={expanded === undefined ? selected : undefined}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={ariaLabel}
      data-selected={selected || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  ) : (
    <span className={classNames} aria-label={ariaLabel} tabIndex={tooltip ? 0 : undefined}>{children}</span>
  )

  return tooltip ? <Tooltip content={tooltip}>{chip}</Tooltip> : chip
}

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={classes('e-badge', className)}>{children}</span>
}

export function StateWord({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: 'neutral' | 'running' | 'failed'
  className?: string
  children: ReactNode
}) {
  return (
    <span className={classes('e-state-word', 't-value', `e-state-word--${tone}`, className)}>
      {children}
      {tone === 'running' && <span className="e-state-word__pulse" aria-hidden="true" />}
    </span>
  )
}

export function Callout({
  tone = 'attention',
  mark = '!',
  className,
  children,
}: {
  tone?: 'attention' | 'avoid' | 'go' | 'convo'
  mark?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={classes('e-callout', `e-callout--${tone}`, className)}>
      <strong className="e-callout__mark" aria-hidden="true">{mark}</strong>
      <span>{children}</span>
    </div>
  )
}

export function Toast({
  tone,
  className,
  children,
}: {
  tone?: 'go' | 'avoid' | 'attention' | 'convo'
  className?: string
  children: ReactNode
}) {
  const [visible, setVisible] = useState(true)
  const presence = useExitPresence(visible)

  useEffect(() => {
    const timer = window.setTimeout(
      () => setVisible(false),
      DESIGN_TIMING_MS.toastDismiss,
    )
    return () => window.clearTimeout(timer)
  }, [])

  if (!presence.mounted) return null
  return (
    <div
      className={classes('e-toast', className)}
      role="status"
      aria-hidden={presence.state === 'exiting' || undefined}
      {...(presence.state === 'exiting' ? { inert: '' } : {})}
      data-state={presence.state}
      onTransitionEnd={presence.onTransitionEnd}
    >
      {tone && <span className={`e-toast__dot e-toast__dot--${tone}`} aria-hidden="true" />}
      {children}
    </div>
  )
}

export function DockKey({ pressed = false, className, ...props }: IconButtonProps) {
  return (
    <IconButton
      {...props}
      pressed={pressed}
      keyStyle
      className={classes('e-dock-key', className)}
    />
  )
}

export function ContextRow({
  rank,
  reorderable = false,
  dragLabel = 'Drag to rearrange',
  relation,
  title,
  glyph,
  status,
  defaultExpanded = false,
  meta,
  snippet,
  dimmed = false,
  lifted = false,
  cardId,
  onDragStart,
  onDrag,
  onDragEnd,
  onDragOver,
  onDrop,
  className,
}: {
  rank?: number | string
  reorderable?: boolean
  dragLabel?: string
  relation?: 'direct' | 'light' | 'avoid'
  title: string
  glyph?: ReactNode
  status?: ReactNode
  defaultExpanded?: boolean
  meta?: ReactNode
  snippet?: ReactNode
  dimmed?: boolean
  lifted?: boolean
  cardId?: string
  onDragStart?: DragEventHandler<HTMLButtonElement>
  onDrag?: DragEventHandler<HTMLButtonElement>
  onDragEnd?: DragEventHandler<HTMLButtonElement>
  onDragOver?: DragEventHandler<HTMLDetailsElement>
  onDrop?: DragEventHandler<HTMLDetailsElement>
  className?: string
}) {
  const hasDisclosure = Boolean(meta || snippet)
  const canReorder = reorderable && relation !== 'avoid'
  const visibleRank = relation === 'avoid' ? undefined : rank
  const detailsRef = useRef<HTMLDetailsElement | null>(null)
  useLayoutEffect(() => {
    if (defaultExpanded && detailsRef.current) detailsRef.current.open = true
  }, [defaultExpanded])
  const head = (
    <>
      {visibleRank !== undefined && <span className="e-context-row__rank">{visibleRank}</span>}
      {canReorder && (
        <Tooltip content={dragLabel}>
          <button
            type="button"
            className="e-context-row__grip"
            draggable
            aria-label={dragLabel}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onDragStart={onDragStart}
            onDrag={onDrag}
            onDragEnd={onDragEnd}
          >
            <GripVertical aria-hidden="true" />
          </button>
        </Tooltip>
      )}
      {(glyph || relation) && (
        <span className="e-context-row__glyph" data-relation={relation}>
          {glyph ?? <ContextRelationGlyph relation={relation!} />}
        </span>
      )}
      <span className="e-context-row__title">{title}</span>
      {status && <span className="e-context-row__status">{status}</span>}
      {hasDisclosure && <ChevronDown className="e-context-row__chevron" aria-hidden="true" />}
    </>
  )
  const rowClassName = classes(
    'e-context-row',
    relation && `e-context-row--${relation}`,
    canReorder && 'e-context-row--reorderable',
    dimmed && 'e-context-row--dimmed',
    lifted && 'e-context-row--lifted',
    className,
  )

  if (!hasDisclosure) {
    return (
      <div className={rowClassName} data-card-id={cardId}>
        <div className="e-context-row__head">{head}</div>
      </div>
    )
  }

  return (
    <details
      ref={detailsRef}
      className={rowClassName}
      data-card-id={cardId}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <summary className="e-context-row__head">{head}</summary>
      <div className="e-context-row__body">
        {meta && <div className="e-context-row__meta">{meta}</div>}
        {snippet && <div className="e-context-row__snippet">{snippet}</div>}
      </div>
    </details>
  )
}

function ContextRelationGlyph({ relation }: { relation: 'direct' | 'light' | 'avoid' }) {
  return (
    <svg viewBox="0 0 18 8" aria-hidden="true">
      <path
        d="M1 4 H17"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth={relation === 'direct' ? 3 : relation === 'light' ? 1.5 : 2}
        strokeDasharray={relation === 'avoid' ? '6 4' : undefined}
      />
    </svg>
  )
}

export function ContextRowBoundary({ label }: { label: string }) {
  return (
    <div className="e-context-row-boundary" role="separator" aria-label={label}>
      <span>{label}</span>
    </div>
  )
}
