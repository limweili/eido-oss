import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'virtual:eido-design-tokens.css'
import './styles.css'
import {
  selectProfileRendererPersistence,
  registerProfileRendererCheckpointHandler,
  type ProfileRendererEnvironment,
} from './graph/profileRendererPersistence'
import * as store from './graph/store'
import { installRendererCounterRuntime } from './performance/rendererCounterRuntime'
import { installWireRecordRuntime } from './shared/wireRecord'
import { loadWireRecordPreference } from './ui/wireRecordPreference'
import { words } from './shared/words'
import { OverlayProvider } from './ui/overlays'
import { registerProfileAgentMutationBarrierHandler } from './desktop/profileAgentMutationBarrier'
import { registerProfileAgentRunRendererRuntime } from './desktop/profileAgentRunRendererRuntime'

const rootElement = document.getElementById('root')!
const root = createRoot(rootElement)

function renderFailClosedStartup(): void {
  root.render(
    <StrictMode>
      <main className="app">
        <div className="board-wrap">
          <section className="empty" role="alert">
            <h2 className="t-display">{words.profileUnavailableTitle}</h2>
            <p className="t-hint">{words.profileUnavailableHint}</p>
          </section>
        </div>
      </main>
    </StrictMode>,
  )
}

async function bootstrap(): Promise<void> {
  let selection
  try {
    // Selection is deliberately one-shot and precedes every product render.
    // A packaged sentinel with an absent/incomplete bridge throws here and can
    // never drift into browser persistence.
    selection = selectProfileRendererPersistence(window as unknown as ProfileRendererEnvironment)
  } catch {
    renderFailClosedStartup()
    return
  }

  try {
    store.configureGraphPersistence(selection)
    let credentialStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.localStorage
    if (selection.kind === 'packaged-profile' && import.meta.env.MODE === 'desktop-proof') {
      const proof = await import('./desktop/packagedProfileProof')
      credentialStorage = proof.createPackagedCredentialMigrationFixture(credentialStorage)
    }
    const credentialLoad = store.configureGraphApiCredential(
      selection.kind,
      window.eidoKeychain,
      credentialStorage,
    )
    if (selection.kind === 'browser-development') await credentialLoad
    // A refused or unavailable credential leaves provider access locked.
    // Native Board authority can be established while the OS request is pending.
    else void credentialLoad.catch(() => undefined)
    if (selection.kind === 'packaged-profile') {
      const bridge = window.eidoProfile
      if (!bridge) throw new Error('Packaged Profile bridge is unavailable')
      const agentRunRuntime = registerProfileAgentRunRendererRuntime(window, {
        isAuthorityReady: () => {
          const graph = store.useGraph.getState()
          return graph.hydrated && graph.profileStartupState === 'ready'
        },
        subscribeAuthorityReadiness: (listener) => store.useGraph.subscribe(() => listener()),
        readLiveBoard: () => {
          const graph = store.useGraph.getState()
          return Object.freeze({
            ideaId: graph.currentIdeaId,
            board: graph.snapshot(),
          })
        },
        flush: () => selection.persistence.flush(),
      })
      registerProfileRendererCheckpointHandler(
        window,
        store.profileRendererCheckpointPersistence(),
        () => store.captureCurrentProfileRendererCommitState(),
        { prepareForCheckpoint: agentRunRuntime.drain },
      )
      registerProfileAgentMutationBarrierHandler(
        window,
        bridge,
        selection.persistence,
        () => store.captureCurrentProfileRendererCommitState(),
        {
          acquireExecutionLease: agentRunRuntime.acquireAuthoritativeMutationLease,
          freezeMutationAdmission: store.freezeProfileRendererMutationAdmissionForUpdate,
          onTerminalFailure: renderFailClosedStartup,
        },
      )
      window.addEventListener('beforeunload', () => agentRunRuntime.close(), { once: true })
    }

    if (import.meta.env.DEV) {
      const runtime = await import('./performance/browserPerformanceRuntime')
      runtime.installBrowserPerformanceRuntime()
    }

    installRendererCounterRuntime()
    installWireRecordRuntime(loadWireRecordPreference())

    if (import.meta.env.DEV) {
      ;(window as unknown as { __eido: unknown }).__eido = store.useGraph
    }

    root.render(
      <StrictMode>
        <OverlayProvider>
          <App />
        </OverlayProvider>
      </StrictMode>,
    )
    if (selection.kind === 'packaged-profile' && import.meta.env.MODE === 'desktop-proof') {
      await credentialLoad
      const { installPackagedProfileProof } = await import('./desktop/packagedProfileProof')
      installPackagedProfileProof(store)
    }
  } catch {
    renderFailClosedStartup()
  }
}

void bootstrap()
