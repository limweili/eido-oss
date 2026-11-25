// What the provider actually charged, set against what Eido estimated for the
// same bytes (#1035).
//
// Every context decision in Eido rests on QuadChars (ADR 0015): four printable
// characters count as one token. It is model-agnostic and free, and it is
// wrong by 10-25% depending on what the text is made of. Wrong low is the
// dangerous direction: a conversation the estimator reads as 68% of the window
// while the model's own tokenizer reads it as 85% sails past the compaction
// threshold and into a refusal, which is the exact failure compaction exists to
// prevent.
//
// OpenRouter reports real usage in the last frame of every stream, counted with
// the serving model's own tokenizer, without being asked. That number is the
// truth about a request Eido has already estimated, so the two together give
// the estimator's error for this model, on this kind of content, right now. One
// ratio per model, applied to every later estimate.
//
// Held in memory only, deliberately. The ratio is relearned on the first turn
// of any session at no cost, whereas a bad one written to the device would keep
// steering every future run on that model with nothing to correct it.

// Below this, a sample says more about the per-message envelope than about the
// text, and a short prompt's ratio would be noise applied to long ones.
const MIN_SAMPLE_TOKENS = 1_000

// A ratio outside these bounds is not a tokenizer difference, it is a mismatch:
// a request whose real content never reached the estimator, or a usage figure
// that counted something else. Believing it would move the threshold further
// from the truth than leaving the estimate alone.
const MIN_RATIO = 0.5
const MAX_RATIO = 3

const ratios = new Map<string, number>()

// The freshest sample wins rather than an average of all of them. A model's
// error depends on what is being sent, and the most recent request is the
// closest thing to what the next one will carry.
export function recordTokenCalibration(model: string, estimated: number, actual: number): void {
  if (!model) return
  if (!Number.isFinite(estimated) || estimated < MIN_SAMPLE_TOKENS) return
  if (!Number.isFinite(actual) || actual <= 0) return
  const ratio = actual / estimated
  if (ratio < MIN_RATIO || ratio > MAX_RATIO) return
  ratios.set(model, ratio)
}

// An estimate corrected by what this model was last seen to charge. With no
// sample yet, the estimate stands exactly as it always has.
export function calibratedTokens(model: string, estimated: number): number {
  const ratio = ratios.get(model)
  return ratio ? Math.ceil(estimated * ratio) : estimated
}

export function tokenCalibrationFor(model: string): number | undefined {
  return ratios.get(model)
}

export function resetTokenCalibrationForTests(): void {
  ratios.clear()
}
