# Plan Formats and Loaders

Query Graphs supports several query-plan formats and is designed so that new ones are cheap to add.
A **loader** is a function that takes raw plan text and returns a `TreeDescription` — the format-independent tree model described in the [`query-graphs` README](../query-graphs/README.md).
Everything downstream (layout, rendering, interaction) is shared across formats.

## Supported Formats

| Format | Loader (`query-graphs/src/loaders`) | Source shape | How it is obtained |
| --- | --- | --- | --- |
| Postgres | `postgres.ts` | JSON | `EXPLAIN (FORMAT JSON)`, ideally with `ANALYZE` |
| Umbra / CedarDB | `umbra.ts` | JSON | `EXPLAIN (FORMAT JSON)`, ideally with `ANALYZE` |
| Hyper | `hyper.ts` | JSON | Hyper's `EXPLAIN (FORMAT JSON)`, e.g. via HyperAPI |
| Tableau logical query | `tableau.ts` | XML | Tableau Desktop / Online log files |
| Generic JSON | `json.ts` | JSON | fallback — renders any JSON as a tree |
| Generic XML | `xml.ts` | XML | fallback — renders any XML as a tree |

The Postgres, Umbra/CedarDB, and Hyper loaders understand plan semantics: they choose icons, order and collapse children, label edges with cardinalities, and visualize execution details.
Umbra and CedarDB emit the same operator-tree format, so one loader covers both.
Their loader and Hyper share the adaptive operator/expression converter in `adaptive-plan-tree.ts`.
The generic JSON and XML loaders map the input structure literally and act as catch-all fallbacks.

## Loader Dispatch

The app does not ask the user which format they pasted.
Instead, `loadPlanFromText` (`query-graphs/src/loaders/plan.ts`) parses JSON once and tries each semantic JSON loader in order:

```ts
const jsonPlanLoaders = [loadPostgresPlan, loadUmbraPlan, loadHyperPlan];
```

A loader signals "this is not my format" by throwing.
Valid JSON that no semantic loader recognizes is passed to the generic JSON loader.
Non-JSON input is tried as Tableau XML and then generic XML; if every loader fails, `loadPlanFromText` reports the de-duplicated messages.

**Order matters.**
Postgres and Hyper plans are both JSON, so the Postgres loader — which checks for a distinctive signature (a top-level `Plan` object containing a `Node Type`) — is tried *before* the more permissive Hyper loader.
The generic `json`/`xml` loaders come last so a recognized format always wins over the literal fallback.

## Adding a New Format

To add support for another database's plans:

1. **Write the loader.**
   Add `query-graphs/src/loaders/<db>.ts` exporting a `load<Db>FromText(text: string): TreeDescription`.
   Parse the text, then recursively convert each source node into a `TreeNode`: set `name`, pick an `icon` from the `IconName` union, put scalar attributes into `properties` (shown in the tooltip), and put real children into `children`/`collapsedChildren`.
   Use `hyper.ts` as the reference implementation and reuse the helpers in `loader-utils.ts`.
   Formats using `operator`/`expression` tags should reuse `adaptive-plan-tree.ts`; see `umbra.ts`.
   Throw an `Error` when the input is not your format, so dispatch can fall through to the next loader.
2. **Register it** in `query-graphs/src/loaders/plan.ts`, positioned so a more specific format is tried before a more permissive one.
3. **Add an example** plan under `standalone-app/examples/<db>/` so it shows up on the `examples.html` page.
   If the format comes from a database that [`plan-dumper`](../plan-dumper/README.md) can drive, add a query there so the example can be regenerated instead of hand-maintained.
4. **Verify** by loading the example in the app; see [`plan-dumper`](../plan-dumper/README.md) for the end-to-end workflow.

The same loaders are exported from the published library (`@tableau/query-graphs/lib/loaders/<db>`), so a new format is immediately available to embedders too.

## Writing a Permissive Loader

Query Graphs values graceful degradation over strictness (see the [project goals](README.md#high-level-project-goals)).
Databases ship plan features on their own cadence, and a plan should still render usefully even when it contains fields the loader has never seen.

A few principles keep a loader permissive:

* **Throw only to reject a format, not to reject a field.**
  A loader throws during dispatch to signal "this is not my format" (see [Loader Dispatch](#loader-dispatch)).
  Once it has committed to a format, it should degrade rather than throw — an unexpected field must never blank the whole graph.
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
