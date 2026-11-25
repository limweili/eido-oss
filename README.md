# Eido

Eido is a local-first thinking whiteboard. Put notes, images, and questions on a
canvas, then connect cards to shape the context an AI run sees. Results stay on
the board alongside the cards that informed them. You can revisit older results
and replay changes to the board.

Eido is free and open source under the [GNU General Public License v3.0](LICENSE).
You can work on boards, export your Profile, and access boards from the CLI
or MCP offline without an account. Eido collects no product analytics.

## Run from source

The desktop build is tested on Apple silicon Macs and Windows x64. Install Git,
Node 24 or Node 26 (26.9 or later), and npm 11. On a Mac, install the Xcode Command Line Tools (`xcode-select
--install`). On Windows, install Visual Studio Build Tools with the **Desktop
development with C++** workload. The desktop build uses the C compiler for a
small helper that connects the local CLI to the running app.

```sh
git clone https://github.com/limweili/eido-oss.git
cd eido-oss
npm ci
npm start
```

After `npm ci` installs the dependencies, `npm start` builds and opens the
Electron app with the local SQLite Profile.
The Profile lives at `Eido/profiles/default/eido-profile.sqlite` under your
platform's application data directory. A source build uses the same local
Profile as the installed app.

If you package Eido or run `npm run desktop:smoke`, use a current [official
Node.js distribution](https://nodejs.org/en/download) from either supported
line. Packaging uses Node's single executable application support to bundle the
standalone CLI.

## Connect an AI provider

Open **Settings → AI Models** to add your OpenRouter API key or select a supported
AI tool you already use on your computer. Eido supports Claude Code, Codex, and
Antigravity. These tools use their own login and may send prompts and files to
their provider when you run them. You can also add a Linkup key for web search
and research. Your providers set and bill their own charges.

On an Ask AI card, the globe enables web search for that run. With a Linkup key
you can also choose Research mode, which can submit a longer job to Linkup. The
result shows the sources and tool steps available to Eido. Pasting a public URL
on the canvas can fetch a preview from the website and its image hosts.

To install or update Eido, get the latest build from [eido.so](https://eido.so/#download).

## Develop in a browser

Run `npm run dev` and open the URL Vite prints. This mode uses a local JSON file
or IndexedDB for development and does not use the desktop SQLite Profile. Set
`EIDO_DATA_FILE` to a disposable path such as `.local/dev-board.json` when you
want a fresh test board.

```sh
npm run check           # Toolchain policy, TypeScript, and application tests
npm run build           # Production renderer build
npm run test:browser    # Browser interaction suite
npm run desktop:smoke   # Disposable native smoke proof on macOS arm64 or Windows x64
```

## Contribute

- [Contributing guide](CONTRIBUTING.md) and [security reporting](SECURITY.md)
- [Architecture and source layout](docs/README.md)
- [Testing commands](docs/codebase/TESTING.md)
- [Local CLI and MCP](docs/agents/eido-cli.md)
