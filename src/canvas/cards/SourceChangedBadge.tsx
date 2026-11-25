import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SourceChangeStatus } from '../../brain/sourceContext'
import { useGraph } from '../../graph/store'
import { Button, IconButton, Menu, MenuItem, Popover } from '../../ui/primitives'
import { dragBlockingClass } from '../cardInteraction'
import { words } from '../../shared/words'

type Props = {
  status: SourceChangeStatus | null
  selected: boolean
  onDismiss: (signature: string) => void
}

export function SourceChangedBadge({ status, selected, onDismiss }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const dismissRef = useRef<HTMLButtonElement | null>(null)
  const changedSources = status?.changes.filter((change) => change.reason === 'changed') ?? []
  const deletedSources = status?.changes.filter((change) => change.reason === 'deleted') ?? []

  useLayoutEffect(() => {
    if (open && changedSources.length === 0) dismissRef.current?.focus()
  }, [changedSources.length, open])

  useEffect(() => {
    if (!status) setOpen(false)
  }, [status])

  if (!status) return null

  return (
    <span ref={rootRef} className={`source-change ${dragBlockingClass(selected)}`}>
      <Popover
        open={open}
        onOpenChange={setOpen}
        dismissOnTab={false}
        ariaHasPopup="dialog"
        trigger={
          <IconButton
            className="source-change-trigger"
            variant="ghost"
            size="compact"
            label={words.sourceChanged}
            icon={<span aria-hidden="true">!</span>}
            onClick={(event) => event.stopPropagation()}
          />
        }
      >
        <div
          className="source-change-popover"
          role="dialog"
          aria-label={words.sourceChanged}
        >
          <div className="source-change-note">
            <strong className="t-value">{words.sourceChanged}</strong>
            <span className="t-ui">{words.sourceChangedDetail}</span>
          </div>
          <div className="source-change-sources">
            {changedSources.length > 0 && (
              <Menu ariaLabel={words.sourceChangedSources} className="source-change-list">
                {changedSources.map((change) => (
                  <MenuItem
                    key={`${change.cardId}:${change.groupMode ?? ''}`}
                    onClick={() => {
                      setOpen(false)
                      useGraph.getState().requestCardFocus(change.cardId)
                    }}
                  >
                    <span className="source-change-name t-ui">{change.label}</span>
                  </MenuItem>
                ))}
              </Menu>
            )}
            {deletedSources.length > 0 && (
              <div className="source-change-deleted-list">
                {deletedSources.map((change) => (
                  <div
                    className="source-change-deleted-row"
                    key={`${change.cardId}:${change.groupMode ?? ''}`}
                  >
                    <span className="source-change-name t-ui">{change.label}</span>
                    <span className="source-change-reason deleted t-ui">
                      {words.sourceChangedDeleted}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Button
            ref={dismissRef}
            variant="quiet"
            size="compact"
            onClick={() => {
              const owningCardNode = rootRef.current?.closest<HTMLElement>(
                '.react-flow__node[data-id]',
              )
              setOpen(false)
              onDismiss(status.signature)
              queueMicrotask(() => {
                if (owningCardNode?.isConnected) owningCardNode.focus()
              })
            }}
          >
            {words.sourceChangedDismiss}
          </Button>
        </div>
      </Popover>
    </span>
  )
}
