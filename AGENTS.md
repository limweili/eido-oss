# Working on Eido

- Start with [CONTRIBUTING.md](CONTRIBUTING.md) and [CONTEXT.md](CONTEXT.md).
- Use the supported Node and npm versions in `package.json`. Run `npm run check` for application changes and `npm run test:ci-tools` for CI or release changes.
- Use synthetic Boards and disposable Profiles for tests. The installed SQLite Profile and keys belong to the person using the app.
- Keep Boards, exports, and local CLI and MCP access usable offline. Online activity supports OpenRouter, web tools, website previews, and the coding CLI the person chooses for an AI run.
