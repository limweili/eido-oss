// One-time keypair generation for the update-manifest signing key (#793,
// ADR 0032). Run ONLY as part of the documented key ceremony:
// docs/release/update-signing-key-ceremony.md.
//
// Prints both halves to stdout and writes NOTHING to disk. The ceremony
// decides where each half goes: the private PEM becomes a GitHub Actions
// secret in the private repository plus an offline backup outside GitHub; the
// public hex is pasted into electron/updateFeedPublicKey.ts. Losing the
// private key permanently ends updates for every installed copy, because the
// matching public key is compiled into them.

import { generateKeyPairSync } from 'node:crypto'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { publicKeyHexFrom, UPDATE_SIGNING_KEY_ENV } from './sign-update-manifest.mjs'

export function generateUpdateSigningKey() {
  const { privateKey } = generateKeyPairSync('ed25519')
  return Object.freeze({
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKeyHex: publicKeyHexFrom(privateKey),
  })
}

function main(argv) {
  if (argv.length > 2) {
    throw new Error('generate-update-signing-key.mjs takes no arguments')
  }
  const { privateKeyPem, publicKeyHex } = generateUpdateSigningKey()
  console.log('== Eido update-manifest signing key (ceremony use only) ==')
  console.log('')
  console.log(`PRIVATE half: value of the ${UPDATE_SIGNING_KEY_ENV} secret and of the offline backup.`)
  console.log('Never commit it, paste it into an issue, or store it in any GitHub surface but the secret:')
  console.log('')
  console.log(privateKeyPem.trimEnd())
  console.log('')
  console.log('PUBLIC half: paste into UPDATE_FEED_PUBLIC_KEY_HEX in electron/updateFeedPublicKey.ts:')
  console.log('')
  console.log(publicKeyHex)
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  try {
    main(process.argv)
  } catch (error) {
    console.error(`generate-update-signing-key: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
