/*

Hyper JSON Transformations
--------------------------

To perform from a Hyper JSON tree to a query-graphs tree, we apply the following heuristics:

The main steps are:

1. Convert the overall tree
    * traverse breadth-first over the tree, converting from JSON to our internal representation
    * detect the type of a node based on the `operator` or `expression` key
      For other nodes, decide based on their value: if it is of a plain type (string, number, ...), show it as part
      of the tooltip; otherwise show it as part of the tree. A few pre-defined keys (e.g., "analyze", are alsways rendered
      in the tooltip, though)
    * lookup a type-specific config which configures the icon, display name etc.
    * render children in a logically meaningful order, i.e. render "left" before "right" etc.
    * collapse tree by defautl:
        * for operators: collapse all children which are not operators
        * for expressions: don't collapse anything
2. Add additional details in a 2nd pass: edge widths, highlighting particularly long-running queries, ...

*/

import {TreeNode, TreeDescription, Crosslink, IconName, PipelineInfo, visitTreeNodes, allChildren} from "./tree-description";
import {Json, JsonObject, forceToString, tryToString, formatMetric, hasOwnProperty, tryGetPropertyPath} from "./loader-utils";

// A categorical color palette for execution pipelines.
// Curated for good separation and readability on a white background
// (based on the Tableau 10 palette, with the low-contrast yellow darkened).
const PIPELINE_PALETTE = [
    "#4e79a7", // blue
    "#f28e2b", // orange
    "#59a14f", // green
    "#e15759", // red
    "#b07aa1", // purple
    "#76b7b2", // teal
    "#9c6b3f", // brown
    "#ff9da7", // pink
    "#b5992b", // gold
    "#8c8c8c", // gray
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
    "op:executiontarget": {icon: "run-query-symbol"},
    "op:select": {icon: "filter-symbol"},
    "op:sort": {icon: "sort-symbol"},
    "op:groupby": {icon: "groupby-symbol"},
    // Joins
    "op:join": {icon: "inner-join-symbol", crosslinkSourceKey: "magic"},
    "op:leftouterjoin": {icon: "left-join-symbol", crosslinkSourceKey: "magic"},
    "op:rightouterjoin": {icon: "right-join-symbol", crosslinkSourceKey: "magic"},
    "op:fullouterjoin": {icon: "full-join-symbol", crosslinkSourceKey: "magic"},
    "op:leftantijoin": {crosslinkSourceKey: "magic"},
    "op:rightantijoin": {crosslinkSourceKey: "magic"},
    "op:leftsemijoin": {crosslinkSourceKey: "magic"},
    "op:rightsemijoin": {crosslinkSourceKey: "magic"},
    "op:leftsinglejoin": {crosslinkSourceKey: "magic"},
    "op:rightsinglejoin": {crosslinkSourceKey: "magic"},
    "op:leftmarkjoin": {crosslinkSourceKey: "magic"},
    "op:rightmarkjoin": {crosslinkSourceKey: "magic"},
    "op:earlyprobe": {icon: "filter-symbol", crosslinkSourceKey: "builder"},
    // Various scans
    "op:tablescan": {icon: "table-symbol"},
    "op:arrowscan": {icon: "table-symbol"},
    "op:binaryscan": {icon: "table-symbol"},
    "op:csvscan": {icon: "table-symbol"},
    "op:cloudtablescan": {icon: "table-symbol"},
    "op:cursorscan": {icon: "table-symbol"},
    "op:icebergscan": {icon: "table-symbol"},
    "op:parquetscan": {icon: "table-symbol"},
    "op:tdescan": {icon: "table-symbol"},
    // Other tables
    "op:tableconstruction": {icon: "const-table-symbol"},
    "op:virtualtable": {icon: "virtual-table-symbol"},
    // Temp & Explicit scan
    "op:explicitscan": {icon: "temp-table-symbol", crosslinkSourceKey: "input"},
    "op:temp": {icon: "temp-table-symbol"},
    "op:iterationincrement": {crosslinkSourceKey: "source"},
    // Expressions
    "exp:comparison": {displayNameKey: "mode"},
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
                renderingConfig = nodeRenderingConfig[`op:${nodeTag}`] ?? {};
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
        const propertyKeys = ["debug-name", "debugName", "analyze", "sqlpos"];
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
        const errored = conversionState.metadata.has("Error") && tryGetPropertyPath(rawNode, ["analyze", "running"]) === true;
        if (errored) {
            convertedNode.iconColor = "red";
        }

        // Information on the execution time
        const execTime = tryGetPropertyPath(rawNode, ["analyze", "cpu-cycles"]);
        if (typeof execTime === "number") {
            conversionState.runtimes.push({node: convertedNode, time: execTime});
        }

        // Display the number of rows flowing on the links between the nodes.
        // Edge *thickness* encodes the data volume (rows), which is the classic
        // query-graphs semantic. The old format exposes `cardinality` (estimate)
        // and `analyze.tuple-count` (actual); the new FORMAT JSON exposes
        // `statistics.estimated-rows` (estimate) and `statistics.output-rows`
        // (actual, ANALYZE only; `processed-rows` as a fallback).
        let estimatedCard =
            hasOwnProperty(rawNode, "cardinality") && typeof rawNode.cardinality === "number" ? rawNode.cardinality : undefined;
        let actualCard: Json | undefined = tryGetPropertyPath(rawNode, ["analyze", "tuple-count"]);
        if (estimatedCard === undefined) {
            const estRows = tryGetPropertyPath(rawNode, ["statistics", "estimated-rows"]);
            if (typeof estRows === "number") estimatedCard = estRows;
        }
        if (typeof actualCard !== "number") {
            actualCard =
                tryGetPropertyPath(rawNode, ["statistics", "output-rows"]) ??
                tryGetPropertyPath(rawNode, ["statistics", "processed-rows"]);
        }
        if (estimatedCard !== undefined || typeof actualCard === "number") {
            if (typeof actualCard === "number") {
                conversionState.edgeWidths.push({node: convertedNode, width: actualCard});
                convertedNode.edgeLabel =
                    estimatedCard !== undefined
                        ? formatMetric(actualCard) + "/" + formatMetric(estimatedCard)
                        : formatMetric(actualCard);
                // Highlight significant differences between planned and actual rows
                if (estimatedCard !== undefined && (estimatedCard > actualCard * 10 || actualCard * 10 < estimatedCard)) {
                    convertedNode.edgeClass = "qg-label-highlighted";
                }
            } else if (estimatedCard !== undefined) {
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

function convertHyperPlan(node: Json): TreeDescription {
    const conversionState = {
        operatorsById: new Map<string, TreeNode>(),
        crosslinks: [],
        edgeWidths: [],
        runtimes: [],
        metadata: new Map<string, string>(),
    } as ConversionState;
    // Check if the query failed
    const errorMsg = tryGetPropertyPath(node, ["analyze", "error", "message", "original"]);
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
    return {root, crosslinks, metadata: conversionState.metadata};
}

// A raw pipeline entry, as parsed from the `pipelines` array of the plan.
interface RawPipeline {
    id: number;
    operatorIds: number[];
    statistics?: Map<string, string>;
    // Raw ANALYZE cost counters (only present under EXPLAIN ANALYZE). In the
    // PIPELINES output, cpu-cycles/wall-time live on the pipeline, not on the
    // individual operators.
    cpuCycles?: number;
    wallTime?: number;
}

// Assign a horizontal ("x") rank to every tree node, mirroring how the tree is
// laid out left-to-right: leaves are numbered in depth-first order, and each
// inner node is placed at the centroid of its children. This ordering is
// layout-independent (it does not change when nodes are expanded/collapsed),
// which keeps pipeline colors stable while the user explores the plan.
function computeHorizontalRanks(root: TreeNode): Map<TreeNode, number> {
    const ranks = new Map<TreeNode, number>();
    let nextLeaf = 0;
    const assign = (node: TreeNode): number => {
        const children = node.children ?? [];
        let rank: number;
        if (children.length === 0) {
            rank = nextLeaf++;
        } else {
            let sum = 0;
            for (const child of children) sum += assign(child);
            rank = sum / children.length;
        }
        ranks.set(node, rank);
        return rank;
    };
    assign(root);
    return ranks;
}

function parsePipelineStatistics(node: Json): Map<string, string> | undefined {
    if (typeof node !== "object" || Array.isArray(node) || node === null) return undefined;
    const stats = new Map<string, string>();
    // Cycle counts and wall-time are the interesting per-pipeline ANALYZE metrics.
    const cpuCycles = node["cpu-cycles"];
    if (typeof cpuCycles === "number") stats.set("cpu-cycles", formatMetric(cpuCycles));
    const wallTime = node["wall-time"];
    if (typeof wallTime === "number") stats.set("wall-time", formatDuration(wallTime));
    if (stats.size === 0) return undefined;
    return stats;
}

// Format a nanosecond duration into a compact, human-readable string.
function formatDuration(nanos: number): string {
    if (nanos < 1e3) return `${nanos.toFixed(0)} ns`;
    if (nanos < 1e6) return `${(nanos / 1e3).toFixed(1)} µs`;
    if (nanos < 1e9) return `${(nanos / 1e6).toFixed(1)} ms`;
    return `${(nanos / 1e9).toFixed(2)} s`;
}

// Parse and validate the `pipelines` array of the plan.
function parsePipelines(pipelinesJson: Json): RawPipeline[] {
    if (!Array.isArray(pipelinesJson)) {
        throw new Error("Invalid Hyper query plan: `pipelines` must be an array");
    }
    const pipelines: RawPipeline[] = [];
    for (const entry of pipelinesJson) {
        if (typeof entry !== "object" || Array.isArray(entry) || entry === null) continue;
        const id = entry["id"];
        const operators = entry["operators"];
        if (typeof id !== "number" || !Array.isArray(operators)) continue;
        const operatorIds = operators.filter((o): o is number => typeof o === "number");
        const stats = entry["statistics"];
        let cpuCycles: number | undefined;
        let wallTime: number | undefined;
        if (typeof stats === "object" && !Array.isArray(stats) && stats !== null) {
            if (typeof stats["cpu-cycles"] === "number") cpuCycles = stats["cpu-cycles"];
            if (typeof stats["wall-time"] === "number") wallTime = stats["wall-time"];
        }
        pipelines.push({
            id,
            operatorIds,
            statistics: parsePipelineStatistics(stats),
            cpuCycles,
            wallTime,
        });
    }
    return pipelines;
}

// Project the merged execution pipelines onto the operator tree and assign colors.
//
// Coloring follows two rules requested by the visualization:
//  * Pipelines are assigned palette colors left-to-right (by their left-most
//    operator), so neighboring pipelines get visually distinct hues.
//  * An operator that belongs to several pipelines is colored by the *right-most*
//    of those pipelines. This makes the UNION ALL / fork-share cases read
//    naturally: the shared "pipeline above" a UNION ALL (executed once per input)
//    takes on the color of the right-most input pipeline, and a forked/shared
//    source keeps the color of the right-most consumer that reads from it.
function assignPipelineColors(root: TreeNode, operatorsById: Map<string, TreeNode>, pipelines: RawPipeline[]): PipelineInfo[] {
    const ranks = computeHorizontalRanks(root);
    const nodeRank = (n: TreeNode) => ranks.get(n) ?? 0;

    // Resolve each pipeline's member operators to tree nodes and compute its
    // horizontal extent (min/max rank of any member operator).
    interface ResolvedPipeline extends RawPipeline {
        nodes: TreeNode[];
        minRank: number;
        maxRank: number;
    }
    const resolved: ResolvedPipeline[] = pipelines.map((p) => {
        const nodes: TreeNode[] = [];
        for (const opId of p.operatorIds) {
            const node = operatorsById.get(opId.toString());
            if (node) nodes.push(node);
        }
        const memberRanks = nodes.map(nodeRank);
        return {
            ...p,
            nodes,
            minRank: memberRanks.length ? Math.min(...memberRanks) : Infinity,
            maxRank: memberRanks.length ? Math.max(...memberRanks) : -Infinity,
        };
    });

    // Assign palette colors in left-to-right order.
    const colorOrder = [...resolved].sort((a, b) => a.minRank - b.minRank || a.maxRank - b.maxRank || a.id - b.id);
    const colorById = new Map<number, string>();
    const infoById = new Map<number, PipelineInfo>();
    const legend: PipelineInfo[] = [];
    colorOrder.forEach((p, idx) => {
        const color = pipelineColor(idx);
        colorById.set(p.id, color);
        const info: PipelineInfo = {id: p.id, color, operatorCount: p.nodes.length, statistics: p.statistics};
        infoById.set(p.id, info);
        legend.push(info);
    });

    // For each operator, record every pipeline it belongs to and pick the
    // right-most one (largest maxRank, ties broken by id) as its display color.
    const nodePipelines = new Map<TreeNode, ResolvedPipeline[]>();
    for (const p of resolved) {
        for (const node of p.nodes) {
            const list = nodePipelines.get(node) ?? [];
            list.push(p);
            nodePipelines.set(node, list);
        }
    }
    // Total CPU cost across all pipelines, used to turn per-pipeline cpu-cycles
    // into a relative "hotness" (ANALYZE only).
    const totalCpuCycles = resolved.reduce((sum, p) => sum + (p.cpuCycles ?? 0), 0);

    for (const [node, ps] of nodePipelines) {
        const winner = ps.reduce((best, p) =>
            p.maxRank > best.maxRank || (p.maxRank === best.maxRank && p.id > best.id) ? p : best,
        );
        node.pipelineColor = colorById.get(winner.id);
        node.pipelineIds = ps.map((p) => p.id).sort((a, b) => a - b);
        // All pipeline colors, ordered left-to-right so the segmented bar lines
        // up with the pipelines as they appear below the operator.
        node.pipelineColors = [...ps]
            .sort((a, b) => a.minRank - b.minRank || a.maxRank - b.maxRank || a.id - b.id)
            .map((p) => colorById.get(p.id))
            .filter((c): c is string => c !== undefined);

        // Overlay the ANALYZE cost of the operator's dominant pipeline. Hue keeps
        // encoding pipeline *identity* (icon/bar/border); the label *background*
        // encodes the pipeline's CPU *cost* as heat -- the same channel the older
        // per-operator cpu-cycle highlighting used, so the two compose cleanly.
        if (winner.cpuCycles !== undefined && totalCpuCycles > 0) {
            const share = winner.cpuCycles / totalCpuCycles;
            if (share >= 0.05) {
                const l = (95 + (72 - 95) * Math.min(1, share)).toFixed(1);
                node.nodeColor = `hsl(309, 84%, ${l}%)`;
            }
            // Surface the per-pipeline numbers on the operator (there is no
            // legend); shown in the expanded body.
            if (!node.properties) node.properties = new Map<string, string>();
            node.properties.set("pipeline", `#${winner.id}`);
            node.properties.set("pipeline cpu-cycles", formatMetric(winner.cpuCycles));
            if (winner.wallTime !== undefined) node.properties.set("pipeline wall-time", formatDuration(winner.wallTime));
            node.properties.set("pipeline cost", `${(share * 100).toFixed(1)}%`);
        }
    }

    // Color each edge by the right-most pipeline shared by both of its endpoints.
    // If the parent and child share no pipeline, the edge is a pipeline breaker
    // and is left neutral, so the color changes visibly at pipeline boundaries.
    const byId = new Map<number, ResolvedPipeline>();
    for (const p of resolved) byId.set(p.id, p);
    const rightmostOf = (ids: number[]): number =>
        ids.reduce((best, id) => {
            const a = byId.get(id);
            const b = byId.get(best);
            if (!a) return best;
            if (!b) return id;
            return a.maxRank > b.maxRank || (a.maxRank === b.maxRank && id > best) ? id : best;
        });
    const walkEdges = (node: TreeNode, parent: TreeNode | undefined) => {
        if (parent && node.pipelineIds && parent.pipelineIds) {
            const parentIds = parent.pipelineIds;
            const common = node.pipelineIds.filter((id) => parentIds.includes(id));
            if (common.length) {
                // All pipelines flowing across this edge, ordered left-to-right.
                const ordered = common
                    .map((id) => byId.get(id))
                    .filter((p): p is ResolvedPipeline => p !== undefined)
                    .sort((a, b) => a.minRank - b.minRank || a.maxRank - b.maxRank || a.id - b.id);
                node.edgeColors = ordered.map((p) => colorById.get(p.id)).filter((c): c is string => c !== undefined);
                node.edgeColor = colorById.get(rightmostOf(common));
            }
        }
        for (const child of allChildren(node)) walkEdges(child, node);
    };
    walkEdges(root, undefined);

    return legend;
}

// Load a Hyper plan that carries a merged execution-pipeline graph
// (`EXPLAIN (FORMAT JSON, PIPELINES, ...)`), i.e. a top-level `{tree, pipelines}`.
function convertHyperPlanWithPipelines(node: JsonObject): TreeDescription {
    const treeDescription = convertHyperPlan(node["tree"]);
    // Rebuild the operator-id map over the produced tree so pipelines can be resolved.
    const operatorsById = new Map<string, TreeNode>();
    visitTreeNodes(
        treeDescription.root,
        (n) => {
            const opId = n.properties?.get("operator-id") ?? n.properties?.get("operatorId");
            if (opId !== undefined) operatorsById.set(opId, n);
        },
        allChildren,
    );
    const pipelines = parsePipelines(node["pipelines"]);
    treeDescription.pipelines = assignPipelineColors(treeDescription.root, operatorsById, pipelines);
    return treeDescription;
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
        return convertHyperPlanWithPipelines(json);
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
        throw new Error("JSON parse failed with '" + err + "'.");
    }
    return loadHyperPlan(json);
}
