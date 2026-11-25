export function createMediaQueryStore(query: string) {
  let mediaQuery: MediaQueryList | null | undefined
  let subscriberCount = 0

  function getMediaQuery(): MediaQueryList | null {
    if (mediaQuery !== undefined) return mediaQuery
    mediaQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(query)
        : null
    return mediaQuery
  }

  return {
    getSnapshot: () => getMediaQuery()?.matches ?? false,
    subscribe(listener: () => void): () => void {
      const media = getMediaQuery()
      if (!media) return () => {}
      subscriberCount += 1
      media.addEventListener('change', listener)
      return () => {
        media.removeEventListener('change', listener)
        subscriberCount -= 1
        if (subscriberCount === 0) mediaQuery = undefined
      }
    },
  } as const
}
