// One bounded process runner for the signing lanes.
//
// Every command a signing lane runs is deadline-bounded and never throws on a
// nonzero exit: a lane decides for itself which failures are expected (a DMG
// that is genuinely unsigned) and which are fatal. `runChecked` is the fatal
// form and names a stable failure code instead of leaking a command transcript,
// because these lanes run with credential material on the host.

import { spawn } from 'node:child_process'

export function runCommand(command, args, {
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = 30_000,
} = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ code, stdout, stderr })
    }
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', () => finish(null))
    child.on('close', (code) => finish(code))
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      finish(null)
    }, timeoutMs)
  })
}

export async function runChecked(command, args, { code, ...options } = {}) {
  const result = await runCommand(command, args, options)
  if (result.code !== 0) {
    const failure = new Error(code ?? 'command-failed')
    failure.code = code ?? 'command-failed'
    throw failure
  }
  return result
}
