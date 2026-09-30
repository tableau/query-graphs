# Plan Formats and Loaders

Query Graphs supports several query-plan formats and is designed so that new ones are cheap to add.
A **loader** transforms a database-specific plan representation into a `TreeDescription`, the format-independent tree model described in the [`query-graphs` README](../query-graphs/README.md).
The public `loadPlanFromText` façade handles syntax parsing and selects the matching loader.
Everything downstream (layout, rendering, interaction) is shared across formats.

## Supported Formats

| Format | Loader (`query-graphs/src/loaders`) | Source shape | How it is obtained |
| --- | --- | --- | --- |
| Postgres | `postgres.ts` | JSON | `EXPLAIN (FORMAT JSON)`, ideally with `ANALYZE` |
| Umbra / CedarDB | `umbra.ts` | JSON | `EXPLAIN (FORMAT JSON)`, ideally with `ANALYZE` |
| DuckDB | `duckdb.ts` | JSON | `EXPLAIN (FORMAT JSON)`, ideally with `ANALYZE` |
| Hyper | `hyper.ts` | JSON | Hyper's `EXPLAIN (FORMAT JSON)`, e.g. via HyperAPI |
| Tableau logical query | `tableau.ts` | XML | Tableau Desktop / Online log files |
| Generic JSON | `json.ts` | JSON | fallback — renders any JSON as a tree |
| Generic XML | `xml.ts` | XML | fallback — renders any XML as a tree |

The Postgres, DuckDB, Umbra/CedarDB, and Hyper loaders understand plan semantics: they choose icons, order and collapse children, label edges with cardinalities, and visualize execution details.
Umbra and CedarDB emit the same operator-tree format, so one loader covers both.
The generic JSON and XML loaders map the input structure literally and act as catch-all fallbacks.

## Loader Dispatch

The app does not ask the user which format they pasted.
Instead, `loadPlanFromText` (`query-graphs/src/loaders/index.ts`) parses JSON once, retaining source offsets, and checks each loader.

Each loader exposes separate `matches` and `load` operations, so format detection does not depend on converter exceptions.
If a matching loader cannot convert the plan, dispatch records the failure and continues with later matching loaders.
If no parser and loader combination succeeds, `InvalidPlanError` contains the collected failures as its cause.

Callers can bypass detection by passing a registered format:

```ts
loadPlanFromText(text, {format: "hyper"});
loadPlanFromText(text, {format: "json"}); // Force literal JSON rendering.
```

Forced dispatch parses only the syntax used by that loader, skips `matches`, and never falls back to another loader.
An unknown name produces `UnknownPlanFormatError`; invalid input produces `InvalidPlanError` with the requested format.
Pass `{sql: queryText}` to add an original-SQL document or override one embedded by the plan loader.
Hyper and Umbra loaders use this exact text to resolve plan-provided SQL positions into source links on tree nodes.
Both formats report UTF-8 byte positions; Hyper uses absolute offsets, while Umbra uses one-based line and column coordinates.

## Adding a New Format

To add support for another database's plans:

1. **Write the loader.**
   Add `query-graphs/src/loaders/<db>.ts` exporting a `PlanLoader`, such as `dbPlanLoader: PlanLoader<Json>` for a JSON format.
   Its `matches` method should recognize the format from a small, stable signature; its `load` method performs the conversion.
   Configure `decorated-json-tree.ts` to map semantic node types, structural children, properties, metrics, and crosslinks while retaining its adaptive fallback for unknown fields.
   Use the existing format loader closest to the new format as a reference and reuse the helpers in `loader-utils.ts` and `tree-postprocessing.ts`.
   JSON loaders implement `JsonPlanLoader` and list every property they may use for JSON source links in `sourcePropertyKeys`; parsing retains positions only for the union of these sets.
2. **Register it** in the matching syntax-specific registry in `query-graphs/src/loaders/index.ts`, positioned so a more specific format is tried before a more permissive one.
3. **Add an example** plan under `standalone-app/examples/<db>/` so it shows up on the `examples.html` page.
   If the format comes from a database that [`plan-dumper`](../plan-dumper/README.md) can drive, add a query there so the example can be regenerated instead of hand-maintained.
4. **Verify** by loading the example in the app; see [`plan-dumper`](../plan-dumper/README.md) for the end-to-end workflow.

The descriptors are also exported from the published library (`@tableau/query-graphs/lib/loaders/<db>`) for callers that already have parsed JSON or XML.
Most embedders should use the `loadPlanFromText` façade instead.
Low-level loaders invoked with parsed JSON and an empty context still work, but their output does not contain source locations.

## Writing a Permissive Loader

Query Graphs values graceful degradation over strictness (see the [project goals](README.md#high-level-project-goals)).
Databases ship plan features on their own cadence, and a plan should still render usefully even when it contains fields the loader has never seen.

A few principles keep a loader permissive:

* **Keep recognition narrow and conversion permissive.**
  `matches` should require only the stable signature needed to distinguish the format.
  Once it has matched, `load` should degrade rather than throw — an unexpected field must never blank the whole graph.
* **Never assume a field is present.**
  Read optional data through the nullable helpers in `loader-utils.ts` (`tryGetPropertyPath`, `tryToString`) instead of indexing directly, so a missing key yields "no value" rather than a crash.
* **Fall back to the adaptive heuristic for anything unknown.**
  Turn an unrecognized scalar into a tooltip `property` and an unrecognized object or array into a child `TreeNode`.
  A brand-new plan field then shows up as *something* the user can inspect, even before the loader understands it.
* **Don't assume a field has a certain type.**
  Check the type of fields before using them.
  If they don't have the expected type, fallback to render the node via an adaptive heuristic.
* **Contain failures to the smallest subtree.**
  Convert nodes independently so one malformed operator degrades to a generic node instead of aborting its siblings.
* **Lean on the generic fallbacks.**
  `json` and `xml` are the ultimate safety net: a plan that no semantic loader recognizes still renders as its literal structure.
