/*

DuckDB JSON Transformations
----------------------------

DuckDB's `EXPLAIN (FORMAT JSON)` already emits a clean, uniform tree: every node is
`{name, children, extra_info}`, where `extra_info` is a flat map of already-stringified
properties (values are strings, or arrays of strings). This is much more regular than
Hyper's plan JSON (arbitrary nested objects/arrays keyed by operator-specific field names),
so the conversion below is a straightforward, non-adaptive map:

* every `extra_info` entry becomes a tooltip property, verbatim
* every `children` entry becomes a tree child, in DuckDB's own order
* the operator `name` is classified into an icon by a handful of exact matches (`FILTER`,
  `ORDER_BY`, `COLUMN_DATA_SCAN`, ...) plus suffix rules for the families DuckDB names
  systematically (`*_JOIN`, `*_SCAN`, `*_GROUP_BY`) -- unlike Hyper, there's no need for an
  exhaustive per-tag lookup table since DuckDB's own names are already regular.

`EXPLAIN (ANALYZE, FORMAT JSON)` wraps the same tree in a top-level object carrying
whole-query stats (`latency`, `rows_returned`, ...) and an extra `EXPLAIN_ANALYZE` node;
that wrapper is unwrapped, and the per-node runtime metrics it adds (`operator_timing`,
`operator_cardinality`) feed the same cardinality-edge and runtime-coloring helpers Hyper
uses (see `loader-utils.ts`).

DuckDB assigns each CTE (`CTE`/`REC_CTE`) a small integer index, referenced by its scans
(`CTE_SCAN`/`REC_CTE_SCAN`) via `CTE Index`. This is used to draw a crosslink from a scan
back to the CTE it reads -- the same idea as Hyper's magic joins or Postgres's `CTE Scan`.

*/

import type {TreeNode, TreeDescription, IconName} from "./tree-description";
import type {Json, JsonObject, UnresolvedCrosslink} from "./loader-utils";
import {
    forceToString,
    tryToString,
    formatMetric,
    hasOwnProperty,
    resolveCrosslinks,
    setEdgeWidths,
    colorRelativeExecutionTime,
    setCardinalityEdgeLabel,
} from "./loader-utils";

// Temporary state which we hold during converting from JSON to internal graph representation
interface ConversionState {
    cteById: Map<string, TreeNode>;
    crosslinks: UnresolvedCrosslink[];
    edgeWidths: {node: TreeNode; width: number}[];
    runtimes: {node: TreeNode; time: number}[];
}

function createConversionState(): ConversionState {
    return {cteById: new Map(), crosslinks: [], edgeWidths: [], runtimes: []};
}

// Like `tryToString`, but treats a missing key as absent rather than stringifying it to `"undefined"`.
function getString(obj: JsonObject, key: string): string | undefined {
    return hasOwnProperty(obj, key) ? tryToString(obj[key]) : undefined;
}

const joinTypeIcons: Record<string, IconName> = {
    INNER: "inner-join-symbol",
    LEFT: "left-join-symbol",
    RIGHT: "right-join-symbol",
    FULL: "full-join-symbol",
    // SEMI/ANTI/MARK/SINGLE joins are intentionally left without an icon, same as Hyper.
};

// Classify an operator by name into an icon and, for CTEs, a nicer display name.
// DuckDB names its operators systematically (`*_JOIN`, `*_SCAN`, `*_GROUP_BY`), so most of
// this is suffix-based rather than an exhaustive per-name table.
function classifyOperator(name: string, extraInfo: JsonObject): {icon?: IconName; displayName?: string} {
    if (name === "FILTER") return {icon: "filter-symbol"};
    if (name === "ORDER_BY" || name === "TOP_N") return {icon: "sort-symbol"};
    if (name === "CTE" || name === "REC_CTE") return {displayName: getString(extraInfo, "CTE Name")};
    // A `DUMMY_SCAN` is DuckDB's single synthesized row for a query without a FROM clause,
    // the same role Postgres's "Result" plays -- rendered the same way, as a constant table.
    if (name === "DUMMY_SCAN" || name === "COLUMN_DATA_SCAN") return {icon: "const-table-symbol"};
    if (name.endsWith("GROUP_BY")) return {icon: "groupby-symbol"};
    if (name === "CROSS_PRODUCT") return {icon: "inner-join-symbol"};
    if (name.endsWith("JOIN")) {
        return {icon: joinTypeIcons[getString(extraInfo, "Join Type") ?? ""]};
    }
    if (name.endsWith("SCAN")) {
        return hasOwnProperty(extraInfo, "Table") ? {icon: "table-symbol"} : {icon: "temp-table-symbol"};
    }
    return {};
}

function formatDuration(seconds: number): string {
    if (seconds < 1e-3) return (seconds * 1e6).toFixed(0) + "us";
    if (seconds < 1) return (seconds * 1e3).toFixed(1) + "ms";
    return seconds.toFixed(3) + "s";
}

// Convert a single DuckDB plan node (and its children) to a TreeNode.
// Once past the top-level format check, this never throws: a malformed child just renders
// with whatever partial information is available, per the project's "permissive loader" rule.
function convertDuckDBNode(rawNode: Json, state: ConversionState): TreeNode {
    if (typeof rawNode !== "object" || Array.isArray(rawNode) || rawNode === null) {
        return {name: forceToString(rawNode)};
    }

    // Plain `EXPLAIN` nodes carry `name`; `EXPLAIN ANALYZE` nodes carry `operator_name` instead.
    // DuckDB also pads some names with a trailing space (e.g. `"SEQ_SCAN "`).
    const name = (getString(rawNode, "name") ?? getString(rawNode, "operator_name") ?? "").trim();
    const rawExtraInfo = rawNode["extra_info"];
    const extraInfo: JsonObject =
        typeof rawExtraInfo === "object" && !Array.isArray(rawExtraInfo) && rawExtraInfo !== null ? rawExtraInfo : {};

    const properties = new Map<string, string>();
    for (const key of Object.getOwnPropertyNames(extraInfo)) {
        const value = extraInfo[key];
        properties.set(key, Array.isArray(value) ? value.map((v) => forceToString(v)).join(", ") : forceToString(value));
    }

    const rawChildren = rawNode["children"];
    const children = Array.isArray(rawChildren) ? rawChildren.map((c) => convertDuckDBNode(c, state)) : [];

    const {icon, displayName} = classifyOperator(name, extraInfo);
    const convertedNode: TreeNode = {name: displayName ?? name, icon, properties, children};

    // Link a CTE (`CTE`/`REC_CTE`) to the scans (`CTE_SCAN`/`REC_CTE_SCAN`) reading it, via their shared index.
    if (name === "CTE" || name === "REC_CTE") {
        const tableIndex = getString(extraInfo, "Table Index");
        if (tableIndex !== undefined) state.cteById.set(tableIndex, convertedNode);
    } else if (name === "CTE_SCAN" || name === "REC_CTE_SCAN") {
        const cteIndex = getString(extraInfo, "CTE Index");
        if (cteIndex !== undefined) state.crosslinks.push({source: convertedNode, targetId: cteIndex});
    }

    // Display the cardinality on the incoming edge
    const estimatedCard = Number(properties.get("Estimated Cardinality"));
    if (!Number.isNaN(estimatedCard)) {
        const actualCard = rawNode["operator_cardinality"];
        setCardinalityEdgeLabel(
            convertedNode,
            state.edgeWidths,
            estimatedCard,
            typeof actualCard === "number" ? actualCard : undefined,
        );
    }

    // `EXPLAIN ANALYZE` adds a per-node measured runtime; feed it into the tooltip and the runtime coloring.
    const timing = rawNode["operator_timing"];
    if (typeof timing === "number") {
        properties.set("Operator Timing", formatDuration(timing));
        state.runtimes.push({node: convertedNode, time: timing});
    }

    return convertedNode;
}

// `EXPLAIN (ANALYZE, FORMAT JSON)` wraps the real plan in an extra `EXPLAIN_ANALYZE` node.
// Unwrap it so the visible root is the same operator plain `EXPLAIN` would show.
function unwrapAnalyzeEnvelope(envelope: JsonObject): Json {
    const children = envelope["children"];
    if (!Array.isArray(children) || children.length !== 1) return envelope;
    const wrapper = children[0];
    if (typeof wrapper !== "object" || Array.isArray(wrapper) || wrapper === null) return wrapper;
    const wrapperChildren = wrapper["children"];
    return Array.isArray(wrapperChildren) && wrapperChildren.length === 1 ? wrapperChildren[0] : wrapper;
}

function convertDuckDBAnalyzePlan(envelope: JsonObject): TreeDescription {
    const state = createConversionState();
    const root = convertDuckDBNode(unwrapAnalyzeEnvelope(envelope), state);
    colorRelativeExecutionTime(state.runtimes);
    setEdgeWidths(state.edgeWidths);
    const crosslinks = resolveCrosslinks(state.cteById, state.crosslinks);

    // Whole-query stats have no natural node to sit on, so they go into the graph-level metadata.
    const metadata = new Map<string, string>();
    const latency = envelope["latency"];
    if (typeof latency === "number") metadata.set("Latency", formatDuration(latency));
    const rowsReturned = envelope["rows_returned"];
    if (typeof rowsReturned === "number") metadata.set("Rows Returned", formatMetric(rowsReturned));

    return {root, crosslinks, metadata};
}

// Detects the top-level envelope of `EXPLAIN (ANALYZE, FORMAT JSON)`.
function isAnalyzeEnvelope(json: Json): json is JsonObject {
    return (
        typeof json === "object" &&
        !Array.isArray(json) &&
        json !== null &&
        typeof json["latency"] === "number" &&
        typeof json["cpu_time"] === "number" &&
        Array.isArray(json["children"])
    );
}

function isPlanNode(json: Json): json is JsonObject {
    return (
        typeof json === "object" &&
        !Array.isArray(json) &&
        json !== null &&
        typeof json["name"] === "string" &&
        Array.isArray(json["children"]) &&
        typeof json["extra_info"] === "object"
    );
}

// Loads a DuckDB query plan
export function loadDuckDBPlan(json: Json): TreeDescription {
    if (isAnalyzeEnvelope(json)) {
        return convertDuckDBAnalyzePlan(json);
    }

    // Plain `EXPLAIN (FORMAT JSON)` wraps the root node in a single-element array.
    const node = Array.isArray(json) && json.length === 1 ? json[0] : json;
    if (!isPlanNode(node)) {
        throw new Error("Invalid DuckDB query plan");
    }
    const state = createConversionState();
    const root = convertDuckDBNode(node, state);
    setEdgeWidths(state.edgeWidths);
    const crosslinks = resolveCrosslinks(state.cteById, state.crosslinks);
    return {root, crosslinks};
}

// Load a JSON tree from text
export function loadDuckDBPlanFromText(text: string): TreeDescription {
    let json: Json;
    try {
        json = JSON.parse(text);
    } catch (err) {
        throw new Error("JSON parse failed with '" + err + "'.", {cause: err});
    }
    return loadDuckDBPlan(json);
}
