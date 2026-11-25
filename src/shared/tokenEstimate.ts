// QuadChars token estimation (ADR 0015): every 4 printable ASCII characters
// count as one estimated token, every other character counts as one. This is
// OpenRouter's own model-agnostic normalization — adopting it verbatim avoids
// a tokenizer dependency; the ~10–25% error vs native tokenizers is absorbed
// by the 20% budget margin (see docs/foundations/context-layer.md tunables).

export function estimateTokens(text: string): number {
  let printable = 0
  let other = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0x20 && code <= 0x7e) printable += 1
    else other += 1
  }
  return Math.ceil(printable / 4) + other
}
