import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Button, Field, FieldLabel } from '../primitives'
import { words } from '../../shared/words'
import { ModalShell } from './ModalShell'

export type ConfirmDialogOptions = Readonly<{
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  tone?: 'primary' | 'danger'
}>

export type PromptDialogOptions = Readonly<{
  title: string
  message: string
  label: string
  submitLabel: string
  cancelLabel?: string
  defaultValue?: string
  placeholder?: string
}>

export type DialogService = Readonly<{
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>
  prompt: (options: PromptDialogOptions) => Promise<string | null>
}>

type ConfirmRequest = Readonly<{
  id: number
  kind: 'confirm'
  options: ConfirmDialogOptions
  returnFocus: HTMLElement | null
  resolve: (value: boolean) => void
}>

type PromptRequest = Readonly<{
  id: number
  kind: 'prompt'
  options: PromptDialogOptions
  returnFocus: HTMLElement | null
  resolve: (value: string | null) => void
}>

export type DialogRequest = ConfirmRequest | PromptRequest

export const DialogContext = createContext<DialogService | null>(null)

export function useDialogs(): DialogService {
  const dialogs = useContext(DialogContext)
  if (!dialogs) throw new Error('useDialogs must be used inside OverlayProvider')
  return dialogs
}

function activeElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null
}

type DeferredSettlement<Value> =
  | Readonly<{ pending: false }>
  | Readonly<{ pending: true; value: Value }>

function useDialogExit<Value>(complete: (value: Value) => void) {
  const [open, setOpen] = useState(true)
  const settlementRef = useRef<DeferredSettlement<Value>>({ pending: false })
  const completeRef = useRef(complete)
  completeRef.current = complete

  const requestClose = useCallback((value: Value) => {
    if (settlementRef.current.pending) return
    settlementRef.current = { pending: true, value }
    setOpen(false)
  }, [])

  const completeExit = useCallback(() => {
    const settlement = settlementRef.current
    if (!settlement.pending) return
    settlementRef.current = { pending: false }
    completeRef.current(settlement.value)
  }, [])

  return { open, requestClose, completeExit } as const
}

export function useDialogQueue() {
  const [active, setActiveState] = useState<DialogRequest | null>(null)
  const activeRef = useRef<DialogRequest | null>(null)
  const pendingRef = useRef<DialogRequest[]>([])
  const trainReturnFocusRef = useRef<HTMLElement | null>(null)
  const nextIdRef = useRef(1)

  const setActive = useCallback((request: DialogRequest | null) => {
    activeRef.current = request
    setActiveState(request)
  }, [])

  const returnFocusForRequest = () => {
    if (!activeRef.current && pendingRef.current.length === 0) {
      trainReturnFocusRef.current = activeElement()
    }
    return trainReturnFocusRef.current
  }

  const confirm = useCallback((options: ConfirmDialogOptions) => {
    return new Promise<boolean>((resolve) => {
      const request: ConfirmRequest = {
        id: nextIdRef.current++,
        kind: 'confirm',
        options,
        returnFocus: returnFocusForRequest(),
        resolve,
      }
      if (activeRef.current) pendingRef.current.push(request)
      else setActive(request)
    })
  }, [setActive])

  const prompt = useCallback((options: PromptDialogOptions) => {
    return new Promise<string | null>((resolve) => {
      const request: PromptRequest = {
        id: nextIdRef.current++,
        kind: 'prompt',
        options,
        returnFocus: returnFocusForRequest(),
        resolve,
      }
      if (activeRef.current) pendingRef.current.push(request)
      else setActive(request)
    })
  }, [setActive])

  const settle = useCallback((requestId: number, value: boolean | string | null) => {
    const current = activeRef.current
    if (!current || current.id !== requestId) return
    if (current.kind === 'confirm') current.resolve(value === true)
    else current.resolve(typeof value === 'string' ? value : null)

    const next = pendingRef.current.shift() ?? null
    setActive(next)
    if (!next) trainReturnFocusRef.current = null
  }, [setActive])

  const cancelAll = useCallback((updateState: boolean) => {
    const requests = [
      ...(activeRef.current ? [activeRef.current] : []),
      ...pendingRef.current,
    ]
    activeRef.current = null
    pendingRef.current = []
    trainReturnFocusRef.current = null
    for (const request of requests) {
      if (request.kind === 'confirm') request.resolve(false)
      else request.resolve(null)
    }
    if (updateState) setActiveState(null)
  }, [])

  const service = useMemo<DialogService>(() => ({ confirm, prompt }), [confirm, prompt])
  return { active, cancelAll, service, settle } as const
}

function ConfirmDialog({
  request,
  settle,
}: {
  request: ConfirmRequest
  settle: (requestId: number, value: boolean) => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(request.returnFocus)
  const options = request.options
  const exit = useDialogExit<boolean>(value => settle(request.id, value))
  return (
    <ModalShell
      open={exit.open}
      title={options.title}
      dismissOnBackdrop={false}
      initialFocusRef={cancelRef}
      returnFocusRef={returnFocusRef}
      onDismiss={() => exit.requestClose(false)}
      onExitComplete={exit.completeExit}
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" onClick={() => exit.requestClose(false)}>
            {options.cancelLabel ?? words.cancel}
          </Button>
          <Button
            variant={options.tone === 'danger' ? 'danger-confirm' : 'primary'}
            onClick={() => exit.requestClose(true)}
          >
            {options.confirmLabel}
          </Button>
        </>
      }
    >
      <p className="e-dialog-message t-prose-s">{options.message}</p>
    </ModalShell>
  )
}

function PromptDialog({
  request,
  settle,
}: {
  request: PromptRequest
  settle: (requestId: number, value: string | null) => void
}) {
  const [value, setValue] = useState(request.options.defaultValue ?? '')
  const fieldRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(request.returnFocus)
  const formId = `eido-prompt-${useId().replace(/:/g, '')}`
  const fieldId = `${formId}-field`
  const options = request.options
  const exit = useDialogExit<string | null>(result => settle(request.id, result))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    exit.requestClose(value)
  }

  return (
    <ModalShell
      open={exit.open}
      title={options.title}
      dismissOnBackdrop={false}
      initialFocusRef={fieldRef}
      returnFocusRef={returnFocusRef}
      onDismiss={() => exit.requestClose(null)}
      onExitComplete={exit.completeExit}
      footer={
        <>
          <Button variant="ghost" onClick={() => exit.requestClose(null)}>
            {options.cancelLabel ?? words.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId}>
            {options.submitLabel}
          </Button>
        </>
      }
    >
      <form id={formId} className="e-dialog-form" onSubmit={submit}>
        <p className="e-dialog-message t-prose-s">{options.message}</p>
        <FieldLabel htmlFor={fieldId}>{options.label}</FieldLabel>
        <Field
          ref={fieldRef}
          id={fieldId}
          value={value}
          placeholder={options.placeholder}
          autoComplete="off"
          onChange={event => setValue(event.currentTarget.value)}
        />
      </form>
    </ModalShell>
  )
}

export function DialogPresenter({
  request,
  settle,
}: {
  request: DialogRequest
  settle: (requestId: number, value: boolean | string | null) => void
}) {
  if (request.kind === 'confirm') {
    return <ConfirmDialog request={request} settle={settle} />
  }
  return <PromptDialog request={request} settle={settle} />
}

export function DialogContextProvider({
  service,
  children,
}: {
  service: DialogService
  children: ReactNode
}) {
  return <DialogContext.Provider value={service}>{children}</DialogContext.Provider>
}
