// The Ed25519 public half of the update-manifest signing key (#793, ADR 0032).
//
// This value is compiled into every shipped app and cannot be changed on
// machines already in the field. The private half never exists in this
// repository: it is generated once by the founder in the key ceremony
// (docs/release/update-signing-key-ceremony.md), stored as a secret in the
// private repository, and backed up offline outside GitHub before first use.
//
// While this constant is empty the key is unprovisioned and every manifest is
// refused, so an installed app behaves exactly as if the feed were
// unreachable: silence, no prompt. That is the intended fail-closed state
// until the ceremony has been performed and the real public key pasted here.
//
// Format: 64 lowercase hex characters: the raw 32-byte Ed25519 public key,
// exactly as printed by scripts/release-signing/generate-update-signing-key.mjs.
export const UPDATE_FEED_PUBLIC_KEY_HEX = '4cc4447cd1b1f850bc64da18a32b016bdf97eb5a728c9691070c463e2723ec37'
