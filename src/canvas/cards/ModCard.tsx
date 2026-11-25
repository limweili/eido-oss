import type { NodeProps } from '@xyflow/react'
import { Eye, Plus, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useGraph } from '../../graph/store'
import { commitV2Mod } from '../../mods/commit'
import { ModContextPopover, ModIdentityWell } from '../../mods/chrome'
import { canGrowMod, growMod } from '../../mods/growth'
import { modFaceDefinitionFor } from '../../mods/faces/registry'
import { mountModFaceHost } from '../../mods/faces/host'
import type { ModFaceDefinition, MountedModFaceHost } from '../../mods/faces/types'
import type { Mod, ModKind } from '../../mods/model'
import { cloneDetached } from '../../mods/snapshot'
import { modChromeWords, modGrowWords } from '../../shared/words'
import { IconButton, Popover } from '../../ui/primitives'
import {
  canEditSelectedCard,
  dragBlockingClass,
  modFaceGestureReporterFromNodeData,
} from '../cardInteraction'
import { CardShell, type CardColourMode } from './CardShell'

export function ModCard({ id, selected, data }: NodeProps) {
  const card = useGraph(useShallow((state) => {
    const found = state.graph().cardById(id)
    return {
      exists: Boolean(found),
      modV2: found?.modV2,
      headerColor: found?.headerColor,
      headerFill: found?.headerFill,
    }
  }))
  const activeTool = useGraph((state) => state.activeTool)
  const mod = card?.modV2
  const definition = mod
    ? modFaceDefinitionFor(mod.kind) as ModFaceDefinition<ModKind> | undefined
    : undefined
  const canEdit = canEditSelectedCard({ activeTool, data, selected: !!selected })
  const dragBlock = dragBlockingClass(!!selected)
  const faceRootRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<MountedModFaceHost<ModKind> | null>(null)
  const gestureReporterRef = useRef(modFaceGestureReporterFromNodeData(data))
  const cancelTitleEditRef = useRef(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(mod?.title ?? '')
  const [contextOpen, setContextOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const mountedSettingsRef = useRef<Readonly<{ dispose: () => void }> | null>(null)
  const [contextDraftOverride, setContextDraftOverride] = useState<string | null>(
    mod?.treatOverride ?? null,
  )

  gestureReporterRef.current = modFaceGestureReporterFromNodeData(data)

  const commitMod = useCallback(
    (nextMod: Mod, label: string) => commitV2Mod(useGraph.getState(), id, nextMod, label),
    [id],
  )
  const setCardHeaderColor = useGraph((state) => state.setCardHeaderColor)

  useEffect(() => {
    if (!editingTitle && mod) setTitleDraft(mod.title)
  }, [editingTitle, mod])

  useLayoutEffect(() => {
    const root = faceRootRef.current
    if (!root || !definition || !mod) return
    const host = mountModFaceHost<ModKind>({
      root,
      definition,
      mod,
      selected: !!selected,
      canEdit,
      commit: commitMod,
      onGestureChange: (active) => gestureReporterRef.current?.(id, active),
    })
    hostRef.current = host
    return () => {
      host.dispose()
      if (hostRef.current === host) hostRef.current = null
    }
    // Kind changes replace the imperative island; state changes flow through update below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitMod, definition, id])

  useLayoutEffect(() => {
    if (!mod) return
    hostRef.current?.update({ mod, selected: !!selected, canEdit })
  }, [canEdit, mod, selected])

  const bindSettingsRoot = useCallback((root: HTMLDivElement | null) => {
    mountedSettingsRef.current?.dispose()
    mountedSettingsRef.current = null
    if (settingsOpen && root) {
      mountedSettingsRef.current = hostRef.current?.mountSettings(root) ?? null
    }
  }, [settingsOpen])

  const commitTitle = () => {
    setEditingTitle(false)
    if (cancelTitleEditRef.current) {
      cancelTitleEditRef.current = false
      setTitleDraft(mod?.title ?? '')
      return
    }
    if (!mod || titleDraft === mod.title) return
    const next = cloneDetached(mod)
    next.title = titleDraft.trim() || mod.title
    setTitleDraft(next.title)
    commitMod(next, 'Rename Mod')
  }

  const closeContext = (open: boolean) => {
    if (open) {
      setContextDraftOverride(mod?.treatOverride ?? null)
      setContextOpen(true)
      return
    }
    setContextOpen(false)
    if (!mod || contextDraftOverride === mod.treatOverride) return
    const next = cloneDetached(mod)
    next.treatOverride = contextDraftOverride
    commitMod(next, 'Edit Mod treatment')
  }

  const contextMod = useMemo(() => {
    if (!mod || !contextOpen) return mod
    return { ...mod, treatOverride: contextDraftOverride } as Mod
  }, [contextDraftOverride, contextOpen, mod])

  const gateChromeClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (canEdit) {
      event.stopPropagation()
      return
    }
    event.preventDefault()
  }

  if (!card.exists || !mod || !definition) return null

  const titleControl = editingTitle ? (
    <input
      autoFocus
      className={`mod-card-title-input e-edit nodrag t-title ${dragBlock}`}
      aria-label={modChromeWords.title}
      value={titleDraft}
      onChange={(event) => setTitleDraft(event.currentTarget.value)}
      onBlur={commitTitle}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          cancelTitleEditRef.current = true
          setTitleDraft(mod.title)
          event.currentTarget.blur()
        }
      }}
    />
  ) : (
    <button
      className={`card-title-display mod-card-title t-title ${dragBlock}`}
      type="button"
      aria-label={modChromeWords.title}
      onClick={(event) => {
        if (!canEdit) return
        event.stopPropagation()
        cancelTitleEditRef.current = false
        setTitleDraft(mod.title)
        setEditingTitle(true)
      }}
    >
      <span>{mod.title}</span>
    </button>
  )

  const setAccent = (accent: string) => {
    if (!canEdit) return
    const next = cloneDetached(mod)
    next.accent = accent
    commitMod(next, 'Set Mod colour')
    // A chosen fill paints with the accent — keep the stored colour in step.
    if (card.headerColor) setCardHeaderColor(id, accent, card.headerFill ?? 'half')
  }

  const setFill = (mode: CardColourMode) => {
    if (!canEdit) return
    if (mode === 'none') setCardHeaderColor(id, undefined)
    else setCardHeaderColor(id, mod.accent, mode)
  }

  const growWord = modGrowWords[mod.kind]
  const growable = Boolean(growWord) && canGrowMod(mod)
  const grow = (event: MouseEvent<HTMLButtonElement>) => {
    gateChromeClick(event)
    if (!canEdit) return
    const next = cloneDetached(mod)
    if (growMod(next)) commitMod(next, growWord ?? 'Grow Mod')
  }

  return (
    <CardShell
      id={id}
      kind="mod"
      selected={!!selected}
      data={data}
      titleControl={titleControl}
      identity={{
        color: mod.accent,
        label: modChromeWords.colour,
        picker: (
          <ModIdentityWell
            mod={mod}
            onAccentChange={setAccent}
            fill={card.headerColor ? card.headerFill ?? 'half' : undefined}
            onFillChange={setFill}
          />
        ),
        interactive: canEdit,
      }}
      headActions={
        contextMod && (<>
          {growable && (
            <IconButton
              className={dragBlock}
              label={growWord!}
              icon={<Plus aria-hidden="true" />}
              variant="ghost"
              size="compact"
              onClick={grow}
            />
          )}
          <Popover
            open={settingsOpen}
            onOpenChange={(open) => {
              if (!open || canEdit) setSettingsOpen(open)
            }}
            dismissOnTab={false}
            ariaHasPopup="dialog"
            trigger={
              <IconButton
                className={dragBlock}
                label={modChromeWords.settings}
                icon={<SlidersHorizontal aria-hidden="true" />}
                variant="ghost"
                size="compact"
                onClick={gateChromeClick}
              />
            }
          >
            <div
              className="mod-settings-popover"
              role="dialog"
              aria-label={modChromeWords.settings}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div ref={bindSettingsRoot} />
            </div>
          </Popover>
        </>)
      }
    >
      <div ref={faceRootRef} />
      <div className="mod-foot">
        {contextMod && (
          <ModContextPopover
            mod={contextMod}
            open={contextOpen}
            onOpenChange={closeContext}
            onTreatmentOverrideChange={setContextDraftOverride}
            trigger={
              <button
                className={`mod-ikey ${dragBlock}`}
                type="button"
                aria-label={modChromeWords.context}
                onClick={gateChromeClick}
              >
                <Eye aria-hidden="true" />
              </button>
            }
          />
        )}
      </div>
    </CardShell>
  )
}
