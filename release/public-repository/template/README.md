# Eido releases

This is Eido's **public-but-unadvertised** binary release repository. Public
means that links may be forwarded or discovered; it is not access control.

Every full release is one exact certified pair: macOS arm64 and Windows x64.
Both installers must be present for that publication.
A correction may publish only the affected platform under a higher version,
with an explicit release record naming the platform, source, and hashes. The
Alpha installers are deliberately unsigned, so the download page explains the
macOS Open Anyway and Windows SmartScreen steps before installation.

Every release records its exact public source commit, SHA-256 installer
checksums, certification reference, and release notes. To install a corrected
build, return in your browser, download the newer installer, and reinstall it;
your Profile remains separate from the app. The existing updater path remains
in Eido, but this Alpha publishes no updater manifest/checksum assets. Without
those feed inputs the updater remains dormant and cannot discover, download, or
launch a new installer. `SHA256SUMS.txt` is release-integrity evidence, not an
updater input.

Eido does not collect automatic telemetry. Support reports must exclude saved
Ideas, Card text, prompts, assets, API keys, credentials, and private filesystem
paths.

Eido is free and open source under GNU GPL version 3 only. The source lives at
[limweili/eido](https://github.com/limweili/eido). This repository distributes
installers independently of the source repository. Every release links its
exact source commit and source archive, including the build scripts needed to
build that version. See [the source and license notice](SOURCE_AND_LICENSE_NOTICE.md)
and [the license](LICENSE). AI and web search use each user's own provider API keys.
