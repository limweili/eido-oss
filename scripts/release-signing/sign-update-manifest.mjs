// Signs an update manifest with the Eido update-manifest signing key and
// verifies its own output before reporting success (#793, ADR 0032).
//
// Usage:
//   EIDO_UPDATE_MANIFEST_SIGNING_KEY='<PKCS#8 PEM>' \
//     node scripts/release-signing/sign-update-manifest.mjs <manifest-path>
//
// Writes a detached Ed25519 signature to `<manifest-path>.sig`: one base64
// line over the exact manifest bytes, the format electron/updateFeed.ts
// verifies. The private key arrives ONLY through the environment; there is
// deliberately no key-file argument, so a caller (CI or human) can never be
// steered toward reading a key from a path an attacker chose, and the key
// never has to exist on disk in the workflow at all.
//
// After writing, the tool re-reads both files from disk, derives the public
// key from the private key, and verifies the signature it just produced. A
// broken signing step therefore fails loudly here instead of shipping a feed
// that every installed app silently refuses. If
// EIDO_UPDATE_MANIFEST_PUBLIC_KEY_HEX is also set (CI passes the key compiled
// into the app), the derived public key must match it exactly, catching a
// rotated or mispasted secret before an inert manifest is published.

import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export const UPDATE_SIGNING_KEY_ENV = 'EIDO_UPDATE_MANIFEST_SIGNING_KEY'
export const UPDATE_PUBLIC_KEY_ENV = 'EIDO_UPDATE_MANIFEST_PUBLIC_KEY_HEX'

const SIGNATURE_BASE64_PATTERN = /^[A-Za-z0-9+/]{86}==$/

export function signatureAssetPathFor(manifestPath) {
  return `${manifestPath}.sig`
}

// Extracts the raw 32-byte public half from a private key object, as lowercase
// hex, the exact format compiled into electron/updateFeedPublicKey.ts.
export function publicKeyHexFrom(privateKey) {
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
  return Buffer.from(spki.subarray(spki.byteLength - 32)).toString('hex')
}

export async function signUpdateManifest({ manifestPath, privateKeyPem, expectedPublicKeyHex }) {
  let privateKey
  try {
    privateKey = createPrivateKey(privateKeyPem)
  } catch {
    throw new Error(`${UPDATE_SIGNING_KEY_ENV} is not a readable private key`)
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(`${UPDATE_SIGNING_KEY_ENV} is not an Ed25519 key (got ${privateKey.asymmetricKeyType})`)
  }

  const publicKeyHex = publicKeyHexFrom(privateKey)
  if (expectedPublicKeyHex !== undefined && publicKeyHex !== expectedPublicKeyHex.toLowerCase()) {
    throw new Error(
      `Signing key does not match ${UPDATE_PUBLIC_KEY_ENV}: the secret would sign a feed no shipped app trusts`,
    )
  }

  const manifestBytes = await readFile(manifestPath)
  const signaturePath = signatureAssetPathFor(manifestPath)
  const signatureLine = sign(null, manifestBytes, privateKey).toString('base64')
  await writeFile(signaturePath, `${signatureLine}\n`, 'utf8')

  // Self-check from disk, not from memory: prove the bytes a publisher would
  // actually upload verify together under the derived public key.
  const writtenManifest = await readFile(manifestPath)
  const writtenSignatureText = await readFile(signaturePath, 'utf8')
  const writtenLine = writtenSignatureText.split(/\r?\n/, 1)[0]?.trim() ?? ''
  if (!SIGNATURE_BASE64_PATTERN.test(writtenLine)) {
    throw new Error('Self-verification failed: written signature is not a single 64-byte base64 line')
  }
  const publicKey = createPublicKey(privateKey)
  const verified = verify(null, writtenManifest, publicKey, Buffer.from(writtenLine, 'base64'))
  if (!verified) {
    throw new Error('Self-verification failed: written signature does not verify over the written manifest')
  }

  return Object.freeze({ signaturePath, publicKeyHex })
}

async function main(argv) {
  const args = argv.slice(2)
  if (args.length !== 1 || args[0].startsWith('-')) {
    throw new Error('Usage: sign-update-manifest.mjs <manifest-path> (key via environment only)')
  }
  const privateKeyPem = process.env[UPDATE_SIGNING_KEY_ENV]
  if (!privateKeyPem || privateKeyPem.trim() === '') {
    throw new Error(`${UPDATE_SIGNING_KEY_ENV} is not set; the signing key is supplied only via environment`)
  }
  const expectedPublicKeyHex = process.env[UPDATE_PUBLIC_KEY_ENV]

  const result = await signUpdateManifest({
    manifestPath: args[0],
    privateKeyPem,
    expectedPublicKeyHex: expectedPublicKeyHex === undefined || expectedPublicKeyHex.trim() === ''
      ? undefined
      : expectedPublicKeyHex.trim(),
  })
  console.log(`signed: ${result.signaturePath}`)
  console.log(`public-key-hex: ${result.publicKeyHex}`)
  console.log('self-verification: ok')
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main(process.argv).catch((error) => {
    console.error(`sign-update-manifest: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
