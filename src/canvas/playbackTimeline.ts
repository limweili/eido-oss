const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value))

const normalizeEventCount = (eventCount: number) => Math.max(0, Math.trunc(eventCount))

export function playbackEventIndexAtProgress(eventCount: number, progress: number): number {
  const count = normalizeEventCount(eventCount)
  if (count === 0) return 0
  if (count === 1) return 1
  const clampedProgress = clamp(progress, 0, 1)
  return Math.min(count, Math.floor(clampedProgress * (count - 1) + Number.EPSILON) + 1)
}

export function playbackProgressForEventIndex(eventIndex: number, eventCount: number): number {
  const count = normalizeEventCount(eventCount)
  if (count <= 1) return 0
  const clampedIndex = clamp(Math.trunc(eventIndex), 1, count)
  return (clampedIndex - 1) / (count - 1)
}
