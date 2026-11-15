/** Display weights only; these do not represent observations between dates. */
export function observationBlend(position: number, count: number) {
  const value = Math.max(0, Math.min(Number.isFinite(position) ? position : 0, Math.max(0, count - 1)))
  const index = Math.floor(value)
  const nextIndex = Math.min(index + 1, Math.max(0, count - 1))
  const fraction = value - index
  const targetOpacity = 0.8 * fraction
  return { index, nextIndex, fraction, targetOpacity, sourceOpacity: 0.8 * (1 - fraction) / (1 - targetOpacity) }
}
