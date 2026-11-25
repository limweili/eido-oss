# Update-Manifest Signing Key Ceremony

One-time procedure. The founder performs it by hand, once, before the first
signed Update Manifest is ever published (#793, ADR 0032). No agent generates,
sees, or stores this key.

## What this key is

Every shipped Eido carries the public half of this key compiled into it
(`electron/updateFeedPublicKey.ts`). The app refuses any Update Manifest not
signed by the private half. Windows artifacts are deliberately unsigned, so on
Windows this signature is the only thing standing between a compromised
release repository and code execution on a user's machine.

Two facts drive every step below:

- **Losing the private key permanently ends updates** for everyone already
  installed. There is no remote repair; each person would have to reinstall by
  hand. This is why the offline backup happens before first use, not after.
- **Leaking the private key hands an attacker the ability to sign manifests**
  that every installed app will trust. Key rotation is not built (it needs a
  transition release trusting both keys), so a leak means shipping a new
  release line. Treat the private half like the root credential it is.

## Preconditions

- You are on your own Mac, on a terminal that does not log or sync its
  scrollback (no shared tmux, no session recorders, no screen sharing).
- You have two offline storage media ready for the backup (for example two USB
  drives you own, or one drive plus paper in a safe). Neither is a cloud
  location, and neither is GitHub in any form: not a private repo, not a gist,
  not an issue, not a draft.
- The repository is checked out and `node` is available.

## Steps

### 1. Generate the keypair

From the repository root:

```sh
node scripts/release-signing/generate-update-signing-key.mjs
```

It prints two things and writes nothing to disk:

- the **private half**, a PEM block (`-----BEGIN PRIVATE KEY-----` ...)
- the **public half**, a 64-character hex string

Keep this terminal open until step 5 is complete. Everything below copies from
this output.

### 2. Make the offline backup first, before any use

Copy the private PEM to both offline media. Then prove the backup is real:
open each copy and compare it character-for-character against the terminal
(for a paper copy, read it back). An unverified backup is not a backup.

Store the media in separate physical places. Done means: two verified offline
copies exist, outside GitHub and outside any cloud.

### 3. Store the private half as a repository secret

In the **private** repository `limweili/eido` (never `eido-releases`):

Settings -> Environments -> `release-publish` -> Environment secrets (or Repository secrets):

- Name: `UPDATE_SIGNING_KEY` (and `EIDO_UPDATE_MANIFEST_SIGNING_KEY`)
- Value: the full private PEM, including the BEGIN and END lines

The publishing workflow (#978) reads it from the `release-publish` environment. No release ever handles
the key manually after this.

### 4. Compile the public half into the app

Open `electron/updateFeedPublicKey.ts` and set the empty constant to the
64-character hex string:

```ts
export const UPDATE_FEED_PUBLIC_KEY_HEX = '<public hex from step 1>'
```

Commit through a normal PR. This is public information; only the private half
is secret. Until this lands in a shipped release, installed apps refuse all
manifests, which is the intended fail-closed state.

Also add the same hex as a repository **variable** (not secret)
`EIDO_UPDATE_MANIFEST_PUBLIC_KEY_HEX`, so the signing step can prove the
secret it holds matches the key apps trust, and fail the release if they ever
drift.

### 5. Prove the roundtrip

Sign a scratch manifest with the key exactly as CI will:

Read the key with `read -rs` rather than typing it on a command line. A shell
records every command line it runs, assignments included, and `~/.zsh_history`
outlives the terminal window, syncs, and lands in backups. Pasting the root
signing key onto a command line writes it to disk in plain text.

```sh
read -rs -d '' EIDO_UPDATE_MANIFEST_SIGNING_KEY
```

Paste the private PEM, then press Ctrl-D. Nothing is echoed. Then:

```sh
export EIDO_UPDATE_MANIFEST_SIGNING_KEY
read -r EIDO_UPDATE_MANIFEST_PUBLIC_KEY_HEX
export EIDO_UPDATE_MANIFEST_PUBLIC_KEY_HEX
echo '{"probe":true}' > /tmp/ceremony-probe.json
node scripts/release-signing/sign-update-manifest.mjs /tmp/ceremony-probe.json
rm -f /tmp/ceremony-probe.json /tmp/ceremony-probe.json.sig
unset EIDO_UPDATE_MANIFEST_SIGNING_KEY EIDO_UPDATE_MANIFEST_PUBLIC_KEY_HEX
```

Expected output ends with `self-verification: ok`, and the printed
`public-key-hex` equals the value you compiled in step 4. Any mismatch or
error: stop, and restart the ceremony from step 1 with a fresh keypair (the
current one has never been used, so it can simply be discarded).

### 6. Clean up

- Close the terminal session, then check that the key did not reach shell
  history: `grep -c 'PRIVATE KEY' ~/.zsh_history` must print `0`. If it does
  not, remove the offending lines and consider the key compromised; restart
  the ceremony with a fresh keypair rather than hoping.
- Clear the clipboard by copying something harmless over it.
- Clear the terminal scrollback (Cmd+K in Terminal/iTerm).
- Confirm no file on the machine contains the private PEM (`/tmp`, editors,
  clipboard managers). The generator never writes files, so anything found
  was created by hand in this session.
- The private half now exists in exactly three places: the GitHub secret and
  the two offline backups. If it exists anywhere else, delete it.

## Do not run this ceremony until #977 has landed

Freshness enforcement (ADR 0032 decision 0) ships in #977. Until it is in a
released build, a signed manifest proves origin but not currency, so a party
who can publish could replay an old signed manifest to freeze an installation
at its current version or to erase a recall it has not yet seen.

That costs nothing while the compiled key is empty, because no manifest
verifies at all. It becomes permanent the moment a Release ships with a
provisioned key and no freshness check: those installs cannot be fixed by a
later update, because the update is exactly what an attacker can suppress.

Run the ceremony after #977 is merged, not before.

## After the ceremony

- The secret is used only by the publishing workflow (#978); no human touches
  the key during a release.
- If the key is ever exposed, or a backup is lost, record it and raise it
  immediately: the response (new key plus transition release, or accepted
  risk) is a founder decision, and speed matters more than tidiness.
