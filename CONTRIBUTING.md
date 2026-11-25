# Contributing to Eido

Eido uses [GPL v3.0](LICENSE). Contributions use the same licence. Keep boards
usable offline. AI and optional search use the person's own
provider credentials or installed AI tools.

Follow the [source setup](README.md#run-from-source) for the desktop app. To
work on the canvas without the native build, use [browser development](README.md#develop-in-a-browser).

Read [CONTEXT.md](CONTEXT.md) and the relevant [foundation document](docs/foundations/README.md)
before changing a layer. UI changes follow the [design system](docs/design/design-system/SYSTEM.md).

Use synthetic data and disposable Profile roots for tests. Keep real Profiles,
provider keys, `.env.local` files, recovery copies, and personal Board exports
out of commits, issues, and pull requests.

Run `npm run check` and `npm run build` before opening a code pull request. For
workflow and release-tool changes, run `npm run test:ci-tools`. See the
[testing guide](docs/codebase/TESTING.md) for focused commands and browser tests.
In the pull request, describe what changed and what you ran to verify it.

[Open an issue](https://github.com/limweili/eido-oss/issues) for bugs or proposals.
Use [private security reporting](SECURITY.md) for vulnerabilities.
