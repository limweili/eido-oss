export function isStressMaxWithinControlEnvelope(
  controlMaxMs: number,
  stressMaxMs: number,
  cadenceMs: number,
) {
  return stressMaxMs <= Math.max(controlMaxMs + cadenceMs * 2 + 2, controlMaxMs * 1.5)
}
