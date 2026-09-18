# Plan Formats and Loaders

Query Graphs supports several query-plan formats and is designed so that new ones are cheap to add.
A **loader** is a descriptor that recognizes and converts one parsed input format into a `TreeDescription` — the format-independent tree model described in the [`query-graphs` README](../query-graphs/README.md).
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
The generic JSON and XML loaders map the input structure literally and act as catch-all fallbacks.

## Loader Dispatch

The app does not ask the user which format they pasted.
Instead, `loadPlanFromText` (`query-graphs/src/loaders/index.ts`) parses JSON once and checks each semantic JSON loader in order:

```ts
const jsonPlanLoaders = [postgresPlanLoader, hyperPlanLoader, jsonPlanLoader];
```

Each loader exposes separate `matches` and `load` operations, so format detection does not depend on converter exceptions.
Once a loader matches, conversion failures are reported as `InvalidPlanError` instead of silently falling through to another format.
Valid JSON that no semantic loader recognizes is handled by the generic JSON loader.
Non-JSON input is parsed as XML once, then checked against the Tableau and generic XML loaders.
Input that is neither JSON nor XML produces a `PlanSyntaxError` containing both syntax failures.
If a loader must reject malformed content, `InvalidPlanError` identifies the selected format.
Other converter exceptions are unexpected programming failures and propagate unchanged instead of being disguised as invalid user input.

**Order matters.**
Postgres and Hyper plans are both JSON, so the Postgres loader — which checks for the distinctive top-level `Plan` object — is tried *before* the more permissive Hyper loader.
The generic `json`/`xml` loaders come last so a recognized format always wins over the literal fallback.

Callers can bypass detection by passing a registered format:

```ts
loadPlanFromText(text, {format: "hyper"});
loadPlanFromText(text, {format: "json"}); // Force literal JSON rendering.
```

Forced dispatch parses only the syntax used by that loader, skips `matches`, and never falls back to another loader.
An unknown name produces `UnknownPlanFormatError`; invalid syntax produces `PlanSyntaxError` with the expected syntax and requested format.

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
  `json` and `xml` are the ultimate safety net: a plan that no semantic loader recognizes still renders as its literal structure.
