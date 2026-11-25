# Phase 0 fresh-agent transcript

Captured: 2026-07-22 from a disposable unpacked macOS application produced by
the checked-in Electron Builder configuration. The packaged
`Contents/Resources/bin/eido` shim was invoked with no arguments and no Profile
path, environment hint, or prior CLI context.

Command:

```text
$ Eido Shell Proof.app/Contents/Resources/bin/eido
```

Exit: `0`

Transcript:

```text
Eido is a local visual thinking board. This command reads the installed Eido Profile through the bounded Agent Gateway; it never accepts a Profile path or storage credentials.

Start here:
  eido describe                    Print every installed operation schema, bound, and failure.
  eido describe <operation>        Describe one operation (for example graph.query).

Read commands:
  eido status
  eido capabilities
  eido idea list [list options]
  eido graph query <filters>
  eido record get <record-id-or-Card-Deep-Link>
  eido mod-template list [list options]

Raw compatibility:
  eido batch                       Pass one complete Gateway envelope from stdin unchanged.

Common options:
  --pretty                         Indent a command's JSON for a human reader.
  --limit N  --byte-limit N  --cursor VALUE  --projection FIELD

Graph filters:
  --kind KIND  --card ID_OR_LINK  --idea ID_OR_LINK  --parent ID_OR_LINK

A Card Deep Link looks like eido://app/?idea=...&card=.... Its card and Idea identities are authoritative; viewport x/y/zoom values are ignored hints.

Machine output is the normalized Gateway JSON envelope unless --pretty is supplied. Failures keep the installed raw JSON mode's exit-code taxonomy.
```

## Friction note

The bare command answers the minimum zero-context questions in one screen:
what Eido is, what the CLI can do, how to discover exact schemas, what is safe
to pass, and what machine callers receive. It exposed one packaging-specific
friction during the run: the initial shim assumed the production executable was
literally named `Eido`, while proof packages use a different product filename.
The shim now resolves the sole executable inside the sealed app's `MacOS`
directory and fails closed if that boundary is ambiguous; the packaged rerun
above is the passing transcript.

This is the minimum Phase 0 orientation check. The broader independent
zero-context acceptance journey across the full epic remains owned by #722.
