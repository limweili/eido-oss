# WAL read concurrency evidence

Measured: 2026-07-22 with the repository-pinned Node 24.12.0 `node:sqlite`
runtime, using only databases created under a disposable temporary directory.

## Question

Can the Phase 0 CLI open a second SQLite connection and read a WAL snapshot
while the GUI owns the installed Profile, or must it report `busy` until the
live-owner socket transport lands?

## Production posture

Eido does not use ordinary WAL ownership. The installed Profile runtime sets
`journal_mode = WAL` and retains `locking_mode = EXCLUSIVE` in
`electron/sqliteRuntime.ts`. The owner lease is an additional guard; this
measurement isolates the underlying SQLite behavior so the transport decision
does not rest on assumption.

## Measurement

Two synthetic databases were initialized with the same table and row. Their
owner connections stayed open while a second read-only connection attempted a
`SELECT`:

1. ordinary WAL, without retained exclusive locking;
2. WAL followed by `locking_mode = EXCLUSIVE` and a committed immediate
   transaction, matching Eido's retained lock posture.

Observed output:

```text
ordinary-wal=read:known
eido-exclusive-wal=blocked:ERR_SQLITE_ERROR:database is locked
```

The temporary directory and both synthetic databases were removed immediately
after the measurement. No installed Profile path or user data was opened.

## Decision

Ordinary WAL can serve a concurrent snapshot read, but Eido's actual exclusive
owner posture cannot. Phase 0 therefore keeps the existing single-owner lease
and raw exit taxonomy: when the GUI owns the Profile, direct headless CLI reads
report `busy`. Safe live reads require the authenticated app-owned socket/named
pipe planned for Phase 1; Phase 0 must not add a second SQLite-reader loophole.
