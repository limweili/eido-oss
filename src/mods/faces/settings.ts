import { cloneDetached } from '../snapshot'
import { snap } from '../prompt'
import type { Mod, ModKind } from '../model'
import { modChromeWords } from '../../shared/words'
import { mountModPopoverAccordion, mountModPopoverField } from './popoverControls'
import type {
  ModFaceSettingsMountContext,
  ModFaceSettingsRenderState,
  MountedModFaceSettings,
} from './types'

type Mutate = (mod: Mod) => void

/** One option's row in the prompt accordions: rename + its sentence frame. */
type PromptEntry = Readonly<{
  key: string
  label: string
  frame: string
  placeholder: string
  setLabel: (mod: Mod, value: string) => void
  setFrame: (mod: Mod, value: string) => void
}>

function guard(control: HTMLElement) {
  control.addEventListener('pointerdown', (event) => event.stopPropagation())
  control.addEventListener('keydown', (event) => event.stopPropagation())
}

const capWord = (value: string) => {
  const lower = value.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/** The shared gear body; kind-specific fields remain selected by the face definition. */
export function mountModSettings<K extends ModKind>(
  context: ModFaceSettingsMountContext<K>,
): MountedModFaceSettings<K> {
  let state: ModFaceSettingsRenderState<K> = context
  let fieldOrdinal = 0
  let focusFirstControl = true
  let openAccordionKey: string | null = null

  const commit = (label: string, mutate: Mutate) => {
    const next = cloneDetached(state.mod) as Mod
    mutate(next)
    context.commit(next as Mod<K>, label)
  }

  const fieldId = (suffix: string) => (
    `mod-settings-${state.mod.kind}-${suffix.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${fieldOrdinal++}`
  )

  const textField = (
    parent: HTMLElement,
    label: string,
    value: string,
    onCommit: (value: string) => void,
    options: { prose?: boolean; placeholder?: string; help?: string } = {},
  ) => {
    const control = options.prose
      ? document.createElement('textarea')
      : document.createElement('input')
    if (control instanceof HTMLTextAreaElement) control.rows = 2
    else control.type = 'text'
    control.value = value
    control.placeholder = options.placeholder ?? ''
    control.disabled = !state.interactive
    control.addEventListener('change', () => onCommit(control.value))
    guard(control)
    mountModPopoverField(parent, {
      id: fieldId(label),
      label,
      control,
      help: options.help,
    })
  }

  /** The reference stepper pill: − OFF/N +, OFF below the minimum when allowed. */
  const stepperField = (
    parent: HTMLElement,
    label: string,
    value: number,
    onCommit: (value: number) => void,
    options: { min?: number; max?: number; off?: boolean; help?: string } = {},
  ) => {
    const bounds = { min: 2, max: 10, off: true, ...options }
    const control = document.createElement('div')
    control.className = 'e-stepper'
    const minus = document.createElement('button')
    minus.type = 'button'
    minus.textContent = '−'
    minus.setAttribute('aria-label', `Fewer ${label.toLowerCase()}`)
    const readout = document.createElement('span')
    readout.className = 'val t-micro'
    readout.textContent = value < bounds.min ? modChromeWords.off.toUpperCase() : String(value)
    const plus = document.createElement('button')
    plus.type = 'button'
    plus.textContent = '+'
    plus.setAttribute('aria-label', `More ${label.toLowerCase()}`)
    minus.disabled = !state.interactive || (bounds.off ? value < bounds.min : value <= bounds.min)
    plus.disabled = !state.interactive || value >= bounds.max
    minus.addEventListener('click', () => {
      const next = value <= bounds.min ? (bounds.off ? 0 : bounds.min) : value - 1
      if (next !== value) onCommit(next)
    })
    plus.addEventListener('click', () => {
      const next = value < bounds.min ? bounds.min : Math.min(bounds.max, value + 1)
      if (next !== value) onCommit(next)
    })
    control.append(minus, readout, plus)
    guard(control)
    mountModPopoverField(parent, { id: fieldId(label), label, control, help: options.help })
    // Stable ids let a re-render hand focus back to the pressed step key.
    minus.id = `${control.id}-minus`
    plus.id = `${control.id}-plus`
  }

  /* The reference's sentence accordions: an "Options" run where each option
     opens (one at a time) to a Name input and its own prompt. */
  const promptAccordions = (
    parent: HTMLElement,
    entries: readonly PromptEntry[],
    help?: string,
  ) => {
    const heading = document.createElement('label')
    heading.className = 'e-pop-label t-micro'
    heading.textContent = modChromeWords.options
    parent.append(heading)
    // One option open at a time, like the reference — enforced with in-place
    // updates: a rebuild here would detach the clicked trigger mid-event and
    // read to the popover as an outside press.
    const accordions = new Map<string, { update: (s: {
      label: string; summary: string; expanded: boolean; enabled: boolean
    }) => void }>()
    for (const entry of entries) {
      const accordion = mountModPopoverAccordion(parent, {
        id: fieldId(entry.key),
        label: entry.label,
        summary: '',
        expanded: openAccordionKey === entry.key,
        enabled: state.interactive,
        onExpandedChange(expanded) {
          const previous = openAccordionKey
          openAccordionKey = expanded ? entry.key : null
          if (expanded && previous && previous !== entry.key) {
            const other = entries.find((candidate) => candidate.key === previous)
            if (other) accordions.get(previous)?.update({
              label: other.label, summary: '', expanded: false, enabled: state.interactive,
            })
          }
          accordion.update({
            label: entry.label, summary: '', expanded, enabled: state.interactive,
          })
        },
      })
      accordions.set(entry.key, accordion)
      textField(
        accordion.body,
        modChromeWords.name,
        entry.label,
        (value) => {
          const trimmed = value.trim()
          if (trimmed) commit('Rename Mod part', (mod) => entry.setLabel(mod, trimmed))
        },
      )
      textField(
        accordion.body,
        modChromeWords.optionPrompt,
        entry.frame,
        (frame) => commit('Edit Mod prompt', (mod) => entry.setFrame(mod, frame)),
        {
          prose: true,
          placeholder: entry.placeholder,
          help: help ?? modChromeWords.valueSlotHelp,
        },
      )
    }
  }

  /* Stop names live in ONE field as a column of inputs, like the reference;
     with stops off the field stays, saying to turn stops on first. */
  const stopNamesField = (
    parent: HTMLElement,
    values: readonly string[],
    placeholders: readonly string[],
    onName: (index: number, name: string) => void,
  ) => {
    const control = document.createElement('div')
    control.className = 'e-pop-stop-names'
    values.forEach((value, index) => {
      const input = document.createElement('input')
      input.className = 'e-field'
      input.type = 'text'
      input.value = value
      input.placeholder = placeholders[index] ?? ''
      input.disabled = !state.interactive
      input.setAttribute('aria-label', `${modChromeWords.stopName} ${index + 1}`)
      input.addEventListener('change', () => onName(index, input.value.trim()))
      control.append(input)
    })
    guard(control)
    mountModPopoverField(parent, {
      id: fieldId(modChromeWords.stopNames),
      label: modChromeWords.stopNames,
      control,
      help: values.length ? modChromeWords.stopNamesOrderHelp : modChromeWords.turnOnStopsHelp,
    })
  }

  const stops = (
    parent: HTMLElement,
    steps: number,
    names: readonly string[] | undefined,
    onSteps: (steps: number) => void,
    onName?: (index: number, name: string) => void,
    max = 10,
  ) => {
    stepperField(parent, modChromeWords.stops, steps, onSteps, { max })
    if (!onName) return
    const count = steps >= 2 ? steps + 1 : 0
    stopNamesField(
      parent,
      Array.from({ length: count }, (_, index) => names?.[index] ?? ''),
      Array.from({ length: count }, (_, index) => `${Math.round(index / steps * 100)}%`),
      onName,
    )
  }

  const render = () => {
    const focusedFieldId = context.root.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).id
      : ''
    context.root.replaceChildren()
    fieldOrdinal = 0
    const mod = state.mod as Mod
    const partById = (
      candidate: Mod,
      collection: 'items' | 'options' | 'lanes' | 'axes',
      id: string,
      patch: (part: { label: string; frame?: string }) => void,
    ) => {
      const part = (candidate.state as unknown as Record<string, unknown>)[collection]
      if (!Array.isArray(part)) return
      const target = part.find((entry) => typeof entry === 'object' && entry !== null && entry.id === id)
      if (target) patch(target)
    }
    const partEntries = (
      collection: 'items' | 'options' | 'lanes' | 'axes',
      parts: readonly { id: string; label: string; frame?: string }[],
      placeholderOf: (label: string) => string,
    ): PromptEntry[] => parts.map((part) => ({
      key: part.id,
      label: part.label,
      frame: part.frame ?? '',
      placeholder: placeholderOf(part.label),
      setLabel: (candidate, value) => partById(candidate, collection, part.id, (target) => {
        target.label = value.toUpperCase()
      }),
      setFrame: (candidate, value) => partById(candidate, collection, part.id, (target) => {
        target.frame = value
      }),
    }))

    // The Name field leads every kind's settings, like the reference gear.
    textField(context.root, modChromeWords.name, mod.title, (value) => {
      const trimmed = value.trim()
      if (trimmed) commit('Rename Mod', (candidate) => { candidate.title = trimmed })
    })

    switch (mod.kind) {
      case 'slider':
      case 'dial': {
        stops(context.root, mod.state.steps, mod.state.stops, (steps) => commit('Set Mod stops', (candidate) => {
          if (candidate.kind !== mod.kind) return
          candidate.state.steps = steps
          candidate.state.stops = steps >= 2
            ? Array.from({ length: steps + 1 }, (_, index) => candidate.state.stops[index] ?? '')
            : []
          candidate.state.items.forEach((item) => { item.v = snap(item.v, steps) })
        }), (index, name) => commit('Rename Mod stop', (candidate) => {
          if (candidate.kind === mod.kind) candidate.state.stops[index] = name
        }))
        promptAccordions(context.root, partEntries('items', mod.state.items, (label) => `${capWord(label)}: {value}.`))
        break
      }
      case 'count':
        stepperField(context.root, modChromeWords.stops, mod.state.steps, (steps) => (
          commit('Set Count steps', (candidate) => {
            if (candidate.kind !== 'count') return
            candidate.state.steps = steps
            if (candidate.state.mode !== 'number') {
              candidate.state.items.forEach((item) => { item.n = Math.min(item.n, candidate.state.steps) })
            }
          })
        ), { off: false, help: modChromeWords.countStopsHelp })
        promptAccordions(context.root, partEntries('items', mod.state.items, (label) => `${capWord(label)}: {value}.`))
        break
      case 'switch':
        promptAccordions(
          context.root,
          partEntries('items', mod.state.items, (label) => `${capWord(label)}.`),
          modChromeWords.switchPromptHelp,
        )
        break
      case 'select':
        promptAccordions(
          context.root,
          partEntries('options', mod.state.options, () => 'Write for …'),
          modChromeWords.selectPromptHelp,
        )
        break
      case 'order':
        textField(context.root, modChromeWords.modPrompt, mod.state.frame, (frame) => commit('Edit Mod prompt', (candidate) => {
          if (candidate.kind === 'order') candidate.state.frame = frame
        }), { prose: true, placeholder: 'Priorities: {value}.', help: modChromeWords.valueSlotHelp })
        promptAccordions(
          context.root,
          partEntries('items', mod.state.items, (label) => label.toLowerCase()),
          modChromeWords.orderPromptHelp,
        )
        break
      case 'pad':
        for (const axisName of ['x', 'y'] as const) {
          const axis = mod.state.axes[axisName]
          textField(context.root, `${axis.label} ${modChromeWords.lowEnd}`, axis.lo, (value) => commit('Rename Pad end', (candidate) => {
            if (candidate.kind === 'pad') candidate.state.axes[axisName].lo = value
          }))
          textField(context.root, `${axis.label} ${modChromeWords.highEnd}`, axis.hi, (value) => commit('Rename Pad end', (candidate) => {
            if (candidate.kind === 'pad') candidate.state.axes[axisName].hi = value
          }))
        }
        // One stepper drives both axes, like the reference: the snap grid IS the stops.
        stepperField(context.root, modChromeWords.stops, mod.state.axes.x.steps, (steps) => (
          commit('Set Pad stops', (candidate) => {
            if (candidate.kind !== 'pad') return
            for (const axisName of ['x', 'y'] as const) {
              candidate.state.axes[axisName].steps = steps
              candidate.state.v[axisName] = snap(candidate.state.v[axisName], steps)
            }
          })
        ))
        promptAccordions(context.root, (['x', 'y'] as const).map((axisName) => {
          const axis = mod.state.axes[axisName]
          return {
            key: axisName,
            label: axis.label,
            frame: axis.frame,
            placeholder: `${capWord(axis.label)}: {value}.`,
            setLabel: (candidate, value) => {
              if (candidate.kind === 'pad') candidate.state.axes[axisName].label = value.toUpperCase()
            },
            setFrame: (candidate, value) => {
              if (candidate.kind === 'pad') candidate.state.axes[axisName].frame = value
            },
          } satisfies PromptEntry
        }))
        break
      case 'filter':
        stops(context.root, mod.state.steps, mod.state.stops, (steps) => commit('Set Mod stops', (candidate) => {
          if (candidate.kind !== 'filter') return
          candidate.state.steps = steps
          candidate.state.stops = steps >= 2
            ? Array.from({ length: steps + 1 }, (_, index) => candidate.state.stops[index] ?? '')
            : []
          candidate.state.lanes.forEach((lane) => {
            lane.lo = snap(lane.lo, steps)
            lane.hi = snap(lane.hi, steps)
          })
        }), (index, name) => commit('Rename Mod stop', (candidate) => {
          if (candidate.kind === 'filter') candidate.state.stops[index] = name
        }))
        promptAccordions(context.root, partEntries('lanes', mod.state.lanes, (label) => `${capWord(label)}: {value}.`))
        break
      case 'mixer':
        textField(context.root, modChromeWords.modPrompt, mod.state.frame, (frame) => commit('Edit Mod prompt', (candidate) => {
          if (candidate.kind === 'mixer') candidate.state.frame = frame
        }), { prose: true, placeholder: 'Blend {value}.', help: modChromeWords.valueSlotHelp })
        promptAccordions(context.root, partEntries('items', mod.state.items, (label) => `{value} ${label.toLowerCase()}`))
        break
      case 'radar':
        stops(context.root, mod.state.steps, undefined, (steps) => commit('Set Mod stops', (candidate) => {
          if (candidate.kind !== 'radar') return
          candidate.state.steps = steps
          candidate.state.axes.forEach((axis) => { axis.v = snap(axis.v, steps) })
        }))
        promptAccordions(context.root, partEntries('axes', mod.state.axes, (label) => `${label.toLowerCase()} {value}`))
        break
      case 'matrix':
        stepperField(context.root, modChromeWords.stops, mod.state.steps, (steps) => (
          commit('Set Matrix stops', (candidate) => {
            if (candidate.kind !== 'matrix') return
            candidate.state.steps = steps
            candidate.state.stepNames = Array.from(
              { length: steps },
              (_, index) => candidate.state.stepNames[index] ?? (index === 0 ? 'none' : ''),
            )
            candidate.state.cells.forEach((row) => row.forEach((cell, index) => {
              row[index] = Math.min(cell, steps - 1)
            }))
          })
        ), { min: 2, max: 5, off: false, help: modChromeWords.matrixStopsHelp })
        stopNamesField(
          context.root,
          mod.state.stepNames,
          mod.state.stepNames.map((_, index) => (
            index === 0 ? 'none' : `${Math.round(index / (mod.state.steps - 1) * 100)}%`
          )),
          (index, name) => commit('Rename Matrix stop', (candidate) => {
            if (candidate.kind === 'matrix') candidate.state.stepNames[index] = name
          }),
        )
        break
    }
    const restoredControl = focusedFieldId
      ? Array.from(context.root.querySelectorAll<HTMLElement>('[id]'))
        .find((control) => control.id === focusedFieldId)
      : undefined
    if (restoredControl) {
      restoredControl.focus()
    } else if (focusFirstControl) {
      focusFirstControl = false
      context.root.querySelector<HTMLElement>('input, textarea, select, button')?.focus()
    }
  }

  render()
  return {
    update(next) {
      state = next
      render()
    },
    dispose() {
      context.root.replaceChildren()
    },
  }
}
