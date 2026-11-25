# Scheme-less website recognition for link previews

**Status:** point-in-time implementation research, 14 August 2026  
**Decision scope:** recognizing a complete pasted clipboard value such as `www.example.com`, `example.co`, or `example.co.uk/path` before sending its normalized `https://` URL through Eido's existing preview pipeline. This is a convenience classifier, not a network- or security-validation boundary.

## Recommendation

Use the browser-standard `URL` parser for syntax and normalization, then use [`tldts`](https://github.com/remusao/tldts/tree/v7.4.9/packages/tldts) as one local, synchronous ICANN-suffix and registrable-domain check for **scheme-less** input. Do not maintain a “top 15 TLD” regex or set.

In outline:

```ts
import { parse } from 'tldts'

function implicitWebUrl(text: string): URL | null {
  if (!text || text.length > LIMIT || /\s/.test(text) || !text.includes('.')) return null

  try {
    const url = new URL(`https://${text}`)
    if (url.username || url.password) return null
    const host = parse(url.hostname, {
      allowPrivateDomains: false,
      extractHostname: false,
      validateHostname: false,
      detectIp: false,
    })
    if (host.isIcann !== true || host.domain === null) return null
    if (looksLikeCommonFilename(text)) return null
    return url
  } catch {
    return null
  }
}
```

Keep Eido's current explicit `http://` and `https://` path separate. A user who supplies a scheme has expressed clear intent, so explicit URLs should continue through the existing protocol, credentials, length, port, DNS/IP, redirect, and fetch protections even when their suffix is reserved, new, or unknown. The ICANN gate is only for inferring intent when the scheme is absent.

Declare `tldts` as a direct production dependency. The package was already present in this checkout only as a development-time transitive dependency of `tough-cookie`; application behavior must not rely on that relationship. Keep the lookup behind Eido's installed-main or local-development boundary rather than importing its suffix data into the renderer bundle. The renderer can reject ordinary text with constant-time shape checks, then ask the local boundary to classify only plausible scheme-less candidates.

## Why this shape

### 1. Parse URLs; do not grow a URL regex

The WHATWG URL Standard defines one parser and host-processing model for web URLs, including ports, paths, queries, fragments, IPv4/IPv6 syntax, and domain-to-ASCII processing for internationalized names. Eido should use the platform `URL` implementation after adding the inferred `https://` scheme instead of reproducing those rules in a regular expression ([WHATWG URL parsing](https://url.spec.whatwg.org/#url-parsing), [host parsing](https://url.spec.whatwg.org/#concept-host-parser), [IDNA](https://url.spec.whatwg.org/#idna)).

This naturally preserves inputs such as:

- `www.example.com`
- `example.co`
- `example.co.uk/path?view=board#card`
- `subdomain.example.com:443/path`
- Unicode domains that the platform converts to their ASCII/Punycode host form

It also gives a single canonical hostname to the suffix lookup. The preview fetch remains `https://` by default; the user can still paste an explicit `http://` URL when required.

### 2. Validate against maintained ICANN suffix rules, not popularity

IANA's Root Zone Database is the authority for delegated top-level domains and includes generic and country-code names such as `.com` and `.uk` ([IANA Root Zone Database](https://www.iana.org/domains/root/db)). Its machine-readable list contained 1,438 entries on 13 August 2026, not fifteen ([IANA TLD list](https://data.iana.org/TLD/tlds-alpha-by-domain.txt)). A popularity-based shortlist would reject ordinary valid websites—Eido's own motivating `.studio` example demonstrates the problem—and would create a product rule with no stable definition of “top.”

A raw TLD set is still insufficient for suffixes such as `co.uk`: it can tell that `.uk` exists but cannot distinguish registrable `example.co.uk` from the public suffix `co.uk` itself. The Public Suffix List exists because registry policies differ and cannot be derived reliably by counting labels ([PSL purpose](https://publicsuffix.org/learn/)). `tldts` packages those rules; `parse(...)` reports whether the prevailing suffix is from the ICANN section and whether the hostname contains a registrable domain. Requiring both `isIcann === true` and non-null `domain` accepts `example.co.uk`, rejects bare `co.uk`, and rejects fallback parsing of unknown suffixes.

Keep `allowPrivateDomains: false`. For this classifier, `foo.blogspot.com` is already a valid scheme-less host because `.com` is delegated; treating `blogspot.com` as a private suffix adds no useful intent signal and can make the provider root itself look non-registrable.

Do **not** substitute the smaller `tldts-icann` package for this boolean gate. Its documented result shape omits the `isIcann` distinction ([`tldts-icann` README, v7.4.9](https://github.com/remusao/tldts/blob/v7.4.9/packages/tldts-icann/README.md)), and direct checks against v7.4.9 found that ordinary single-label suffixes such as `.co` and `.studio` can receive the same null membership marker as `.local` and unknown endings. The full package distinguishes these cases while still ignoring private rules through its option.

### 3. The lookup is offline and cheap

`tldts` ships its suffix data in the package, so paste classification performs no DNS, HTTP, or IPC work. Its maintainers report roughly 0.1–1 microsecond per input and 2–3 million parses per second ([`tldts` README, v7.4.9](https://github.com/remusao/tldts/blob/v7.4.9/packages/tldts/README.md#performance)). Its generated lookup uses compact typed arrays and a right-to-left trie with binary-searched edge hashes; initialization is described in source as a one-time roughly 1 ms pass ([suffix-trie source, v7.4.9](https://github.com/remusao/tldts/blob/v7.4.9/packages/tldts/src/suffix-trie.ts)). These are upstream figures and design claims, not an Eido production benchmark, but they put the work far below a render, DNS lookup, or preview fetch.

Run the classifier only after the existing constant-time checks: trim, length bound, whole-value/no-whitespace requirement, and explicit-scheme branch. There is no reason to scan prose or initialize a general linkifier for a clipboard value that Eido intentionally treats as one object.

The package's list is necessarily a snapshot. The PSL itself warns that static copies become stale as TLDs change and says DNS is authoritative for current existence ([PSL validity warning](https://publicsuffix.org/learn/)). For Eido, runtime DNS validation would harm latency and offline behavior and would duplicate the later preview attempt. The appropriate trade-off is to update the dependency with normal application releases, accept that a newly delegated scheme-less TLD may remain plain text until an update, and always allow the explicit `https://` escape hatch.

## False positives cannot be eliminated by a suffix list

Some common filename extensions are real delegated TLDs. `.md`, for example, is Moldova's country-code TLD, so `README.md` is both a plausible filename and a syntactically registrable domain. Neither IANA data, the PSL, DNS, nor a more elaborate URL regex can infer the user's intent perfectly from that string alone.

Retain a small product-level filename denylist for scheme-less, unadorned values such as `README.md`, `index.html`, `package.json`, and `photo.jpg`. Keep these intent overrides:

- An explicit `http://` or `https://` always wins.
- A `www.` prefix is strong website intent and may bypass the filename heuristic, but never URL parsing or the preview service's security checks.
- A path, query, or fragment after a registrable host is stronger website intent than an unadorned dotted token.
- Prose, whitespace-separated values, email addresses, bare public suffixes, single-label hosts, IP literals, credentials, and unknown suffixes remain on the ordinary text path when no HTTP(S) scheme is present.

The filename list should stay deliberately small and test-led. Trying to enumerate every file extension merely recreates the TLD-maintenance problem in reverse.

## Why not a general linkification library?

[`linkify-it`](https://github.com/markdown-it/linkify-it) is a mature option when links must be extracted from arbitrary prose, and it supports Unicode, fuzzy scheme-less links, and configurable TLD lists. Its own API shows the additional ambiguity: fuzzy links need an allowed-TLD policy, and its defaults accept every two-letter root zone plus a shortlist of named suffixes. Eido has a simpler contract—the entire paste must be one website—so a standard URL parse plus one registrable-domain lookup is smaller conceptually and preserves the existing text-paste boundary.

## Acceptance matrix

| Paste | Expected classification | Reason |
| --- | --- | --- |
| `www.example.com` | `https://www.example.com` | Registrable ICANN domain; strong `www.` intent |
| `example.co` | `https://example.co` | Delegated ccTLD |
| `example.co.uk/a?q=1#b` | Preserved under inferred `https://` | Multi-label public suffix plus registrable label |
| `drybread.studio` | `https://drybread.studio` | Valid delegated gTLD; demonstrates why top-15 is wrong |
| `münchen.de` | Normalized HTTP(S) URL | Platform IDNA plus ICANN suffix data |
| `co.uk` | Text | Public suffix, not a registrable domain |
| `release.unknown` | Text | Unknown suffix and no explicit intent |
| `README.md` | Text | Ambiguous real ccTLD; filename product heuristic wins |
| `www.readme.md` | Website | `www.` is explicit enough to override filename ambiguity |
| `https://release.unknown/path` | Existing explicit-URL behavior | Scheme is explicit; downstream preview boundary decides outcome |
| `See example.com` | Text | Eido only promotes a complete pasted value |
| `hello@example.com` | Text | Email is not a website paste |

## Implementation guardrails

1. Add table-driven unit coverage for common gTLDs, ccTLDs, multi-label suffixes, Unicode/IDN, `www.`, port/path/query/fragment preservation, bare suffixes, unknown suffixes, credentials, emails, filenames, and explicit-URL compatibility.
2. Add one browser-level tracer test proving a scheme-less domain reaches the same preview Card flow as an explicit HTTPS URL. Do not repeat metadata-fetch security tests at this layer.
3. Keep suffix recognition a pure synchronous helper. It must not perform DNS or fetch work and must not become an authorization signal.
4. Measure the production bundle delta with Eido's existing bundle gate after adding the direct dependency; do not turn a microsecond paste-only call into a new hot-path benchmark suite unless the bundle or interaction evidence identifies a real regression.

## Decision

Adopt `URL` + `tldts/parse` with `isIcann === true` and a non-null registrable domain + Eido's narrow filename-intent heuristic. This accepts far more real-world domains than a top-15 list, rejects arbitrary dotted words and bare public suffixes more accurately than the current alphabetic-suffix regex, works offline, and adds negligible per-paste computation while leaving the established preview service as the sole network/security boundary.
