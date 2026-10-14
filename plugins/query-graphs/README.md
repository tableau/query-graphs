# Query Graphs MCP App

The Query Graphs MCP App opens local query plans in the same React and loader-based viewer used by the website.
The plugin package contains a small Node launcher and a release pin; the compiled server and browser UI are downloaded from a matching GitHub Release on first start.

## Install

Use `https://github.com/tableau/query-graphs` as a Git plugin marketplace and choose `query-graphs` from `.agents/plugins/marketplace.json`.
The launcher needs Node.js 24 or newer and network access on its first start.
It verifies the pinned release asset before caching or running it, then reuses the verified cache while offline.
The release tag named in `release.json` must exist before the wrapper can cold-start; the tag workflow publishes that exact pinned asset.

## Tools

`open_query_plan` accepts an optional local `path`, optional `sqlPath`, optional loader `format`, and optional display `title`.
Omit `path` to open the empty viewer, where a user can paste or drop a plan.
The server reads explicit regular files into immutable snapshots, and the app retrieves each file in bounded chunks.
Model-visible results contain display metadata and an opaque handle, never plan contents, SQL, or full local paths.
`read_plan_chunk` is available only to the app UI.
When the Query Graphs theme setting is `System`, the viewer follows the host's light or dark theme; host display-mode changes also update the expand control without remounting the graph.

Each file is limited to 64 MiB, the server retains at most 128 MiB across two snapshots, and an idle snapshot expires after 15 minutes.
These limits bound memory and stale local data; least-recently-used eviction keeps the newest plans available when the cache is full.
The 180 KiB chunk limit keeps base64 tool responses bounded while avoiding an excessive number of bridge calls for large plans.

## Development

Run `pnpm install`, then `pnpm --filter @tableau/query-graphs-plugin... build` to build the core dependency and plugin in workspace dependency order, creating the self-contained runtime in ignored `dist/`.
For local development, run `node plugins/query-graphs/dist/server.mjs` from the repository root with an MCP host.
Run `pnpm --filter @tableau/query-graphs-plugin test` for package contract checks and `pnpm --filter @tableau/query-graphs-plugin typecheck` for TypeScript checks.

## Prepare A Release

Run `pnpm --filter @tableau/query-graphs-plugin prepare-release -- 0.1.1` with the next version on a release branch.
This rebuilds the deterministic JSON asset and updates `package.json`, the plugin manifest, and `release.json` with the asset's byte count, SHA-256, and `plugin-v<version>` tag.
Commit those changes, push the commit, and push the matching `plugin-v<version>` tag pointing to that commit.
The tag workflow rebuilds the asset, verifies the committed pin and tag, then publishes only `query-graphs-plugin.json` to the GitHub Release.
After the workflow publishes the asset, merge the version and pin changes to `main` so marketplace installs never reference an unpublished release.
No release is created by the local build.
