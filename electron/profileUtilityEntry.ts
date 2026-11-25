import { profileServiceFailure } from '../src/persistence/profileServiceContract'
import { createProfileUtilityHost } from './profileUtilityHost'
import {
  assertProfileUtilityParentMessage,
  createProfileUtilityFatal,
} from './profileUtilityProtocol'

const utilityParentPort = process.parentPort
const host = createProfileUtilityHost()
let initialized = false
let terminal = false
let awaitingCloseAcknowledgement: string | undefined
let queue = Promise.resolve()

function postTerminal(
  message: Parameters<typeof utilityParentPort.postMessage>[0],
  exitCode: number,
): void {
  terminal = true
  try {
    utilityParentPort.postMessage(message)
  } finally {
    setImmediate(() => process.exit(exitCode))
  }
}

utilityParentPort.on('message', (event) => {
  if (terminal) {
    try {
      const message = assertProfileUtilityParentMessage(event.data)
      if (message.kind === 'close-acknowledgement'
        && message.requestId === awaitingCloseAcknowledgement) {
        awaitingCloseAcknowledgement = undefined
        setImmediate(() => process.exit(0))
      }
    } catch {
      // Terminal utilities accept only the correlated close acknowledgement.
    }
    return
  }
  queue = queue.then(async () => {
    if (terminal) return
    const message = assertProfileUtilityParentMessage(event.data)
    if (message.kind === 'initialize') {
      if (initialized) throw new Error('Profile utility was initialized more than once')
      initialized = true
      const startup = await host.initialize(message.payload)
      if (startup.kind === 'fatal') {
        postTerminal(startup, 1)
      } else {
        utilityParentPort.postMessage(startup)
      }
      return
    }
    if (!initialized) throw new Error('Profile utility request arrived before initialization')
    if (message.kind !== 'request') {
      throw new Error('Profile utility close acknowledgement arrived before close')
    }
    const response = await host.handle(message)
    if (message.operation === 'close') {
      if (response.result.ok) {
        terminal = true
        awaitingCloseAcknowledgement = response.requestId
        utilityParentPort.postMessage(response)
      } else {
        postTerminal(response, 1)
      }
    } else {
      utilityParentPort.postMessage(response)
    }
  }).catch(() => {
    if (terminal) return
    postTerminal(createProfileUtilityFatal(profileServiceFailure('internal')), 1)
  })
})
