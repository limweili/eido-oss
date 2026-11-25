import { spawn } from 'node:child_process'

const DEFAULT_TERMINATION_GRACE_MS = 1_000
const MAX_CAPTURED_OUTPUT_BYTES = 16 * 1024

export async function runBoundedNativeBuild({
  command,
  args = [],
  label,
  timeoutMs,
  cwd,
  environment = process.env,
  platform = process.platform,
  terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
  forwardOutput = false,
  allowedExitCodes = [0],
} = {}) {
  if (typeof command !== 'string' || command.length === 0) {
    throw new Error('Bounded native build command is required')
  }
  if (!Array.isArray(args) || args.some(argument => typeof argument !== 'string')) {
    throw new Error('Bounded native build arguments are invalid')
  }
  if (typeof label !== 'string' || label.length === 0) {
    throw new Error('Bounded native build label is required')
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Bounded native build timeout is invalid')
  }
  if (!Array.isArray(allowedExitCodes)
    || allowedExitCodes.length === 0
    || allowedExitCodes.some(code => !Number.isInteger(code))) {
    throw new Error('Bounded native build allowed exit codes are invalid')
  }

  const child = spawn(command, args, {
    cwd,
    env: environment,
    windowsHide: true,
    detached: platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let captured = ''
  const output = { stdout: '', stderr: '' }
  const capture = (source, chunk) => {
    const bytes = Buffer.from(chunk)
    output[source] = appendBounded(output[source], bytes.toString('utf8'))
    captured += `[${source}] ${bytes.toString('utf8')}`
    if (Buffer.byteLength(captured) > MAX_CAPTURED_OUTPUT_BYTES) {
      captured = captured.slice(-MAX_CAPTURED_OUTPUT_BYTES)
    }
    if (forwardOutput) {
      const destination = source === 'stdout' ? process.stdout : process.stderr
      destination.write(bytes)
    }
  }
  child.stdout.on('data', chunk => capture('stdout', chunk))
  child.stderr.on('data', chunk => capture('stderr', chunk))

  const closed = new Promise((resolvePromise) => {
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      resolvePromise(result)
    }
    child.once('error', error => finish({ error }))
    child.once('close', (code, signal) => finish({ code, signal }))
  })
  let deadline
  const outcome = await Promise.race([
    closed.then(result => ({ state: 'closed', result })),
    new Promise(resolvePromise => {
      deadline = setTimeout(() => resolvePromise({ state: 'timeout' }), timeoutMs)
    }),
  ]).finally(() => clearTimeout(deadline))

  if (outcome.state === 'timeout') {
    await terminateProcessTree(child, platform, terminationGraceMs)
    const joined = await waitBounded(closed, terminationGraceMs)
    if (!joined) {
      child.stdout.destroy()
      child.stderr.destroy()
      await waitBounded(closed, terminationGraceMs)
    }
    throw new Error(buildFailureMessage(label, `timed out after ${timeoutMs}ms`, captured))
  }
  if (outcome.result.error) {
    throw new Error(buildFailureMessage(
      label,
      `could not start: ${outcome.result.error.message}`,
      captured,
    ))
  }
  if (!allowedExitCodes.includes(outcome.result.code)) {
    const status = outcome.result.signal ?? `exit ${outcome.result.code}`
    throw new Error(buildFailureMessage(label, `failed with ${status}`, captured))
  }
  return {
    code: outcome.result.code,
    signal: outcome.result.signal,
    stdout: output.stdout,
    stderr: output.stderr,
  }
}

async function terminateProcessTree(child, platform, timeoutMs) {
  if (!Number.isInteger(child.pid) || child.pid <= 0) return
  const terminated = await terminateBoundedProcessTree({
    pid: child.pid,
    platform,
    timeoutMs,
  })
  if (!terminated && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
  }
}

export async function terminateBoundedProcessTree({
  pid,
  platform = process.platform,
  timeoutMs = DEFAULT_TERMINATION_GRACE_MS,
} = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error('Bounded process-tree termination PID is invalid')
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Bounded process-tree termination timeout is invalid')
  }
  if (platform === 'win32') {
    const terminator = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    const outcome = new Promise(resolvePromise => {
      terminator.once('error', () => resolvePromise({ state: 'error' }))
      terminator.once('close', code => resolvePromise({ state: 'closed', code }))
    })
    const finished = await waitBounded(outcome, timeoutMs)
    if (!finished) {
      if (terminator.exitCode === null && terminator.signalCode === null) {
        terminator.kill('SIGKILL')
      }
      await waitBounded(outcome, timeoutMs)
      return false
    }
    const result = await outcome
    return result.state === 'closed' && result.code === 0
  }

  try {
    process.kill(-pid, 'SIGKILL')
    return true
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
    return false
  }
}

function buildFailureMessage(label, reason, captured) {
  const detail = captured.trim()
  return detail.length === 0
    ? `${label} ${reason}`
    : `${label} ${reason}\n${detail}`
}

function appendBounded(current, addition) {
  const combined = current + addition
  return Buffer.byteLength(combined) <= MAX_CAPTURED_OUTPUT_BYTES
    ? combined
    : combined.slice(-MAX_CAPTURED_OUTPUT_BYTES)
}

async function waitBounded(promise, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      promise.then(() => true, () => true),
      new Promise(resolvePromise => {
        timer = setTimeout(() => resolvePromise(false), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
