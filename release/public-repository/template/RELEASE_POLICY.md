# Release policy

Alpha releases obey these controls:

- Every release starts as a draft containing
  its exact certified macOS arm64 and Windows x64 installers, checksums,
  public source commit, certification evidence, and release note before
  publication.
- Alpha installers are unsigned: macOS is ad-hoc signed only and
  Windows has no Authenticode signature. The download page documents the
  operating-system first-open steps without presenting unsigned bytes as
  authenticated publisher output.
- Published releases and their tags are immutable. A version or tag is never
  reused, even after rejection or deletion.
- Candidate and final installers are the same verified bytes. Publication never
  rebuilds or replaces an artifact.
- The paired-platform requirement applies to every full
  release. A correction may contain only the affected platform, but it must
  use a higher version and an explicit release record naming the platform,
  source, reason, and hashes.
- Drafts and prereleases are ignored by the download page. It links only the
  final release returned by GitHub's `releases/latest` endpoint.
- The release record links the exact public source commit and source archive
  at https://github.com/limweili/eido, names GNU GPL version 3 only, and records
  artifact digests. That source includes the build scripts for the released
  version. Source traceability does not by itself claim a reproducible build.
- Updates on both platforms use a manual browser download and reinstall. The
  existing updater path stays in the app but remains dormant because this Alpha
  publishes no updater manifest/checksum assets. It therefore cannot discover,
  download, or launch a new installer. `SHA256SUMS.txt` is release-integrity
  evidence, not an updater input. A correction is a new immutable version,
  never a replacement asset.
- Profile data, Portable Exports, credentials, private filesystem paths, and
  signing material never belong in this repository or its release assets.
  Source and build instructions belong in the public source repository; this
  delivery repository links the exact commit for each binary release.
