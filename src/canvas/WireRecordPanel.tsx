// The human-readable face of Board Info's wire record (#968). It lives under
// the toggle in Settings and shows the same entries the console reads through
// window.__EIDO_WIRE_RECORD__, so a person can answer "did that run call a
// tool?" without opening a console. It polls rather than subscribes, like the
// renderer counters overlay: a diagnostic must never make the thing it
// observes busier.

import { useEffect, useState } from 'react'
import {
  clearWireRecord,
  readWireRecord,
  type WireRecordEntry,
} from '../shared/wireRecord'
import { words } from '../shared/words'
import { Button } from '../ui/primitives'

export const WIRE_RECORD_POLL_INTERVAL_MS = 1_000

function kindLabel(kind: WireRecordEntry['kind']): string {
  switch (kind) {
    case 'request': return words.wireRecordKindRequest
    case 'call': return words.wireRecordKindCall
    case 'result': return words.wireRecordKindResult
    case 'failure': return words.wireRecordKindFailure
  }
}

// One entry as one line. The fields carry the meaning; this only orders them.
function entryBody(entry: WireRecordEntry): string {
  const address = `${entry.host ?? ''}${entry.path ?? ''}`
  switch (entry.kind) {
    case 'request': {
      // Only a provider request carries a declaration list; its emptiness is
      // the fact worth a word of its own.
      if (!entry.toolNames) return address
      const tools = entry.toolNames.length
        ? `${words.wireRecordToolsLead} ${entry.toolNames.join(', ')}`
        : words.wireRecordNoTools
      return [address, tools, entry.briefIncluded ? words.wireRecordBriefSent : '']
        .filter(Boolean)
        .join(' · ')
    }
    case 'call':
      return `${entry.tool ?? ''} ${entry.args ?? ''}`.trim()
    case 'result':
      return [entry.tool ?? address, `${entry.ms ?? 0} ms`, `${entry.size ?? 0} chars`, entry.outcome ?? '']
        .filter(Boolean)
        .join(' · ')
    case 'failure':
      return [entry.tool ?? address, entry.status ? `http ${entry.status}` : '', entry.outcome ?? '']
        .filter(Boolean)
        .join(' · ')
  }
}

// HH:MM:SS from the entry's ISO timestamp; the date adds nothing to a record
// that dies with the tab.
function timeOf(at: string): string {
  const parsed = new Date(at)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toTimeString().slice(0, 8)
}

export function WireRecordPanel({
  read = readWireRecord,
}: {
  read?: () => readonly WireRecordEntry[]
}) {
  const [entries, setEntries] = useState<readonly WireRecordEntry[]>(() => read())

  useEffect(() => {
    const interval = window.setInterval(() => setEntries(read()), WIRE_RECORD_POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [read])

  return (
    <div className="wire-record">
      <div className="wire-record__bar">
        {entries.length === 0 ? (
          <p className="t-hint">{words.wireRecordEmptyHint}</p>
        ) : (
          <Button
            onClick={() => {
              clearWireRecord()
              setEntries(read())
            }}
          >
            {words.wireRecordClear}
          </Button>
        )}
      </div>
      {entries.length > 0 && (
        <ol className="wire-record__list" aria-label={words.settingsWireRecordLabel}>
          {/* The kind is a chip and may shout in small caps; the time and the
              body are evidence and keep their exact case, because an entry
              shown uppercased is not the entry that was recorded. */}
          {entries.map((entry, index) => (
            <li className="wire-record__row" key={`${entry.at}-${index}`}>
              <span className="wire-record__time t-value">{timeOf(entry.at)}</span>
              <span className={`wire-record__kind wire-record__kind--${entry.kind} t-micro`}>
                {kindLabel(entry.kind)}
              </span>
              <span className="wire-record__body t-value">{entryBody(entry)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
