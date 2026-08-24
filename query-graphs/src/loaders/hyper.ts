/*

Hyper JSON Transformations
--------------------------

We transform a Hyper JSON tree into a query-graphs tree using the following heuristics:

1. Convert the overall tree
    * traverse the tree recursively, converting from JSON to our internal representation
    * detect the type of a node based on its `operator` or `expression` key.
      For other keys, decide based on their value: a plain value (string, number, ...) becomes
      part of the tooltip; anything else becomes part of the tree. A few pre-defined keys
      (e.g., `analyze`) are always rendered in the tooltip, though.
    * look up a type-specific config which configures the icon, display name etc.
    * render children in a logically meaningful order, i.e. render "left" before "right" etc.
    * collapse the tree by default:
        * for operators: collapse all children which are not operators
        * for expressions: don't collapse anything
2. Add additional details in a 2nd pass: edge widths, highlighting particularly long-running operators, ...

*/

import type {TreeNode, TreeDescription, Crosslink, IconName} from "../tree-description";
import {allChildren} from "../tree-description";
import type {Json, JsonObject} from "./loader-utils";
import {forceToString, tryToString, formatMetric, hasOwnProperty, tryGetPropertyPath} from "./loader-utils";

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

function pipelineColor(index: number): string {
    return PIPELINE_PALETTE[index % PIPELINE_PALETTE.length];
}

interface UnresolvedCrosslink {
    source: TreeNode;
    targetOpId: string;
}

// Temporary state which we hold during converting from JSON to internal graph representation
interface ConversionState {
    operatorsById: Map<string, TreeNode>;
    crosslinks: UnresolvedCrosslink[];
    edgeWidths: {node: TreeNode; width: number}[];
    runtimes: {node: TreeNode; time: number}[];
    metadata: Map<string, string>;
}

// Customization points for rendering the various different
// operator and expression types
interface NodeRenderingConfig {
    displayNameKey?: string;
    crosslinkSourceKey?: string;
    icon?: IconName;
}

const nodeRenderingConfig: Record<string, NodeRenderingConfig> = {
    "op:execution-target": {icon: "run-query-symbol"},
    "op:executiontarget": {icon: "run-query-symbol"},
    "op:select": {icon: "filter-symbol"},
    "op:sort": {icon: "sort-symbol"},
    "op:group-by": {icon: "groupby-symbol"},
    "op:groupby": {icon: "groupby-symbol"},
    // Joins
    "op:join": {displayNameKey: "type", icon: "inner-join-symbol", crosslinkSourceKey: "magic"},
    "op:join:inner": {displayNameKey: "type", icon: "inner-join-symbol", crosslinkSourceKey: "magic"},
    "op:join:left-outer": {displayNameKey: "type", icon: "left-join-symbol", crosslinkSourceKey: "magic"},
    "op:join:right-outer": {displayNameKey: "type", icon: "right-join-symbol", crosslinkSourceKey: "magic"},
    "op:join:full-outer": {displayNameKey: "type", icon: "full-join-symbol", crosslinkSourceKey: "magic"},
    "op:join:left-anti": {displayNameKey: "type", crosslinkSourceKey: "magic"},
    "op:join:right-anti": {displayNameKey: "type", crosslinkSourceKey: "magic"},
    "op:join:left-semi": {displayNameKey: "type", crosslinkSourceKey: "magic"},
    "op:join:right-semi": {displayNameKey: "type", crosslinkSourceKey: "magic"},
    "op:join:left-single": {displayNameKey: "type", crosslinkSourceKey: "magic"},
    "op:join:right-single": {displayNameKey: "type", crosslinkSourceKey: "magic"},
    "op:join:left-mark": {displayNameKey: "type", crosslinkSourceKey: "magic"},
    "op:join:right-mark": {displayNameKey: "type", crosslinkSourceKey: "magic"},
    "op:left-outer-join": {icon: "left-join-symbol", crosslinkSourceKey: "magic"},
    "op:leftouterjoin": {icon: "left-join-symbol", crosslinkSourceKey: "magic"},
    "op:right-outer-join": {icon: "right-join-symbol", crosslinkSourceKey: "magic"},
    "op:rightouterjoin": {icon: "right-join-symbol", crosslinkSourceKey: "magic"},
    "op:full-outer-join": {icon: "full-join-symbol", crosslinkSourceKey: "magic"},
    "op:fullouterjoin": {icon: "full-join-symbol", crosslinkSourceKey: "magic"},
    "op:left-anti-join": {crosslinkSourceKey: "magic"},
    "op:leftantijoin": {crosslinkSourceKey: "magic"},
    "op:right-anti-join": {crosslinkSourceKey: "magic"},
    "op:rightantijoin": {crosslinkSourceKey: "magic"},
    "op:left-semi-join": {crosslinkSourceKey: "magic"},
    "op:leftsemijoin": {crosslinkSourceKey: "magic"},
    "op:right-semi-join": {crosslinkSourceKey: "magic"},
    "op:rightsemijoin": {crosslinkSourceKey: "magic"},
    "op:left-single-join": {crosslinkSourceKey: "magic"},
    "op:leftsinglejoin": {crosslinkSourceKey: "magic"},
    "op:right-single-join": {crosslinkSourceKey: "magic"},
    "op:rightsinglejoin": {crosslinkSourceKey: "magic"},
    "op:left-mark-join": {crosslinkSourceKey: "magic"},
    "op:leftmarkjoin": {crosslinkSourceKey: "magic"},
    "op:right-mark-join": {crosslinkSourceKey: "magic"},
    "op:rightmarkjoin": {crosslinkSourceKey: "magic"},
    "op:early-probe": {icon: "filter-symbol", crosslinkSourceKey: "builder"},
    "op:earlyprobe": {icon: "filter-symbol", crosslinkSourceKey: "builder"},
    // Various scans
    "op:scan": {displayNameKey: "type", icon: "table-symbol"},
    "op:scan:virtual-table": {displayNameKey: "type", icon: "virtual-table-symbol"},
    "op:table-scan": {icon: "table-symbol"},
    "op:tablescan": {icon: "table-symbol"},
    "op:arrow-scan": {icon: "table-symbol"},
    "op:arrowscan": {icon: "table-symbol"},
    "op:binary-scan": {icon: "table-symbol"},
    "op:binaryscan": {icon: "table-symbol"},
    "op:csv-scan": {icon: "table-symbol"},
    "op:csvscan": {icon: "table-symbol"},
    "op:cloud-table-scan": {icon: "table-symbol"},
    "op:cloudtablescan": {icon: "table-symbol"},
    "op:cursor-scan": {icon: "table-symbol"},
    "op:cursorscan": {icon: "table-symbol"},
    "op:iceberg-scan": {icon: "table-symbol"},
    "op:icebergscan": {icon: "table-symbol"},
    "op:parquet-scan": {icon: "table-symbol"},
    "op:parquetscan": {icon: "table-symbol"},
    "op:tdescan": {icon: "table-symbol"},
    // Other tables
    "op:table-construction": {icon: "const-table-symbol"},
    "op:tableconstruction": {icon: "const-table-symbol"},
    "op:virtual-table": {icon: "virtual-table-symbol"},
    "op:virtualtable": {icon: "virtual-table-symbol"},
    // Temp & Explicit scan
    "op:explicit-scan": {icon: "temp-table-symbol", crosslinkSourceKey: "input"},
    "op:explicitscan": {icon: "temp-table-symbol", crosslinkSourceKey: "input"},
    "op:temp": {icon: "temp-table-symbol"},
    "op:iteration-increment": {crosslinkSourceKey: "source"},
    "op:iterationincrement": {crosslinkSourceKey: "source"},
    // Inserts
    "op:insert": {displayNameKey: "type"},
    // Expressions
    "exp:comparison": {displayNameKey: "mode"},
    "exp:iu-ref": {displayNameKey: "iu"},
    "exp:iuref": {displayNameKey: "iu"},
};

// Should the entry `key` from `node` always be expanded?
function isAlwaysExpanded(node: JsonObject, key: string): boolean {
    const child = node[key];
    if (node.hasOwnProperty("operator")) {
        // There might be arrays of operators. Also detect those...
        let unwrapped = child;
        while (Array.isArray(unwrapped) && unwrapped.length) {
            unwrapped = unwrapped[0];
        }
        // Subobjects which are also operators themself should be displayed
        if (typeof unwrapped === "object" && !Array.isArray(unwrapped) && unwrapped !== null) {
            return unwrapped.hasOwnProperty("operator");
        }
        // All other children should be hidden
        return false;
    }
    return false;
}

// Convert Hyper JSON to a D3 tree
function convertHyperNode(rawNode: Json, parentKey, conversionState: ConversionState): TreeNode | TreeNode[] {
    if (tryToString(rawNode) !== undefined) {
        return {
            name: tryToString(rawNode),
        };
    } else if (typeof rawNode === "object" && !Array.isArray(rawNode) && rawNode !== null) {
        // "Object" nodes
        const expandedChildren = [] as TreeNode[];
        const collapsedChildren = [] as TreeNode[];
        const properties = new Map<string, string>();

        // Figure out if this is an operator or an expression and
        // retrieve the operator-specific customizations
        let nodeType: "operator" | "expression" | undefined;
        let nodeTag: string | undefined;
        let renderingConfig: NodeRenderingConfig = {};
        if (rawNode.hasOwnProperty("operator")) {
            const val = tryToString(rawNode["operator"]);
            if (val !== undefined) {
                nodeType = "operator";
                nodeTag = val;
                const configKey = `op:${nodeTag}`;
                const subtype = tryToString(rawNode["type"]);
                renderingConfig =
                    (subtype !== undefined ? nodeRenderingConfig[`${configKey}:${subtype}`] : undefined) ??
                    nodeRenderingConfig[configKey] ??
                    {};
            }
        } else if (rawNode.hasOwnProperty("expression")) {
            const val = tryToString(rawNode["expression"]);
            if (val !== undefined) {
                nodeType = "expression";
                nodeTag = val;
                renderingConfig = nodeRenderingConfig[`exp:${nodeTag}`] ?? {};
            }
        }

        // Display these properties always as properties, even if they are more complex.
        // `debugName` is the pre-kebab-case spelling of `debug-name`; we accept both for
        // backwards compatibility with plans produced before the Hyper kebab-case cutover.
        const propertyKeys = ["debug-name", "debugName", "statistics", "analyze", "sqlpos"];
        for (const key of propertyKeys) {
            if (!rawNode.hasOwnProperty(key)) {
                continue;
            }
            properties.set(key, forceToString(rawNode[key]));
        }

        // Determine the order in which other keys are displayed.
        // For some keys, we enforce a specific order here (e.g., "left" comes before "right").
        // For all other keys, we use alphabetic order.
        // `value-for-comparison` / `valueForComparison`: both spellings are listed so the
        // fixed child ordering works for plans from before and after the kebab-case cutover.
        const fixedChildOrder = ["inputs", "input", "left", "right", "value", "value-for-comparison", "valueForComparison"];
        const orderedKeys = Object.getOwnPropertyNames(rawNode)
            .filter((k) => {
                // `propertyKeys` and `operator`/`expression` were already handled
                return k != nodeType && propertyKeys.indexOf(k) === -1;
            })
            .sort((a, b) => {
                const idx1 = fixedChildOrder.indexOf(a);
                const idx2 = fixedChildOrder.indexOf(b);
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

        // Display all other properties adaptively: simple expressions are displayed as properties, all others as part of the tree
        for (const key of orderedKeys) {
            // Try to display as string property
            const str = tryToString(rawNode[key]);
            if (str !== undefined) {
                properties.set(key, str);
                continue;
            }

            // Display as part of the tree
            const children = isAlwaysExpanded(rawNode, key) ? expandedChildren : collapsedChildren;
            const innerNodes = convertHyperNode(rawNode[key], key, conversionState);
            if (fixedChildOrder.indexOf(key) != -1) {
                if (Array.isArray(innerNodes)) {
                    // Flatten the array, in case it's one of the "fixedChildOrder" keys
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

        // Figure out the display name
        const specificDisplayName = renderingConfig.displayNameKey ? properties.get(renderingConfig.displayNameKey) : undefined;
        // Accept both `debug-name` (post kebab-case cutover) and the legacy `debugName`.
        const debugNameNode =
            tryGetPropertyPath(rawNode, ["debug-name", "value"]) ?? tryGetPropertyPath(rawNode, ["debugName", "value"]);
        const debugName = typeof debugNameNode === "string" ? debugNameNode : undefined;
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
        const running =
            tryGetPropertyPath(rawNode, ["statistics", "running"]) ?? tryGetPropertyPath(rawNode, ["analyze", "running"]);
        const errored = conversionState.metadata.has("Error") && running === true;
        if (errored) {
            convertedNode.iconColor = "red";
        }

        // Information on the execution time
        const execTime =
            tryGetPropertyPath(rawNode, ["statistics", "cpu-cycles"]) ?? tryGetPropertyPath(rawNode, ["analyze", "cpu-cycles"]);
        if (typeof execTime === "number") {
            conversionState.runtimes.push({node: convertedNode, time: execTime});
        }

        // Display the cardinality on the links between the nodes
        const estimatedCard =
            hasOwnProperty(rawNode, "estimated-rows") && typeof rawNode["estimated-rows"] === "number"
                ? rawNode["estimated-rows"]
                : hasOwnProperty(rawNode, "cardinality") && typeof rawNode.cardinality === "number"
                  ? rawNode.cardinality
                  : undefined;
        if (estimatedCard !== undefined) {
            const actualCard =
                tryGetPropertyPath(rawNode, ["statistics", "output-rows"]) ??
                tryGetPropertyPath(rawNode, ["analyze", "tuple-count"]);
            if (typeof actualCard === "number") {
                conversionState.edgeWidths.push({node: convertedNode, width: actualCard});
                convertedNode.edgeLabel = formatMetric(actualCard) + "/" + formatMetric(estimatedCard);
                // Highlight significant differences between planned and actual rows
                if (estimatedCard > actualCard * 10 || actualCard > estimatedCard * 10) {
                    convertedNode.edgeClass = "qg-label-highlighted";
                }
            } else {
                conversionState.edgeWidths.push({node: convertedNode, width: estimatedCard});
                convertedNode.edgeLabel = formatMetric(estimatedCard);
            }
        }

        // Add to `operator-id` map if applicable.
        // `operatorId` is the legacy spelling; accept both for backwards compatibility.
        if (nodeType == "operator") {
            const operatorId = properties?.get("operator-id") ?? properties?.get("operatorId");
            if (operatorId !== undefined) {
                conversionState.operatorsById.set(operatorId, convertedNode);
            }
        }

        // Add cross links
        if (renderingConfig.crosslinkSourceKey) {
            const sourceId = properties?.get(renderingConfig.crosslinkSourceKey);
            if (sourceId !== undefined) {
                conversionState.crosslinks.push({
                    source: convertedNode,
                    targetOpId: sourceId,
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
            let innerNode = convertHyperNode(value, name, conversionState);
            if (Array.isArray(innerNode)) {
                innerNode = {children: innerNode};
            }
            if (!innerNode.name) innerNode.name = name;
            listOfObjects.push(innerNode);
        }
        return listOfObjects;
    }
    throw new Error("Invalid Hyper query plan");
}

// Resolve all pending crosslinks
function resolveCrosslinks(state: ConversionState): Crosslink[] {
    const crosslinks = [] as Crosslink[];
    for (const link of state.crosslinks) {
        const target = state.operatorsById.get(link.targetOpId);
        if (target !== undefined) {
            crosslinks.push({source: link.source, target: target});
        }
    }
    return crosslinks;
}

// Sets the edge widths, relative to the number of output tuples
function colorRelativeExecutionTime(state: ConversionState) {
    const totalTime = state.runtimes.reduce((p, v) => p + v.time, 0);
    for (const op of state.runtimes) {
        const relativeExecutionRatio = op.time / totalTime;
        const l = (95 + (72 - 95) * relativeExecutionRatio).toFixed(3);
        op.node.nodeColor = relativeExecutionRatio >= 0.05 ? `hsl(309, 84%, ${l}%)` : undefined;
    }
}

// Sets the edge widths, relative to the number of output tuples
function setEdgeWidths(state: ConversionState) {
    const maxWidth = state.edgeWidths.reduce((p, v) => (p > v.width ? p : v.width), 0);
    const minWidth = state.edgeWidths.reduce((p, v) => (p < v.width ? p : v.width), Infinity);
    if (minWidth == maxWidth) return;
    const factor = Math.max(maxWidth - minWidth, minWidth);
    for (const edge of state.edgeWidths) {
        edge.node.edgeWidth = (edge.width - minWidth) / factor;
    }
}

// A raw pipeline entry, as parsed from the `pipelines` array of the plan.
interface RawPipeline {
    id: number;
    operatorIds: number[];
}

// Parse and validate the `pipelines` array of the plan.
function parsePipelines(pipelinesJson: Json): RawPipeline[] {
    if (!Array.isArray(pipelinesJson)) {
        return [];
    }
    const pipelines: RawPipeline[] = [];
    for (const entry of pipelinesJson) {
        if (typeof entry !== "object" || Array.isArray(entry) || entry === null) continue;
        const id = entry["id"];
        const operators = entry["operators"];
        if (typeof id !== "number" || !Array.isArray(operators)) continue;
        const operatorIds = operators.filter((o): o is number => typeof o === "number");
        pipelines.push({id, operatorIds});
    }
    return pipelines;
}

// Color the per-node bars, edges and icons for the merged execution pipelines in one pre-order DFS, coloring each pipeline on first appearance so colors track tree position, not pipeline ids.
function assignPipelineColors(
    root: TreeNode,
    operatorsById: Map<string, TreeNode>,
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
        nodes: p.operatorIds.map((opId) => operatorsById.get(opId.toString())!),
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

function convertHyperPlan(node: Json, pipelines?: Json): TreeDescription {
    const conversionState = {
        operatorsById: new Map<string, TreeNode>(),
        crosslinks: [],
        edgeWidths: [],
        runtimes: [],
        metadata: new Map<string, string>(),
    } as ConversionState;
    // Check if the query failed
    const errorMsg =
        tryGetPropertyPath(node, ["statistics", "error", "message", "original"]) ??
        tryGetPropertyPath(node, ["analyze", "error", "message", "original"]);
    if (errorMsg) {
        conversionState.metadata.set("Error", forceToString(errorMsg));
    }

    const root = convertHyperNode(node, "result", conversionState);
    if (Array.isArray(root)) {
        throw new Error("Invalid Hyper query plan");
    }
    colorRelativeExecutionTime(conversionState);
    setEdgeWidths(conversionState);
    const crosslinks = resolveCrosslinks(conversionState);
    if (pipelines !== undefined) {
        assignPipelineColors(root, conversionState.operatorsById, parsePipelines(pipelines), crosslinks);
    }
    return {root, crosslinks, metadata: conversionState.metadata};
}

function convertOptimizerSteps(node: Json): TreeDescription | undefined {
    // Check if we have a top-level object with a single key "optimizersteps" containing an array
    if (typeof node !== "object" || Array.isArray(node) || node === null) return undefined;
    if (Object.getOwnPropertyNames(node).length != 1) return undefined;
    if (!node.hasOwnProperty("optimizersteps")) return undefined;
    const steps = node["optimizersteps"];
    if (!Array.isArray(steps)) return undefined;

    // Transform the optimizer steps
    const crosslinks: Crosslink[] = [];
    const children: TreeNode[] = [];
    const properties = new Map<string, string>();
    for (const step of steps) {
        // Check that our step has two subproperties: "name" and "plan"
        if (typeof step !== "object" || Array.isArray(step) || step === null) return undefined;
        if (Object.getOwnPropertyNames(step).length != 2) return undefined;
        if (!step.hasOwnProperty("name")) return undefined;
        if (!step.hasOwnProperty("plan")) return undefined;
        const name = step["name"];
        const plan = step["plan"];
        if (typeof name !== "string") return undefined;

        // Add the child
        const {root: childRoot, crosslinks: newCrosslinks, metadata: newProperties} = convertHyperPlan(plan);
        crosslinks.push(...(newCrosslinks ?? []));
        children.push({name: name, children: [childRoot]});
        for (const p of newProperties ?? new Map<string, string>()) {
            properties.set(p[0], p[1]);
        }
    }
    const root = {name: "optimizersteps", children: children};
    return {root, crosslinks, metadata: properties};
}

// Detect the `{tree, pipelines}` envelope emitted by `EXPLAIN (..., PIPELINES, ...)`.
function hasPipelineEnvelope(json: Json): json is JsonObject {
    return (
        typeof json === "object" &&
        !Array.isArray(json) &&
        json !== null &&
        hasOwnProperty(json, "tree") &&
        hasOwnProperty(json, "pipelines") &&
        typeof json["tree"] === "object"
    );
}

// Loads a Hyper query plan
export function loadHyperPlan(json: Json): TreeDescription {
    if (hasPipelineEnvelope(json)) {
        return convertHyperPlan(json["tree"], json["pipelines"]);
    }
    return convertOptimizerSteps(json) ?? convertHyperPlan(json);
}

function tryStripPrefix(str, pre) {
    if (str.startsWith(pre)) return str.substring(pre.length);
    return str;
}

// Load a JSON tree from text
export function loadHyperPlanFromText(graphString: string): TreeDescription {
    // Strip `plan` prefix if it exists. This is written by `sql_hyper` if output is forwarded using `\o`
    graphString = tryStripPrefix(graphString, "plan\n");

    // Parse the plan as JSON
    let json: Json;
    try {
        json = JSON.parse(graphString);
    } catch (err) {
        throw new Error("JSON parse failed with '" + err + "'.", {cause: err});
    }
    return loadHyperPlan(json);
}
