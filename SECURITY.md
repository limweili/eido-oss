# Security

Report security vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/limweili/eido-oss/security/advisories/new).
If that form is unavailable, open an issue asking for a private reporting
channel without including exploit details, credentials, or private data.

Include the Eido version or source commit, operating system, affected feature,
and steps to reproduce the issue with synthetic data. Keep real Profiles,
API keys, private provider responses, and storage credentials out of reports.

Eido stores boards locally. OpenRouter and optional Linkup requests use your
own credentials. Link previews fetch public pages and preview images.
Coding CLIs you select can contact their provider under your login.
Eido collects no product analytics. The [privacy policy](https://eido.so/privacy)
describes what each recipient receives.

Keep provider keys private and revoke a key at its provider if it is exposed.
Downloaded releases should come from Eido's documented release channels.
