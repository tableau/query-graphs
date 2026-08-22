# Query Graphs — Agent Guide

Query Graphs visualizes database query plans as interactive graphs, entirely in the browser.
Start at [docs/README.md](docs/README.md) — the entry point for all developer documentation.

## Where to Look

* [Architecture](docs/Architecture.md) — the different modules and the "plan text to graph" pipeline.
* [Build and Deployment](docs/BuildAndDeployment.md) — building the monorepo, running the dev/prod servers, and how the site is deployed.
* [Plan Formats and Loaders](docs/PlanFormatsAndLoaders.md) — the supported plan formats and how to add a new one.
* Module-specific details live in each module's `README.md`: [`query-graphs`](query-graphs/README.md), [`standalone-app`](standalone-app/README.md), [`upload-server`](upload-server/README.md), and [`plan-dumper`](plan-dumper/README.md).

## Gotcha

`standalone-app` imports the core library from its compiled output in `query-graphs/lib/`, not from its TypeScript sources.
Changes in `query-graphs/src` are not visible to the app until you rebuild the library with `pnpm --filter @tableau/query-graphs build`.
