# Query Graphs Developer Documentation

This folder is the entry point for anyone — human or agent — hacking on Query Graphs.
It documents cross-cutting topics (architecture, build, plan formats).
Details that belong to a single module live in that module's `README.md`, linked below.

Start with [Architecture](Architecture.md) for the big picture, then jump to the module you care about.

## High-Level Project Goals

* Human-readable, intuitive interface
* Handle **large** query plans. This implies:
  * Performance: loading, graph-layouting, etc. must be performant even for huge query plans
  * Use screen real estate wisely: even for large graphs, allow people to grasp the high-level overview quickly
* Be permissive, degrade gracefully:
  Database systems (Hyper, Postgres, ...) ship new features on their own cadence, independent of whether query-graphs is ready or not.
  We should still be able to render their query plans nicely.
  Even if parts of the tree don't render well, other parts should still be rendered properly.
* No backwards compatibility:
  Database systems might ship breaking changes to their plan format.
  We focus on the latest version, and don't guarantee backwards compatibility.
  Short-lived shims for very recent format changes are fine (the Hyper loader carries a few), but we don't maintain them indefinitely.

On a technical level:
* stay on up-to-date toolchains
* adopt new web browser features aggressively (JavaScript / CSS / HTML / ...)

## Cross-Cutting Topics

* [Architecture](Architecture.md) — the different modules, how they fit together, and the "plan text → graph" pipeline.
* [Build and Deployment](BuildAndDeployment.md) — building the monorepo, running the dev/prod servers, and how the public site is deployed.
* [Plan Formats and Loaders](PlanFormatsAndLoaders.md) — the supported plan formats, how a format is detected, and how to add support for a new one.

## Module Documentation

* [`query-graphs`](../query-graphs/README.md) — the core library: plan loaders, the internal tree model, and the React/react-flow renderer.
* [`standalone-app`](../standalone-app/README.md) — the shell around the core library: opening files, sharing, and the deployed web app.
* [`upload-server`](../upload-server/README.md) — an optional server that turns an uploaded plan into a shareable link.
* [`plan-dumper`](../plan-dumper/README.md) — scripts that regenerate the committed example plans, and how to verify plan-rendering changes end-to-end.

## Documentation Conventions

These conventions apply to all Markdown files and source-code comments in this repository:

* Write in American English, be concise, and prefer precise references (e.g. name the `loadPlan` function rather than "the loader function").
* Use title case in headings, and put each sentence on its own line — this keeps GitHub diffs readable.
* Embed diagrams directly with Mermaid so they render on GitHub.
* Document processes and architecture that span modules here in `docs/`; keep module-specific detail in the module `README.md` and cross-reference rather than duplicate.
* A source comment must earn its place: explain the non-obvious *why*, describe the current state rather than the change, and do not restate the code.
