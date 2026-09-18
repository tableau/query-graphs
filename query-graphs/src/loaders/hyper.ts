/*

Hyper JSON Transformations
--------------------------

We transform a Hyper JSON tree into a query-graphs tree using the following heuristics:

1. Convert the overall tree
    * traverse the tree recursively, converting from JSON to our internal representation
    * detect the type of a node based on its `operator` or `expression` key.
      For other keys, decide based on their value: a plain value (string, number, ...) becomes
      part of the tooltip; anything else becomes part of the tree. A few pre-defined keys
      (e.g., `statistics`) are always rendered in the tooltip, though.
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
import {forceToString, tryToString, formatMetric, formatBytes, hasOwnProperty, tryGetPropertyPath} from "./loader-utils";

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

// Highlight the edge label when estimated vs. actual rows differ by at least this factor.
const CARDINALITY_MISMATCH_FACTOR = 10;

// Runtime hotspot heatmap: flag a node whose cpu-cycles are >= this share of the plan total, tinting it
// `hsl(HUE, SAT%, L%)` where L runs from BASE (lightest, at threshold) to PEAK (darkest, dominant node).
const HOTSPOT_MIN_RATIO = 0.05;
const HOTSPOT_HUE = 309;
const HOTSPOT_SATURATION = 84;
const HOTSPOT_LIGHTNESS_BASE = 95;
const HOTSPOT_LIGHTNESS_PEAK = 72;

// The FORMAT JSON rework renamed the runtime block `analyze` -> `statistics`; read the new name, then legacy.
function getStatistic(rawNode: Json, key: string): Json | undefined {
    return tryGetPropertyPath(rawNode, ["statistics", key]) ?? tryGetPropertyPath(rawNode, ["analyze", key]);
}

// First candidate that is actually a number. Unlike `??`, this skips a present-but-non-numeric value
// (e.g. a string placeholder) instead of stopping there and masking a real number further down.
function firstNumber(...candidates: (Json | undefined)[]): number | undefined {
    for (const c of candidates) {
        if (typeof c === "number") return c;
    }
    return undefined;
}

// Estimated cardinality: top-level `estimated-rows` (formerly `cardinality`); external plans carry it inside
// the runtime block, so fall back via `getStatistic` (`statistics` then legacy `analyze`) before `cardinality`.
function getEstimatedRows(rawNode: Json): number | undefined {
    return firstNumber(
        tryGetPropertyPath(rawNode, ["estimated-rows"]),
        getStatistic(rawNode, "estimated-rows"),
        tryGetPropertyPath(rawNode, ["cardinality"]),
    );
}

// Measured output rows; old ANALYZE'd plans expose it as `analyze.tuple-count`.
function getActualRows(rawNode: Json): number | undefined {
    return firstNumber(getStatistic(rawNode, "output-rows"), tryGetPropertyPath(rawNode, ["analyze", "tuple-count"]));
}

// Reorder the property map to `front` keys first, then any keys not named in `front`/`tail` (in their existing
// order), then `tail` keys last (in the given order). Missing keys are skipped.
function reorderProperties(properties: Map<string, string>, front: string[], tail: string[] = []): void {
    const reordered = new Map<string, string>();
    const pinned = new Set([...front, ...tail]);
    for (const key of front) {
        const value = properties.get(key);
        if (value !== undefined) reordered.set(key, value);
    }
    for (const [key, value] of properties) {
        if (!pinned.has(key)) reordered.set(key, value);
    }
    for (const key of tail) {
        const value = properties.get(key);
        if (value !== undefined) reordered.set(key, value);
    }
    properties.clear();
    for (const [key, value] of reordered) properties.set(key, value);
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
    "op:output": {icon: "run-query-symbol"},
    "op:filter": {icon: "filter-symbol"},
    "op:sort": {icon: "sort-symbol"},
    "op:group-by": {icon: "groupby-symbol"},
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
    "op:right-outer-join": {icon: "right-join-symbol", crosslinkSourceKey: "magic"},
    "op:full-outer-join": {icon: "full-join-symbol", crosslinkSourceKey: "magic"},
    "op:left-anti-join": {crosslinkSourceKey: "magic"},
    "op:right-anti-join": {crosslinkSourceKey: "magic"},
    "op:left-semi-join": {crosslinkSourceKey: "magic"},
    "op:right-semi-join": {crosslinkSourceKey: "magic"},
    "op:left-single-join": {crosslinkSourceKey: "magic"},
    "op:right-single-join": {crosslinkSourceKey: "magic"},
    "op:left-mark-join": {crosslinkSourceKey: "magic"},
    "op:right-mark-join": {crosslinkSourceKey: "magic"},
    "op:early-probe": {icon: "filter-symbol", crosslinkSourceKey: "builder"},
    // Various scans
    "op:scan": {displayNameKey: "type", icon: "table-symbol"},
    "op:scan:virtual-table": {displayNameKey: "type", icon: "virtual-table-symbol"},
    "op:table-scan": {icon: "table-symbol"},
    "op:arrow-scan": {icon: "table-symbol"},
    "op:binary-scan": {icon: "table-symbol"},
    "op:csv-scan": {icon: "table-symbol"},
    "op:cloud-table-scan": {icon: "table-symbol"},
    "op:cursor-scan": {icon: "table-symbol"},
    "op:iceberg-scan": {icon: "table-symbol"},
    "op:parquet-scan": {icon: "table-symbol"},
    "op:tde-scan": {icon: "table-symbol"},
    // Other tables
    "op:table-construction": {icon: "const-table-symbol"},
    "op:virtual-table": {icon: "virtual-table-symbol"},
    // Temp & Explicit scan
    "op:explicit-scan": {icon: "temp-table-symbol", crosslinkSourceKey: "input"},
    "op:temp": {icon: "temp-table-symbol"},
    "op:iteration-increment": {crosslinkSourceKey: "source"},
    // Inserts
    "op:insert": {displayNameKey: "type"},
    // Expressions
    "exp:comparison": {displayNameKey: "mode"},
    "exp:iu-ref": {displayNameKey: "iu"},
    "exp:reference": {displayNameKey: "id"},
};

// Legacy tags before the kebab-case transition.
const legacyNodeTags: Record<string, string> = {
    "op:executiontarget": "op:execution-target",
    "op:select": "op:filter",
    "op:groupby": "op:group-by",
    "op:leftouterjoin": "op:left-outer-join",
    "op:rightouterjoin": "op:right-outer-join",
    "op:fullouterjoin": "op:full-outer-join",
    "op:leftantijoin": "op:left-anti-join",
    "op:rightantijoin": "op:right-anti-join",
    "op:leftsemijoin": "op:left-semi-join",
    "op:rightsemijoin": "op:right-semi-join",
    "op:leftsinglejoin": "op:left-single-join",
    "op:rightsinglejoin": "op:right-single-join",
    "op:leftmarkjoin": "op:left-mark-join",
    "op:rightmarkjoin": "op:right-mark-join",
    "op:earlyprobe": "op:early-probe",
    "op:tablescan": "op:table-scan",
    "op:arrowscan": "op:arrow-scan",
    "op:binaryscan": "op:binary-scan",
    "op:csvscan": "op:csv-scan",
    "op:cloudtablescan": "op:cloud-table-scan",
    "op:cursorscan": "op:cursor-scan",
    "op:icebergscan": "op:iceberg-scan",
    "op:parquetscan": "op:parquet-scan",
    "op:tdescan": "op:tde-scan",
    "op:tableconstruction": "op:table-construction",
    "op:virtualtable": "op:virtual-table",
    "op:explicitscan": "op:explicit-scan",
    "op:iterationincrement": "op:iteration-increment",
    "exp:iuref": "exp:iu-ref",
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
                const configKey = legacyNodeTags[`op:${nodeTag}`] ?? `op:${nodeTag}`;
                const subtype = tryToString(rawNode["type"]);
                if (subtype !== undefined && nodeRenderingConfig[`${configKey}:${subtype}`]) {
                    renderingConfig = nodeRenderingConfig[`${configKey}:${subtype}`];
                } else {
                    renderingConfig = nodeRenderingConfig[configKey] ?? {};
                }
            }
        } else if (rawNode.hasOwnProperty("expression")) {
            const val = tryToString(rawNode["expression"]);
            if (val !== undefined) {
                nodeType = "expression";
                nodeTag = val;
                const configKey = legacyNodeTags[`exp:${nodeTag}`] ?? `exp:${nodeTag}`;
                renderingConfig = nodeRenderingConfig[configKey] ?? {};
            }
        }

        // Keys kept out of the generic dump. `debug-name` (a `{classification, value}` wrapper) is surfaced as a
        // clean `table-or-alias` row; raw `statistics`/`analyze`/`sqlpos` are dropped in favour of the tidy metric
        // rows below. `cardinality`/`table-metadata` are excluded too, since the curated code re-surfaces them
        // (formatted `estimated-rows`, grouped `table-metadata`) — keeping them would duplicate the raw data.
        const propertyKeys = ["debug-name", "statistics", "analyze", "sqlpos", "cardinality", "table-metadata"];
        const debugNameValue = tryGetPropertyPath(rawNode, ["debug-name", "value"]);
        if (typeof debugNameValue === "string") {
            properties.set("table-or-alias", debugNameValue);
        } else if (rawNode.hasOwnProperty("debug-name")) {
            properties.set("table-or-alias", forceToString(rawNode["debug-name"]));
        }

        // Determine the order in which other keys are displayed.
        // For some keys, we enforce a specific order here (e.g., "left" comes before "right").
        // For all other keys, we use alphabetic order.
        const fixedChildOrder = ["inputs", "input", "left", "right", "value", "value-for-comparison"];
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

        // Figure out the display name (reusing the `debug-name.value` read above for the `table-or-alias` row).
        const specificDisplayName = renderingConfig.displayNameKey ? properties.get(renderingConfig.displayNameKey) : undefined;
        const debugName = typeof debugNameValue === "string" ? debugNameValue : undefined;
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
        const errored = conversionState.metadata.has("Error") && getStatistic(rawNode, "running") === true;
        if (errored) {
            convertedNode.iconColor = "red";
        }

        // `cpu-cycles` is the operator's execution cost; feed it to the hotspot pass (colors the busiest nodes).
        // Via `getStatistic` so it matches the `cpu-cycles` row below (both honour legacy `analyze`).
        const cpuCycles = getStatistic(rawNode, "cpu-cycles");
        if (typeof cpuCycles === "number") {
            conversionState.runtimes.push({node: convertedNode, time: cpuCycles});
        }

        // Estimated/actual cardinalities back both the edge label and the tooltip rows below; compute each once.
        const estimatedCard = getEstimatedRows(rawNode);
        const actualCard = getActualRows(rawNode);

        // Cardinality on the edge between nodes. Sharing these values keeps the edge label consistent with the
        // tooltip rows (so a legacy `analyze`/`cardinality` plan isn't blank).
        if (typeof estimatedCard === "number") {
            if (typeof actualCard === "number") {
                conversionState.edgeWidths.push({node: convertedNode, width: actualCard});
                convertedNode.edgeLabel = formatMetric(actualCard) + "/" + formatMetric(estimatedCard);
                // Highlight significant differences between planned and actual rows
                if (
                    estimatedCard > actualCard * CARDINALITY_MISMATCH_FACTOR ||
                    actualCard > estimatedCard * CARDINALITY_MISMATCH_FACTOR
                ) {
                    convertedNode.edgeClass = "qg-label-highlighted";
                }
            } else {
                conversionState.edgeWidths.push({node: convertedNode, width: estimatedCard});
                convertedNode.edgeLabel = formatMetric(estimatedCard);
            }
        }

        // Surface cardinalities and key runtime volumes as tidy formatted rows (the raw `statistics` block is hidden).
        if (typeof estimatedCard === "number") properties.set("estimated-rows", formatMetric(estimatedCard));
        if (typeof actualCard === "number") properties.set("output-rows", formatMetric(actualCard));
        const processedRows = getStatistic(rawNode, "processed-rows");
        if (typeof processedRows === "number") properties.set("processed-rows", formatMetric(processedRows));
        const rowsMatching = getStatistic(rawNode, "rows-matching-restrictions");
        if (typeof rowsMatching === "number") properties.set("rows-matching", formatMetric(rowsMatching));
        const memoryBytes = getStatistic(rawNode, "memory-bytes");
        if (typeof memoryBytes === "number") properties.set("memory-bytes", formatBytes(memoryBytes));
        // Reuse `cpuCycles` from the hotspot pass; surface it and `execution-time` as rows.
        if (typeof cpuCycles === "number") properties.set("cpu-cycles", formatMetric(cpuCycles));
        const executionTime = getStatistic(rawNode, "execution-time");
        if (typeof executionTime === "number") properties.set("execution-time", formatMetric(executionTime));

        // Lakehouse scans carry `table-metadata` (identifier cols, partitioning, sort order); pack it into one
        // grouped `label: value` block the UI renders as a header + sub-items (see `groupedProperties`).
        const tableMetadata = rawNode["table-metadata"];
        if (tableMetadata !== null && typeof tableMetadata === "object" && !Array.isArray(tableMetadata)) {
            // A column transform: `identity` is bare, anything else wraps it (`bucket[16](Id__c)`).
            const withTransform = (transform: Json | undefined, column: Json | undefined): string | undefined => {
                if (typeof column !== "string") return undefined;
                return typeof transform !== "string" || transform === "identity" ? column : `${transform}(${column})`;
            };
            const metaLines: string[] = [];
            const identifierFields = tableMetadata["identifier-fields"];
            if (Array.isArray(identifierFields) && identifierFields.length > 0) {
                const cols = identifierFields
                    .map((f) => tryGetPropertyPath(f, ["column"]))
                    .filter((c): c is string => typeof c === "string");
                if (cols.length > 0) metaLines.push(`identifier: ${cols.join(", ")}`);
            }
            const partitionTransforms = tableMetadata["partition-transforms"];
            if (Array.isArray(partitionTransforms) && partitionTransforms.length > 0) {
                const parts = partitionTransforms
                    .map((p) => withTransform(tryGetPropertyPath(p, ["transform"]), tryGetPropertyPath(p, ["source", "column"])))
                    .filter((p): p is string => p !== undefined);
                if (parts.length > 0) metaLines.push(`partitioned-by: ${parts.join(", ")}`);
            }
            const sortKeys = tryGetPropertyPath(tableMetadata, ["sort-order", "sort-keys"]);
            if (Array.isArray(sortKeys) && sortKeys.length > 0) {
                const keys = sortKeys
                    .map((k) => {
                        const col = withTransform(
                            tryGetPropertyPath(k, ["transform"]),
                            tryGetPropertyPath(k, ["source", "column"]),
                        );
                        if (col === undefined) return undefined;
                        const dir = tryGetPropertyPath(k, ["direction"]);
                        const nulls = tryGetPropertyPath(k, ["null-order"]);
                        return [col, dir, nulls].filter((x): x is string => typeof x === "string").join(" ");
                    })
                    .filter((k): k is string => k !== undefined);
                if (keys.length > 0) metaLines.push(`sort-order: ${keys.join(", ")}`);
            }
            if (metaLines.length > 0) {
                properties.set("table-metadata", metaLines.join("\n"));
                (convertedNode.groupedProperties ??= new Set()).add("table-metadata");
            }
        }

        // Fixed row order: identity/volume rows first, then metadata, runtime figures, and finally the operator
        // identifiers. Any keys not named here keep their existing order after this list.
        reorderProperties(
            properties,
            [
                "table-or-alias",
                "estimated-rows",
                "processed-rows",
                "rows-matching",
                "output-rows",
                "memory-bytes",
                "table-metadata",
                "execution-time",
                "cpu-cycles",
            ],
            ["type", "operator-id"],
        );

        // Add to `operator-id` map if applicable.
        if (nodeType == "operator") {
            const operatorId = properties?.get("operator-id");
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
        const l = (HOTSPOT_LIGHTNESS_BASE + (HOTSPOT_LIGHTNESS_PEAK - HOTSPOT_LIGHTNESS_BASE) * relativeExecutionRatio).toFixed(3);
        const flagged = relativeExecutionRatio >= HOTSPOT_MIN_RATIO;
        op.node.nodeColor = flagged ? `hsl(${HOTSPOT_HUE}, ${HOTSPOT_SATURATION}%, ${l}%)` : undefined;
        // Echo the hotspot flag onto the `cpu-cycles` row so the driving figure stands out, not just the header.
        if (flagged) (op.node.highlightedProperties ??= new Set()).add("cpu-cycles");
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
    const errorMsg = tryGetPropertyPath(node, ["statistics", "error", "message", "original"]);
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
