# `query-graphs` — Core Library

The `query-graphs` library is the heart of the project: it parses query plans from several databases into one internal tree model and renders that model as an interactive graph using React and [react-flow](https://reactflow.dev/).
It is published to npm as `@tableau/query-graphs` and is consumed by the [`standalone-app`](../standalone-app/README.md), but it can also be embedded into other tools.

This library has no user interface of its own for opening files or sharing — that shell lives in the `standalone-app`.
To see changes in a running UI, rebuild the library and use the app's dev server (see [Build and Deployment](../docs/BuildAndDeployment.md)).

The library provides:

* **The tree model** — `TreeDescription` and `TreeNode` (`src/tree-description.ts`), the format-independent contract between loaders and the renderer.
* **Format loaders** — `duckdb.ts`, `hyper.ts`, `umbra.ts`, `postgres.ts`, `tableau.ts`, and the generic `json.ts`/`xml.ts` fallbacks (`src/loaders/`), each recognizing and converting parsed input into a `TreeDescription`.
  `loaders/index.ts` provides shared format detection and dispatch for applications using the library.
* **The renderer** — lays out and draws the tree; in `src/ui/`.
* **Interaction state** — a Zustand store (`src/ui/store.ts`) tracking the graph state (expanded nodes, the measured node sizes, ...).

## The Tree Model

`TreeDescription` (`src/tree-description.ts`) is the single abstraction that decouples "which database produced this plan" from "how it is drawn".
Every loader outputs one; the renderer only ever consumes one.

* `TreeDescription` — the whole graph: a `root` `TreeNode`, optional `metadata` (`PropertyEntry` rows like a node's `properties`, shown in the top-level label), an optional metadata highlight, optional text documents, and optional `crosslinks`.
* `TextDocument` — a named text artifact associated with the graph, identified by a stable `id` and optionally tagged with its language.
* `TreeNode` — one node. Notable fields:
  * `name`, `icon`, `iconColor`, `nodeColor` — what the node looks like.
  * `properties` — a `Map` of `PropertyEntry` rows shown in the node's detail panel.
    An entry's `value` is a string, a number, or a nested `Map` (an expandable group).
    Numbers stay numbers and are only formatted when rendered, as chosen by the entry's `numberFormat` (`rounded`, `exact`, `memory-bytes`, `time-seconds`), which `applyNumberFormats` infers from words in the property name (rows, memory, time, ...); unset shows the raw number.
  * `children` vs `collapsedChildren` — see [The Collapse/Expand Model](#the-collapseexpand-model).
  * `edgeLabel`, `edgeWidth`, `edgeClass` — decorate the incoming edge (e.g. cardinality labels).
  * `sourceLocations` — optional half-open UTF-16 ranges linking the node to associated text documents.
* `Crosslink` — an extra `source → target` edge between nodes that are related but not parent/child (e.g. a CTE and its scan).
* `IconName` — the set of icons the renderer knows how to draw (joins, scans, sort, group-by, …), realized as SVG in `NodeIcon`.

Two helpers walk the tree: `visitTreeNodes` (recursive traversal) and `allChildren` (children plus collapsed children).

## Format Loaders

Each loader converts a source format into a `TreeDescription`; see [Plan Formats and Loaders](../docs/PlanFormatsAndLoaders.md) for the format list, dispatch order, how to add a new one, and [how to keep a loader permissive](../docs/PlanFormatsAndLoaders.md#writing-a-permissive-loader) on unfamiliar input.

The DuckDB, Hyper, Umbra/CedarDB, and Postgres loaders share an **adaptive conversion heuristic**: a scalar value (string/number/boolean) becomes a tooltip `property`, while a nested object or array becomes a child `TreeNode`.
This keeps simple attributes compact in the tooltip while still exposing structure as the tree.
`decorated-json-tree.ts` implements this as a configurable JSON-tree conversion.
The generic JSON loader uses it without semantic node types or collapsed children.
Hyper additionally configures operator/expression classification, node rendering, child ordering, collapsing, metric extraction, and crosslinks:

* It classifies a node as an operator or an expression from its `operator` / `expression` key, then looks up per-type rendering (icon, display name, crosslink source) in `nodeRenderingConfig`.
* It enforces a meaningful child order (`input`/`left`/`right`/… before alphabetical) so a join's inputs read left-to-right.
* It converts in two passes: first build the tree, then post-process to resolve crosslinks, compute edge widths, and color nodes by runtime.

Shared post-processing helpers resolve crosslinks and scale edge widths. Hyper's pipeline visualization lives separately in `pipeline-coloring.ts`.

Shared parsing/formatting helpers live in `loader-utils.ts` (`tryToString`, `jsonToPropertyEntry`, `getScalarProperty`/`getNumericProperty`, `applyNumberFormats`, `tryGetPropertyPath`, the `Json` type).

The library intentionally exposes low-level loaders (`json`, `xml`) as generic fallbacks so that even an unrecognized plan renders as *something* rather than an error.

JSON loaded through `loadPlanFromText` retains source provenance.
Each JSON loader advertises the property keys it may use to identify nodes, and the dispatcher passes their union to a single streaming parse.
That parse constructs ordinary JSON values while retaining positions only for the requested keys.
The decorated-tree conversion by default links each identifying key and value (`operator`, `expression`, `Node Type`, and similar fields) to the resulting `TreeNode`.
Calling a loader with a `JSON.parse` result is also supported, but cannot produce source locations.

## The Renderer

`QueryGraph` (`src/ui/QueryGraph.tsx`) is the top-level component rendering a `TreeDescription`.
It assigns a stable id to every node, creates a graph-local rendering store seeded from each node's `expandedByDefault` flag, and retains the node dimensions measured by react-flow.

`tree-layout.ts` positions the tree with [`d3-flextree`](https://github.com/Klortho/d3-flextree) on top of `d3-hierarchy`, then translates the result into react-flow nodes and edges.
Layout is driven by the **measured** DOM size of each node, so it runs in two passes: react-flow measures new nodes after their first render, then the tree re-lays-out with the correct sizes.
Those measurements are retained in the controlled node objects so react-flow does not re-initialize them on every layout.
Edge thickness is scaled from `edgeWidth`, and `crosslinks` are added as extra edges.

`QueryNode` (`src/ui/QueryNode.tsx`) draws a single node.
`NodeIcon` (`src/ui/NodeIcon.tsx`) maps each `IconName` to a hand-drawn SVG (the join icons, for instance, are two overlapping circles whose fills encode inner/left/right/full).
`CollapsiblePanel` (`src/ui/CollapsiblePanel.tsx`) is a reusable panel for graph overlays and other secondary content.
`CopyButton` (`src/ui/CopyButton.tsx`) copies text with temporary success or failure feedback and an accessible status announcement.

### Making Large Graphs Approachable

Query plans are large, so the library aggressively hides detail by default and lets the user drill in.
Initially, only the high-level tree shape is shown; the user can zoom and expand the interesting part of the tree.
This also keeps large plans fast: collapsed subtrees are not laid out or rendered until expanded, so the initial render stays cheap even for plans with thousands of operators.

Most nodes are collapsed by default.
The initial state is expressed entirely through `TreeDescription`:

* A node's `children` are always laid out; its `collapsedChildren` are hidden until the subtree is expanded.
* `expandedByDefault` seeds the initial state — loaders set it so that, for example, operator sub-trees start collapsed while expression sub-trees start open.
* `properties` are hidden in the tooltip/detail panel and only shown when the node itself is expanded.

The loaders decide what goes where; the renderer and store just react to those decisions.

### Crosslinks, Cardinalities, and Coloring

These are the touches that make a plan readable at a glance:

* **Crosslinks** connect related-but-distant nodes — a magic join to its builder, a CTE scan to the CTE, a temp-table scan to the temp table. Loaders record them by an operator id and they are resolved into `Crosslink`s after the tree is built.
* **Cardinality edge labels** show `actual/estimated` row counts, and the edge is highlighted (`qg-label-highlighted`) when the estimate is off by more than 10×, which is exactly what you look for when debugging a bad plan.
* **Edge width** is scaled to the number of tuples flowing along an edge, so hot data paths are visually thick.
* **Node color** is a pink shade proportional to a node's share of total runtime, drawing the eye to the expensive operators.

### Interaction State

Each `QueryGraph` owns a [Zustand](https://github.com/pmndrs/zustand) store holding its mutable rendering state, so multiple graphs do not interfere with one another.
It tracks three things, and the distinction between the first two is the key subtlety:

* `expandedNodes` — which nodes have their **property detail panel** open.
* `expandedSubtrees` — which nodes reveal their **`collapsedChildren`** in the graph.
* `nodeDimensions` — react-flow's measurements, retained across controlled-node layout updates.

When loaders provide source locations, hovering a graph node highlights its ranges and hovering or moving the cursor through a document highlights the narrowest matching graph nodes.
SQL locations come from database-provided offsets; JSON loaders link identifying keys and scalar values rather than broad container ranges.
Locations on collapsed nodes resolve to their closest visible ancestors.

### Plan Insights

Plan Insights are being developed incrementally.
This section describes the intended design, including parts that are not implemented yet.

Plan Insights provide high-level summaries of query plans.
The design includes the following types of insights:

* **Top-K lists** rank nodes by a metric (for example, "top operators by CPU cycles", "top operators by rows produced", or "top scans by rows processed").
* **Node groups** highlight all nodes that match a predicate (for example, "unselective scans" or "operators with misestimated cardinalities").
* **Category lists** partition matching nodes by the distinct values of one property (for example, "scan type: native, iceberg, parquet" or "join type: inner, left-outer, full-outer").

Insights are rendered in a "Plan Insights" panel.
Hovering or focusing an insight entry highlights every matching graph node and its linked SQL and JSON ranges;
hovering a graph node or linked source range highlights the corresponding insight entries.
Insights reuse this transient linked-highlight mechanism rather than assigning persistent colors to nodes.
A node can therefore participate in several insight definitions without creating conflicting color assignments.

Insight definitions are config-driven and live outside the loaders.
They operate on the property bags of tree nodes produced by the loaders.
Each definition selects nodes and describes how to summarize them.
For example, the scan-type category list is configured as:

```ts
{
    id: "scan-types",
    title: "Scan types",
    where: {property: "operator", equals: "scan"},
    groupBy: "type",
}
```

For now, the definitions are hard-coded in `query-graphs/src/insights/presets.ts`.
The standalone app selects definitions using the detected plan format.
A future UI could allow users to configure their own insights directly.

## Tech Debt

* `tsconfig.json` disables `strict` (and several related checks) with `TODO`s to tighten them; new code should still be written to satisfy strict mode where practical.
* The `package.json` `style` field points at `style/query-graphs.css`, which does not exist — component styles are instead imported by the components themselves and preserved via `sideEffects`. See [Embedding the Library](#embedding-the-library).

## Embedding the Library

Install `@tableau/query-graphs`, then combine a loader with the `QueryGraph` component:

```tsx
import {QueryGraph} from "@tableau/query-graphs/lib/ui/QueryGraph";
import {loadPlanFromText} from "@tableau/query-graphs/lib/loaders";

function MyPlanViewer({planText}: {planText: string}) {
    const {tree} = loadPlanFromText(planText);
    return <QueryGraph treeDescription={tree} />;
}
```

Pass `{format: "hyper"}` (or another registered format) as the second argument to bypass automatic format detection.

The component imports its own CSS (`QueryGraph.css`, `QueryNode.css`, `NodeIcon.css`) and react-flow's default stylesheet; with a bundler that honors the package's `sideEffects`, those styles are included automatically when you import the component.
If you build a plan programmatically instead of parsing text, construct a `TreeDescription` directly — that is the only contract the renderer depends on.
