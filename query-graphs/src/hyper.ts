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

import {TreeNode, TreeDescription, Crosslink, IconName} from "./tree-description";
import {Json, JsonObject, forceToString, tryToString, formatMetric, tryGetPropertyPath} from "./loader-utils";
import {DEFAULT_THRESHOLDS, isCardinalityMismatch, isCostlyScan, costlyScanShade} from "./highlight-rules";

interface UnresolvedCrosslink {
    source: TreeNode;
    targetOpId: string;
}

// Operator tags that read a base table/file. These are the only operators that populate scan-only
// statistics (`processed-rows`, `rows-matching-restrictions`) and that show estimated-rows /
// rows-matching on their outgoing edge.
const SCAN_OPERATORS = new Set([
    "tablescan",
    "arrowscan",
    "binaryscan",
    "csvscan",
    "cloudtablescan",
    "cursorscan",
    "icebergscan",
    "parquetscan",
    "tdescan",
]);

// The threshold heuristics (costly scan, cardinality misestimate, runtime hotspot) and their default
// values now live in highlight-rules.ts, so the loader and the render-time recompute share a single
// source of truth. The loader seeds each node with the default-threshold verdict; the UI recomputes
// live when the user edits a threshold. See `deriveNodeDisplay`.

// Read a runtime-statistics field from a Hyper operator. In the FORMAT JSON rework (W-22563058),
// Hyper renamed the per-operator runtime-statistics block from `analyze` to `statistics`, and
// renamed the measured output cardinality field from `tuple-count` to `output-rows`. We look up
// the new `statistics` block first and fall back to the legacy `analyze` block so both old and
// new plans keep working.
function getStatistic(rawNode: Json, key: string): Json | undefined {
    return tryGetPropertyPath(rawNode, ["statistics", key]) ?? tryGetPropertyPath(rawNode, ["analyze", key]);
}

// The key `statistics` is overloaded in Hyper JSON: on most operators it is the per-operator runtime
// block renamed from `analyze` (cpu-cycles, tuple-count/output-rows, processed-rows, ...), but on a
// base-table scan it can instead be a table/column *metadata* block (`columns` distinct-value counts,
// `valid`, `timestamp`). Only the runtime block is redundant with the clean top-level properties we
// surface; the metadata block carries information shown nowhere else, so it must not be dropped.
// Distinguish by looking for any of the runtime metrics — the metadata block has none of them.
const RUNTIME_STATISTIC_KEYS = ["cpu-cycles", "tuple-count", "output-rows", "processed-rows", "running", "pipeline"];
function isRuntimeStatistics(stats: Json | undefined): boolean {
    if (typeof stats !== "object" || stats === null || Array.isArray(stats)) return false;
    return RUNTIME_STATISTIC_KEYS.some((k) => k in stats);
}

// Read an operator's optimizer row estimate. The top-level `cardinality` field was renamed to
// `estimated-rows` in the FORMAT JSON rework (W-22563058); read the new name first and fall back to
// the legacy one so both old and new plans keep working.
function getEstimatedRows(rawNode: Json): Json | undefined {
    return tryGetPropertyPath(rawNode, ["estimated-rows"]) ?? tryGetPropertyPath(rawNode, ["cardinality"]);
}

// Surface the optimizer row estimate once, as a metric-formatted `estimated-rows` property. The
// generic property loop adds a raw, unformatted copy under whichever key the plan used
// (`estimated-rows` or legacy `cardinality`); drop both so the estimate appears only once.
function setFormattedEstimatedRows(properties: Map<string, string>, estRows: number) {
    properties.delete("estimated-rows");
    properties.delete("cardinality");
    properties.set("estimated-rows", formatMetric(estRows));
}

// Read an operator's measured output cardinality, honoring the legacy field name. `getStatistic`
// only knows the post-rework `output-rows` key (looked up in either the `statistics` or `analyze`
// block); the pre-rework name was `analyze.tuple-count`. Shared by the generic-operator path and
// the legacy-scan fallback so both read the actual row count the same way.
function getActualRows(rawNode: Json): Json | undefined {
    const outputRows = getStatistic(rawNode, "output-rows");
    return outputRows === undefined ? tryGetPropertyPath(rawNode, ["analyze", "tuple-count"]) : outputRows;
}

// Set the estimate/actual edge label, width, raw signals, and cardinality-misestimate highlight on a
// node's incoming edge. Shared by the generic-operator path and both scan paths so the label format,
// the misestimate test, and the reason wording stay identical across all three. `isScan` selects the
// scan wording (the "actual" is the matched-restrictions count) over the generic wording (measured
// output rows); it is stored as `cardIsScan` and MUST match how `deriveNodeDisplay` re-derives the
// reason at render time, or the first render (baked) would disagree with every later one (derived).
function setCardinalityEdge(node: TreeNode, conversionState: ConversionState, estimate: number, actual: number, isScan: boolean) {
    // Edge *width* follows the actual row count so every edge stays on one global min/max scale
    // (`setEdgeWidths` normalizes against it); mixing an estimate in would skew that range.
    conversionState.edgeWidths.push({node, width: actual});
    // Label reads estimate/actual (estimate first) to match the estimate/actual rework; this is an
    // intentional Hyper convention and differs from postgres.ts's older actual/estimated order.
    node.edgeLabel = formatMetric(estimate) + "/" + formatMetric(actual);
    // Store the raw estimate/actual so the edge-mismatch highlight can be recomputed at render time
    // when the user edits the cardinality thresholds.
    node.cardEstimate = estimate;
    node.cardActual = actual;
    node.cardIsScan = isScan;
    // Highlight a significant estimate-vs-actual difference, but only when the larger side is big
    // enough to matter (the floor in `isCardinalityMismatch`): without it a 36-vs-0 miss highlights
    // the same as a 540M-vs-0 one, since a >ratio difference is trivially true whenever actual is 0.
    if (isCardinalityMismatch(estimate, actual, DEFAULT_THRESHOLDS)) {
        node.edgeClass = "qg-label-highlighted";
        const dir = estimate > actual ? "over-estimated" : "under-estimated";
        const subject = isScan ? "this scan's output" : "this operator's output";
        const tail = isScan
            ? `estimated ${formatMetric(estimate)} rows, ${formatMetric(actual)} matched the restrictions.`
            : `estimated ${formatMetric(estimate)} rows, actual ${formatMetric(actual)}.`;
        node.edgeReason = `Cardinality misestimate: the optimizer ${dir} ${subject} — ${tail}`;
    }
}

// Temporary state which we hold during converting from JSON to internal graph representation
interface ConversionState {
    operatorsById: Map<string, TreeNode>;
    crosslinks: UnresolvedCrosslink[];
    edgeWidths: {node: TreeNode; width: number}[];
    runtimes: {node: TreeNode; time: number}[];
    // Every scan's processed-rows volume, used to total scan work and shade costly scans proportionally.
    scanProcessed: {node: TreeNode; processed: number}[];
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
            // `debug-name`/`debugName` holds the table name as a sensitivity-wrapped string
            // (`{classification, value}` in Hyper's `AnySensitivityString`). Surface just the value
            // under the friendlier `table-name` label rather than dumping the raw JSON. Fall back to
            // the raw stringification for the plain-string spelling used by older plans.
            if (key === "debug-name" || key === "debugName") {
                const value = tryGetPropertyPath(rawNode, [key, "value"]);
                if (typeof value === "string") {
                    properties.set("table-name", value);
                    continue;
                }
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
                // Drop only the per-operator *runtime* `statistics` block (the post-W-22563058 rename
                // of `analyze`): the metrics that matter (cpu-cycles, processed-rows, output-rows, ...)
                // are already surfaced as clean top-level properties, so rendering the raw block —
                // either as a subtree or as a stringified blob property — would only duplicate them.
                // A `statistics` block that instead carries table/column metadata (e.g. per-column
                // `columns` distinct-value/uniqueness data on a base-table scan) is unrelated to the
                // runtime block and must still be shown, so keep it.
                if (k === "statistics" && isRuntimeStatistics(rawNode[k])) return false;
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

        // Highlight the node which errored out, in case the query failed.
        // `running` lives in the runtime statistics block, which Hyper renamed from `analyze` to
        // `statistics` in the FORMAT JSON rework (W-22563058); read both for backwards compat.
        const errored = conversionState.metadata.has("Error") && getStatistic(rawNode, "running") === true;
        if (errored) {
            convertedNode.iconColor = "red";
        }

        // Information on the execution time
        const execTime = getStatistic(rawNode, "cpu-cycles");
        if (typeof execTime === "number") {
            conversionState.runtimes.push({node: convertedNode, time: execTime});
            // Raw signal for the render-time runtime-hotspot recompute.
            convertedNode.cpuTime = execTime;
            // Surface the measured CPU cycles directly on the node, so it is visible without
            // expanding the collapsed "statistics" subtree.
            properties.set("cpu-cycles", formatMetric(execTime));
        }

        // Scan operators own their outgoing edge below (they show estimated-rows / rows-matching
        // instead of the generic estimate / actual), so the generic cardinality block is skipped for
        // them. Determining this up front keeps a single source of truth per node: a scan's edge is
        // set once, in the scan block, avoiding a double `edgeWidths` push and an `edgeClass` clobber.
        const isScanOperator = nodeType == "operator" && nodeTag !== undefined && SCAN_OPERATORS.has(nodeTag);

        // Display the cardinality on the links between the nodes.
        // `cardinality` (optimizer estimate) was renamed to `estimated-rows`, and the measured
        // `analyze.tuple-count` became `statistics.output-rows`, both in the FORMAT JSON rework.
        const estimatedCardRaw = getEstimatedRows(rawNode);
        if (typeof estimatedCardRaw === "number" && !isScanOperator) {
            const estimatedCard = estimatedCardRaw;
            const actualCard = getActualRows(rawNode);
            if (typeof actualCard === "number") {
                setCardinalityEdge(convertedNode, conversionState, estimatedCard, actualCard, false);
            } else {
                conversionState.edgeWidths.push({node: convertedNode, width: estimatedCard});
                convertedNode.edgeLabel = formatMetric(estimatedCard);
            }
        }

        // Surface the key scan statistics directly on table/scan nodes, so they are visible
        // without having to expand the collapsed "statistics" subtree. These live in the newer
        // Hyper "statistics" block (as emitted by `FormatJsonConverter`); `getStatistic` also reads
        // the legacy "analyze" block for backwards compatibility.
        if (isScanOperator) {
            // Group the row-count metrics together in the node body. `output-rows` is intentionally
            // omitted here: it is already shown as the "actual" cardinality on the edge label above.
            // `est-rows` is the optimizer estimate, which lives at the operator top level
            // (`estimated-rows`, formerly `cardinality`) rather than inside the statistics block.
            // Reuse the value already read above rather than walking the property path again.
            const estRows = estimatedCardRaw;
            if (typeof estRows === "number") {
                setFormattedEstimatedRows(properties, estRows);
            }
            // [statistics field, display label]
            const scanStatMetrics: [string, string][] = [
                ["processed-rows", "processed-rows"],
                ["rows-matching-restrictions", "rows-matching"],
            ];
            for (const [jsonKey, label] of scanStatMetrics) {
                const value = getStatistic(rawNode, jsonKey);
                if (typeof value === "number") {
                    properties.set(label, formatMetric(value));
                }
            }
            // A costly scan reads far more rows than survive its restrictions (low selectivity) —
            // exactly the signal Hyper's index recommender keys off of. estimated-rows is not used
            // for the costly-scan test below: the actual processed-vs-matching ratio is what matters.
            const processedRows = getStatistic(rawNode, "processed-rows");
            const rowsMatching = getStatistic(rawNode, "rows-matching-restrictions");
            if (typeof rowsMatching === "number" && typeof estRows === "number") {
                // For scan nodes the outgoing edge shows estimated-rows / rows-matching: rows-matching
                // is the scan's actual output, so it drives both the label's "actual" and the edge
                // width. `isScan` = true selects the "matched the restrictions" reason wording.
                setCardinalityEdge(convertedNode, conversionState, estRows, rowsMatching, true);
            } else if (typeof estRows === "number") {
                // No `rows-matching-restrictions` (e.g. a legacy `analyze` plan, where that key never
                // existed). Fall back to the scan's measured *output* cardinality (`output-rows`, or
                // the pre-rework `tuple-count`) — the same actual the generic cardinality block
                // (skipped for scans) uses for other operators; without it the actual was silently
                // dropped and the edge showed estimate-only. `isScan` = false here because this actual
                // is measured output, not the matched-restrictions count, so the generic wording fits.
                const actualCard = getActualRows(rawNode);
                if (typeof actualCard === "number") {
                    setCardinalityEdge(convertedNode, conversionState, estRows, actualCard, false);
                } else {
                    // No measured actual at all: estimate-only edge, same label/width the generic block
                    // would emit.
                    conversionState.edgeWidths.push({node: convertedNode, width: estRows});
                    convertedNode.edgeLabel = formatMetric(estRows);
                }
            }
            // Detect a costly scan. Only scans of a meaningful size (>= 1M processed rows) qualify.
            // `rows-matching == 0` is the extreme costly case — read everything, kept nothing — so
            // it always counts; otherwise flag a >= 100x processed-to-matching ratio. A costly scan
            // highlights the whole node, its edge label, and the processed-rows / rows-matching rows.
            if (typeof processedRows === "number") {
                // Remember the raw scan volume so the plan-insights summary can total it and the
                // "top offenders" list can rank scans.
                convertedNode.scanProcessedRows = processedRows;
                // Collect it for the plan-wide processed-rows total, which shades costly scans below.
                conversionState.scanProcessed.push({node: convertedNode, processed: processedRows});
            }
            if (typeof rowsMatching === "number") {
                convertedNode.scanRowsMatching = rowsMatching;
            }
            if (typeof processedRows === "number" && typeof rowsMatching === "number") {
                // Require a meaningful absolute scan size before flagging a costly scan; otherwise
                // small scans (e.g. 100 processed, 0 matching) all look costly. Uses the default
                // thresholds; the UI recomputes this live when the user edits them.
                const costlyScan = isCostlyScan(processedRows, rowsMatching, DEFAULT_THRESHOLDS);
                if (costlyScan) {
                    // Costly is the top-precedence node color; it always wins over index-rec/index-used.
                    convertedNode.highlightNode = "costly-scan";
                    // `processed-rows` is billed at row-group granularity: the whole row group is
                    // billed once any page in it is fetched/decoded, so it reflects billing cost, not
                    // rows literally scanned. A low match-per-processed ratio means many row groups
                    // were read/billed to return few rows (little pruning) — an index or better
                    // clustering would cut the cost.
                    convertedNode.highlightReason =
                        `Costly scan: billed ${formatMetric(processedRows)} rows (whole row groups), ` +
                        `only ${formatMetric(rowsMatching)} matched the restrictions — few matches per row group read.`;
                    convertedNode.edgeClass = "qg-label-highlighted";
                    // The costly-scan reason takes precedence as the edge tooltip too.
                    convertedNode.edgeReason = convertedNode.highlightReason;
                    // Flag the costly scan so the `processed-rows` / `rows-matching` property rows
                    // render in light red.
                    convertedNode.costlyScan = true;
                }
            }
            // Index-recommendation candidate: only present when Hyper flags a candidate column.
            // `should-recommend-candidate` (under `statistics.index-recommender`) is Hyper's verdict
            // on whether the candidate is actually worth building.
            const idxRecColumn = tryGetPropertyPath(rawNode, ["index-recommendation-candidate", "column"]);
            if (typeof idxRecColumn === "string") {
                const shouldRecommend = tryGetPropertyPath(rawNode, [
                    "statistics",
                    "index-recommender",
                    "should-recommend-candidate",
                ]);
                const suffix = shouldRecommend === true ? " (recommended)" : shouldRecommend === false ? " (not recommended)" : "";
                properties.set("index-rec", idxRecColumn + suffix);
                // Category membership is independent of the display color: a costly scan can also
                // carry an index recommendation, so record it regardless of which color wins below.
                convertedNode.hasIndexRec = true;
                // Record the index-rec category as the node's non-threshold "base" highlight, so the
                // render-time recompute can restore it when a costly scan no longer claims the node.
                const verdict =
                    shouldRecommend === true
                        ? " Hyper recommends building it."
                        : shouldRecommend === false
                          ? " Hyper does not recommend building it."
                          : "";
                convertedNode.baseHighlight = "index-rec";
                convertedNode.baseHighlightReason = `Index-recommendation candidate on column "${idxRecColumn}".${verdict}`;
                // Color the node for an index recommendation now, unless a costly scan already claimed
                // it (costly has higher precedence).
                if (convertedNode.highlightNode !== "costly-scan") {
                    convertedNode.highlightNode = convertedNode.baseHighlight;
                    convertedNode.highlightReason = convertedNode.baseHighlightReason;
                }
            }

            // Report whether an index was actually used for this scan. Hyper emits `used-index`
            // (an object `{name, covered, ...}`) only when a scan actually used an index; the
            // top-level `available-indexes` count reflects how many indexes exist on the table.
            // So: `used-index` present -> which index (and covering vs. seek); otherwise, if
            // indexes exist -> "no". These are Iceberg/foreign-scan, FORMAT INTERNAL-only fields.
            const usedIndexName = tryGetPropertyPath(rawNode, ["used-index", "name"]);
            const availableIndexes = tryGetPropertyPath(rawNode, ["available-indexes"]);
            if (typeof availableIndexes === "number") {
                // Re-add the count in the fixed position below; drop the raw copy added by the generic
                // property loop so it appears only once. The plural label reads correctly as a count
                // ("available-indexes: 3") rather than as an index named "3".
                properties.delete("available-indexes");
                properties.set("available-indexes", formatMetric(availableIndexes));
            }
            if (typeof usedIndexName === "string") {
                const covered = tryGetPropertyPath(rawNode, ["used-index", "covered"]);
                const suffix = covered === true ? " (covered)" : covered === false ? " (seek)" : "";
                properties.set("index-used", usedIndexName + suffix);
                // Category membership is independent of the display color (see hasIndexRec above).
                convertedNode.hasIndexUsed = true;
                // Record index-used as the base highlight only when no higher-precedence base (an
                // index recommendation) already claimed it, so the render-time recompute restores the
                // right category. Costly scan is recomputed separately and outranks both.
                if (convertedNode.baseHighlight === undefined) {
                    const how = covered === true ? "a covering scan" : covered === false ? "an index seek" : "an index";
                    convertedNode.baseHighlight = "index-used";
                    convertedNode.baseHighlightReason = `Used index "${usedIndexName}" (${how}).`;
                }
                // Color the node for an actually-used index, unless a costly scan or an index
                // recommendation already claimed it (both have higher precedence).
                if (convertedNode.highlightNode === undefined) {
                    convertedNode.highlightNode = "index-used";
                    convertedNode.highlightReason = convertedNode.baseHighlightReason;
                }
            } else if (typeof availableIndexes === "number" && availableIndexes > 0) {
                properties.set("index-used", "no");
            }

            // Reorder the scan-node properties so the key metrics lead in a fixed, readable order,
            // with all remaining properties following in their existing order. Maps preserve
            // insertion order, so we clear and re-insert in place (keeping the same Map reference
            // that `convertedNode.properties` already points to).
            const scanPropOrder = [
                "table-name",
                "index-rec",
                "estimated-rows",
                "processed-rows",
                "rows-matching",
                "available-indexes",
                "index-used",
            ];
            const reordered = new Map<string, string>();
            for (const key of scanPropOrder) {
                const value = properties.get(key);
                if (value !== undefined) {
                    reordered.set(key, value);
                }
            }
            for (const [key, value] of properties) {
                if (!reordered.has(key)) {
                    reordered.set(key, value);
                }
            }
            properties.clear();
            for (const [key, value] of reordered) {
                properties.set(key, value);
            }
        } else if (nodeType == "operator") {
            // For non-scan operators, surface the actual output alongside the estimate. `output-rows`
            // (measured rows produced) lives inside the nested "statistics" block, so it is not shown
            // by the generic property loop; `estimated-rows` is a top-level number that loop already
            // added as a raw value. Re-add both, metric-formatted and grouped as `estimated-rows`
            // then `output-rows`. `rows-matching` is intentionally not included: it is a scan-only
            // metric (only scan operators populate `rows-matching-restrictions`).
            const estRows = getEstimatedRows(rawNode);
            if (typeof estRows === "number") {
                setFormattedEstimatedRows(properties, estRows);
            }
            const outputRows = getStatistic(rawNode, "output-rows");
            if (typeof outputRows === "number") {
                properties.set("output-rows", formatMetric(outputRows));
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

// Tint expensive operators with a magenta runtime heatmap, and explain that cost in the tooltips.
// Returns the total CPU cycles across all operators, so the render-time recompute can determine each
// operator's runtime share against the live hotspot threshold.
function colorRelativeExecutionTime(state: ConversionState): number {
    const totalTime = state.runtimes.reduce((p, v) => p + v.time, 0);
    if (totalTime <= 0) return totalTime;
    for (const op of state.runtimes) {
        const relativeExecutionRatio = op.time / totalTime;
        const isHotspot = relativeExecutionRatio >= DEFAULT_THRESHOLDS.runtimeHotspotPercent / 100;
        const l = (95 + (72 - 95) * relativeExecutionRatio).toFixed(3);
        // Violet, distinct from the magenta cardinality-misestimate edge highlight. Keep this in sync
        // with `deriveNodeDisplay` in highlight-rules.ts, which recomputes the same tint at render time.
        op.node.nodeColor = isHotspot ? `hsl(265, 70%, ${l}%)` : undefined;
        // A hotspot's violet tint appears on the node label. Append the CPU-cycles share to the tooltips
        // so that magenta coloring reads as "this is expensive", not just "this is flagged".
        if (isHotspot) {
            const pct = Math.round(relativeExecutionRatio * 100);
            const cpuReason = `Runtime CPU hotspot: used ${formatMetric(op.time)} CPU cycles — ${pct}% of the plan's total runtime.`;
            // Each reason goes on its own line so multiple findings on one node stay legible.
            op.node.highlightReason = op.node.highlightReason ? `${op.node.highlightReason}\n${cpuReason}` : cpuReason;
            if (op.node.edgeReason) {
                op.node.edgeReason = `${op.node.edgeReason}\n${cpuReason}`;
            }
        }
    }
    return totalTime;
}

// Shade each costly scan's node box proportionally to its share of all rows the plan's scans read,
// mirroring the runtime-hotspot heatmap. Returns the summed processed-rows across every scan, so the
// render-time recompute can re-derive each scan's share against the live thresholds.
function shadeCostlyScans(state: ConversionState): number {
    const processedTotal = state.scanProcessed.reduce((p, v) => p + v.processed, 0);
    for (const scan of state.scanProcessed) {
        // Only the scans flagged costly under the default thresholds are tinted; the rest stay plain.
        // Keep this in sync with `deriveNodeDisplay` in highlight-rules.ts, which recomputes the same
        // shade at render time via the shared `costlyScanShade` helper.
        if (scan.node.costlyScan) {
            scan.node.costlyScanColor = costlyScanShade(scan.processed, processedTotal);
        }
    }
    return processedTotal;
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
        scanProcessed: [],
        metadata: new Map<string, string>(),
    } as ConversionState;
    // Check if the query failed. The runtime statistics block was renamed from `analyze` to
    // `statistics` in the FORMAT JSON rework (W-22563058); read both for backwards compat.
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
    const planCpuTotal = colorRelativeExecutionTime(conversionState);
    const planProcessedTotal = shadeCostlyScans(conversionState);
    setEdgeWidths(conversionState);
    const crosslinks = resolveCrosslinks(conversionState);
    // The Hyper loader stores raw signals on each node, so the threshold-based highlights (costly
    // scan, cardinality misestimate, runtime hotspot) can be recomputed at render time from adjustable
    // thresholds. The baked values above are the default-threshold seed for the first render.
    return {
        root,
        crosslinks,
        metadata: conversionState.metadata,
        planSource: "hyper",
        adjustableHighlights: true,
        planCpuTotal,
        planProcessedTotal,
    };
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
    // Deliberately not `adjustableHighlights`: an optimizer-steps tree stitches several independent
    // plans under one root, each with its own runtime totals, so there is no single `planCpuTotal`
    // to recompute hotspots against. The per-step nodes keep the default-threshold highlights baked
    // by `convertHyperPlan`; the live threshold editor is only offered for single-plan trees.
    return {root, crosslinks, metadata: properties, planSource: "hyper"};
}

// Loads a Hyper query plan
export function loadHyperPlan(json: Json): TreeDescription {
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
