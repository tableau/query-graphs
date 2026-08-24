# `query-graphs` — Core Library

The `query-graphs` library is the heart of the project: it parses query plans from several databases into one internal tree model and renders that model as an interactive graph using React and [react-flow](https://reactflow.dev/).
It is published to npm as `@tableau/query-graphs` and is consumed by the [`standalone-app`](../standalone-app/README.md), but it can also be embedded into other tools.

This library has no user interface of its own for opening files or sharing — that shell lives in the `standalone-app`.
To see changes in a running UI, rebuild the library and use the app's dev server (see [Build and Deployment](../docs/BuildAndDeployment.md)).

The library provides:

* **The tree model** — `TreeDescription` and `TreeNode` (`src/tree-description.ts`), the format-independent contract between loaders and the renderer.
* **Format loaders** — `hyper.ts`, `postgres.ts`, `tableau.ts`, and the generic `json.ts`/`xml.ts` fallbacks (`src/loaders/`), each turning plan text into a `TreeDescription`.
* **The renderer** — lays out and draws the tree; in `src/ui/`.
* **Interaction state** — a Zustand store (`src/ui/store.ts`) tracking the graph state (expanded nodes, the measured node sizes, ...).

## The Tree Model

`TreeDescription` (`src/tree-description.ts`) is the single abstraction that decouples "which database produced this plan" from "how it is drawn".
Every loader outputs one; the renderer only ever consumes one.

* `TreeDescription` — the whole graph: a `root` `TreeNode`, optional `metadata` (shown in the top-level label), and optional `crosslinks`.
* `TreeNode` — one node. Notable fields:
  * `name`, `icon`, `iconColor`, `nodeColor` — what the node looks like.
  * `properties` — a `Map` of key/value strings shown in the node's tooltip/detail panel.
  * `children` vs `collapsedChildren` — see [The Collapse/Expand Model](#the-collapseexpand-model).
  * `edgeLabel`, `edgeWidth`, `edgeClass` — decorate the incoming edge (e.g. cardinality labels).
* `Crosslink` — an extra `source → target` edge between nodes that are related but not parent/child (e.g. a CTE and its scan).
* `IconName` — the set of icons the renderer knows how to draw (joins, scans, sort, group-by, …), realized as SVG in `NodeIcon`.

Two helpers walk the tree: `visitTreeNodes` (recursive traversal) and `allChildren` (children plus collapsed children).

## Format Loaders

Each loader converts a source format into a `TreeDescription`; see [Plan Formats and Loaders](../docs/PlanFormatsAndLoaders.md) for the format list, dispatch order, how to add a new one, and [how to keep a loader permissive](../docs/PlanFormatsAndLoaders.md#writing-a-permissive-loader) on unfamiliar input.

The Hyper and Postgres loaders share an **adaptive conversion heuristic**: a scalar value (string/number/boolean) becomes a tooltip `property`, while a nested object or array becomes a child `TreeNode`.
This keeps simple attributes compact in the tooltip while still exposing structure as the tree.
The `hyper.ts` loader is the richest reference:

* It classifies a node as an operator or an expression from its `operator` / `expression` key, then looks up per-type rendering (icon, display name, crosslink source) in `nodeRenderingConfig`.
* It enforces a meaningful child order (`input`/`left`/`right`/… before alphabetical) so a join's inputs read left-to-right.
* It converts in two passes: first build the tree, then post-process to resolve crosslinks, compute edge widths, and color nodes by runtime.

Shared parsing/formatting helpers live in `loader-utils.ts` (`tryToString`, `forceToString`, `formatMetric`, `tryGetPropertyPath`, the `Json` type).

The library intentionally exposes low-level loaders (`json`, `xml`) as generic fallbacks so that even an unrecognized plan renders as *something* rather than an error.

## The Renderer

`QueryGraph` (`src/ui/QueryGraph.tsx`) is the top-level component rendering a `TreeDescription`.
It assigns a stable id to every node, creates a graph-local rendering store seeded from each node's `expandedByDefault` flag, and retains the node dimensions measured by react-flow.

`tree-layout.ts` positions the tree with [`d3-flextree`](https://github.com/Klortho/d3-flextree) on top of `d3-hierarchy`, then translates the result into react-flow nodes and edges.
Layout is driven by the **measured** DOM size of each node, so it runs in two passes: react-flow measures new nodes after their first render, then the tree re-lays-out with the correct sizes. Those measurements are retained in the controlled node objects so react-flow does not re-initialize them on every layout.
Edge thickness is scaled from `edgeWidth`, and `crosslinks` are added as extra edges.

`QueryNode` (`src/ui/QueryNode.tsx`) draws a single node.
`NodeIcon` (`src/ui/NodeIcon.tsx`) maps each `IconName` to a hand-drawn SVG (the join icons, for instance, are two overlapping circles whose fills encode inner/left/right/full).

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

## Tech Debt

* `tsconfig.json` disables `strict` (and several related checks) with `TODO`s to tighten them; new code should still be written to satisfy strict mode where practical.
* The `package.json` `style` field points at `style/query-graphs.css`, which does not exist — component styles are instead imported by the components themselves and preserved via `sideEffects`. See [Embedding the Library](#embedding-the-library).

## Embedding the Library

Install `@tableau/query-graphs`, then combine a loader with the `QueryGraph` component:

```tsx
import {QueryGraph} from "@tableau/query-graphs/lib/ui/QueryGraph";
import {loadHyperPlanFromText} from "@tableau/query-graphs/lib/loaders/hyper";

function MyPlanViewer({planText}: {planText: string}) {
    const tree = loadHyperPlanFromText(planText);
    return <QueryGraph treeDescription={tree} />;
}
```

The component imports its own CSS (`QueryGraph.css`, `QueryNode.css`, `NodeIcon.css`) and react-flow's base stylesheet; with a bundler that honors the package's `sideEffects`, those styles are included automatically when you import the component.
If you build a plan programmatically instead of parsing text, construct a `TreeDescription` directly — that is the only contract the renderer depends on.
