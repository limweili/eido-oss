export type InstalledProfileLiveGateway = Readonly<{
  close(): Promise<void>
  terminate(): Promise<void>
}>

export type InstalledProfileLiveGatewayLifecycle = Readonly<{
  start(createStartup: () => Promise<InstalledProfileLiveGateway>): void
  stop(force: boolean): Promise<void>
}>

export function createInstalledProfileLiveGatewayLifecycle(
  onFailure: (error: unknown) => void,
): InstalledProfileLiveGatewayLifecycle {
  let server: InstalledProfileLiveGateway | undefined
  let startup: Promise<InstalledProfileLiveGateway> | undefined
  let stopping = false
  let stopped = false
  let stopAttempt: Promise<void> | undefined

  return Object.freeze({
    start(createStartup) {
      if (server || startup || stopping || stopped) return
      const candidate = createStartup()
      startup = candidate
      void candidate.then((started) => {
        if (startup === candidate) startup = undefined
        server = started
      }).catch((error: unknown) => {
        if (startup === candidate) startup = undefined
        if (!stopping) onFailure(error)
      })
    },
    stop(force) {
      if (stopped) return Promise.resolve()
      if (stopAttempt) return stopAttempt
      stopping = true
      const attempt = (async () => {
        const started = server ?? (startup ? await startup.catch(() => undefined) : undefined)
        if (!started) {
          stopped = true
          return
        }
        if (force) await started.terminate()
        else await started.close()
        if (server === started) server = undefined
        stopped = true
      })()
      stopAttempt = attempt
      void attempt.finally(() => {
        if (stopAttempt === attempt) stopAttempt = undefined
      }).catch(() => undefined)
      return attempt
    },
  })
}
