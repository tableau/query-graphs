/*

Adaptive JSON Plan Conversion
-----------------------------

Several database systems (Hyper, Umbra, CedarDB, ...) emit a query plan as a JSON tree built from
the same two building blocks: "operator" nodes (physical/logical plan operators) and "expression"
nodes (scalar expressions), each tagged by an `operator`/`expression` key. This module implements
the shared conversion heuristic once, so a new loader for such a system only has to supply the
small set of things that actually differ (icons, which fields are estimated/actual cardinality,
crosslinks, ...) instead of re-implementing the whole tree walk.

The heuristic:
1. Traverse the tree recursively, converting from JSON to our internal representation.
2. Detect the type of a node based on its `operator` or `expression` key.
   For other keys, decide based on their value: a plain value (string, number, ...) becomes
   part of the tooltip; anything else becomes part of the tree. A few pre-defined keys are
   always rendered in the tooltip, though.
3. Look up a type-specific rendering config (icon, display name, crosslink source), via the
   format's `getRenderingConfig` callback.
4. Render children in a logically meaningful order, i.e. render "left" before "right" etc.
5. Collapse the tree by default: for operators, collapse all children which are not operators;
   for expressions, don't collapse anything.

Pipeline coloring, edge widths, relative-runtime coloring and crosslink resolution are likewise
shared: they only need a `TreeNode` and a couple of format-agnostic lookup tables, built up while
walking the tree (or, for id maps, in a small post-processing pass over the finished tree).

*/

import {TreeNode, Crosslink, IconName, allChildren, visitTreeNodes} from "./tree-description";
import {Json, JsonObject, forceToString, tryToString, formatMetric} from "./loader-utils";

// A categorical color palette for execution pipelines (the Tableau 20 colors).
// The ten saturated base hues come first, then their lighter companions, so
// that adjacent pipelines never get near-identical shades (e.g. light-blue does
// not follow blue). Colors are assigned to pipelines left-to-right and rotate
// (index % length) once exhausted.
const PIPELINE_PALETTE = [
    // Base hues.
    "#4e79a7", // blue
    "#f28e2b", // orange
    "#59a14f", // green
    "#b6992d", // gold
    "#499894", // teal
    "#e15759", // red
    "#79706e", // gray
    "#d37295", // pink
    "#b07aa1", // purple
    "#9d7660", // brown
    // Lighter companions (only reached by wide plans).
    "#a0cbe8", // light blue
    "#ffbe7d", // light orange
    "#8cd17d", // light green
    "#f1ce63", // light gold
    "#86bcb6", // light teal
    "#ff9d9a", // light red
    "#bab0ac", // light gray
    "#fabfd2", // light pink
    "#d4a6c8", // light purple
    "#d7b5a6", // light brown
];

export function pipelineColor(index: number): string {
    return PIPELINE_PALETTE[index % PIPELINE_PALETTE.length];
}

export interface UnresolvedCrosslink {
    source: TreeNode;
    targetId: string;
}

// Mutable state threaded through one tree conversion.
export interface ConversionState {
    crosslinks: UnresolvedCrosslink[];
    edgeWidths: {node: TreeNode; width: number}[];
    runtimes: {node: TreeNode; time: number}[];
}

export function newConversionState(): ConversionState {
    return {crosslinks: [], edgeWidths: [], runtimes: []};
}

// Customization points for rendering a specific operator/expression tag.
export interface NodeRenderingConfig {
    displayNameKey?: string;
    crosslinkSourceKey?: string;
    icon?: IconName;
}

// The knobs a format-specific loader turns to reuse the adaptive conversion heuristic.
export interface AdaptiveTreeConfig {
    // Rendering customization for a classified node. Called after all of the node's own
    // properties have been collected, so it may inspect `properties` (e.g. to vary a join's
    // icon by its "type" property) as well as the raw JSON.
    getRenderingConfig(
        nodeType: "operator" | "expression",
        tag: string,
        rawNode: JsonObject,
        properties: Map<string, string>,
    ): NodeRenderingConfig;
    // Keys always rendered as a tooltip property (via `forceToString`), never as a child,
    // regardless of how complex their value is.
    alwaysPropertyKeys: string[];
    // Child keys with a fixed display order (e.g. "left" before "right"); everything else
    // falls back to alphabetic order.
    fixedChildOrder: string[];
    // Optional debug/user-assigned name, tried before the rendering config's `displayNameKey`.
    getDebugName?(rawNode: JsonObject): string | undefined;
    // Optional: should this node be highlighted as the one which errored?
    isErrored?(rawNode: JsonObject, metadata: Map<string, string>): boolean;
    // Optional: this node's own execution time, driving the "hot node" coloring.
    getExecutionTime?(rawNode: JsonObject): number | undefined;
    // Optional: the actual (measured) cardinality, shown alongside the estimate on the edge label.
    getActualCardinality?(rawNode: JsonObject): number | undefined;
}

// Should the entry `key` from `node` always be expanded?
// For operators: keep nested operators (or arrays thereof) visible, collapse everything else
// (typically expressions). For everything else (usually expressions): never force-collapse.
function isAlwaysExpanded(node: JsonObject, key: string): boolean {
    const child = node[key];
    if (node.hasOwnProperty("operator")) {
        let unwrapped = child;
        while (Array.isArray(unwrapped) && unwrapped.length) {
            unwrapped = unwrapped[0];
        }
        if (typeof unwrapped === "object" && !Array.isArray(unwrapped) && unwrapped !== null) {
            return unwrapped.hasOwnProperty("operator");
        }
        return false;
    }
    return false;
}

// Convert a JSON plan tree to a `TreeNode` tree, using `config` for the format-specific bits.
export function convertAdaptiveJsonNode(
    rawNode: Json,
    parentKey: string,
    state: ConversionState,
    config: AdaptiveTreeConfig,
    metadata: Map<string, string>,
): TreeNode | TreeNode[] {
    if (tryToString(rawNode) !== undefined) {
        return {
            name: tryToString(rawNode),
        };
    } else if (typeof rawNode === "object" && !Array.isArray(rawNode) && rawNode !== null) {
        // "Object" nodes
        const expandedChildren = [] as TreeNode[];
        const collapsedChildren = [] as TreeNode[];
        const properties = new Map<string, string>();

        // Figure out if this is an operator or an expression.
        let nodeType: "operator" | "expression" | undefined;
        let nodeTag: string | undefined;
        if (rawNode.hasOwnProperty("operator")) {
            const val = tryToString(rawNode["operator"]);
            if (val !== undefined) {
                nodeType = "operator";
                nodeTag = val;
            }
        } else if (rawNode.hasOwnProperty("expression")) {
            const val = tryToString(rawNode["expression"]);
            if (val !== undefined) {
                nodeType = "expression";
                nodeTag = val;
            }
        }

        // Display these properties always as properties, even if they are more complex.
        for (const key of config.alwaysPropertyKeys) {
            if (!rawNode.hasOwnProperty(key)) {
                continue;
            }
            properties.set(key, forceToString(rawNode[key]));
        }

        // Determine the order in which other keys are displayed.
        // For some keys, we enforce a specific order here (e.g., "left" comes before "right").
        // For all other keys, we use alphabetic order.
        const orderedKeys = Object.getOwnPropertyNames(rawNode)
            .filter((k) => {
                // The type key and `alwaysPropertyKeys` were already handled.
                return k != nodeType && config.alwaysPropertyKeys.indexOf(k) === -1;
            })
            .sort((a, b) => {
                const idx1 = config.fixedChildOrder.indexOf(a);
                const idx2 = config.fixedChildOrder.indexOf(b);
                if (idx1 != -1 || idx2 != -1) {
                    const fixed1 = idx1 == -1 ? Infinity : idx1;
                    const fixed2 = idx2 == -1 ? Infinity : idx2;
                    return fixed1 - fixed2;
                } else {
                    if (a < b) return -1;
                    if (a > b) return 1;
                    return 0;
                }
            });

        // Display all other properties adaptively: simple values are displayed as properties, all others as part of the tree
        for (const key of orderedKeys) {
            // Try to display as string property
            const str = tryToString(rawNode[key]);
            if (str !== undefined) {
                properties.set(key, str);
                continue;
            }

            // Display as part of the tree
            const children = isAlwaysExpanded(rawNode, key) ? expandedChildren : collapsedChildren;
            const innerNodes = convertAdaptiveJsonNode(rawNode[key], key, state, config, metadata);
            if (config.fixedChildOrder.indexOf(key) != -1) {
                if (Array.isArray(innerNodes)) {
                    // Flatten the array, in case it's one of the `fixedChildOrder` keys
                    Array.prototype.push.apply(children, innerNodes);
                } else {
                    // The `key` itself is not inserted as an intermediate node.
                    if (!innerNodes.name) {
                        innerNodes.name = key;
                    }
                    children.push(innerNodes);
                }
            } else if (Array.isArray(innerNodes)) {
                // Array-valued children are collapsed by default, to avoid displaying too many properties all at once.
                children.push({name: key, collapsedChildren: innerNodes});
            } else if (!innerNodes.name) {
                // Single node without a name? Set the name and as a child.
                innerNodes.name = key;
                children.push(innerNodes);
            } else {
                // Single node which already has a name? Add as a nested node.
                children.push({name: key, children: [innerNodes]});
            }
        }

        // Figure out the display name and rendering config (icon, ...). The rendering config may
        // depend on a property collected just above (e.g. a join's icon varying by its "type").
        const renderingConfig = nodeType && nodeTag ? config.getRenderingConfig(nodeType, nodeTag, rawNode, properties) : {};
        const specificDisplayName = renderingConfig.displayNameKey ? properties.get(renderingConfig.displayNameKey) : undefined;
        const debugName = config.getDebugName?.(rawNode);
        const displayName = debugName ?? specificDisplayName ?? properties?.get("name") ?? nodeTag ?? "";

        // Build the converted node
        const convertedNode = {
            name: displayName,
            icon: renderingConfig.icon,
            properties,
            children: expandedChildren,
            collapsedChildren,
            expandedByDefault: nodeType != "operator" && expandedChildren.length == 0,
        } as TreeNode;

        // Highlight the node which errored out, in case the query failed
        if (config.isErrored?.(rawNode, metadata)) {
            convertedNode.iconColor = "red";
        }

        // Information on the execution time
        const execTime = config.getExecutionTime?.(rawNode);
        if (typeof execTime === "number") {
            state.runtimes.push({node: convertedNode, time: execTime});
        }

        // Display the cardinality on the links between the nodes
        if (rawNode.hasOwnProperty("cardinality") && typeof rawNode["cardinality"] === "number") {
            const estimatedCard = rawNode["cardinality"];
            const actualCard = config.getActualCardinality?.(rawNode);
            if (typeof actualCard === "number") {
                state.edgeWidths.push({node: convertedNode, width: actualCard});
                convertedNode.edgeLabel = formatMetric(actualCard) + "/" + formatMetric(estimatedCard);
                // Highlight significant differences between planned and actual rows
                if (estimatedCard > actualCard * 10 || actualCard > estimatedCard * 10) {
                    convertedNode.edgeClass = "qg-label-highlighted";
                }
            } else {
                state.edgeWidths.push({node: convertedNode, width: estimatedCard});
                convertedNode.edgeLabel = formatMetric(estimatedCard);
            }
        }

        // Add cross links
        if (renderingConfig.crosslinkSourceKey) {
            const targetId = properties?.get(renderingConfig.crosslinkSourceKey);
            if (targetId !== undefined) {
                state.crosslinks.push({
                    source: convertedNode,
                    targetId,
                });
            }
        }

        return convertedNode;
    } else if (Array.isArray(rawNode)) {
        // "Array" nodes
        const listOfObjects = [] as TreeNode[];
        for (let index = 0; index < rawNode.length; ++index) {
            const value = rawNode[index];
            const name = `${parentKey}.${index}`;
            let innerNode = convertAdaptiveJsonNode(value, name, state, config, metadata);
            if (Array.isArray(innerNode)) {
                innerNode = {children: innerNode};
            }
            if (!innerNode.name) innerNode.name = name;
            listOfObjects.push(innerNode);
        }
        return listOfObjects;
    }
    throw new Error("Invalid query plan");
}

// Index every node carrying one of the given properties by that property's value.
// Tries the keys in order and stops at the first match, so callers can accept several spellings
// of the same id (e.g. Hyper's kebab-case cutover from `operator-id` to `operatorId`).
export function buildIdMap(root: TreeNode, keys: string[]): Map<string, TreeNode> {
    const idMap = new Map<string, TreeNode>();
    visitTreeNodes(
        root,
        (node: TreeNode) => {
            for (const key of keys) {
                const id = node.properties?.get(key);
                if (id !== undefined) {
                    idMap.set(id, node);
                    break;
                }
            }
        },
        allChildren,
    );
    return idMap;
}

// Resolve all pending crosslinks against an id map (see `buildIdMap`).
export function resolveCrosslinks(crosslinks: UnresolvedCrosslink[], idMap: Map<string, TreeNode>): Crosslink[] {
    const resolved = [] as Crosslink[];
    for (const link of crosslinks) {
        const target = idMap.get(link.targetId);
        if (target !== undefined) {
            resolved.push({source: link.source, target});
        }
    }
    return resolved;
}

// Colors nodes by their relative execution time (a pink shade proportional to a node's share of total runtime).
export function colorRelativeExecutionTime(runtimes: {node: TreeNode; time: number}[]) {
    const totalTime = runtimes.reduce((p, v) => p + v.time, 0);
    for (const op of runtimes) {
        const relativeExecutionRatio = op.time / totalTime;
        const l = (95 + (72 - 95) * relativeExecutionRatio).toFixed(3);
        op.node.nodeColor = relativeExecutionRatio >= 0.05 ? `hsl(309, 84%, ${l}%)` : undefined;
    }
}

// Sets the edge widths, relative to the number of output tuples
export function setEdgeWidths(edgeWidths: {node: TreeNode; width: number}[]) {
    const maxWidth = edgeWidths.reduce((p, v) => (p > v.width ? p : v.width), 0);
    const minWidth = edgeWidths.reduce((p, v) => (p < v.width ? p : v.width), Infinity);
    if (minWidth == maxWidth) return;
    const factor = Math.max(maxWidth - minWidth, minWidth);
    for (const edge of edgeWidths) {
        edge.node.edgeWidth = (edge.width - minWidth) / factor;
    }
}

// A raw pipeline entry, resolved into the fields the coloring logic needs. `duration`, if
// known, additionally drives relative-runtime coloring (see `colorRelativeExecutionTime`).
export interface RawPipeline {
    id: number;
    operatorIds: number[];
    duration?: number;
}

// Parse and validate a `pipelines`-shaped array of the plan. `extract` maps one raw entry to a
// `RawPipeline`, or `undefined` to skip it; this is where a format's specific field names
// (e.g. `operators` vs. `svoperators`) are resolved.
export function parsePipelines(
    pipelinesJson: Json,
    extract: (entry: JsonObject, index: number) => RawPipeline | undefined,
): RawPipeline[] {
    if (!Array.isArray(pipelinesJson)) {
        return [];
    }
    const pipelines: RawPipeline[] = [];
    let index = 0;
    for (const entry of pipelinesJson) {
        if (typeof entry !== "object" || Array.isArray(entry) || entry === null) continue;
        const p = extract(entry, index++);
        if (p) pipelines.push(p);
    }
    return pipelines;
}

// Color the per-node bars, edges and icons for the merged execution pipelines in one pre-order DFS, coloring each pipeline on first appearance so colors track tree position, not pipeline ids.
export function assignPipelineColors(
    root: TreeNode,
    idMap: Map<string, TreeNode>,
    pipelines: RawPipeline[],
    crosslinks: Crosslink[],
): void {
    // Resolve each pipeline to its tree nodes. `color` is filled lazily the first
    // time the pipeline is seen during the walk (empty string = not yet seen).
    interface ResolvedPipeline {
        id: number;
        nodes: TreeNode[];
        color: string;
    }
    const resolved: ResolvedPipeline[] = pipelines.map((p) => ({
        id: p.id,
        nodes: p.operatorIds.map((opId) => idMap.get(opId.toString())!).filter((node) => node !== undefined),
        color: "",
    }));

    // Record, per tree node, every pipeline it belongs to (kept local: the
    // "pipeline" concept never leaks into the presentation model, which only
    // ever sees colors).
    const nodePipelines = new Map<TreeNode, ResolvedPipeline[]>();
    for (const p of resolved) {
        for (const node of p.nodes) {
            const list = nodePipelines.get(node) ?? [];
            list.push(p);
            nodePipelines.set(node, list);
        }
    }

    // A crosslink feeds data into its source like a child would (e.g. an explicit
    // scan reading a shared operator, or a magic join reading its magic side), but
    // it is not a tree child. Treat the crosslink target as an extra child so a
    // reader still gets the below-bar for the pipeline it reads through the link.
    const crosslinkChildren = new Map<TreeNode, TreeNode[]>();
    for (const link of crosslinks) {
        const list = crosslinkChildren.get(link.source) ?? [];
        list.push(link.target);
        crosslinkChildren.set(link.source, list);
    }

    let nextColor = 0;
    const walk = (node: TreeNode, parent: TreeNode | undefined) => {
        const nodePs = nodePipelines.get(node);
        if (nodePs) {
            // Color the pipelines appearing here for the first time.
            for (const p of nodePs) if (p.color === "") p.color = pipelineColor(nextColor++);

            // Order segments left-to-right by the position of the first child
            // that carries each pipeline, so the bars line up with the branches
            // below. Ties (several pipelines entering through the same child, or
            // pipelines with no child) keep their appearance order via the stable
            // sort.
            const childOrder = new Map<number, number>();
            const children = [...allChildren(node), ...(crosslinkChildren.get(node) ?? [])];
            children.forEach((child, idx) => {
                const childPs = nodePipelines.get(child);
                if (!childPs) return;
                for (const p of childPs) if (!childOrder.has(p.id)) childOrder.set(p.id, idx);
            });
            const ordered = (ps: ResolvedPipeline[]): ResolvedPipeline[] =>
                [...ps].sort((a, b) => (childOrder.get(a.id) ?? Infinity) - (childOrder.get(b.id) ?? Infinity));

            // Outgoing (above): pipelines shared with the parent. The root has no
            // parent, so it gets no bar above.
            let outgoing: ResolvedPipeline[] = [];
            if (parent) {
                const parentPs = nodePipelines.get(parent);
                const parentPipelineIds = parentPs ? new Set(parentPs.map((p) => p.id)) : new Set<number>();
                outgoing = nodePs.filter((p) => parentPipelineIds.has(p.id));
            }
            node.barsAbove = ordered(outgoing).map((p) => p.color);
            if (outgoing.length) node.edgeColors = node.barsAbove;

            // Incoming (below): pipelines shared with an operator child. A leaf has
            // no operator child, so it gets no bar below.
            const incoming = nodePs.filter((p) => childOrder.has(p.id));
            node.barsBelow = ordered(incoming).map((p) => p.color);

            // Tint the operator icon (and thereby the minimap) with the node's
            // right-most pipeline color, unless already colored (e.g. the red
            // error highlight, which takes precedence).
            if (!node.iconColor) {
                const all = ordered(nodePs);
                node.iconColor = all[all.length - 1].color;
            }
        }
        for (const child of allChildren(node)) walk(child, node);
    };
    walk(root, undefined);
}
