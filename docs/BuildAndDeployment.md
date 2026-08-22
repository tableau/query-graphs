# Build and Deployment

This document covers building the monorepo locally, running the webserver during development, and how the public site is deployed.

## Prerequisites

Use [pnpm](https://pnpm.io/), not npm.
The repository is a pnpm workspace monorepo; the workspace members are listed in `pnpm-workspace.yaml`.

## First Build

```shell
git clone https://github.com/tableau/query-graphs.git
cd query-graphs
pnpm install
pnpm -r build
pnpm --filter query-graphs-app prod-server
```

Then open [localhost:8080](http://localhost:8080).

## Build Order: `query-graphs` Before `standalone-app`

The `standalone-app` imports the core library from `@tableau/query-graphs/lib/…`, i.e. from the library's **compiled** output in `query-graphs/lib/`, not from its TypeScript sources.
`pnpm --filter @tableau/query-graphs build` runs `tsc` and copies the CSS into `lib/`.

`pnpm -r build` builds every module in dependency order, so it already builds `query-graphs` before `standalone-app` — you don't need to sequence them by hand.

The practical consequence: **changes inside `query-graphs/src` are not visible to the app until you rebuild the library.**
When editing the core library, re-run its `build` script (or a `tsc --build --watch`) so the app picks up your changes.
Changes inside `standalone-app/src` do not have this problem — the dev server recompiles them on save.

## Development and Production Servers

Both commands are run from inside `standalone-app`:

* `pnpm dev-server` — webpack dev server on `localhost:8080` with hot reload; use this while developing.
* `pnpm prod-server` — serves the already-built `dist/` folder via `http-server`; use this to sanity-check a production build.

`pnpm build` produces the production bundle in `standalone-app/dist/`.

## Linting

We use ESLint with Prettier.
Run `pnpm run lint` from the repository root to fix issues automatically, or `pnpm run lint-test` to only report them (this is what CI runs).

## Continuous Integration and Deployment

CI is defined in [`.github/workflows/ci.yaml`](../.github/workflows/ci.yaml) and runs on every push and pull request.
It installs dependencies, runs `lint-test`, then builds every module with `pnpm -r build` (which builds `query-graphs` before `standalone-app`).

On pushes to `main`, the same workflow deploys `standalone-app/dist/` to GitHub Pages, which serves [tableau.github.io/query-graphs](https://tableau.github.io/query-graphs/).
