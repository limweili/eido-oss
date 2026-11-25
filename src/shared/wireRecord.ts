// Board Info's wire record (#968): an opt-in, local, in-memory account of what
// a run did on the wire, so "the tools were never declared", "declared and the
// model called none", "a call was refused", and "a call succeeded and returned
// nothing useful" stop looking identical from a Result Card. Answering that
// question used to require hand-patching window.fetch from a console.
//
// This is inert observation. Entries live in this module's memory and die with
// the tab: nothing here reaches the Profile document, writes a file, or makes
// a network call. Only the on/off preference is stored, and it lives with the
// other device settings in renderer storage (ui/wireRecordPreference.ts).
//
// The seam is deliberately one module in shared/: the AI provider boundary
// (brain/openRouter.ts) and the reach boundary (brain/linkup.ts) call the
// same few record functions, and the web boundary records at its one shared
// network edge, so a later endpoint routed through that edge is recorded
// without knowing this module exists.
//
// No credential can enter an entry. The one place a key travels on these
// requests is a header, and no function here accepts headers: a URL is reduced
// to host and pathname, and everything else recorded is a name, a count, or a
// string the caller already shows the model. wireRecord.test.ts proves a
// recorded run leaks no key material even when every request carried one.

// One thing that happened on the wire. A flat shape rather than a union so
// console.table(window.__EIDO_WIRE_RECORD__.entries()) reads well; `kind`
// says which optional fields are meaningful.
export type WireRecordEntry = Readonly<{
  // Wall-clock ISO time. Buffer order is arrival order.
  at: string
  // 'request': something left for a host. 'call': the model asked for a tool.
  // 'result': a call or web request finished. 'failure': one was refused or
  // never arrived.
  kind: 'request' | 'call' | 'result' | 'failure'
  // Where a request went or failed: host and pathname only, never a header,
  // never a query string.
  host?: string
  path?: string
  // On a provider request: the tool names declared on it (empty array means a
  // request that declared none, which is one of the four cases this record
  // exists to separate), and whether the travelling brief rode in the prompt.
  // Absent entirely on requests that are not to the AI provider.
  toolNames?: readonly string[]
  briefIncluded?: boolean
  // On a model tool call and its result: the tool's name and the arguments
  // exactly as the model wrote them, capped.
  tool?: string
  args?: string
  // On a result: how long it took and how big the answer was, in characters
  // of the text handed onward.
  ms?: number
  size?: number
  // How it went: 'ok', or a failure kind ('rate-limited', 'bad-key',
  // 'unknown-tool', ...). Never a response body.
  outcome?: string
  // On a failure that got an answer: the HTTP status. 0 when nothing answered.
  status?: number
}>

// A ring: the newest WIRE_RECORD_MAX_ENTRIES win. A long investigation runs to
// tens of wire calls at three or four entries each, so 200 holds several full
// runs side by side; with every kept string capped below, the worst-case
// buffer is around half a megabyte, which a diagnostic may cost and a long
// run cannot grow.
export const WIRE_RECORD_MAX_ENTRIES = 200

// The only string an entry keeps that the model authors is a tool call's
// arguments. 2,000 characters shows the whole argument object of any sane
// call (queries run a few hundred) and truncates only a pathological blob.
export const WIRE_RECORD_MAX_STRING = 2_000

// The whole cost of "off": this stays null, every record function returns on
// its first check, and no buffer exists to grow. Callers that would do work
// just to build an argument (a Date.now() pair, say) ask isWireRecording()
// first; callers passing values they already hold just call.
let entries: WireRecordEntry[] | null = null

export function isWireRecording(): boolean {
  return entries !== null
}

// Flips the buffer itself, not a flag beside it. Turning the record off drops
// every entry, deliberately: off means no buffer, and the entries were always
// going to die with the tab anyway.
export function setWireRecording(on: boolean): void {
  entries = on ? entries ?? [] : null
}

export function clearWireRecord(): void {
  if (entries) entries.length = 0
}

export function readWireRecord(): readonly WireRecordEntry[] {
  return entries ? [...entries] : []
}

function push(entry: WireRecordEntry): void {
  if (!entries) return
  entries.push(entry)
  if (entries.length > WIRE_RECORD_MAX_ENTRIES) {
    entries.splice(0, entries.length - WIRE_RECORD_MAX_ENTRIES)
  }
}

function capString(value: string): string {
  return value.length > WIRE_RECORD_MAX_STRING ? value.slice(0, WIRE_RECORD_MAX_STRING) : value
}

// A URL becomes host and pathname, and only those. Query and hash are dropped
// unread, and a string that does not parse as a URL records as nothing at
// all, because a string this module cannot classify could be anything.
function hostAndPath(url: string): { host: string; path: string } {
  try {
    const parsed = new URL(url)
    return { host: parsed.host, path: parsed.pathname }
  } catch {
    return { host: '', path: '' }
  }
}

// The declared tool names, from either declaration shape this app sends: an
// Eido-executed function tool carries its name under `function.name`, a
// provider server tool is named by its `type`. Anything else contributes
// nothing rather than a guess.
function declaredToolNames(tools: unknown): string[] {
  if (!Array.isArray(tools)) return []
  const names: string[] = []
  for (const raw of tools) {
    const tool = raw as { type?: unknown; function?: { name?: unknown } } | null
    const name =
      typeof tool?.function?.name === 'string' && tool.function.name
        ? tool.function.name
        : typeof tool?.type === 'string'
          ? tool.type
          : ''
    if (name) names.push(name)
  }
  return names
}

// A request to the AI provider: what was declared on it is the fact this
// record exists for. `tools` is the request body's own declaration list,
// passed by reference so the off path allocates nothing.
export function wireRecordProviderRequest(url: string, tools: unknown, briefIncluded: boolean): void {
  if (!entries) return
  push({
    at: new Date().toISOString(),
    kind: 'request',
    ...hostAndPath(url),
    toolNames: declaredToolNames(tools),
    briefIncluded,
  })
}

// Any other request that leaves the machine, recorded at the shared network
// edge that sends it.
export function wireRecordRequest(url: string): void {
  if (!entries) return
  push({ at: new Date().toISOString(), kind: 'request', ...hostAndPath(url) })
}

// A tool call as the model made it, before any judgment about whether an
// executor claims the name or the arguments parse.
export function wireRecordToolCall(tool: string, args: string): void {
  if (!entries) return
  push({ at: new Date().toISOString(), kind: 'call', tool: capString(tool), args: capString(args) })
}

// What a tool call came to: duration, size of the text handed to the model,
// and an outcome word ('ok', 'failed', 'unknown-tool', ...).
export function wireRecordToolResult(tool: string, ms: number, size: number, outcome: string): void {
  if (!entries) return
  push({ at: new Date().toISOString(), kind: 'result', tool: capString(tool), ms, size, outcome })
}

// A web request that answered: duration and the size of the body that came
// back. The body itself is never kept.
export function wireRecordWebResult(url: string, ms: number, size: number): void {
  if (!entries) return
  push({ at: new Date().toISOString(), kind: 'result', ...hostAndPath(url), ms, size, outcome: 'ok' })
}

// A request that was refused or never answered: the status and the failure
// kind, never the response body (#968).
export function wireRecordFailure(url: string, status: number, outcome: string): void {
  if (!entries) return
  push({ at: new Date().toISOString(), kind: 'failure', ...hostAndPath(url), status, outcome })
}

// ---- reading it from the page ------------------------------------------------

export type WireRecordRuntime = Readonly<{
  entries: () => readonly WireRecordEntry[]
  clear: () => void
}>

declare global {
  interface Window {
    /** Read-only wire diagnostics for Board Info (#968). In-memory, local. */
    __EIDO_WIRE_RECORD__?: WireRecordRuntime
  }
}

// Installed once at boot beside the renderer counters runtime, so a console or
// an agent driving the app can read the buffer without opening Settings. The
// reader is exposed whether or not recording is on: an empty record is an
// honest answer.
export function installWireRecordRuntime(recordingOn: boolean): void {
  setWireRecording(recordingOn)
  window.__EIDO_WIRE_RECORD__ = { entries: readWireRecord, clear: clearWireRecord }
}
