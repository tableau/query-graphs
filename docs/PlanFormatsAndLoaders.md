# Plan Formats and Loaders

Query Graphs supports several query-plan formats and is designed so that new ones are cheap to add.
A **loader** tranforms a database-specific plan representation into a `TreeDescription`, the format-independent tree model described in the [`query-graphs` README](../query-graphs/README.md).
The public `loadPlanFromText` façade handles syntax parsing and selects the matching loader.
Everything downstream (layout, rendering, interaction) is shared across formats.

## Supported Formats

| Format | Loader (`query-graphs/src/loaders`) | Source shape | How it is obtained |
| --- | --- | --- | --- |
| Postgres | `postgres.ts` | JSON | `EXPLAIN (FORMAT JSON)`, ideally with `ANALYZE` |
| Hyper | `hyper.ts` | JSON | Hyper's `EXPLAIN (FORMAT JSON)`, e.g. via HyperAPI |
| Tableau logical query | `tableau.ts` | XML | Tableau Desktop / Online log files |
| Generic JSON | `json.ts` | JSON | fallback — renders any JSON as a tree |
| Generic XML | `xml.ts` | XML | fallback — renders any XML as a tree |

The Postgres and Hyper loaders understand plan semantics: they choose icons, order and collapse children, label edges with cardinalities, and color nodes by runtime.
The generic JSON loader renders scalar fields as tooltip properties and nested values as tree nodes, without format-specific decorations or collapsed children.
The generic XML loader maps the input structure literally.
Both act as catch-all fallbacks.

## Loader Dispatch

The app does not ask the user which format they pasted.
Instead, `loadPlanFromText` (`query-graphs/src/loaders/index.ts`) parses JSON once and checks each semantic JSON loader in order:

```ts
const jsonPlanLoaders = [postgresPlanLoader, hyperPlanLoader, jsonPlanLoader];
```

Each loader exposes separate `matches` and `load` operations, so format detection does not depend on converter exceptions.
If a matching loader cannot convert the plan, dispatch records the failure and continues with later matching loaders.
If no parser and loader combination succeeds, `InvalidPlanError` contains the collected failures as its cause.

Callers can bypass detection by passing a registered format:

```ts
loadPlanFromText(text, {format: "hyper"});
loadPlanFromText(text, {format: "json"}); // Force generic JSON-tree rendering.
```

Forced dispatch parses only the syntax used by that loader, skips `matches`, and never falls back to another loader.
An unknown name produces `UnknownPlanFormatError`; invalid input produces `InvalidPlanError` with the requested format.

## Adding a New Format

To add support for another database's plans:

1. **Write the loader.**
   Add `query-graphs/src/loaders/<db>.ts` exporting a `PlanLoader`, such as `dbPlanLoader: PlanLoader<Json>` for a JSON format.
   Its `matches` method should recognize the format from a small, stable signature; its `load` method performs the conversion.
   Recursively convert each source node into a `TreeNode`: set `name`, pick an `icon` from the `IconName` union, put scalar attributes into `properties` (shown in the tooltip), and put real children into `children`/`collapsedChildren`.
   Use `hyper.ts` as the reference implementation and reuse the helpers in `loader-utils.ts`.
2. **Register it** in the matching syntax-specific registry in `query-graphs/src/loaders/index.ts`, positioned so a more specific format is tried before a more permissive one.
3. **Add an example** plan under `standalone-app/examples/<db>/` so it shows up on the `examples.html` page.
   If the format comes from a database that [`plan-dumper`](../plan-dumper/README.md) can drive, add a query there so the example can be regenerated instead of hand-maintained.
4. **Verify** by loading the example in the app; see [`plan-dumper`](../plan-dumper/README.md) for the end-to-end workflow.

The descriptors are also exported from the published library (`@tableau/query-graphs/lib/loaders/<db>`) for callers that already have parsed JSON or XML.
Most embedders should use the `loadPlanFromText` façade instead.

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
  `json` and `xml` are the ultimate safety net: a plan that no semantic loader recognizes still renders as an inspectable tree.
