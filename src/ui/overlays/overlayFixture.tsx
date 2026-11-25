import { StrictMode, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CircleHelp } from 'lucide-react'
import 'virtual:eido-design-tokens.css'
import '../../styles.css'
import {
  Button,
  IconButton,
  Menu,
  MenuItem,
  Picker,
  Popover,
} from '../primitives'
import { ModalShell, OverlayProvider, useDialogs } from './index'

function OverlayFixture({
  onUnmountProvider,
}: {
  onUnmountProvider: (
    confirmation: Promise<boolean>,
    prompt: Promise<string | null>,
  ) => void
}) {
  const dialogs = useDialogs()
  const [parentOpen, setParentOpen] = useState(false)
  const [childOpen, setChildOpen] = useState(false)
  const [dialogOutcome, setDialogOutcome] = useState('')
  const [pickerValue, setPickerValue] = useState('')
  const [nestedOutcome, setNestedOutcome] = useState('')
  const parentInitialRef = useRef<HTMLButtonElement>(null)
  const childInitialRef = useRef<HTMLButtonElement>(null)

  const runDialogs = async () => {
    const capturedTarget = 'fixture-card'
    const confirmation = dialogs.confirm({
      title: 'Delete fixture card?',
      message: 'This removes the fixture card and its connections.',
      confirmLabel: 'Delete card',
      tone: 'danger',
    })
    const reason = dialogs.prompt({
      title: 'Why stop here?',
      message: 'Add the one-line reason future runs should avoid.',
      label: 'Reason',
      submitLabel: 'Keep reason',
      defaultValue: '  first draft  ',
    })
    setDialogOutcome(
      `${capturedTarget}|${await confirmation}|${(await reason) ?? 'cancelled'}`,
    )
  }

  const requestProviderUnmount = () => {
    const confirmation = dialogs.confirm({
      title: 'Unmounted confirm',
      message: 'This request should cancel during teardown.',
      confirmLabel: 'Continue',
    })
    const prompt = dialogs.prompt({
      title: 'Unmounted prompt',
      message: 'This queued request should cancel during teardown.',
      label: 'Value',
      submitLabel: 'Keep value',
    })
    onUnmountProvider(confirmation, prompt)
  }

  const openNestedConfirm = () => {
    void dialogs.confirm({
      title: 'Confirm above child?',
      message: 'The child and its floating menu stay mounted underneath.',
      confirmLabel: 'Keep nesting',
    }).then(confirmed => setNestedOutcome(confirmed ? 'confirmed' : 'cancelled'))
  }

  return (
    <main style={{ padding: '24px' }}>
      <div style={{ display: 'flex', gap: '8px' }}>
        <Button onClick={() => setParentOpen(true)}>Open parent</Button>
        <Button onClick={() => void runDialogs()}>Run dialogs</Button>
        <Button onClick={requestProviderUnmount}>Unmount provider</Button>
      </div>
      <output aria-label="Dialog outcome">{dialogOutcome}</output>
      <output aria-label="Picker outcome">{pickerValue}</output>
      <output aria-label="Nested confirm outcome">{nestedOutcome}</output>

      <ModalShell
        open={parentOpen}
        title="Parent dialog"
        subtitle="The lower layer stays mounted while its child is open."
        dismissOnBackdrop={false}
        initialFocusRef={parentInitialRef}
        onDismiss={() => {
          setChildOpen(false)
          setParentOpen(false)
        }}
      >
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Button ref={parentInitialRef} onClick={() => setChildOpen(true)}>
            Open child
          </Button>
          <Picker
            value={pickerValue}
            options={[
              { value: 'direct', label: 'Direct' },
              { value: 'light', label: 'Light' },
            ]}
            onValueChange={setPickerValue}
            ariaLabel="Modal picker"
            emptyLabel="Choose strength"
            variant="compact"
          />
          <Popover trigger={<Button>Modal menu</Button>}>
            <Menu ariaLabel="Modal menu actions">
              <MenuItem onClick={() => setChildOpen(true)}>
                Open child from menu
              </MenuItem>
            </Menu>
          </Popover>
          <IconButton
            label="Modal help"
            tooltip="Modal floating help"
            icon={<CircleHelp aria-hidden="true" />}
          />
          <Button>Last parent action</Button>
        </div>
        <ModalShell
          open={childOpen}
          title="Child dialog"
          dismissOnBackdrop={false}
          initialFocusRef={childInitialRef}
          onDismiss={() => setChildOpen(false)}
        >
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button ref={childInitialRef}>Child action</Button>
            <Popover trigger={<Button>Child menu</Button>}>
              <Menu ariaLabel="Child menu actions">
                <MenuItem onClick={openNestedConfirm}>
                  Open confirm from menu
                </MenuItem>
              </Menu>
            </Popover>
          </div>
        </ModalShell>
      </ModalShell>
    </main>
  )
}

function FixtureHost() {
  const [providerMounted, setProviderMounted] = useState(true)
  const [unmountOutcome, setUnmountOutcome] = useState('')

  const unmountProvider = (
    confirmation: Promise<boolean>,
    prompt: Promise<string | null>,
  ) => {
    void Promise.all([confirmation, prompt]).then(([confirmed, value]) => {
      setUnmountOutcome(`${confirmed}|${value ?? 'cancelled'}`)
    })
    setProviderMounted(false)
  }

  return providerMounted ? (
    <OverlayProvider>
      <OverlayFixture onUnmountProvider={unmountProvider} />
    </OverlayProvider>
  ) : (
    <output aria-label="Provider unmount outcome">{unmountOutcome}</output>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FixtureHost />
  </StrictMode>,
)
