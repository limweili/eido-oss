# Eido Research 2 — Toolcraft Source Intake

> Status: point-in-time source intake, 2026-07-13. No Toolcraft app was built or run for this study.

## Bottom Line

`@pixel-point/toolcraft` does not currently identify a public source repository. The npm package has no `repository`, `homepage`, or `bugs` metadata, and a point-in-time search of Pixel Point's public GitHub repositories returns no Toolcraft repository. The canonical public artifact behind `npx @pixel-point/toolcraft create` is therefore the published npm package, currently `0.0.14`, rather than a cloneable Git repository. [Package metadata](https://unpkg.com/@pixel-point/toolcraft@0.0.14/package.json) · [Pixel Point GitHub search](https://api.github.com/search/repositories?q=toolcraft%20org%3Apixel-point)

Eido's local reference is at `research/repos/toolcraft/`. It was generated on 2026-07-13 with:

```bash
npx --yes @pixel-point/toolcraft@0.0.14 create toolcraft --name toolcraft --yes --no-install --no-skills
```

This is a generated, version-pinned source snapshot, not an upstream Git checkout. It contains the starter plus copied Toolcraft runtime/UI source, but not the complete CLI package source or upstream history. The directory is covered by Eido's existing `research/repos/` gitignore rule and should remain local.

## How `create` Sources a Project

The CLI does not clone or download a separate starter repository after launch. The npm tarball itself contains `templates/starter`, `templates/runtime`, `templates/ui`, Toolcraft workflow skills, CLI source, tests, and the custom license. [Published tarball](https://registry.npmjs.org/@pixel-point/toolcraft/-/toolcraft-0.0.14.tgz) · [CLI README](https://unpkg.com/@pixel-point/toolcraft@0.0.14/README.md)

For a published-package run, the generator:

1. Resolves its source directories to those three embedded template folders.
2. Copies the starter into the target directory.
3. Copies UI and runtime sources into `src/toolcraft/ui` and `src/toolcraft/runtime`.
4. Removes copied runtime/UI test files, rewrites imports and starter names, writes an integrity manifest, and generates the target `package.json` and `tsconfig.json`.

The source also has a monorepo-development path (`starter`, `packages/ui/src`, and `packages/toolcraft-runtime/src`), but falls back to the embedded npm templates when those sibling paths are absent. This strongly suggests an unpublished upstream monorepo; it does not establish a public canonical repository. [Generator source](https://unpkg.com/@pixel-point/toolcraft@0.0.14/src/generate.mjs)

By default, `create` then installs app dependencies and invokes the bundled `skills` CLI to install Toolcraft workflow skills. The intake command deliberately disabled both side effects with `--no-install --no-skills`. [CLI source](https://unpkg.com/@pixel-point/toolcraft@0.0.14/src/cli.mjs)

## What Is Worth Studying

The [Pixel Point article](https://pixelpoint.io/blog/how-to-craft-personal-design-tools-with-toolcraft/) describes Toolcraft as more than a component library: it combines a canvas/control shell, local editable components, schema/runtime conventions, AI instructions, acceptance checks, export behavior, and performance testing. The highest-value Eido seams in this snapshot are therefore:

- the schema-to-control/runtime boundary;
- canvas sizing, zoom, panel, and export contracts;
- how `AGENTS.md` and `docs/toolcraft/` constrain agent behavior;
- acceptance and performance matrices as executable product contracts;
- the integrity manifest that discourages accidental edits to copied framework code.

## License and Archival Caveats

Toolcraft uses the custom **Toolcraft Designer License**, not an open-source license. It permits personal, educational, internal evaluation, and designer client work. Pixel Point retains ownership of the CLI, starter, runtime, UI, documentation, and copied Toolcraft source. It prohibits standalone redistribution or resale and requires a separate commercial license for uses including paid AI software, AI design tools, app/website builders, code-generation platforms, template marketplaces, and competing generators. [Toolcraft Designer License](https://unpkg.com/@pixel-point/toolcraft@0.0.14/LICENSE.md)

Consequences for Eido:

- Keeping the version-pinned snapshot locally under gitignored `research/repos/` is aligned with internal evaluation.
- Do not commit, publish, mirror, or redistribute the snapshot as if it were an open-source repository.
- Research findings and architectural observations can be committed; copied Toolcraft source should remain local.
- Reusing Toolcraft code in an Eido product could fall within the license's restricted AI-software/design-tool categories and should be cleared with Pixel Point before implementation.

The npm package is still `0.0.x` and has released frequently: `0.0.2` appeared on 2026-06-23 and `0.0.14` on 2026-07-09. Future research should record the exact package version and tarball integrity rather than treat `latest` as a stable archival identifier. For `0.0.14`, npm reports integrity `sha512-ysncByTrcM/hdbUVuILjDIel52K4/CA7MfyGMKsye8ZqpG0392+kDeT9ImhCk5Ff4uWhrGzN6hOE36M6q5pB/A==`. [Registry history and integrity](https://registry.npmjs.org/%40pixel-point%2Ftoolcraft)

## Provenance URLs

- Article: <https://pixelpoint.io/blog/how-to-craft-personal-design-tools-with-toolcraft/>
- npm package: <https://www.npmjs.com/package/@pixel-point/toolcraft>
- Versioned package contents: <https://unpkg.com/browse/@pixel-point/toolcraft@0.0.14/>
- Versioned tarball: <https://registry.npmjs.org/@pixel-point/toolcraft/-/toolcraft-0.0.14.tgz>
- Public GitHub organization: <https://github.com/pixel-point>
