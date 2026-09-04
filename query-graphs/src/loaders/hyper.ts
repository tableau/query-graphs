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
import {
    DEFAULT_THRESHOLDS,
    isCardinalityMismatch,
    isCostlyScan,
    isHighVolumeScan,
    highVolumeScanReason,
    costlyScanReason,
    runtimeHotspotReason,
    memoryHotspotReason,
    costlyScanShade,
    runtimeHotspotShade,
    memoryHotspotShade,
    duplicateColumnsReason,
} from "../highlight-rules";

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

// Operator tags that read a base table/file. These are the only operators that populate scan-only
// statistics (`processed-rows`, `rows-matching-restrictions`) and that show estimated-rows /
// rows-matching on their outgoing edge.
const SCAN_OPERATORS = new Set([
    // The newer FORMAT JSON / "inputs"-array plans emit a single generic `scan` operator (with a
    // `type` field like `data-lake-object`) instead of the older per-format `tablescan`/`icebergscan`/…
    // tags. Treat it as a scan so scan-specific handling (metrics, costly-scan detection, Iceberg
    // `table-metadata`) applies.
    "scan",
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

// Join operators carry a `condition` expression describing which columns are equated (the join
// predicate). We surface that predicate inline so the fields involved in the join are visible
// without drilling into the collapsed `condition` subtree — mirroring what we do for filters.
const JOIN_OPERATORS = new Set([
    "join",
    "leftouterjoin",
    "rightouterjoin",
    "fullouterjoin",
    "leftantijoin",
    "rightantijoin",
    "leftsemijoin",
    "rightsemijoin",
    "leftsinglejoin",
    "rightsinglejoin",
    "leftmarkjoin",
    "rightmarkjoin",
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

// Read the operator-level error carried in the runtime-statistics block of a failed (analyzed) plan.
// When a query errors mid-execution, Hyper records the error on the operator that raised it as an
// object: `{code, message: {original, translation}, detail, hint, source}` (the operator that was
// *running* when it happened is flagged separately via `running: true`). A successful operator carries
// `error: null`. Return a readable one-line string (preferring the translated message, then the raw
// one, then a plain-string error), optionally prefixed with the SQLSTATE code — or undefined when the
// node has no error value, so the caller only surfaces it on the node that actually failed.
function getErrorMessage(rawNode: Json): string | undefined {
    const error = getStatistic(rawNode, "error");
    if (typeof error !== "object" || error === null || Array.isArray(error)) {
        // A plain-string error (older / simpler shapes) is used as-is; anything else (incl. `null`) has
        // no message to show.
        return typeof error === "string" && error.length > 0 ? error : undefined;
    }
    const messageNode = tryGetPropertyPath(error, ["message"]);
    let message: string | undefined;
    if (typeof messageNode === "string") {
        message = messageNode;
    } else {
        const translation = tryGetPropertyPath(error, ["message", "translation"]);
        const original = tryGetPropertyPath(error, ["message", "original"]);
        message = typeof translation === "string" ? translation : typeof original === "string" ? original : undefined;
    }
    if (message === undefined || message.length === 0) return undefined;
    const code = tryGetPropertyPath(error, ["code"]);
    return typeof code === "string" && code.length > 0 ? `[${code}] ${message}` : message;
}

// The measured runtime metrics an operator can emit into its `analyze` / `statistics` block, mapped
// to the clean property name we surface them under. `tuple-count` (renamed `output-rows`) is the
// count of rows the operator produced — for a table-valued UDF like `hybrid_search` this is its
// "matched" count, the analog of a scan's rows-matching-restrictions. The others are timing /
// memory / scheduling telemetry. All are opportunistic: only present on analyzed (runtime) plans.
const RUNTIME_METRIC_PROPS: {key: string; prop: string; format: (v: number) => string}[] = [
    {key: "execution-time", prop: "execution-time", format: (v) => formatMetric(v)},
    {key: "memory-bytes", prop: "memory-bytes", format: (v) => formatBytes(v)},
    {key: "pipeline", prop: "pipeline", format: (v) => v.toString()},
];

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
// the legacy one so both old and new plans keep working. "External" analyze plans carry the estimate
// only inside the runtime `statistics` block (`statistics.estimated-rows`, with no top-level copy), so
// read that too — otherwise those plans lose all edge estimates, edge widths, and misestimate highlights.
function getEstimatedRows(rawNode: Json): Json | undefined {
    return (
        tryGetPropertyPath(rawNode, ["estimated-rows"]) ??
        tryGetPropertyPath(rawNode, ["statistics", "estimated-rows"]) ??
        tryGetPropertyPath(rawNode, ["cardinality"])
    );
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

// A `udtablefunction` operator invokes a table-valued UDF — e.g. Data Cloud's `hybrid_search`, which
// fuses vector + keyword retrieval over an index. The interesting details (which index, how many
// records it spans, the vector DB, the embedding model, the similarity metric) live several levels
// deep in the UDF's argument metadata, under
// `args[i].variant.language-specific-metadata.properties.<key>.value`, and each `value` is itself a
// JSON-encoded string. These helpers dig those out so the loader can surface them on the node instead
// of leaving them buried in the collapsed `args` subtree.
function findUdfMetadataProperties(rawNode: Json): JsonObject | undefined {
    const args = tryGetPropertyPath(rawNode, ["args"]);
    if (!Array.isArray(args)) return undefined;
    for (const arg of args) {
        const props = tryGetPropertyPath(arg, ["variant", "language-specific-metadata", "properties"]);
        if (typeof props === "object" && props !== null && !Array.isArray(props)) {
            return props as JsonObject;
        }
    }
    return undefined;
}

// Read a `{classification, value}`-wrapped metadata entry as a plain string.
function getUdfMetadataString(props: JsonObject, key: string): string | undefined {
    const value = tryGetPropertyPath(props, [key, "value"]);
    return typeof value === "string" ? value : undefined;
}

// Find the view / table a table-valued UDF searches over. Its first argument is a `tableref` whose
// `table-name` carries `{database, schema, table}`; return the bare table name (the most useful part;
// e.g. the `..._index__dlm` model/view the search targets).
function findUdfTableName(rawNode: Json): string | undefined {
    const args = tryGetPropertyPath(rawNode, ["args"]);
    if (!Array.isArray(args)) return undefined;
    for (const arg of args) {
        const table = tryGetPropertyPath(arg, ["variant", "tableref", "table-name", "table"]);
        if (typeof table === "string") return table;
    }
    return undefined;
}

// Find the underlying source table(s) behind a search UDF's index/view. The UDF metadata lists the
// physical data-lake tables it reads under `language-specific-metadata.leafTables[].tableName.table`
// (e.g. the `..._chunk__dll` data-lake table backing the `..._index__dlm` view). Returns the distinct
// leaf-table names, in order, so a search node can report its real source table separately from the
// `table-name` view it targets. Empty when no distinct leaf tables are present.
function findUdfLeafTables(rawNode: Json): string[] {
    const args = tryGetPropertyPath(rawNode, ["args"]);
    if (!Array.isArray(args)) return [];
    const names: string[] = [];
    const seen = new Set<string>();
    for (const arg of args) {
        const leaves = tryGetPropertyPath(arg, ["variant", "language-specific-metadata", "leafTables"]);
        if (!Array.isArray(leaves)) continue;
        for (const leaf of leaves) {
            const table = tryGetPropertyPath(leaf, ["tableName", "table"]);
            if (typeof table === "string" && !seen.has(table)) {
                seen.add(table);
                names.push(table);
            }
        }
    }
    return names;
}

// Find the relevance-score columns a search UDF emits. A `hybrid_search` returns its retrieved rows
// plus one or more score columns — `vector_score__c` (dense/semantic leg), `keyword_score__c`
// (lexical/BM25 leg), and `hybrid_score__c` (the fused score). Their presence is the *authoritative*
// signal for what the search actually computed: seeing both a keyword and a vector score is direct
// evidence of a true hybrid search, stronger than inferring it from the keyword-index metadata. The
// UDF's projected columns live in `output-columns[].name` (clean, post-rework names); on older plans
// they are in `ius[i]` as `[name, type]` with a truncated `alias.` prefix. Returns the score-column
// short names (`vector`, `keyword`, `hybrid`, or any other `<x>_score__c`) in a stable order.
function findUdfScoreColumns(rawNode: Json): string[] {
    const names: string[] = [];
    const seen = new Set<string>();
    const add = (raw: string | undefined) => {
        if (raw === undefined) return;
        // Strip a leading `alias.` qualifier (present on `ius` entries), then match `<name>_score__c`.
        // Require a non-empty prefix (`.+`) so a column named literally `_score__c` doesn't yield a
        // blank score name.
        const bare = raw.slice(raw.lastIndexOf(".") + 1);
        const m = /^(.+)_score__c$/.exec(bare);
        if (m === null) return;
        const short = m[1];
        if (!seen.has(short)) {
            seen.add(short);
            names.push(short);
        }
    };
    const outputColumns = tryGetPropertyPath(rawNode, ["output-columns"]);
    if (Array.isArray(outputColumns)) {
        for (const col of outputColumns) add(tryToString(tryGetPropertyPath(col, ["name"])));
    }
    // Fall back to `ius` (older plans) only if `output-columns` yielded nothing; `ius` names are
    // truncated (e.g. `hybrid_s.hybrid_s`), so they may not match `_score__c` — this is best-effort.
    if (names.length === 0) {
        const ius = tryGetPropertyPath(rawNode, ["ius"]);
        if (Array.isArray(ius)) {
            for (const entry of ius) add(Array.isArray(entry) ? tryToString(entry[0]) : undefined);
        }
    }
    // Present the fused score first, then the two legs, then anything else — most-to-least summary.
    const rank = (s: string) => (s === "hybrid" ? 0 : s === "vector" ? 1 : s === "keyword" ? 2 : 3);
    return names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// Read one field out of a metadata entry whose `value` is a JSON-encoded string (e.g.
// `vectorDbConnectionDetails`, `embeddingModelDetails`). Returns undefined if the entry is missing,
// isn't valid JSON, or lacks the field.
function getUdfMetadataJsonField(props: JsonObject, key: string, field: string): string | undefined {
    const raw = getUdfMetadataString(props, key);
    if (raw === undefined) return undefined;
    let parsed: Json;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return undefined;
    }
    // Narrow on `typeof === "string"` rather than `tryToString`, which would turn a missing field into
    // the literal string "undefined" — falsely populating `vector-db` and flagging the node as a search.
    const value = tryGetPropertyPath(parsed, [field]);
    return typeof value === "string" ? value : undefined;
}

// Human-readable operator symbols for the binary/comparison expression kinds Hyper emits, so a filter
// condition renders as `a = b` / `x + 1` instead of a deep expression subtree.
const EXPRESSION_OPERATORS: Record<string, string> = {
    add: "+",
    sub: "-",
    mul: "*",
    div: "/",
    mod: "%",
    and: "AND",
    or: "OR",
};

// Hyper encodes a `Double`/`Float` const's `value` as the raw 64-bit IEEE-754 *bit pattern* written as
// an integer (e.g. `0.05` is stored as `4587366580439587154`), not as the numeric value. Reinterpret
// those bits back into the double they represent so a predicate reads `x BETWEEN 0.05 AND 0.33` instead
// of a pair of nonsensical 19-digit integers. Built from two 32-bit words (no BigInt) to stay within the
// project's es5 target. Note: the integer has already passed through `JSON.parse`, which loses precision
// beyond 2^53, so the low mantissa bits are approximate — we trim display noise below. Returns undefined
// when the input isn't a finite integer bit pattern, so the caller falls back to the raw value.
function reinterpretDoubleBits(bits: number): number | undefined {
    if (!Number.isFinite(bits) || bits < 0 || Math.floor(bits) !== bits) {
        return undefined;
    }
    const high = Math.floor(bits / 0x100000000);
    const low = bits - high * 0x100000000;
    // `high` must fit in the upper 32-bit word; a value past that isn't a representable double bit
    // pattern (and can't survive JSON.parse anyway), so leave it to the raw fallback.
    if (high > 0xffffffff) return undefined;
    const dv = new DataView(new ArrayBuffer(8));
    dv.setUint32(0, high);
    dv.setUint32(4, low >>> 0);
    const value = dv.getFloat64(0);
    // The JSON.parse precision loss corrupts the lowest ~3 decimal digits; trim to 13 significant
    // figures (ample for a display summary; the full subtree remains available) so a threshold like
    // 0.05 doesn't render as 0.0500000000000007.
    return Number(value.toPrecision(13));
}

// Render a `const` expression's value, quoting strings so `x = 'PROMO'` is unambiguous vs `x = 3`.
// Hyper encodes different constant types differently: text/int/bool carry a plain `value`; `Double`/
// `Float` carry an IEEE-754 bit pattern; `Numeric`/`BigNumeric` are fixed-point scaled integers (the
// latter split across `low`/`high` with no `value`). Returns undefined for any shape we don't decode,
// so the caller falls back to the full subtree rather than printing a misleading value.
function stringifyConst(expr: JsonObject): string | undefined {
    const value = tryGetPropertyPath(expr, ["value", "value"]);
    const type = tryGetPropertyPath(expr, ["value", "type"]);
    const typeName = Array.isArray(type) ? tryToString(type[0]) : undefined;
    // A null literal carries `null: true` instead of a `value` (e.g. a `date_trunc` argument left
    // unset). Render it as `NULL` rather than bailing — otherwise a single null constant collapses the
    // whole surrounding expression to the subtree fallback.
    if (tryGetPropertyPath(expr, ["value", "null"]) === true) return "NULL";
    // An `Interval` literal has no scalar `value`; it is split into `months` / `days` / `time`
    // (microseconds). Render the non-zero parts (e.g. `INTERVAL 1 day`) so an interval-arithmetic
    // expression reads instead of collapsing to the subtree.
    if (typeName === "Interval") {
        const months = tryGetPropertyPath(expr, ["value", "months"]);
        const days = tryGetPropertyPath(expr, ["value", "days"]);
        const time = tryGetPropertyPath(expr, ["value", "time"]);
        const parts: string[] = [];
        if (typeof months === "number" && months !== 0) parts.push(`${months} month${Math.abs(months) === 1 ? "" : "s"}`);
        if (typeof days === "number" && days !== 0) parts.push(`${days} day${Math.abs(days) === 1 ? "" : "s"}`);
        if (typeof time === "number" && time !== 0) parts.push(`${time}µs`);
        return `INTERVAL ${parts.length > 0 ? parts.join(" ") : "0"}`;
    }
    // `Double`/`Float` values arrive as an IEEE-754 bit pattern (a large integer), not the number
    // itself — reinterpret it back into the double it represents.
    if ((typeName === "Double" || typeName === "Float") && typeof value === "number") {
        const asDouble = reinterpretDoubleBits(value);
        if (asDouble !== undefined) return asDouble.toString();
    }
    // `Numeric[p,s]` / `BigNumeric[p,s]` are fixed-point: an unscaled integer divided by 10^scale
    // (scale = the third element of the type tuple, default 0). `Numeric` keeps the unscaled integer in
    // `value`; `BigNumeric` has no `value` and splits it across 64-bit `low`/`high` halves. Recover the
    // decimal so `sum > 300` reads as such instead of leaking the raw scaled integer (or `undefined`).
    if ((typeName === "Numeric" || typeName === "BigNumeric") && Array.isArray(type)) {
        const scale = typeof type[2] === "number" ? type[2] : 0;
        let unscaled: number | undefined;
        if (typeof value === "number") {
            unscaled = value;
        } else {
            const low = tryGetPropertyPath(expr, ["value", "low"]);
            const high = tryGetPropertyPath(expr, ["value", "high"]);
            // high * 2^64 + low; exact for the common small-constant case (high === 0) and an acceptable
            // display approximation otherwise.
            if (typeof low === "number" && typeof high === "number") {
                unscaled = high * 4294967296 * 4294967296 + low;
            }
        }
        if (unscaled !== undefined) {
            return (scale > 0 ? unscaled / Math.pow(10, scale) : unscaled).toString();
        }
    }
    // Any other type must carry a plain scalar `value`; without one the encoding is unknown, so bail to
    // the subtree instead of rendering the literal string "undefined".
    if (value === undefined) return undefined;
    const str = tryToString(value);
    if (str === undefined) return undefined;
    // Quote textual types; leave numerics/booleans bare.
    const isText = typeName === "Varchar" || typeName === "Char" || typeName === "Text";
    return isText ? `'${str}'` : str;
}

// Hyper labels every column flowing through a plan with an internal "IU" (Information Unit) name,
// not the original SQL column name — which isn't preserved in the plan JSON. A column read by a scan
// is named `scan_<column>`; a column produced by an operator is named after that operator (`union`,
// `GroupByKey`, `map`, …) with a trailing counter to keep it unique. So a join predicate can read
// `union = union82`, which is opaque. This rewrites the internal name into a friendlier origin label
// while preserving the uniqueness counter, so the same predicate reads `⟨union #82⟩` / `orderkey` and
// the reader can tell *where* each side came from. It never invents a real column name we don't have.
const IU_ORIGIN_LABELS: Record<string, string> = {
    union: "union",
    groupbykey: "group key",
    map: "computed",
    tableconstruction: "literal rows",
    setresult: "set result",
    window: "window",
    unnest: "unnest",
};
function humanizeIuName(name: string | undefined): string | undefined {
    if (name === undefined || name.length === 0) return name;
    // A qualified reference (`c.relkind`, `orders.o_orderkey`) already carries a real column name.
    if (name.includes(".")) return name;
    // A scan column is `scan_<column>`; the readable part is the column name itself. Keep any trailing
    // counter (part of the column's disambiguation, e.g. `scan_orderkey2`).
    if (name.startsWith("scan_") && name.length > "scan_".length) {
        return name.slice("scan_".length);
    }
    // Split an optional trailing uniqueness counter off an operator-derived base name.
    const match = /^([A-Za-z_][A-Za-z_]*?)(\d+)$/.exec(name);
    const base = match ? match[1] : name;
    const counter = match ? match[2] : undefined;
    const label = IU_ORIGIN_LABELS[base.toLowerCase()];
    if (label !== undefined) {
        // e.g. `union82` -> `⟨union #82⟩`, `GroupByKey` -> `⟨group key⟩`. The angle brackets flag it as
        // an operator-produced column rather than a named table column.
        return counter !== undefined ? `⟨${label} #${counter}⟩` : `⟨${label}⟩`;
    }
    // Aggregates (`sum`, `avg`, `count2`, …) and anything else are already reasonably readable. Return
    // the name verbatim — crucially INCLUDING any trailing counter. Hyper appends that digit to make the
    // IU unique (a second `count` aggregate becomes `count2`), so it is part of a real, stable column
    // name, not a positional index. It is also exactly what `outputColumnName` prints in the node's
    // "output columns" list, so leaving it intact keeps a filter/join predicate reading `count2 > 1`
    // consistent with the `count2` shown as that operator's output (splitting it to `count #2` would
    // read like an index and diverge from the column list).
    return name;
}

// Plan-scoped map from Hyper's internal IU name to a friendly, real column name. Unlike
// `humanizeIuName` (which only prettifies the internal name), this recovers the *actual* column
// names the plan does carry, just in two out-of-the-way places:
//   • scan `attributes`: each attribute pairs its `iu` with the source column `name`
//     (`opportun.CloseDat` -> `CloseDateOnly__c`);
//   • the plan's projected output: `output[i].iu` pairs with `output-names[i]`
//     (`union5` -> `grouping_1__sl`).
// Consulted by `stringifyExpression`'s iuref case so sort keys, grouping keys, join/filter
// predicates, etc. name the real column instead of an opaque `⟨union #5⟩`. Rebuilt per plan
// (`convertOptimizerSteps` converts several plans in sequence), so it is reset in `convertHyperPlan`.
let iuDisplayNames = new Map<string, string>();

// Plan-scoped map: IU -> its user-facing *alias* when the query renamed the column and that alias differs
// from the base column name in `iuDisplayNames`. A query may write `SELECT Name__c AS "Account Name"`; the
// plan records that alias only at the top-level projection's `output-names`, positionally paired with the
// output IUs. So the base table reads `Name__c` while every operator downstream carrying that same logical
// column should read `Account Name` — making the plan read like the SQL. Populated by an alias flood-fill
// (see `collectAliasInfo` and the flood in `convertHyperPlan`); consulted (preferred over the base name)
// by `stringifyExpression`'s iuref case and `outputColumnName`. Scans keep the base name and annotate it
// with the alias (`Name__c → Account Name`) instead of replacing it. Reset per plan.
let iuAliases = new Map<string, string>();

// Plan-scoped set of every IU name that is *referenced* by an operator somewhere in the plan (i.e. read
// by an `iu-ref` expression). A scan defines columns via its `attributes`; a column is "used" if any
// downstream operator's expression reads its IU. Consulted when truncating a wide scan's column preview
// so the columns that actually feed the rest of the plan are the ones shown. Rebuilt per plan alongside
// `iuDisplayNames`.
let referencedIus = new Set<string>();

// Plan-scoped memo mapping a raw operator node -> the set of IUs it references in its OWN expressions
// (join `condition`, `key-expressions`, `map` `values`, sort keys, …) but NOT inside any nested child
// operator, and NOT inside a passthrough `output`/`mapping` projection. This is "which of my child's
// columns do *I* actually consume". Used to order a node's `output columns` so the ones its immediate
// parent reads lead the preview — the reader doesn't have to scroll a wide row to find the join key or
// grouping column the parent above it uses. Rebuilt per plan; memoized because sibling children all
// query the same parent. See `collectDirectRefs`.
let directRefsCache = new WeakMap<object, Set<string>>();

// Plan-scoped memo for `computeOutputIus`, keyed by the raw operator node. The output-column derivation
// is called once per non-scan operator during the top-down conversion and recursively re-derives the
// whole subtree beneath it; without memoization a deep operator chain is O(n²). Cleared per plan
// alongside `iuDisplayNames`. Keyed by node identity — safe because a plan is a tree (each node has one
// parent), so a node's derived output is independent of which ancestor triggered the derivation.
let outputIuCache = new WeakMap<object, OutputColumn[]>();

// Plan-scoped map: a raw operator node that feeds a set operation (union-all / except-all / …) -> the
// set op's own output columns (its `ius`, resolved to display names). A set operation's inputs are
// union-compatible — each produces exactly the set op's output schema (same columns, same order) — so an
// input's `output columns` row is authoritatively the set op's columns. `computeOutputIus`, deriving an
// operator's output bottom-up, can disagree on the count (a `map` appends its computed columns to its
// full child output; a child subtree may be over-derived), which made the inputs' column counts not match
// the union-all above them. Populated by `propagateSetOpNames`; used to overwrite a set-op input's
// `output columns` with the set op's columns so inputs and union-all line up exactly.
let setOpInputColumns = new WeakMap<object, OutputColumn[]>();

// While a join's `condition` is being rendered, this maps an IU to which input it comes from — the left
// child (`"L"`), the right child (`"R"`), or `""` when it can't be attributed to a single input.
// `stringifyExpression` frames the column by side: the left input's column takes a `⟨L⟩` prefix, the
// right input's a `⟨R⟩` suffix, so `custkey = custkey2` reads `⟨L⟩ custkey = custkey2 ⟨R⟩`. Left
// `undefined` (and reset after each join) so every other predicate render — filters, group-by keys,
// map values — stays untagged.
let iuSideTag: ((iu: string) => "L" | "R" | "") | undefined;

// Walk the raw plan JSON once, populating BOTH per-plan lookup structures in a single traversal:
//   • `names` (→ `iuDisplayNames`): every IU-name -> real-column-name pairing we can recover — from
//     scan `attributes` (`iu` -> source `name`) and the projected `output` / `output-names` pairing.
//   • `refs` (→ `referencedIus`): every IU *used* by operator logic (read by an `iu-ref`).
// A single pre-pass (rather than collecting during conversion) is required because references point
// both ways: a `sort` near the root orders by `union5`, which is defined deeper and only *named* at the
// root `execution-target`.
//
// `underPassthrough` tracks whether we are inside a passthrough construct — `output` (an operator's
// projection list) or `mapping` (an `explicitscan`'s per-column source->target rename list). These
// carry an `iu-ref` for *every* column flowing through, not just the ones an operator acts on, so
// counting them in `refs` would mark every column "referenced" and defeat the used-column
// prioritization. We still recurse into them (they hold no `attributes`/`output-names` of their own, so
// this is harmless for `names`) but suppress their `iu-ref`s from `refs`.
function collectIuInfo(
    node: Json | undefined,
    names: Map<string, string>,
    refs: Set<string>,
    mappingLinks: {target: string; source: string}[],
    underPassthrough = false,
): void {
    if (Array.isArray(node)) {
        for (const child of node) collectIuInfo(child, names, refs, mappingLinks, underPassthrough);
        return;
    }
    if (typeof node !== "object" || node === null) return;

    // Scan attributes: `iu` (a `[name, type]` pair) -> the source column `name`.
    const attributes = node["attributes"];
    if (Array.isArray(attributes)) {
        for (const attr of attributes) {
            const iu = tryGetPropertyPath(attr, ["iu"]);
            const rawName = Array.isArray(iu) ? iu[0] : iu;
            const colName = tryGetPropertyPath(attr, ["name"]);
            if (typeof rawName === "string" && typeof colName === "string") {
                names.set(rawName, colName);
            }
        }
    }

    // Projected output columns: `output[i].iu` -> `output-names[i]` (the user-facing result names).
    const output = node["output"];
    const outputNames = node["output-names"] ?? node["outputNames"];
    if (Array.isArray(output) && Array.isArray(outputNames)) {
        for (let i = 0; i < output.length && i < outputNames.length; i++) {
            const iu = tryGetPropertyPath(output[i], ["iu"]);
            const rawName = Array.isArray(iu) ? iu[0] : iu;
            const name = outputNames[i];
            if (typeof rawName === "string" && typeof name === "string") {
                names.set(rawName, name);
            }
        }
    }

    // An `explicit-scan` / `temp` re-projects a materialized result, renaming each column via a
    // `mapping` of `source` (an `iu-ref` to the column being re-read) -> `target` (the new IU name). The
    // source IU may be defined by a scan visited later in this walk, so record the rename as a
    // target->source link and resolve it to a display name afterward (see the caller). Only plain
    // renames are linked; a computed `source` has no single column name to carry forward.
    const mapping = node["mapping"];
    if (Array.isArray(mapping)) {
        for (const m of mapping) {
            const targetIu = iuName(tryGetPropertyPath(m, ["target"]));
            const source = tryGetPropertyPath(m, ["source"]);
            if (targetIu === undefined || source === undefined) continue;
            const sourceKind = tryToString(tryGetPropertyPath(source, ["expression"]))?.replace(/-/g, "");
            if (sourceKind === "iuref") {
                const sourceIu = iuName(tryGetPropertyPath(source, ["iu"]));
                if (sourceIu !== undefined) mappingLinks.push({target: targetIu, source: sourceIu});
            }
        }
    }

    // A `group-by` emits its grouping keys as fresh `GroupByKeyN` IUs (`key-expressions[i].iu`), each
    // grouping on an `expression.value` that — for a plain grouping column — is an `iu-ref` to the
    // source column's IU. That source IU has a real display name (from a scan attribute, or another
    // group-by's key upstream), but the produced `GroupByKeyN` never would, so it renders as the opaque
    // `⟨group key #N⟩` everywhere it flows downstream (explicit-scan re-reads, join conditions). Record
    // the grouping as the same kind of target->source rename link so the fixpoint below carries the real
    // column name onto `GroupByKeyN`. Only plain column groupings are linked; a computed key expression
    // has no single column name to carry forward.
    const keyExprs = node["key-expressions"] ?? node["keyExpressions"];
    if (Array.isArray(keyExprs)) {
        for (const k of keyExprs) {
            const targetIu = iuName(tryGetPropertyPath(k, ["iu"]));
            // Newer plans wrap the key expression under `expression.value`; legacy plans put it directly
            // under `value`. Accept both, mirroring the group-by rendering path.
            const source = tryGetPropertyPath(k, ["expression", "value"]) ?? tryGetPropertyPath(k, ["value"]);
            if (targetIu === undefined || source === undefined) continue;
            const sourceKind = tryToString(tryGetPropertyPath(source, ["expression"]))?.replace(/-/g, "");
            if (sourceKind === "iuref") {
                const sourceIu = iuName(tryGetPropertyPath(source, ["iu"]));
                if (sourceIu !== undefined) mappingLinks.push({target: targetIu, source: sourceIu});
            }
        }
    }

    // An `iu-ref` (kebab or concatenated) names the IU it reads in `iu` (a bare name or a `[name, type]`
    // pair). Record it as a genuine use unless we are inside a passthrough construct (see above).
    const kind = tryToString(node["expression"])?.replace(/-/g, "");
    if (kind === "iuref" && !underPassthrough) {
        const iu = node["iu"];
        const raw = Array.isArray(iu) ? iu[0] : iu;
        if (typeof raw === "string") refs.add(raw);
    }

    for (const key of Object.getOwnPropertyNames(node)) {
        collectIuInfo(node[key], names, refs, mappingLinks, underPassthrough || key === "output" || key === "mapping");
    }
}

// Collect the IUs that a single operator reads in its OWN expressions — its direct consumption of its
// children's output columns. Unlike `collectIuInfo` (which walks the whole plan), this stops at the
// boundary of any nested child operator (`operator` key): a child's internal `iu-ref`s read the child's
// *own* inputs, not this operator's, so descending would conflate levels. Passthrough `output`/`mapping`
// projections are suppressed for the same reason as in `collectIuInfo` — they carry an `iu-ref` for every
// column flowing through, which would mark every column "used" and defeat the ordering. `isChild` is
// false only for the operator we start from, so the boundary check never trips on it.
function collectDirectRefs(node: Json | undefined, refs: Set<string>, underPassthrough: boolean, isChild: boolean): void {
    if (Array.isArray(node)) {
        for (const child of node) collectDirectRefs(child, refs, underPassthrough, isChild);
        return;
    }
    if (typeof node !== "object" || node === null) return;
    // Boundary: a nested operator owns its own reference scope — do not descend into it.
    if (isChild && node.hasOwnProperty("operator")) return;
    const kind = tryToString(node["expression"])?.replace(/-/g, "");
    if (kind === "iuref" && !underPassthrough) {
        const iu = node["iu"];
        const raw = Array.isArray(iu) ? iu[0] : iu;
        if (typeof raw === "string") refs.add(raw);
    }
    for (const key of Object.getOwnPropertyNames(node)) {
        collectDirectRefs(node[key], refs, underPassthrough || key === "output" || key === "mapping", true);
    }
}

// Memoized accessor for an operator's direct references (see `directRefsCache`).
function directRefsOf(node: object): Set<string> {
    let refs = directRefsCache.get(node);
    if (refs === undefined) {
        refs = new Set<string>();
        collectDirectRefs(node as Json, refs, false, false);
        directRefsCache.set(node, refs);
    }
    return refs;
}

// Collect the alias flood-fill inputs (see the `iuAliases` block comment): an UNDIRECTED graph of
// "same logical column" links plus the aliased-output seeds. Only the two link kinds NOT already in
// `mappingLinks` (scan renames / explicit-scan mappings / group-by keys) are gathered here:
//   • set-op `values`: output `ius[i]` ↔ each input branch's `values[k][i]` iu-ref;
//   • `map` `values`: the produced `iu` ↔ the IU(s) it purely passes through (plain iu-ref or coalesce).
// Seeds pair each projection's `output[i].iu` with its user-facing `output-names[i]`.
function collectAliasInfo(
    node: Json | undefined,
    links: {a: string; b: string}[],
    seeds: Map<string, string>,
    computed: Map<string, string[]>,
): void {
    if (Array.isArray(node)) {
        for (const child of node) collectAliasInfo(child, links, seeds, computed);
        return;
    }
    if (typeof node !== "object" || node === null) return;

    // Alias seeds: a projection's `output[i].iu` takes the user-facing `output-names[i]`.
    const output = node["output"];
    const outputNames = node["output-names"] ?? node["outputNames"];
    if (Array.isArray(output) && Array.isArray(outputNames)) {
        for (let i = 0; i < output.length && i < outputNames.length; i++) {
            const iu = iuName(tryGetPropertyPath(output[i], ["iu"]));
            const name = outputNames[i];
            if (iu !== undefined && typeof name === "string" && !seeds.has(iu)) seeds.set(iu, name);
        }
    }

    const ius = node["ius"];
    const values = node["values"];
    if (Array.isArray(ius) && Array.isArray(values)) {
        // Set operation: `ius[i]` is output column i; `values[k][i]` is input branch k's iu-ref for it.
        for (const branch of values) {
            if (!Array.isArray(branch)) continue;
            for (let i = 0; i < branch.length && i < ius.length; i++) {
                const kind = tryToString(tryGetPropertyPath(branch[i], ["expression"]))?.replace(/-/g, "");
                if (kind !== "iuref") continue;
                const outIu = iuName(ius[i]);
                const srcIu = iuName(tryGetPropertyPath(branch[i], ["iu"]));
                if (outIu !== undefined && srcIu !== undefined) links.push({a: outIu, b: srcIu});
            }
        }
    } else if (Array.isArray(values)) {
        // A `map` defines each `values[j] = {iu, value}`. Link the produced IU to the column(s) it is a
        // pure passthrough of; computed values (arithmetic, const, …) mint a new column with no upstream
        // alias to inherit, so they contribute no link. For a computed value we still record its iu-ref
        // leaves in `computed` — the backward base-name recovery consults them to see through a single-
        // source cast (so a union branch that is `cast(individual_id__c)` is recognized as `individual_id__c`
        // rather than as an unnamed column, which would let it hide a genuine cross-branch name disagreement).
        for (const entry of values) {
            const targetIu = iuName(tryGetPropertyPath(entry, ["iu"]));
            if (targetIu === undefined) continue;
            const value = tryGetPropertyPath(entry, ["value"]);
            const pass = passthroughSourceIus(value);
            if (pass.length > 0) {
                for (const srcIu of pass) links.push({a: targetIu, b: srcIu});
            } else if (!computed.has(targetIu)) {
                computed.set(targetIu, iuRefLeaves(value));
            }
        }
    }

    for (const key of Object.getOwnPropertyNames(node)) collectAliasInfo(node[key], links, seeds, computed);
}

// Every IU read by an expression subtree (its `iu-ref` leaves), bounded against pathological nesting. A
// pure `cast(x)` yields `[x]`, `floor(a)` yields `[a]`, `a + b` yields `[a, b]`, a `const` yields `[]`.
// Used by the backward base-name recovery to resolve a single-source computed union branch to the column
// it derives from, so its real identity participates in the cross-branch agreement check.
function iuRefLeaves(expr: Json | undefined, depth = 0): string[] {
    if (depth > 8 || expr === undefined || expr === null || typeof expr !== "object") return [];
    if (Array.isArray(expr)) {
        const out: string[] = [];
        for (const child of expr) out.push(...iuRefLeaves(child, depth + 1));
        return out;
    }
    const kind = tryToString(expr["expression"])?.replace(/-/g, "");
    if (kind === "iuref") {
        const iu = iuName(tryGetPropertyPath(expr, ["iu"]));
        return iu === undefined ? [] : [iu];
    }
    const out: string[] = [];
    for (const key of Object.getOwnPropertyNames(expr)) {
        if (key === "expression" || key === "type") continue;
        out.push(...iuRefLeaves(expr[key], depth + 1));
    }
    return out;
}

// The source column a `map` value is a pure RENAME of, if any. A set operation routinely inserts a `map`
// that only re-types or forwards a column so the branch types line up (`setCastN = cast(col)` or
// `setCastN = col`); such a target is the SAME logical column as its single source. A plain passthrough
// (`iu-ref` / same-column `coalesce`, via `passthroughSourceIus`) or a single-column `cast` (a type
// coercion preserves column identity) qualifies; a genuine computation (`tolower(x)`, `floor(x)`, `a + b`,
// a `const`, a multi-column expression) mints a NEW column and yields none.
function renameSourceIus(value: Json | undefined): string[] {
    const pass = passthroughSourceIus(value);
    if (pass.length > 0) return pass;
    if (value === undefined) return [];
    const kind = tryToString(tryGetPropertyPath(value, ["expression"]))?.replace(/-/g, "");
    if (kind === "cast") {
        // Only a coercion of a SINGLE column (`cast(col)`) preserves column identity. Check the cast's
        // DIRECT operand is a passthrough, not merely that the whole subtree has one `iu-ref` leaf — else
        // `cast(price * 2)` / `cast(floor(x))` (one leaf each) would wrongly inherit the source column's
        // name and render the computed column as that column everywhere downstream.
        return passthroughSourceIus(tryGetPropertyPath(value, ["value"]));
    }
    return [];
}

// Gather every `map` rename target -> source-column link (see `renameSourceIus`) so a `setCastN` produced
// by a set-op type-unification map can inherit its source column's real name. A set operation carries a
// sibling `ius` array (its positional branch links are handled by `collectAliasInfo`); skip those and take
// only a plain `map`'s `values` entries. Unlike the alias flood, this contributes ONLY a display name — a
// `cast` link is intentionally kept out of the component graph so the flood can't over-merge across a
// coercion.
function collectMapRenameLinks(node: Json | undefined, out: {target: string; source: string}[]): void {
    if (Array.isArray(node)) {
        for (const child of node) collectMapRenameLinks(child, out);
        return;
    }
    if (node === null || typeof node !== "object") return;
    const values = node["values"];
    if (Array.isArray(values) && !Array.isArray(node["ius"])) {
        for (const entry of values) {
            const target = iuName(tryGetPropertyPath(entry, ["iu"]));
            if (target === undefined) continue;
            const value = tryGetPropertyPath(entry, ["value"]);
            for (const source of renameSourceIus(value)) out.push({target, source});
        }
    }
    for (const key of Object.getOwnPropertyNames(node)) collectMapRenameLinks(node[key], out);
}

// The IUs a `map` value purely passes through: a plain `iu-ref` yields its one IU; a `coalesce` yields
// the IUs of its direct `iu-ref` children (a full-outer-join merge of one column's two sides). Any other
// expression is a genuine computation whose result is a new column, so it yields none.
function passthroughSourceIus(value: Json | undefined): string[] {
    if (value === undefined) return [];
    const kind = tryToString(tryGetPropertyPath(value, ["expression"]))?.replace(/-/g, "");
    if (kind === "iuref") {
        const iu = iuName(tryGetPropertyPath(value, ["iu"]));
        return iu === undefined ? [] : [iu];
    }
    if (kind === "coalesce") {
        // `coalesce` is a general SQL function, but the plan uses it in one alias-relevant way: merging
        // the two sides of a full-outer join on the SAME column (take whichever side is non-null). Only
        // that usage is a same-logical-column passthrough. A `coalesce` over genuinely different columns
        // (`COALESCE(a, b)`) mints a new value and must NOT fuse `a` and `b` into one alias component — so
        // link only when every child is an `iu-ref` and they all resolve to the same known base column.
        // (Operands live under `value` in the plans seen; accept `arguments` defensively. Pick whichever
        // field actually holds the operand array — a plain `?? ` would wrongly keep a non-array `value`.)
        const args = [tryGetPropertyPath(value, ["value"]), tryGetPropertyPath(value, ["arguments"])].find(Array.isArray);
        if (!Array.isArray(args)) return [];
        const ius: string[] = [];
        for (const arg of args) {
            const argKind = tryToString(tryGetPropertyPath(arg, ["expression"]))?.replace(/-/g, "");
            if (argKind !== "iuref") return []; // a computed operand -> not a plain column merge
            const iu = iuName(tryGetPropertyPath(arg, ["iu"]));
            if (iu === undefined) return [];
            ius.push(iu);
        }
        const baseNames = new Set(ius.map((iu) => iuDisplayNames.get(iu)));
        if (baseNames.size !== 1 || baseNames.has(undefined)) return [];
        return ius;
    }
    return [];
}

// Order a node's columns "relevant first" in three tiers, original order preserved within each: (1) the
// columns the immediate parent operator directly reads (`parentRefs`) — so the join key / grouping column
// the parent above consumes leads the preview and needs no scrolling; (2) columns used *somewhere* else
// downstream (`referencedIus`); (3) everything else. When `parentRefs` is absent (root, or a passthrough
// parent that reads nothing) this degrades to the original two-tier used-first ordering. Returns the bare
// display names — the full ordered list the UI progressively reveals when the preview is truncated (see
// COLUMN_PREVIEW_COUNT and QueryNode.tsx).
function orderColumnsRelevantFirst(cols: {name: string; iu: string | undefined}[], parentRefs?: Set<string>): string[] {
    const usedByParent = (c: {iu: string | undefined}) => c.iu !== undefined && parentRefs !== undefined && parentRefs.has(c.iu);
    const usedElsewhere = (c: {iu: string | undefined}) => c.iu !== undefined && referencedIus.has(c.iu);
    return [
        ...cols.filter((c) => usedByParent(c)),
        ...cols.filter((c) => !usedByParent(c) && usedElsewhere(c)),
        ...cols.filter((c) => !usedByParent(c) && !usedElsewhere(c)),
    ].map((c) => c.name);
}

// How many columns a truncated preview shows before eliding into `... [remaining]`. The UI reveals this
// many more per click (see QueryNode.tsx).
const COLUMN_PREVIEW_COUNT = 2;

// Build a compact column-list preview from a relevant-first ordered name list. When it fits, list all;
// past COLUMN_PREVIEW_COUNT, show the leading names and elide the rest as `... [remaining-count]`. The
// UI (when it has the full ordered list on the node) makes that `...` clickable to reveal more; this
// string is the static fallback and must match the UI's initial state. Returns undefined for empty.
function formatColumnPreview(names: string[]): string | undefined {
    if (names.length === 0) return undefined;
    if (names.length <= COLUMN_PREVIEW_COUNT) return names.join(", ");
    return `${names.slice(0, COLUMN_PREVIEW_COUNT).join(", ")} ... [${names.length - COLUMN_PREVIEW_COUNT}]`;
}

interface OutputColumn {
    name: string;
    iu: string | undefined;
}

// The distinct column names that occur more than once in a rendered output-column list, in first-seen
// order. Flags a projection that emits the same name twice — whether from the same IU referenced twice
// or two IUs that resolve to the same display name. Comparison is exact on the display name.
function findDuplicateNames(names: string[]): string[] {
    const counts = new Map<string, number>();
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
    const dups: string[] = [];
    const emitted = new Set<string>();
    for (const n of names) {
        if ((counts.get(n) ?? 0) > 1 && !emitted.has(n)) {
            emitted.add(n);
            dups.push(n);
        }
    }
    return dups;
}

// De-duplicate output columns by IU (dropping later repeats of the same IU) while preserving order.
// Columns without an IU are always kept (nothing to key them on).
function dedupOutputColumns(cols: OutputColumn[]): OutputColumn[] {
    const seen = new Set<string>();
    const out: OutputColumn[] = [];
    for (const c of cols) {
        if (c.iu !== undefined) {
            if (seen.has(c.iu)) continue;
            seen.add(c.iu);
        }
        out.push(c);
    }
    return out;
}

// A friendly name for an output IU: the recovered display name (scan attribute / projected output
// name) when we have one, else the raw IU name — which for computed IUs (aggregates, GroupByKey, map
// results) is the plan's own short label (`avg`, `sum`, `GroupByKey`), still readable.
function outputColumnName(iu: string): string {
    return iuAliases.get(iu) ?? iuDisplayNames.get(iu) ?? iu;
}

// Pull the IU name out of Hyper's `[name, type]` pair (or a bare name).
function iuName(iuPair: Json | undefined): string | undefined {
    const raw = Array.isArray(iuPair) ? iuPair[0] : iuPair;
    return typeof raw === "string" ? raw : undefined;
}

// Render a Hyper type tuple as a compact SQL-ish type name for display. A type is `[Name, ...args]` where
// `Name` is the type (`Varchar`, `Numeric`, `Bool`, …), trailing NUMBERS are length/precision/scale
// (`Numeric(18, 2)`, `Varchar(255)`), and string entries are modifiers like `nullable` — noise for a
// readability label, so they're dropped. Returns undefined when the tuple has no usable name.
function formatTypeName(type: Json | undefined): string | undefined {
    if (!Array.isArray(type) || type.length === 0) return undefined;
    const name = tryToString(type[0]);
    if (name === undefined) return undefined;
    const params = type.slice(1).filter((t): t is number => typeof t === "number");
    return params.length > 0 ? `${name}(${params.join(", ")})` : name;
}

// Most operators carry no column list of their own; unlike scans/temps, their output schema must be
// reconstructed bottom-up. `computeOutputIus` returns an operator's output columns (`{name, iu}`,
// deduped by IU, input order preserved) by combining its children's outputs with whatever IUs it
// defines (map/group-by/window/set-ops) or drops (semi/anti joins keep one side). Names resolve via
// `iuDisplayNames`, falling back to the raw IU name for computed IUs. `depth` guards deep nesting.
// Memoized per node (see `outputIuCache`) so a chain of operators doesn't re-derive the same subtree.
function computeOutputIus(node: Json | undefined, depth = 0): OutputColumn[] {
    if (depth > 40 || typeof node !== "object" || node === null || Array.isArray(node)) return [];
    const cached = outputIuCache.get(node);
    if (cached !== undefined) return cached;
    const result = deriveOutputIus(node, depth);
    outputIuCache.set(node, result);
    return result;
}

function deriveOutputIus(node: JsonObject, depth: number): OutputColumn[] {
    // Child operators: newer plans nest them in an `inputs` array, older ones in `input`/`left`/`right`.
    // (`value` / `value-for-comparison` carry scalar subqueries, not row inputs, so they're excluded.)
    const rawInputs = node["inputs"];
    const children: Json[] = Array.isArray(rawInputs)
        ? (rawInputs as Json[])
        : ([node["input"], node["left"], node["right"]].filter((c) => c !== undefined && c !== null) as Json[]);
    const childColumns = (idx?: number): OutputColumn[] => {
        const picked = idx === undefined ? children : children[idx] !== undefined ? [children[idx]] : [];
        return dedupOutputColumns(picked.flatMap((c) => computeOutputIus(c, depth + 1)));
    };

    // Normalize the operator tag to the concatenated lowercase spelling so kebab-case (`group-by`) and
    // legacy (`groupby`) plans hit the same branch.
    const tag = (tryToString(node["operator"]) ?? "").replace(/-/g, "").toLowerCase();

    // --- IU-defining sources -------------------------------------------------------------------
    // Scan family / virtual table: `attributes[].iu` -> the source column `name`.
    const attributes = node["attributes"];
    if (Array.isArray(attributes) && (tag.endsWith("scan") || tag === "virtualtable")) {
        return dedupOutputColumns(
            attributes
                .map((a): OutputColumn | undefined => {
                    const iu = iuName(tryGetPropertyPath(a, ["iu"]));
                    const nm = tryGetPropertyPath(a, ["name"]);
                    if (iu === undefined && typeof nm !== "string") return undefined;
                    // Prefer the column's query alias, then its recovered display name, so a column that
                    // is aliased (`Name__c → "Account Name"`) or carries a set-operation's propagated
                    // result name (see `propagateSetOpNames`) reads with that name as it flows up through
                    // a join / filter / union — matching what the scan below annotates. `iuDisplayNames`
                    // is normally seeded from this very attribute name, so an un-aliased, un-propagated
                    // plan resolves to the same string.
                    const display = iu !== undefined ? (iuAliases.get(iu) ?? iuDisplayNames.get(iu)) : undefined;
                    return {name: display ?? (typeof nm === "string" ? nm : iu!), iu};
                })
                .filter((c): c is OutputColumn => c !== undefined),
        );
    }
    // explicit-scan / temp: re-projects a materialized result via `mapping` (source -> renamed target).
    if (tag === "explicitscan" || tag === "temp") {
        const mapping = node["mapping"];
        if (!Array.isArray(mapping)) return childColumns();
        return dedupOutputColumns(
            mapping
                .map((m): OutputColumn | undefined => {
                    const name = stringifyExpression(tryGetPropertyPath(m, ["source"]));
                    const iu = iuName(tryGetPropertyPath(m, ["target"]));
                    if (name === undefined || name.length === 0) return undefined;
                    return {name, iu};
                })
                .filter((c): c is OutputColumn => c !== undefined),
        );
    }
    // Set operations (union-all / except-all / intersect-all) expose their result IUs in `ius`.
    if (Array.isArray(node["ius"])) {
        const ius = node["ius"] as Json[];
        // `values[k]` is branch k's per-position iu-refs, positionally aligned to `ius`.
        const branches = node["values"];
        return dedupOutputColumns(
            ius
                .map((e, i): OutputColumn | undefined => {
                    const iu = iuName(e);
                    if (iu === undefined) return undefined;
                    // A result column with an agreed base name or a query alias reads with that name.
                    const known = iuAliases.get(iu) ?? iuDisplayNames.get(iu);
                    if (known !== undefined) return {name: known, iu};
                    // Otherwise the branches disagree on the source column name (or none carry one), so the
                    // set op has no single name to adopt. Rather than emit a bare internal token, annotate
                    // the IU with the distinct real source names feeding this position across the branches
                    // (`union195 (uniqueid__c / UID__c)`), so the column reads with the columns it unifies.
                    const sources: string[] = [];
                    if (Array.isArray(branches)) {
                        for (const branch of branches) {
                            const entry = Array.isArray(branch) ? branch[i] : undefined;
                            const srcIu = entry === undefined ? undefined : iuName(tryGetPropertyPath(entry, ["iu"]));
                            const srcName = srcIu !== undefined ? (iuAliases.get(srcIu) ?? iuDisplayNames.get(srcIu)) : undefined;
                            if (srcName !== undefined && !sources.includes(srcName)) sources.push(srcName);
                        }
                    }
                    const name = sources.length > 0 ? `${iu} (${sources.join(" / ")})` : (humanizeIuName(iu) ?? iu);
                    return {name, iu};
                })
                .filter((c): c is OutputColumn => c !== undefined),
        );
    }
    // `tableconstruction` lists its result IUs in `output` (each an `[iu, type]` pair).
    if (tag === "tableconstruction" && Array.isArray(node["output"])) {
        return dedupOutputColumns(
            (node["output"] as Json[])
                .map((e): OutputColumn | undefined => {
                    const iu = iuName(e);
                    return iu === undefined ? undefined : {name: outputColumnName(iu), iu};
                })
                .filter((c): c is OutputColumn => c !== undefined),
        );
    }

    // --- Operators that define new IUs on top of / instead of their input --------------------
    // `map` appends computed columns (`values[].iu`) to its child's output; name each by the
    // expression it computes when that's short, else fall back to the raw computed-IU name.
    if (tag === "map" && Array.isArray(node["values"])) {
        const computed = (node["values"] as Json[])
            .map((v): OutputColumn | undefined => {
                const iu = iuName(tryGetPropertyPath(v, ["iu"]));
                if (iu === undefined) return undefined;
                const expr = stringifyExpression(tryGetPropertyPath(v, ["value"]));
                const name = expr !== undefined && expr.length > 0 && expr.length <= 30 ? expr : outputColumnName(iu);
                return {name, iu};
            })
            .filter((c): c is OutputColumn => c !== undefined);
        return dedupOutputColumns([...childColumns(), ...computed]);
    }
    // `group-by` emits only its grouping keys + aggregates (input columns are dropped). Name a key by
    // the column/expression it groups on (usually a single real column); name aggregates by their IU.
    if (tag === "groupby") {
        // Accept both the kebab (`key-expressions`) and legacy camelCase (`keyExpressions`) spellings,
        // matching the group-by property-display code.
        const keyExprs = node["key-expressions"] ?? node["keyExpressions"];
        const keys = (Array.isArray(keyExprs) ? (keyExprs as Json[]) : [])
            .map((k): OutputColumn | undefined => {
                const iu = iuName(tryGetPropertyPath(k, ["iu"]));
                if (iu === undefined) return undefined;
                const expr = stringifyExpression(tryGetPropertyPath(k, ["expression", "value"]));
                const name = expr !== undefined && expr.length > 0 && expr.length <= 30 ? expr : outputColumnName(iu);
                return {name, iu};
            })
            .filter((c): c is OutputColumn => c !== undefined);
        const aggs = (Array.isArray(node["aggregates"]) ? (node["aggregates"] as Json[]) : [])
            .map((a): OutputColumn | undefined => {
                const iu = iuName(tryGetPropertyPath(a, ["iu"]));
                return iu === undefined ? undefined : {name: outputColumnName(iu), iu};
            })
            .filter((c): c is OutputColumn => c !== undefined);
        return dedupOutputColumns([...keys, ...aggs]);
    }
    // `window` passes its input through and appends the window functions' result IUs.
    if (tag === "window" && Array.isArray(node["window-infos"])) {
        const windowIus: OutputColumn[] = [];
        for (const info of node["window-infos"] as Json[]) {
            const directIu = iuName(tryGetPropertyPath(info, ["iu"]));
            if (directIu !== undefined) windowIus.push({name: outputColumnName(directIu), iu: directIu});
            const aggs = tryGetPropertyPath(info, ["aggregation", "aggregates"]);
            if (Array.isArray(aggs)) {
                for (const a of aggs) {
                    const iu = iuName(tryGetPropertyPath(a, ["iu"]));
                    if (iu !== undefined) windowIus.push({name: outputColumnName(iu), iu});
                }
            }
        }
        return dedupOutputColumns([...childColumns(), ...windowIus]);
    }

    // --- Joins ---------------------------------------------------------------------------------
    // Semi/anti joins keep only the probed side; mark joins keep one side plus a boolean marker IU;
    // regular and outer joins output both sides. `inputs[0]` is the left child, `inputs[1]` the right.
    if (tag === "leftsemijoin" || tag === "leftantijoin") return childColumns(0);
    if (tag === "rightsemijoin" || tag === "rightantijoin") return childColumns(1);
    if (tag === "leftmarkjoin" || tag === "rightmarkjoin") {
        const base = childColumns(tag === "leftmarkjoin" ? 0 : 1);
        const markerIu = iuName(node["marker"]);
        return markerIu === undefined ? base : dedupOutputColumns([...base, {name: outputColumnName(markerIu), iu: markerIu}]);
    }

    // --- Passthrough (filter/select/sort/share, regular & outer joins, and anything unrecognized) --
    return childColumns();
}

// Union-compatible set operations (union-all / except-all / intersect-all) create fresh output IUs
// (listed in `ius`) that carry the query's result-column names, while each input produces its own
// positionally-aligned columns — whose computed IUs (map results, aggregates) have no recovered name and
// otherwise fall back to a raw expression string. Push each set-op output name down onto every input's
// column at the same position, so all inputs read with the same result-column names as the set operation
// above them — making the columns flowing into the union verifiable at a glance. Walks top-down so a
// nested set-op inherits the outer names first, then passes them further down. Only *fills in* IUs that
// have no recovered name yet — it never overwrites a column's real, recovered name. An IU already resolved
// to a base column (e.g. a grouping key that traces back to `Name__c`) can be referenced elsewhere as a
// genuine column identity — most importantly in a join/filter predicate deeper in the branch — where the
// set-op's positional result alias (`Sum of Amount`) would be flat wrong for it. The set op's own output
// columns still render with the result aliases via the node-scoped `setOpInputColumns` map, so gating here
// costs the union display nothing.
function propagateSetOpNames(node: Json | undefined, depth = 0): void {
    if (depth > 40 || typeof node !== "object" || node === null) return;
    if (Array.isArray(node)) {
        for (const child of node) propagateSetOpNames(child, depth + 1);
        return;
    }
    // A set operation is signalled by an `ius` array (the same marker `deriveOutputIus` keys on). Its
    // row inputs live in `inputs` (newer) or `input`/`left`/`right` (legacy).
    if (Array.isArray(node["ius"])) {
        const outIus = (node["ius"] as Json[]).map(iuName);
        // The set op's output columns, resolved to display names now (top-down order means this set op's
        // `ius` are already named — from the root projection, or from an outer set op processed earlier).
        const outCols: OutputColumn[] = outIus
            .filter((iu): iu is string => iu !== undefined)
            .map((iu) => ({name: outputColumnName(iu), iu}));
        const rawInputs = node["inputs"];
        const inputs: Json[] = Array.isArray(rawInputs)
            ? (rawInputs as Json[])
            : ([node["input"], node["left"], node["right"]].filter((c) => c !== undefined && c !== null) as Json[]);
        // Each `values[k]` is input k's positional iu-refs for the set op's `ius` (authoritatively aligned).
        const branches = node["values"];
        inputs.forEach((input, k) => {
            // This input feeds the set op, so its output schema IS the set op's columns; record them to
            // overwrite the input's `output columns` at display time (a first/outermost set op wins).
            if (typeof input !== "object" || input === null || setOpInputColumns.has(input)) return;
            // Prefer the input's OWN positional source IU (`values[k][i]`) over the set op's output IU, so the
            // input's `output columns` reads with the real column feeding each position — matching what that
            // input's `computes` / scan attributes show — instead of the set op's often-opaque result IU
            // (a join-key `union2` / `union4`). The alias flood links the two, so an aliased column still
            // resolves to the same alias on both; only genuinely-opaque union columns differ, and there the
            // branch's real base name (`Party__c`, `Postal_Code__c`) is the better label. Names are re-resolved
            // at display time (see the `setOpInputColumns` read site), so store the chosen IU per column.
            const branch = Array.isArray(branches) ? branches[k] : undefined;
            const cols: OutputColumn[] = outCols.map((c, i) => {
                const entry = Array.isArray(branch) ? branch[i] : undefined;
                if (entry === undefined) return c;
                const kind = tryToString(tryGetPropertyPath(entry, ["expression"]))?.replace(/-/g, "");
                const srcIu = kind === "iuref" ? iuName(tryGetPropertyPath(entry, ["iu"])) : undefined;
                return srcIu !== undefined ? {name: outputColumnName(srcIu), iu: srcIu} : c;
            });
            setOpInputColumns.set(input, cols);
            // NB: we deliberately do NOT push the set op's output names down onto its inputs' columns by
            // position here. `computeOutputIus` order can misalign against `ius` (a `map` appends computed
            // columns, a child can be over-derived), which silently mislabeled unnamed computed IUs — e.g.
            // an aggregate landing opposite the wrong result column got the wrong name. The alias
            // flood-fill (see `iuAliases`) instead carries result-column names down the RELIABLE per-column
            // `values` links a set operation carries, so a computed IU resolves via its true lineage.
        });
    }
    for (const key of Object.getOwnPropertyNames(node)) {
        propagateSetOpNames(node[key], depth + 1);
    }
}

// Render a Hyper expression tree as a compact, human-readable string (e.g. `Account_id = RecordId`,
// `v26 BETWEEN 1 AND 100`, `a = b AND c < d`, `p_type LIKE 'PROMO%'`, `x IS NOT NULL`). Used to surface
// a filter's `condition` inline instead of leaving it as a deeply-nested collapsed subtree. `depth`
// guards against pathological nesting; past the limit we bail to a placeholder rather than produce an
// unreadable wall of text. Returns undefined when the shape isn't one we render, so callers can fall
// back to the subtree.
function stringifyExpression(expr: Json | undefined, depth = 0): string | undefined {
    if (depth > 6) return "…";
    // A missing operand (absent key → `undefined`, or an explicit `null`) must return real `undefined`,
    // not the string "undefined" that `tryToString` would produce — otherwise the `?? arguments[0]`
    // fallbacks in the `not`/`isnull` cases and the `=== undefined` bail-outs elsewhere silently break,
    // leaking the literal text "undefined" into a rendered condition (e.g. `NOT (undefined)`).
    if (expr === undefined || expr === null) {
        return undefined;
    }
    if (typeof expr !== "object" || Array.isArray(expr)) {
        return tryToString(expr);
    }
    // Newer Hyper plans kebab-case the expression discriminator (`iu-ref` where older plans wrote
    // `iuref`); normalize by dropping hyphens so both spellings hit the same `case`. `kindRaw` keeps
    // the original spelling for the generic `kind(args)` fallback rendering below.
    const kindRaw = tryToString(expr["expression"]);
    const kind = kindRaw?.replace(/-/g, "");
    switch (kind) {
        case "iuref": {
            // `iu` is either a plain column name or `[name, type]`; take the name, then rewrite Hyper's
            // internal IU name into a friendlier origin label (see humanizeIuName). Narrow on
            // `typeof === "string"` (not `tryToString`, which yields the literal "undefined" for a
            // missing field) so a malformed iuref falls back to the subtree instead of rendering
            // the word "undefined".
            const iu = expr["iu"];
            const raw = Array.isArray(iu) ? iu[0] : iu;
            if (typeof raw !== "string") return undefined;
            // Prefer the query's alias for this column when one exists (so a predicate joining on an
            // aliased column reads like the SQL — `Account Name`, not `Name__c`), then the real base
            // column name the plan carries elsewhere (scan attributes / output-names, see
            // `iuDisplayNames`), and finally prettify the opaque internal IU name.
            const name = iuAliases.get(raw) ?? iuDisplayNames.get(raw) ?? humanizeIuName(raw);
            // Within a join condition, frame the column by which side of the join it comes from: the
            // left input takes a `⟨L⟩` prefix, the right input a `⟨R⟩` suffix.
            if (iuSideTag === undefined) return name;
            const side = iuSideTag(raw);
            if (side === "L") return `⟨L⟩ ${name}`;
            if (side === "R") return `${name} ⟨R⟩`;
            return name;
        }
        case "const":
            return stringifyConst(expr);
        case "comparison": {
            const mode = tryToString(expr["mode"]) ?? "?";
            // Render operands in the exact order the plan emitted them — do NOT reorder to force an
            // `⟨L⟩ … ⟨R⟩` reading. The optimizer's operand order is meaningful (e.g. a right-anti /
            // right-semi join's probe vs build side), so the condition reads the same way the query plan
            // renders it. The `⟨L⟩`/`⟨R⟩` side tags on each operand still show which input it comes from.
            const left = stringifyExpression(expr["left"], depth + 1);
            const right = stringifyExpression(expr["right"], depth + 1);
            if (left === undefined || right === undefined) return undefined;
            return `${left} ${mode} ${right}`;
        }
        case "between": {
            const args = expr["arguments"];
            if (!Array.isArray(args) || args.length < 3) return undefined;
            const value = stringifyExpression(args[0], depth + 1);
            const lo = stringifyExpression(args[1], depth + 1);
            const hi = stringifyExpression(args[2], depth + 1);
            if (value === undefined || lo === undefined || hi === undefined) return undefined;
            return `${value} BETWEEN ${lo} AND ${hi}`;
        }
        case "like": {
            // `[value, pattern, escape?]`; render `value LIKE pattern`, dropping the escape char.
            const args = expr["arguments"];
            if (!Array.isArray(args) || args.length < 2) return undefined;
            const value = stringifyExpression(args[0], depth + 1);
            const pattern = stringifyExpression(args[1], depth + 1);
            if (value === undefined || pattern === undefined) return undefined;
            return `${value} LIKE ${pattern}`;
        }
        case "not": {
            // Negation carries its operand as `input` or a single-element `arguments`.
            const inner =
                stringifyExpression(expr["input"], depth + 1) ??
                (Array.isArray(expr["arguments"]) ? stringifyExpression(expr["arguments"][0], depth + 1) : undefined);
            return inner === undefined ? undefined : `NOT (${inner})`;
        }
        case "isnull":
        case "isnotnull": {
            const inner =
                stringifyExpression(expr["input"], depth + 1) ??
                (Array.isArray(expr["arguments"]) ? stringifyExpression(expr["arguments"][0], depth + 1) : undefined);
            if (inner === undefined) return undefined;
            return `${inner} ${kind === "isnull" ? "IS NULL" : "IS NOT NULL"}`;
        }
        case "in": {
            // `value IN (a, b, c)`: first argument is the probe, the rest are the set.
            const args = expr["arguments"];
            if (!Array.isArray(args) || args.length < 2) return undefined;
            const value = stringifyExpression(args[0], depth + 1);
            const set = args.slice(1).map((a) => stringifyExpression(a, depth + 1));
            if (value === undefined || set.some((s) => s === undefined)) return undefined;
            return `${value} IN (${set.join(", ")})`;
        }
        case "cast": {
            // Casts are noise in a predicate; render the inner value transparently. Still increment
            // `depth` so a pathological chain of nested casts hits the recursion guard like any other
            // kind, rather than recursing unbounded into a stack overflow.
            return stringifyExpression(expr["value"], depth + 1);
        }
        case "case": {
            // Searched CASE: `cases: [{case: <cond>, value: <result>}, ...]` with an optional `else`.
            // Render `CASE WHEN c THEN r ... [ELSE e] END`. If any branch has an operand we can't
            // stringify, bail to undefined so the whole thing falls back to the subtree (partial,
            // misleading text is worse than the explorable subtree).
            const cases = expr["cases"];
            if (!Array.isArray(cases) || cases.length === 0) return undefined;
            const parts: string[] = [];
            for (const c of cases) {
                const cond = c !== null && typeof c === "object" ? c : {};
                const when = stringifyExpression((cond as JsonObject)["case"], depth + 1);
                const then = stringifyExpression((cond as JsonObject)["value"], depth + 1);
                if (when === undefined || then === undefined) return undefined;
                parts.push(`WHEN ${when} THEN ${then}`);
            }
            const elseStr = stringifyExpression(expr["else"], depth + 1);
            return `CASE ${parts.join(" ")}${elseStr !== undefined ? ` ELSE ${elseStr}` : ""} END`;
        }
        case "simplecase": {
            // Simple CASE with a scrutinee. Two shapes exist across Hyper versions:
            //   (A) `{value: <scrutinee>, cases: [{cases: [<match>...], value: <result>}], else}`
            //   (B) `{input: <scrutinee>, cases: [{value: <match>, result: <result>}], else}`
            // Disambiguate per branch by whether the branch carries a `cases` match-list (shape A).
            const scrutinee = stringifyExpression(expr["input"] ?? expr["value"], depth + 1);
            const cases = expr["cases"];
            if (scrutinee === undefined || !Array.isArray(cases) || cases.length === 0) return undefined;
            const parts: string[] = [];
            for (const c of cases) {
                const branch = (c !== null && typeof c === "object" ? c : {}) as JsonObject;
                const shapeA = Array.isArray(branch["cases"]);
                const matchExprs = shapeA ? (branch["cases"] as Json[]) : [branch["value"]];
                const matches = matchExprs.map((m) => stringifyExpression(m, depth + 1));
                const result = stringifyExpression(shapeA ? branch["value"] : branch["result"], depth + 1);
                if (result === undefined || matches.some((m) => m === undefined)) return undefined;
                parts.push(`WHEN ${matches.join(", ")} THEN ${result}`);
            }
            const elseStr = stringifyExpression(expr["else"], depth + 1);
            return `CASE ${scrutinee} ${parts.join(" ")}${elseStr !== undefined ? ` ELSE ${elseStr}` : ""} END`;
        }
        default:
            break;
    }
    if (kind === undefined) return undefined;
    // n-ary boolean / arithmetic ops that carry an `arguments` array (and, or, add, mul, …).
    if (kind in EXPRESSION_OPERATORS) {
        const op = EXPRESSION_OPERATORS[kind];
        const args = expr["arguments"];
        if (Array.isArray(args)) {
            const parts = args.map((a) => stringifyExpression(a, depth + 1));
            if (parts.some((p) => p === undefined)) return undefined;
            return parts.join(` ${op} `);
        }
        // Binary form carrying `left`/`right` (e.g. add/mul).
        const left = stringifyExpression(expr["left"], depth + 1);
        const right = stringifyExpression(expr["right"], depth + 1);
        if (left !== undefined && right !== undefined) return `${left} ${op} ${right}`;
    }
    // Generic scalar-function fallback: render an unrecognized expression as `kind(args)` so a filter
    // on e.g. `extractyear(shipdate)` or another built-in still reads as a call rather than falling
    // back to the raw subtree. A unary function carries its operand under `input`; a binary one (e.g.
    // `at_timezone`) under `left`/`right`; others under `arguments`. `case`/`simplecase` are rendered
    // inline as `CASE … END` in the switch above; only `lookup` still carries none of these, so it
    // returns undefined here and falls back to the subtree, which is the right call for it.
    const fnArgs = Array.isArray(expr["arguments"])
        ? expr["arguments"]
        : expr.hasOwnProperty("input")
          ? [expr["input"]]
          : expr.hasOwnProperty("left") && expr.hasOwnProperty("right")
            ? [expr["left"], expr["right"]]
            : undefined;
    if (fnArgs !== undefined) {
        const parts = fnArgs.map((a) => stringifyExpression(a, depth + 1));
        if (!parts.some((p) => p === undefined)) {
            return `${kindRaw}(${parts.join(", ")})`;
        }
    }
    return undefined;
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
    // Label reads actual/estimate (actual first), matching postgres.ts's actual/estimated order.
    node.edgeLabel = formatMetric(actual) + "/" + formatMetric(estimate);
    // Store the raw estimate/actual so the edge-mismatch highlight can be recomputed at render time
    // when the user edits the cardinality thresholds.
    node.cardEstimate = estimate;
    node.cardActual = actual;
    node.cardIsScan = isScan;
    // Always spell out the edge's row counts as a hover tooltip; the label itself shows only the bare
    // "actual/estimate" numbers. Kept in sync with `deriveNodeDisplay`, which recomputes this at
    // render time when the user edits the cardinality thresholds.
    const rowsTip = `Actual rows: ${formatMetric(actual)}, Est. rows: ${formatMetric(estimate)}`;
    node.edgeReason = rowsTip;
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
        node.edgeReason = `${rowsTip}\nCardinality misestimate: the optimizer ${dir} ${subject} — ${tail}`;
    }
}

// Temporary state which we hold during converting from JSON to internal graph representation
interface ConversionState {
    operatorsById: Map<string, TreeNode>;
    crosslinks: UnresolvedCrosslink[];
    edgeWidths: {node: TreeNode; width: number}[];
    runtimes: {node: TreeNode; time: number}[];
    // Every operator's peak memory, used to total plan memory and shade memory hotspots proportionally.
    memories: {node: TreeNode; bytes: number}[];
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
    // Table-valued UDF (e.g. Data Cloud `hybrid_search`); `name` holds the function name.
    "op:udtablefunction": {icon: "virtual-table-symbol", displayNameKey: "name"},
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

// Reorder a properties Map in place so the keys listed in `order` lead (in that order), with every
// remaining key following in its existing insertion order. Keys in `order` that aren't present are
// skipped. Mutates the passed Map (keeping the same reference the converted node already points to),
// since Maps preserve insertion order. Shared by the scan / filter / join / udtablefunction blocks,
// which each want their key metrics to lead in a fixed, readable order.
function reorderProperties(properties: Map<string, string>, order: string[]): void {
    const reordered = new Map<string, string>();
    for (const key of order) {
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
}

// Render a list of aggregate specs as `alias = fn(arg)` strings (with an optional trailing suffix, e.g. a
// window's `OVER (…)` clause). Shared by the `group-by` and `window` display blocks, which encode
// aggregates identically: `agg.operation.aggregate` is the function; a numeric `agg.source` indexes into
// `aggExprs`, whose `value` is the argument expression (a missing/non-numeric source is a nullary
// aggregate like `count(*)`). The alias is the aggregate's output IU resolved via the same
// `outputColumnName(iuName(iu))` the output-column derivation uses, so each rendered call agrees with the
// node's `output columns` entry. Aggregates whose function name is missing are dropped (never rendered as
// the literal "undefined"); when the IU has no name, the bare call is emitted without an `alias =` prefix.
function formatAggregateCalls(aggregates: Json[], aggExprs: Json | undefined, overSuffix = ""): string[] {
    const out: string[] = [];
    for (const agg of aggregates) {
        const fnRaw = tryGetPropertyPath(agg, ["operation", "aggregate"]);
        if (typeof fnRaw !== "string") continue;
        const source = tryGetPropertyPath(agg, ["source"]);
        let arg = "*";
        if (typeof source === "number" && Array.isArray(aggExprs) && source >= 0 && source < aggExprs.length) {
            const argExpr = tryGetPropertyPath(aggExprs[source], ["value"]) ?? aggExprs[source];
            arg = stringifyExpression(argExpr) ?? "…";
        }
        const call = `${fnRaw}(${arg})${overSuffix}`;
        const iu = iuName(tryGetPropertyPath(agg, ["iu"]));
        const alias = iu !== undefined ? outputColumnName(iu) : undefined;
        out.push(alias !== undefined && alias.length > 0 ? `${alias} = ${call}` : call);
    }
    return out;
}

// Convert Hyper JSON to a D3 tree. `parentOperator` is the nearest enclosing operator node (undefined at
// the root); a node's `output columns` are ordered so the columns that operator directly reads lead.
function convertHyperNode(
    rawNode: Json,
    parentKey,
    conversionState: ConversionState,
    parentOperator?: object,
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
        // The IUs the parent operator directly consumes, so this node's output columns can lead with them.
        const parentRefs = parentOperator !== undefined ? directRefsOf(parentOperator) : undefined;
        // Full relevant-first column name lists for truncated column previews, keyed by property name
        // (`columns`, `outputs`). Carried on the node so the UI can progressively reveal the elided
        // columns when the `... [n]` is clicked; only populated when truncation actually happened.
        const columnLists = new Map<string, string[]>();
        // Distinct output-column names this node emits more than once (empty when none). Recomputed on
        // each `output columns` preview so the last write wins (a set-op overwrite re-resolves names).
        let duplicateColumns: string[] = [];
        // Set a column-preview property and, when truncated, stash the full ordered list for the UI.
        const setColumnPreview = (key: string, cols: OutputColumn[]) => {
            const ordered = orderColumnsRelevantFirst(cols, parentRefs);
            const preview = formatColumnPreview(ordered);
            if (preview === undefined) return;
            properties.set(key, preview);
            if (ordered.length > COLUMN_PREVIEW_COUNT) columnLists.set(key, ordered);
            // Flag duplicate names in the node's output projection (see `findDuplicateNames`).
            if (key === "output columns") duplicateColumns = findDuplicateNames(ordered);
        };

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

        // Display these properties always as properties, even if they are more complex.
        // `debugName` is the pre-kebab-case spelling of `debug-name`; we accept both for
        // backwards compatibility with plans produced before the Hyper kebab-case cutover.
        // (The legacy `analyze` runtime block is intentionally NOT listed: its metrics are already
        // surfaced as clean top-level properties, and it is dropped from the subtree below — mirroring
        // the `statistics` handling — so dumping it here as a stringified blob would only duplicate it.)
        const propertyKeys = ["debug-name", "debugName"];
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
        const fixedChildOrder = ["inputs", "input", "left", "right", "value", "value-for-comparison"];
        const orderedKeys = Object.getOwnPropertyNames(rawNode)
            .filter((k) => {
                // Drop the per-operator *runtime* statistics block under either the post-W-22563058
                // `statistics` key or the legacy `analyze` key: the metrics that matter (cpu-cycles,
                // processed-rows, output-rows, ...) are already surfaced as clean top-level properties,
                // so rendering the raw block — either as a subtree or as a stringified blob property —
                // would only duplicate them. A `statistics` block that instead carries table/column
                // metadata (e.g. per-column `columns` distinct-value/uniqueness data on a base-table
                // scan) is unrelated to the runtime block and must still be shown, so keep it — the
                // `isRuntimeStatistics` shape check distinguishes the two.
                if ((k === "statistics" || k === "analyze") && isRuntimeStatistics(rawNode[k])) return false;
                // `sqlpos` is a raw [start, end] source-offset span (or array of them) into the
                // original SQL text — useful to the engine, but noise in the visualizer. Drop it
                // entirely rather than dumping it as a property or a subtree.
                if (k === "sqlpos") return false;
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

            // Display as part of the tree. Pass this node down as the child's parent operator (so the
            // child orders its output columns by what we read); when this node is not itself an operator
            // (a wrapper/expression), forward the nearest enclosing operator unchanged.
            const children = isAlwaysExpanded(rawNode, key) ? expandedChildren : collapsedChildren;
            const childParentOperator = nodeType === "operator" ? rawNode : parentOperator;
            const innerNodes = convertHyperNode(rawNode[key], key, conversionState, childParentOperator);
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
        const debugNameNode = tryGetPropertyPath(rawNode, ["debug-name", "value"]);
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

        // Surface a per-operator error whenever the node carries one, and highlight the operator that
        // was running when the query failed. These are two distinct signals in the analyzed plan: the
        // operator that *raised* the error carries the `error` object, while the operator that was
        // executing when it happened is flagged with `running: true` (they are often different — e.g.
        // the `execution-target` records the error, a `group-by` beneath it was running). Show the
        // message on whichever node has it, and red-flag the running node as before.
        // `running`/`error` live in the runtime statistics block, which Hyper renamed from `analyze` to
        // `statistics` in the FORMAT JSON rework (W-22563058); `getStatistic` reads both for back-compat.
        const errorMessage = getErrorMessage(rawNode);
        if (errorMessage !== undefined) {
            properties.set("error", errorMessage);
            convertedNode.iconColor = "red";
            // Expose the message as a first-class signal so the plan-insights panel can surface it as a
            // severe error and link to this node (the raw `error` property is display-only).
            convertedNode.errorMessage = errorMessage;
        }
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

        // Surface the operator's peak memory usage on every node the same way as cpu-cycles, so it is
        // visible without expanding the collapsed "statistics" subtree. Like cpu-cycles this does three
        // things at once: record it for the plan-total memory-hotspot pass, keep the raw signal for the
        // render-time recompute, and set the human-readable row. Opportunistic: only analyzed (runtime)
        // plans carry it. (The search/UDF block below also emits the row via RUNTIME_METRIC_PROPS;
        // setting it here first just makes it universal — the later set is the same value, idempotent.)
        const memoryBytes = getStatistic(rawNode, "memory-bytes");
        if (typeof memoryBytes === "number") {
            conversionState.memories.push({node: convertedNode, bytes: memoryBytes});
            convertedNode.memoryBytes = memoryBytes;
            properties.set("memory-bytes", formatBytes(memoryBytes));
        }

        // Scan operators own their outgoing edge below (they show estimated-rows / rows-matching
        // instead of the generic estimate / actual), so the generic cardinality block is skipped for
        // them. Determining this up front keeps a single source of truth per node: a scan's edge is
        // set once, in the scan block, avoiding a double `edgeWidths` push and an `edgeClass` clobber.
        const isScanOperator = nodeType == "operator" && nodeTag !== undefined && SCAN_OPERATORS.has(nodeTag.replace(/-/g, ""));

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
            // Record the scan's source type for the plan-insights "Scan types" breakdown. The newer
            // generic `scan` operator carries it in a `type` field (e.g. `data-lake-object`); the older
            // per-format operators encode it in the tag itself (`tablescan`, `icebergscan`, …).
            // A generic `scan` with a missing `type` must not fall back to the literal "undefined" string
            // that `tryToString` returns for a missing field (it would create a spurious "undefined"
            // bucket in the plan-insights "Scan types" breakdown); require a real string.
            const rawScanType = rawNode["type"];
            const scanTypeField = nodeTag === "scan" ? (typeof rawScanType === "string" ? rawScanType : undefined) : nodeTag;
            if (typeof scanTypeField === "string" && scanTypeField.length > 0) {
                convertedNode.scanType = scanTypeField;
            }
            // Group the row-count metrics together in the node body. `est-rows` is the optimizer
            // estimate, which lives at the operator top level (`estimated-rows`, formerly `cardinality`)
            // rather than inside the statistics block. Reuse the value already read above rather than
            // walking the property path again.
            const estRows = estimatedCardRaw;
            if (typeof estRows === "number") {
                setFormattedEstimatedRows(properties, estRows);
            }
            // Surface the scan's measured output cardinality in the node too, matching the "actual"
            // shown on the outgoing edge — the same treatment non-scan operators already get. This was
            // previously omitted on the assumption the edge always carries the actual via `rows-matching`;
            // but when a scan emits no `rows-matching-restrictions`, the edge falls back to `output-rows`
            // and the node would otherwise show no actual count at all. `getActualRows` reads the newer
            // `output-rows` (or the legacy `analyze.tuple-count`), so it matches that edge fallback exactly.
            const scanOutputRows = getActualRows(rawNode);
            if (typeof scanOutputRows === "number") {
                properties.set("output-rows", formatMetric(scanOutputRows));
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
                    convertedNode.highlightReason = costlyScanReason(processedRows, rowsMatching);
                    convertedNode.edgeClass = "qg-label-highlighted";
                    // Append the costly-scan reason below any row-count/misestimate tooltip already set
                    // for this edge. Kept in sync with `deriveNodeDisplay`.
                    convertedNode.edgeReason = convertedNode.edgeReason
                        ? `${convertedNode.edgeReason}\n${convertedNode.highlightReason}`
                        : convertedNode.highlightReason;
                    // Flag the costly scan so the `processed-rows` / `rows-matching` property rows
                    // render in light red.
                    convertedNode.costlyScan = true;
                }
            }
            // High-volume scan: a very large read regardless of selectivity. Less severe than a costly
            // scan, so it only claims the node color when the scan isn't already costly; it still wins
            // the fill over the index categories (an index rec on it shows on the border). Uses the
            // default threshold; the UI recomputes this live when the user edits it.
            if (
                typeof processedRows === "number" &&
                convertedNode.highlightNode !== "costly-scan" &&
                isHighVolumeScan(processedRows, DEFAULT_THRESHOLDS)
            ) {
                convertedNode.highlightNode = "high-volume-scan";
                convertedNode.highlightReason = highVolumeScanReason(processedRows);
                // Flag it so the `processed-rows` property row renders in the high-volume indigo tint.
                convertedNode.highVolumeScan = true;
            }
            // A scan that processed 0 rows while carrying an `early-probes` entry was almost certainly
            // skipped by that early probe: Hyper probes a hash builder before scanning and, when the
            // build side is empty (or prunes everything), the scan reads nothing at all. Require the
            // optimizer to have expected rows (`estRows > 0`): if the estimate is already 0, a 0-row
            // scan is simply the expected empty result, not a runtime prune, so the note would mislead.
            // Annotate the `processed-rows` value inline so a 0-row scan that *was* expected to have
            // rows doesn't read as "table was empty" when it was really pruned at runtime.
            const earlyProbes = tryGetPropertyPath(rawNode, ["early-probes"]);
            const hasEarlyProbe = Array.isArray(earlyProbes) && earlyProbes.length > 0;
            if (processedRows === 0 && hasEarlyProbe && typeof estRows === "number" && estRows > 0) {
                properties.set("processed-rows", `${formatMetric(0)} (likely early probe)`);
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
                // Color the node for an index recommendation now, unless a costly or high-volume scan
                // already claimed it (both have higher fill precedence — the recommendation still shows
                // on the border via `qg-node-index-rec-border`).
                if (convertedNode.highlightNode !== "costly-scan" && convertedNode.highlightNode !== "high-volume-scan") {
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

            // Surface the columns this scan reads from the table. Each `attributes` entry pairs an
            // internal IU with the source column `name`; list them so the reader sees which columns the
            // scan projects without expanding the raw `attributes` subtree. `formatColumnPreview` keeps
            // the row readable on a wide table (first three, used columns first, then `... [total]`).
            const scanAttributes = rawNode["attributes"];
            if (Array.isArray(scanAttributes)) {
                // Keep each column's IU alongside its name so we can tell which columns are used later.
                const cols = scanAttributes
                    .map((attr) => {
                        const name = tryGetPropertyPath(attr, ["name"]);
                        if (typeof name !== "string") return undefined;
                        const iu = tryGetPropertyPath(attr, ["iu"]);
                        const rawIu = Array.isArray(iu) ? iu[0] : iu;
                        const iuKey = typeof rawIu === "string" ? rawIu : undefined;
                        // Prefer the recovered display name so a set-op-propagated result name shows here
                        // too, keeping a single consistent name per IU across the tree. Normally seeded
                        // from this attribute name, so an un-propagated plan resolves to the same string.
                        const display = iuKey !== undefined ? iuDisplayNames.get(iuKey) : undefined;
                        const base = display ?? name;
                        // The base table reports the real column name AND its query alias (if any),
                        // annotated `Name__c → Account Name`, so the reader sees both the physical column
                        // and the name it goes by downstream. Never replace the base name here.
                        const alias = iuKey !== undefined ? iuAliases.get(iuKey) : undefined;
                        return {name: alias !== undefined && alias !== base ? `${base} → ${alias}` : base, iu: iuKey};
                    })
                    .filter((c): c is {name: string; iu: string | undefined} => c !== undefined);
                setColumnPreview("output columns", cols);
            }

            // Iceberg / CDP-v2 lakehouse scans carry a `table-metadata` block describing the physical
            // table layout — its identifier (primary-key) columns, how it is partitioned, and its sort
            // order. Surface these in a compact, readable form so the layout is visible at a glance
            // without drilling into the raw nested JSON subtree (which the generic loop still adds for
            // full detail). All three sub-fields are optional.
            const tableMetadata = rawNode["table-metadata"];
            if (tableMetadata !== null && typeof tableMetadata === "object" && !Array.isArray(tableMetadata)) {
                // Render a partition/sort transform over a column: `identity` is the bare column; any
                // other transform wraps it (`bucket[16](Id__c)`, `truncate[10](name)`, `year(ts)`).
                // Narrow with `typeof === "string"` (not `tryToString`, which returns the literal string
                // "undefined" for a missing field) so an absent column/transform is treated as absent.
                const withTransform = (transform: Json | undefined, column: Json | undefined): string | undefined => {
                    if (typeof column !== "string") return undefined;
                    return typeof transform !== "string" || transform === "identity" ? column : `${transform}(${column})`;
                };

                // Collect the sub-items as `label: value` lines under a single `table-metadata` property,
                // so the node renders them as one grouped block (header + indented rows) rather than
                // three unrelated top-level rows. The QueryNode renderer splits this on newlines.
                const metaLines: string[] = [];

                // Identifier (primary-key) columns.
                const identifierFields = tableMetadata["identifier-fields"];
                if (Array.isArray(identifierFields) && identifierFields.length > 0) {
                    const cols = identifierFields
                        .map((f) => tryGetPropertyPath(f, ["column"]))
                        .filter((c): c is string => typeof c === "string");
                    if (cols.length > 0) {
                        metaLines.push(`identifier: ${cols.join(", ")}`);
                    }
                }

                // Partitioning scheme, e.g. `bucket[16](Id__c)`.
                const partitionTransforms = tableMetadata["partition-transforms"];
                if (Array.isArray(partitionTransforms) && partitionTransforms.length > 0) {
                    const parts = partitionTransforms
                        .map((p) =>
                            withTransform(tryGetPropertyPath(p, ["transform"]), tryGetPropertyPath(p, ["source", "column"])),
                        )
                        .filter((p): p is string => p !== undefined);
                    if (parts.length > 0) {
                        metaLines.push(`partitioned-by: ${parts.join(", ")}`);
                    }
                }

                // Table sort order, e.g. `Id__c asc nulls-first`. Direction / null-order are shown
                // verbatim as they appear in the plan (lower-cased, hyphenated) rather than reformatted.
                const sortKeys = tryGetPropertyPath(tableMetadata, ["sort-order", "sort-keys"]);
                if (Array.isArray(sortKeys) && sortKeys.length > 0) {
                    const keys = sortKeys
                        .map((k) => {
                            const col = withTransform(
                                tryGetPropertyPath(k, ["transform"]),
                                tryGetPropertyPath(k, ["source", "column"]),
                            );
                            if (col === undefined) return undefined;
                            // Raw string values only; a missing direction/null-order must drop out, not
                            // render as the literal "undefined" that `tryToString` would produce.
                            const dir = tryGetPropertyPath(k, ["direction"]);
                            const nulls = tryGetPropertyPath(k, ["null-order"]);
                            const dirStr = typeof dir === "string" ? dir : undefined;
                            const nullsStr = typeof nulls === "string" ? nulls : undefined;
                            return [col, dirStr, nullsStr].filter((x) => x !== undefined).join(" ");
                        })
                        .filter((k): k is string => k !== undefined);
                    if (keys.length > 0) {
                        metaLines.push(`sort-order: ${keys.join(", ")}`);
                    }
                }

                if (metaLines.length > 0) {
                    properties.set("table-metadata", metaLines.join("\n"));
                }
            }

            // Lead with the key scan metrics in a fixed, readable order; the rest follow as-is.
            reorderProperties(properties, [
                "table-name",
                "output columns",
                "index-rec",
                "estimated-rows",
                "processed-rows",
                "rows-matching",
                "output-rows",
                "available-indexes",
                "index-used",
                "table-metadata",
            ]);
        } else if (nodeType == "operator") {
            // For non-scan operators, surface the actual output alongside the estimate. `output-rows`
            // (measured rows produced) lives inside the nested "statistics" block, so it is not shown
            // by the generic property loop; `estimated-rows` is a top-level number that loop already
            // added as a raw value. Re-add both, metric-formatted and grouped as `estimated-rows`
            // then `output-rows`. `rows-matching` is intentionally not included: it is a scan-only
            // metric (only scan operators populate `rows-matching-restrictions`).
            // Reuse the estimate already read once at the top of this block (`estimatedCardRaw`) instead
            // of re-walking the property path; the filter-selectivity block below also reads it.
            const estRows = estimatedCardRaw;
            if (typeof estRows === "number") {
                setFormattedEstimatedRows(properties, estRows);
            }
            // Use `getActualRows` (not a bare `getStatistic("output-rows")`) so old-format ANALYZE'd
            // plans fall back to `analyze.tuple-count`, matching what the edge label/width and the scan
            // block already do. Otherwise a join node would show no `output-rows` even when its parent
            // edge still displays the actual count from that legacy key.
            const outputRows = getActualRows(rawNode);
            if (typeof outputRows === "number") {
                properties.set("output-rows", formatMetric(outputRows));
            }

            // Set by the operator blocks below that establish their own semantic lead (a join's
            // `condition`, a group-by's `group by`, a sort's `sort by`, a map's `computes`, …). When
            // true, the auto-derived `output columns` fallback appends its row at the end rather than
            // fronting it, so the operator-specific lead isn't buried behind it. Set operations and
            // otherwise-generic operators leave this false, so `output columns` fronts for them (which
            // is what makes a union-all read columns-first).
            let hasSemanticLead = false;

            // A filter operator surfaces *what* it filters on and *how much* it removes, so the node
            // reads as more than a generic node with a collapsed condition subtree. Hyper names this
            // operator `select` in the legacy format and `filter` in the newer "inputs"-array format;
            // both carry the same `condition`/child shape, so handle them together.
            if (nodeTag === "select" || nodeTag === "filter") {
                // Render the predicate compactly (e.g. `a = b AND c < d`) instead of leaving it buried
                // in the nested `condition` expression subtree. Keep the subtree too (the generic loop
                // still adds it) for the full detail; the inline string is the at-a-glance summary.
                const conditionStr = stringifyExpression(rawNode["condition"]);
                if (conditionStr !== undefined && conditionStr.length > 0) {
                    properties.set("condition", conditionStr);
                }
                // A top-level `and` splits into independent conjuncts; report the count so a compound
                // filter (`3 predicates`) is visible even when the full string is long, and list each
                // conjunct on its own `predicate N` row so the individual restrictions are readable
                // without parsing the combined `condition` string.
                const conditionArgs = tryGetPropertyPath(rawNode, ["condition", "arguments"]);
                const conjunctKind = tryToString(tryGetPropertyPath(rawNode, ["condition", "expression"]));
                if (conjunctKind === "and" && Array.isArray(conditionArgs) && conditionArgs.length > 1) {
                    properties.set("predicates", conditionArgs.length.toString());
                    conditionArgs.forEach((conjunct, i) => {
                        const conjunctStr = stringifyExpression(conjunct);
                        if (conjunctStr !== undefined && conjunctStr.length > 0) {
                            properties.set(`predicate ${i + 1}`, conjunctStr);
                        }
                    });
                }
                // Filter selectivity: output rows / input rows. This is the filter analog of a scan's
                // processed-vs-matching ratio — how much the predicate cut the row count. Prefer
                // measured actuals (input `output-rows` vs this filter's `output-rows`); fall back to
                // the optimizer estimates (input `estimated-rows` vs this filter's `estimated-rows`) so
                // an estimate-only plan still shows the modeled selectivity. Marked "(est)" when
                // derived from estimates so it isn't mistaken for a measured value.
                // The child is `input` (legacy) or the first entry of `inputs` (newer format).
                const inputs = rawNode["inputs"];
                const input = rawNode["input"] ?? (Array.isArray(inputs) ? inputs[0] : null);
                const inputActual = getActualRows(input);
                const inputEst = getEstimatedRows(input);
                let inputRows: number | undefined;
                let filterOut: number | undefined;
                let estimated = false;
                if (typeof inputActual === "number" && typeof outputRows === "number") {
                    inputRows = inputActual;
                    filterOut = outputRows;
                } else if (typeof inputEst === "number" && typeof estRows === "number") {
                    inputRows = inputEst;
                    filterOut = estRows;
                    estimated = true;
                }
                if (typeof inputRows === "number" && typeof filterOut === "number" && inputRows > 0) {
                    const pct = (filterOut / inputRows) * 100;
                    // Show one decimal for sub-10% selectivities (where precision matters), whole
                    // percents otherwise.
                    const pctStr = pct < 10 ? pct.toFixed(1) : pct.toFixed(0);
                    properties.set(
                        "selectivity",
                        `${pctStr}% pass (${formatMetric(filterOut)} of ${formatMetric(inputRows)})${estimated ? " (est)" : ""}`,
                    );
                }

                // Lead with the readable filter details, keeping remaining properties in place. The
                // dynamic per-conjunct `predicate N` rows follow `predicates`, ordered by N.
                const predicateKeys = [...properties.keys()]
                    .filter((k) => /^predicate \d+$/.test(k))
                    .sort((a, b) => Number(a.slice(10)) - Number(b.slice(10)));
                reorderProperties(properties, [
                    "condition",
                    "predicates",
                    ...predicateKeys,
                    "estimated-rows",
                    "output-rows",
                    "selectivity",
                ]);
                hasSemanticLead = true;
            }

            // A join operator surfaces *which fields it joins on* so the join predicate is visible at
            // a glance instead of buried in the collapsed `condition` expression subtree. The condition
            // is typically an equality (`a = b`) or a conjunction of them for composite keys.
            // `JOIN_OPERATORS` holds the concatenated spellings (`leftouterjoin`); strip hyphens so a
            // kebab-case plan (`left-outer-join`) matches too — the same fallback the icon lookup uses.
            if (nodeTag !== undefined && JOIN_OPERATORS.has(nodeTag.replace(/-/g, ""))) {
                // Tag each column in the predicate with which side of the join it comes from (left input
                // `⟨L⟩`-prefixed, right input `⟨R⟩`-suffixed), derived from the two inputs' output-IU sets
                // — authoritative regardless of the optimizer's operand order. `inputs[0]`/`inputs[1]`
                // are the left/right children (older
                // plans use the `left`/`right`/`input` keys). Set the module-level hook only for the
                // duration of this join's predicate rendering, then clear it.
                const rawInputs = rawNode["inputs"];
                const leftChild = Array.isArray(rawInputs) ? rawInputs[0] : (rawNode["left"] ?? rawNode["input"]);
                const rightChild = Array.isArray(rawInputs) ? rawInputs[1] : rawNode["right"];
                const iusOf = (child: Json | undefined) =>
                    new Set(
                        computeOutputIus(child)
                            .map((c) => c.iu)
                            .filter((iu): iu is string => iu !== undefined),
                    );
                const leftIus = iusOf(leftChild);
                const rightIus = iusOf(rightChild);
                iuSideTag = (iu) => (leftIus.has(iu) ? "L" : rightIus.has(iu) ? "R" : "");

                // Render the join predicate compactly (e.g. `⟨L⟩ orderkey = orderkey2 ⟨R⟩ AND …`).
                // Keep the subtree too (the generic loop still adds it) for full detail.
                const conditionStr = stringifyExpression(rawNode["condition"]);
                if (conditionStr !== undefined && conditionStr.length > 0) {
                    properties.set("condition", conditionStr);
                }
                // A composite key joins on several equalities under a top-level `and`; report the count
                // and list each conjunct on its own `predicate N` row so the individual key comparisons
                // are readable without parsing the combined `condition` string.
                const conditionArgs = tryGetPropertyPath(rawNode, ["condition", "arguments"]);
                const conjunctKind = tryToString(tryGetPropertyPath(rawNode, ["condition", "expression"]));
                if (conjunctKind === "and" && Array.isArray(conditionArgs) && conditionArgs.length > 1) {
                    properties.set("predicates", conditionArgs.length.toString());
                    conditionArgs.forEach((conjunct, i) => {
                        const conjunctStr = stringifyExpression(conjunct);
                        if (conjunctStr !== undefined && conjunctStr.length > 0) {
                            properties.set(`predicate ${i + 1}`, conjunctStr);
                        }
                    });
                }
                // Clear the side-tag hook so no later predicate render (a filter, another node) is tagged.
                iuSideTag = undefined;

                // Lead with the readable join details, keeping remaining properties in place. The
                // dynamic per-conjunct `predicate N` rows follow `predicates`, ordered by N.
                const predicateKeys = [...properties.keys()]
                    .filter((k) => /^predicate \d+$/.test(k))
                    .sort((a, b) => Number(a.slice(10)) - Number(b.slice(10)));
                reorderProperties(properties, [
                    "condition",
                    "predicates",
                    ...predicateKeys,
                    "method",
                    "estimated-rows",
                    "output-rows",
                ]);
                hasSemanticLead = true;
            }

            // A `group-by` (aggregation) operator surfaces *which columns it groups on* and *what it
            // aggregates*, so the node reads as more than a generic operator with a collapsed
            // `key-expressions` / `aggregates` subtree. The raw arrays are deep IU-ref trees; render the
            // grouping keys and the aggregate calls in a compact, SQL-like form. Accept the newer kebab
            // spelling (`group-by`) and the legacy concatenated one (`groupby`).
            if (nodeTag === "group-by" || nodeTag === "groupby") {
                // Grouping keys: each entry wraps its key expression under `expression.value` (newer
                // format) or directly under `value`. Render each compactly (an `iu-ref` becomes a
                // column name; a computed key like a week-bucket becomes its expression).
                const keyExprs = rawNode["key-expressions"] ?? rawNode["keyExpressions"];
                const keyStrs: string[] = [];
                if (Array.isArray(keyExprs)) {
                    for (const entry of keyExprs) {
                        const keyExpr = tryGetPropertyPath(entry, ["expression", "value"]) ?? tryGetPropertyPath(entry, ["value"]);
                        const s = stringifyExpression(keyExpr);
                        if (s !== undefined && s.length > 0) keyStrs.push(s);
                    }
                }
                if (keyStrs.length > 0) {
                    properties.set("group by", keyStrs.join(", "));
                } else if (Array.isArray(keyExprs) && keyExprs.length > 0) {
                    // Keys are present but none rendered compactly (an unrecognized expression shape);
                    // don't mislabel it as a keyless aggregate — point at the full subtree instead.
                    properties.set("group by", `${keyExprs.length} key expression${keyExprs.length > 1 ? "s" : ""} (see subtree)`);
                } else {
                    // No grouping keys at all: a single global aggregate over the whole input.
                    properties.set("group by", "(global aggregate — no keys)");
                }

                // Multiple grouping sets => ROLLUP / CUBE / GROUPING SETS: report the count so the
                // multi-grouping shape is visible without expanding the `grouping-sets` subtree.
                const groupingSets = rawNode["grouping-sets"] ?? rawNode["groupingSets"];
                if (Array.isArray(groupingSets) && groupingSets.length > 1) {
                    properties.set("grouping sets", groupingSets.length.toString());
                }

                // Aggregates: render each as `alias = fn(arg)` (the alias ties back to the `output columns`
                // entry) via the shared `formatAggregateCalls` helper — the `window` block renders the same
                // way, only with an `OVER (…)` suffix.
                const aggregates = rawNode["aggregates"];
                const aggExprs = rawNode["agg-expressions"] ?? rawNode["aggExpressions"];
                const aggStrs = Array.isArray(aggregates) ? formatAggregateCalls(aggregates, aggExprs) : [];
                if (aggStrs.length > 0) {
                    properties.set("aggregates", aggStrs.join(", "));
                }

                reorderProperties(properties, ["group by", "grouping sets", "aggregates", "estimated-rows", "output-rows"]);
                hasSemanticLead = true;
            }

            // A `sort` operator surfaces *which fields it orders by* — each key with its direction and
            // null placement — plus any top-N `limit`, so the ordering reads at a glance instead of
            // being buried in the collapsed `criterion` subtree. Each criterion carries its key
            // expression under `value`, with boolean `descending` / `null-first` flags.
            if (nodeTag === "sort") {
                const criterion = rawNode["criterion"];
                const keyStrs: string[] = [];
                if (Array.isArray(criterion)) {
                    for (const c of criterion) {
                        const keyStr = stringifyExpression(tryGetPropertyPath(c, ["value"]));
                        if (keyStr === undefined || keyStr.length === 0) continue;
                        const descending = tryGetPropertyPath(c, ["descending"]) === true;
                        // `null-first` is the kebab spelling; accept the legacy `nullFirst` too. Only
                        // annotate null placement when the flag is present (a real boolean).
                        const nullFirst = tryGetPropertyPath(c, ["null-first"]) ?? tryGetPropertyPath(c, ["nullFirst"]);
                        const dir = descending ? "desc" : "asc";
                        const nulls = nullFirst === true ? " nulls-first" : nullFirst === false ? " nulls-last" : "";
                        keyStrs.push(`${keyStr} ${dir}${nulls}`);
                    }
                }
                if (keyStrs.length > 0) {
                    properties.set("sort by", keyStrs.join(", "));
                } else if ((!Array.isArray(criterion) || criterion.length === 0) && rawNode["limit"] !== undefined) {
                    // An empty `criterion` with a `limit` is how Hyper encodes a bare `LIMIT` (no
                    // ORDER BY) — it isn't a sort at all. Relabel the node from "sort" to "limit" so it
                    // doesn't read as an ordering operation; the `limit: N` row (surfaced by the generic
                    // loop) then carries the row cap on its own, with no misleading "sort by" row. Swap the
                    // sort icon for the limit glyph too, so the icon doesn't contradict the label.
                    convertedNode.name = "limit";
                    convertedNode.icon = "limit-symbol";
                }
                // `limit` is already surfaced as a raw number by the generic loop; just reorder it up.
                reorderProperties(properties, ["sort by", "limit", "estimated-rows", "output-rows"]);
                hasSemanticLead = true;
            }

            // A `map` operator computes derived columns; surface each output column and its defining
            // expression (`name = expr`) so the computation is visible without expanding the `values`
            // subtree. Each `values` entry carries the output IU under `iu` and the expression under
            // `value`.
            if (nodeTag === "map") {
                const values = rawNode["values"];
                const colStrs: string[] = [];
                if (Array.isArray(values)) {
                    for (const v of values) {
                        const iu = tryGetPropertyPath(v, ["iu"]);
                        const rawName = Array.isArray(iu) ? iu[0] : iu;
                        // Prefer the user-facing alias (e.g. `Sum of Amount`, `grouping_2__sl`) the flood
                        // recovered for this computed IU, then its base column name, so the `column N`
                        // label matches the node's `output columns` row; fall back to the humanized
                        // internal IU (`⟨computed⟩`) when the column has no recovered name.
                        const name =
                            typeof rawName === "string"
                                ? (iuAliases.get(rawName) ?? iuDisplayNames.get(rawName) ?? humanizeIuName(rawName))
                                : undefined;
                        const valueExpr = tryGetPropertyPath(v, ["value"]);
                        const exprStr = stringifyExpression(valueExpr);
                        if (name === undefined || exprStr === undefined || exprStr.length === 0) continue;
                        if (name === exprStr) {
                            // A pure rename/cast reduces to `col = col` once the target inherits its source's
                            // name (see the map-rename fixpoint in `convertHyperPlan`); collapse it to just the
                            // column name so the row reads as plumbing, not a redundant self-assignment. But a
                            // cast/coalesce over a single column renders transparently (see `stringifyExpression`),
                            // so the collapse would hide *which* operation produced the column — tag it so a
                            // type-unification `setCast` reads as `col (cast)` rather than an unexplained rename.
                            // A plain passthrough (`iu-ref`) is a bare rename and needs no marker.
                            const opKind =
                                valueExpr === undefined
                                    ? undefined
                                    : tryToString(tryGetPropertyPath(valueExpr, ["expression"]))?.replace(/-/g, "");
                            let marker = "";
                            if (opKind === "cast") {
                                // Name the target type when Hyper records it, so a `setCast` reads as
                                // `col (cast as Numeric(18, 2))`; fall back to a bare `(cast)` otherwise.
                                const castType = valueExpr === undefined ? undefined : formatTypeName(tryGetPropertyPath(valueExpr, ["type"]));
                                marker = castType !== undefined ? ` (cast as ${castType})` : " (cast)";
                            } else if (opKind === "coalesce") {
                                marker = " (coalesce)";
                            }
                            colStrs.push(name + marker);
                        } else {
                            colStrs.push(`${name} = ${exprStr}`);
                        }
                    }
                }
                if (colStrs.length > 0) {
                    // Report the count, then list each computed column on its own `column N` row (mirrors
                    // the filter/join per-conjunct `predicate N` rows) so long formulas stay readable.
                    properties.set("computes", colStrs.length.toString());
                    colStrs.forEach((s, i) => properties.set(`column ${i + 1}`, s));
                }
                const columnKeys = [...properties.keys()]
                    .filter((k) => /^column \d+$/.test(k))
                    .sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)));
                reorderProperties(properties, ["computes", ...columnKeys, "estimated-rows", "output-rows"]);
                hasSemanticLead = true;
            }

            // A `window` operator passes its input through and appends window-function results. Surface
            // each as `alias = fn(arg) OVER (partition by … order by … frame)` so the computation and
            // its output column read at a glance instead of hiding in the `window-infos` subtree —
            // mirroring how `map` and `group-by` report their computed columns, one per `function N` row.
            // Each `window-infos` entry is either a window aggregate (`operation: "aggregate"`, whose
            // `aggregation.aggregates[]` mirror a group-by's) or a ranking/value function (`operation`
            // names the function and the entry's own `iu` is its result). The output alias is resolved
            // with the same `outputColumnName(iuName(iu))` the output-column derivation uses (lines
            // ~958/963), so each `function N` row's name matches the node's `output columns` entry.
            if (nodeTag === "window") {
                const windowInfos = rawNode["window-infos"] ?? rawNode["windowInfos"];
                // Format the frame bound (`start`/`end`): unbounded / current-row / an N-row offset whose
                // sign selects preceding (negative) vs following (positive), matching SQL frame syntax.
                const frameBound = (info: Json, modeKey: string, expKey: string): string | undefined => {
                    const mode = tryGetPropertyPath(info, [modeKey]);
                    if (mode === "unbounded-preceding" || mode === "unboundedPreceding") return "unbounded preceding";
                    if (mode === "unbounded-following" || mode === "unboundedFollowing") return "unbounded following";
                    if (mode === "current-row" || mode === "currentRow") return "current row";
                    if (mode === "value") {
                        const v = tryGetPropertyPath(info, [expKey, "value", "value"]);
                        if (typeof v === "number") return v === 0 ? "current row" : v < 0 ? `${-v} preceding` : `${v} following`;
                    }
                    return undefined;
                };
                // Build the shared `OVER (…)` clause once per window-info; every function in that info
                // shares its partition / order / frame.
                const overClause = (info: Json): string => {
                    const parts: string[] = [];
                    const partitionBy = tryGetPropertyPath(info, ["partition-by"]) ?? tryGetPropertyPath(info, ["partitionBy"]);
                    if (Array.isArray(partitionBy) && partitionBy.length > 0) {
                        const cols = partitionBy
                            .map((p) => stringifyExpression(p))
                            .filter((s): s is string => s !== undefined && s.length > 0);
                        if (cols.length > 0) parts.push(`partition by ${cols.join(", ")}`);
                    }
                    const orderBy = tryGetPropertyPath(info, ["frame-order-by"]) ?? tryGetPropertyPath(info, ["frameOrderBy"]);
                    if (Array.isArray(orderBy) && orderBy.length > 0) {
                        const keys = orderBy
                            .map((c) => {
                                const keyStr = stringifyExpression(tryGetPropertyPath(c, ["value"]));
                                if (keyStr === undefined || keyStr.length === 0) return undefined;
                                const descending = tryGetPropertyPath(c, ["descending"]) === true;
                                return `${keyStr} ${descending ? "desc" : "asc"}`;
                            })
                            .filter((s): s is string => s !== undefined);
                        if (keys.length > 0) parts.push(`order by ${keys.join(", ")}`);
                    }
                    // Only report a frame when both bounds resolve; a `rows`/`range` mode with `exclude`
                    // set to `no_others` is the default, so the exclusion is intentionally not shown.
                    const mode =
                        tryGetPropertyPath(info, ["rowsmode"]) === true
                            ? "rows"
                            : tryGetPropertyPath(info, ["rangemode"]) === true
                              ? "range"
                              : undefined;
                    if (mode !== undefined) {
                        const start = frameBound(info, "start-mode", "start-exp");
                        const end = frameBound(info, "end-mode", "end-exp");
                        if (start !== undefined && end !== undefined) parts.push(`${mode} between ${start} and ${end}`);
                    }
                    return ` OVER (${parts.join(" ")})`;
                };
                const fnStrs: string[] = [];
                if (Array.isArray(windowInfos)) {
                    for (const info of windowInfos) {
                        const over = overClause(info);
                        const operation = tryGetPropertyPath(info, ["operation"]);
                        if (operation === "aggregate") {
                            // A window aggregate encodes its aggregates exactly like a `group-by`, but under
                            // the nested `aggregation` object and sharing this info's `OVER (…)` clause.
                            const aggregation = tryGetPropertyPath(info, ["aggregation"]);
                            const aggregates = aggregation === undefined ? undefined : tryGetPropertyPath(aggregation, ["aggregates"]);
                            const aggExprs =
                                aggregation === undefined
                                    ? undefined
                                    : (tryGetPropertyPath(aggregation, ["agg-expressions"]) ??
                                      tryGetPropertyPath(aggregation, ["aggExpressions"]));
                            if (Array.isArray(aggregates)) {
                                fnStrs.push(...formatAggregateCalls(aggregates, aggExprs, over));
                            }
                        } else if (typeof operation === "string") {
                            // Ranking / value functions (row_number, rank, lead, lag, …): `operation` is the
                            // function name and the entry's own `iu` is its result column.
                            const iu = iuName(tryGetPropertyPath(info, ["iu"]));
                            const alias = iu !== undefined ? outputColumnName(iu) : undefined;
                            const call = `${operation}()${over}`;
                            fnStrs.push(alias !== undefined && alias.length > 0 ? `${alias} = ${call}` : call);
                        }
                    }
                }
                if (fnStrs.length > 0) {
                    // Report the count, then list each function on its own `function N` row (mirrors the
                    // map `column N` rows) so long OVER clauses stay readable.
                    properties.set("window functions", fnStrs.length.toString());
                    fnStrs.forEach((s, i) => properties.set(`function ${i + 1}`, s));
                }
                const functionKeys = [...properties.keys()]
                    .filter((k) => /^function \d+$/.test(k))
                    .sort((a, b) => Number(a.slice(9)) - Number(b.slice(9)));
                reorderProperties(properties, ["window functions", ...functionKeys, "estimated-rows", "output-rows"]);
                hasSemanticLead = true;
            }

            // An `explicitscan` / `temp` re-reads a materialized (shared) temp result and re-projects its
            // columns under fresh IUs via `mapping` (each entry maps a `source` expression to a renamed
            // `target` IU). Surface the output columns it produces — named by their source column — so the
            // temp's shape reads at a glance instead of hiding in the `mapping` subtree. Prioritize the
            // columns whose target IU is used later, mirroring the scan `columns` preview.
            if (nodeTag !== undefined && (nodeTag.replace(/-/g, "") === "explicitscan" || nodeTag === "temp")) {
                const mapping = rawNode["mapping"];
                if (Array.isArray(mapping)) {
                    const cols = mapping
                        .map((m) => {
                            // The friendly name is the source column's display name (an `iu-ref` that
                            // `stringifyExpression` resolves via `iuDisplayNames`); the relevance key is
                            // the renamed target IU that downstream operators actually reference.
                            const name = stringifyExpression(tryGetPropertyPath(m, ["source"]));
                            if (name === undefined || name.length === 0) return undefined;
                            const target = tryGetPropertyPath(m, ["target"]);
                            const targetIu = Array.isArray(target) ? target[0] : target;
                            return {name, iu: typeof targetIu === "string" ? targetIu : undefined};
                        })
                        .filter((c): c is {name: string; iu: string | undefined} => c !== undefined);
                    setColumnPreview("output columns", cols);
                }
                reorderProperties(properties, ["output columns", "estimated-rows", "output-rows"]);
            }

            // The `execution-target` (plan root) surfaces the query's final output columns by name, so
            // the result shape is visible at the top of the plan without expanding the `output-names`
            // subtree. Accept the newer kebab spelling and the legacy concatenated one.
            if (nodeTag === "execution-target" || nodeTag === "executiontarget") {
                const outputNames = rawNode["output-names"] ?? rawNode["outputNames"];
                if (Array.isArray(outputNames)) {
                    // Pair each result name with its IU (from the parallel `output` array) so the preview
                    // uses the same relevant-columns-first ordering as every other node's `output columns`
                    // row: the leading referenced columns, then `... [remaining]`.
                    const output = rawNode["output"];
                    const cols = outputNames
                        .map((name, i): OutputColumn | undefined => {
                            if (typeof name !== "string") return undefined;
                            const iu = Array.isArray(output) ? iuName(tryGetPropertyPath(output[i], ["iu"])) : undefined;
                            return {name, iu};
                        })
                        .filter((c): c is OutputColumn => c !== undefined);
                    setColumnPreview("output columns", cols);
                }
                reorderProperties(properties, ["output columns", "estimated-rows", "output-rows"]);
            }

            // A `udtablefunction` (e.g. Data Cloud `hybrid_search`) carries rich metadata about the
            // index it searches, the vector DB, and the embedding model — all buried deep inside the
            // UDF argument's `language-specific-metadata`. Surface the most useful bits as top-level
            // node properties so they are visible without drilling into the collapsed `args` subtree.
            if (nodeTag === "udtablefunction") {
                // The UDF's function name (e.g. `hybrid_search`) and volatility, straight off the node.
                // Require real strings: `tryToString` returns the literal "undefined" for a missing
                // field, which would otherwise show as `function: undefined` on a nameless UDF node.
                const fnName = rawNode["name"];
                if (typeof fnName === "string") {
                    properties.set("function", fnName);
                }
                const volatility = rawNode["volatility"];
                if (typeof volatility === "string") {
                    properties.set("volatility", volatility);
                }
                // The view / model the search targets (from the UDF's `tableref` argument), e.g. the
                // `..._index__dlm` view.
                const udfTableName = findUdfTableName(rawNode);
                if (udfTableName !== undefined) {
                    properties.set("table-name", udfTableName);
                }
                // The physical source table(s) behind that view/index (the `..._chunk__dll` data-lake
                // table). Only shown when distinct from `table-name`, so we don't repeat the view name.
                const leafTables = findUdfLeafTables(rawNode).filter((t) => t !== udfTableName);
                if (leafTables.length > 0) {
                    properties.set("source-table", leafTables.join(", "));
                }

                // The relevance-score columns the search projects (e.g. `hybrid`, `vector`, `keyword`).
                // Seeing both a keyword and a vector score is the authoritative "this is a true hybrid
                // search" signal — see `findUdfScoreColumns`.
                const scoreColumns = findUdfScoreColumns(rawNode);
                if (scoreColumns.length > 0) {
                    properties.set("scores", scoreColumns.join(", "));
                }
                const scoresHybrid = scoreColumns.includes("keyword") && scoreColumns.includes("vector");

                // Corpus size the search runs against (from metadata, when present); used both as a
                // standalone property and as context on `matched-records`. Declared out here so the
                // runtime-telemetry block below can read it even when metadata parsing fails.
                let totalRecords: string | undefined;
                const meta = findUdfMetadataProperties(rawNode);
                if (meta !== undefined) {
                    // Human-readable index name and how many records it spans (total-records is the
                    // corpus size the search runs against — useful context for the row estimates).
                    const developerName = getUdfMetadataString(meta, "developer-name");
                    if (developerName !== undefined) {
                        properties.set("index", developerName);
                    }
                    totalRecords = getUdfMetadataString(meta, "total-records");
                    if (totalRecords !== undefined) {
                        const asNum = Number(totalRecords);
                        properties.set("total-records", Number.isFinite(asNum) ? formatMetric(asNum) : totalRecords);
                    }
                    // Vector-search configuration: which vector DB, index type, and similarity metric.
                    const vectorDb = getUdfMetadataJsonField(meta, "vectorDbConnectionDetails", "vectorDBName");
                    if (vectorDb !== undefined) {
                        properties.set("vector-db", vectorDb);
                    }
                    const indexType = getUdfMetadataJsonField(meta, "vectorAccessProperties", "indexType");
                    if (indexType !== undefined) {
                        properties.set("vector-index", indexType);
                    }
                    const metricType = getUdfMetadataJsonField(meta, "vectorAccessProperties", "metricType");
                    if (metricType !== undefined) {
                        properties.set("similarity-metric", metricType);
                    }
                    // Embedding model + dimensionality used to build the query vector.
                    const embeddingModel = getUdfMetadataJsonField(meta, "embeddingModelDetails", "model");
                    if (embeddingModel !== undefined) {
                        properties.set("embedding-model", embeddingModel);
                    }
                    const embeddingDim = getUdfMetadataJsonField(meta, "embeddingModelDetails", "dimension");
                    if (embeddingDim !== undefined) {
                        properties.set("embedding-dim", embeddingDim);
                    }
                    // A keyword-index entry means the hybrid search also runs a lexical (BM25-style)
                    // retrieval leg alongside the vector one — worth flagging as the "hybrid" signal.
                    const keywordIndex = getUdfMetadataString(meta, "keywordIndexConnectionDetails");
                    if (keywordIndex !== undefined) {
                        properties.set("keyword-search", "yes");
                    }

                    // Record the search node so the plan-insights panel can call it out and jump to it.
                    // A vector DB or embedding model is what makes this a (vector/hybrid) search rather
                    // than a plain table-valued function, so only mark it when one of those is present.
                    if (vectorDb !== undefined || embeddingModel !== undefined) {
                        convertedNode.vectorSearch = {
                            function: properties.get("function"),
                            index: developerName,
                            vectorDb,
                            embeddingModel,
                            // Prefer the authoritative score-column evidence (both a keyword and a
                            // vector score projected); fall back to the keyword-index metadata.
                            hybrid: scoresHybrid || keywordIndex !== undefined,
                        };
                    }
                }

                // The following runtime telemetry lives directly on the operator (in its `analyze` /
                // `statistics` block), NOT in the UDF argument metadata — so it must be surfaced whether
                // or not `findUdfMetadataProperties` found anything, hence it sits outside the `meta`
                // block above. Only present on analyzed (runtime) plans, so all of it is opportunistic.

                // How many rows the search *matched* / returned. For a table-valued UDF like
                // `hybrid_search` the engine emits no scan-style processed-rows vs
                // rows-matching-restrictions pair — its measured `output-rows` (legacy
                // `analyze.tuple-count`) IS the matched/returned count, so we report it as the search's
                // "matched" figure, with the index corpus size as context. `total-records` is the whole
                // indexed corpus (not rows scored), so it is context only, not a ratio denominator.
                const searchOutputRows = getActualRows(rawNode);
                if (typeof searchOutputRows === "number") {
                    const totalRecordsNum = totalRecords !== undefined ? Number(totalRecords) : NaN;
                    const corpus = Number.isFinite(totalRecordsNum) ? ` (index holds ${formatMetric(totalRecordsNum)})` : "";
                    properties.set("matched-records", `${formatMetric(searchOutputRows)} matched${corpus}`);
                }

                // Other measured runtime telemetry the engine attached to this operator (execution-time,
                // memory-bytes, pipeline id); `cpu-cycles` is already surfaced earlier for every operator,
                // so it is not repeated here.
                for (const {key, prop, format} of RUNTIME_METRIC_PROPS) {
                    const value = getStatistic(rawNode, key);
                    if (typeof value === "number") {
                        properties.set(prop, format(value));
                    }
                }

                // Drop low-signal raw properties: `function-id` is an internal catalog index and
                // `sqlpos` is a source-text span, neither of which helps read the search node.
                properties.delete("function-id");
                properties.delete("sqlpos");

                // Lead the node body with these UDF properties in a fixed, readable order, keeping any
                // remaining properties in their existing order. Maps preserve insertion order, so we
                // rebuild in place (same Map reference `convertedNode.properties` points to).
                reorderProperties(properties, [
                    "function",
                    "table-name",
                    "source-table",
                    "index",
                    "total-records",
                    "estimated-rows",
                    "output-rows",
                    "matched-records",
                    "vector-db",
                    "vector-index",
                    "similarity-metric",
                    "embedding-model",
                    "embedding-dim",
                    "keyword-search",
                    "scores",
                    "volatility",
                    // Measured runtime telemetry, grouped at the end alongside cpu-cycles.
                    "cpu-cycles",
                    "execution-time",
                    "memory-bytes",
                    "pipeline",
                ]);
                // This block established a semantic lead (`function`, then the index/vector-DB/model
                // metadata). Mark it so the generic `output columns` fallback below appends after the row
                // metrics instead of fronting and burying that lead — same as join/filter/group-by/etc.
                hasSemanticLead = true;
            }

            // For operators that carry no column list of their own (joins, filter/select, sort,
            // group-by, map, window, set-ops, …), derive the output schema bottom-up and show the same
            // used-first column preview as scans, so the reader can see what each stage produces without
            // tracing IUs by hand. Skipped when a more specific block above already set `output columns`
            // (scan / explicit-scan / temp / execution-target) or when the node isn't a projection at all
            // (`insert` is a write).
            if (
                !properties.has("output columns") &&
                nodeTag !== "execution-target" &&
                nodeTag !== "executiontarget" &&
                nodeTag !== "insert"
            ) {
                setColumnPreview("output columns", computeOutputIus(rawNode));
                // Front `output columns` only when the operator has no lead of its own — set operations
                // and generic operators read best columns-first. When a block above already established a
                // semantic lead (join condition, group-by keys, sort keys, map computes), leave `output
                // columns` where `setColumnPreview` appended it (after the row metrics) so the lead stays
                // visible instead of being pushed down.
                if (!hasSemanticLead && properties.has("output columns")) {
                    reorderProperties(properties, ["output columns"]);
                }
            }

            // If this operator feeds a set operation, its output schema is authoritatively the set op's
            // columns (union-compatible inputs share the set op's schema). Overwrite whatever `output
            // columns` the derivation produced so the input's count and names line up exactly with the
            // union-all above it — the bottom-up derivation can otherwise disagree on the column count.
            const setOpCols = setOpInputColumns.get(rawNode);
            if (setOpCols !== undefined && setOpCols.length > 0) {
                columnLists.delete("output columns");
                // Re-resolve names from the stored IUs now, not from the names captured when
                // `propagateSetOpNames` ran: that pass executes before the alias flood-fill populates
                // `iuAliases`, so a column that only gains an alias during the flood (e.g. a nested set
                // op aliased by an outer projection) would otherwise show its base name here while the
                // set op's own output row shows the alias. Resolving at display time keeps both in sync.
                const resolved = setOpCols.map((c) => (c.iu !== undefined ? {name: outputColumnName(c.iu), iu: c.iu} : c));
                setColumnPreview("output columns", resolved);
            }
        }

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

        // `operator-id` is bookkeeping, not query semantics — keep it as the last property row so the
        // meaningful metadata leads. Deleting then re-setting moves the key to the end of the (insertion-
        // ordered) Map. Handles both the kebab and legacy spellings.
        for (const key of ["operator-id", "operatorId"]) {
            const value = properties.get(key);
            if (value !== undefined) {
                properties.delete(key);
                properties.set(key, value);
            }
        }

        // Flag a projection that emits the same output column name more than once (e.g. an
        // execution-target that references the same IU twice). Carry the names for the plan-insights
        // panel, surface a `duplicate-columns` row right after `output columns`, and add a hover reason.
        // Static per plan, so it is baked here; deriveNodeDisplay re-appends the reason on the live
        // render path (which rebuilds `highlightReason` for adjustable plans).
        if (duplicateColumns.length > 0) {
            convertedNode.duplicateColumns = duplicateColumns;
            // Render the row like the other column lists: a `first, second ... [n]` preview whose
            // `... [n]` marker expands the rest on click. Stash the full list for that expansion when the
            // preview truncated it; the property string is the matching static fallback.
            const dupPreview = formatColumnPreview(duplicateColumns)!;
            if (duplicateColumns.length > COLUMN_PREVIEW_COUNT) columnLists.set("duplicate-columns", duplicateColumns);
            // Insert `duplicate-columns` immediately after `output columns` (wherever that row sits)
            // without disturbing the rest of the order. `output columns` is guaranteed present, since
            // `duplicateColumns` is only set when its preview was written.
            const rebuilt = new Map<string, string>();
            for (const [k, v] of properties) {
                rebuilt.set(k, v);
                if (k === "output columns") rebuilt.set("duplicate-columns", dupPreview);
            }
            properties.clear();
            for (const [k, v] of rebuilt) properties.set(k, v);
            const dupReason = duplicateColumnsReason(duplicateColumns);
            convertedNode.highlightReason = convertedNode.highlightReason
                ? `${convertedNode.highlightReason}\n${dupReason}`
                : dupReason;
        }

        // Carry the full column lists (only populated when a preview was truncated) so the UI can expand
        // the elided columns on click.
        if (columnLists.size > 0) {
            convertedNode.columnLists = columnLists;
        }

        return convertedNode;
    } else if (Array.isArray(rawNode)) {
        // "Array" nodes
        const listOfObjects = [] as TreeNode[];
        for (let index = 0; index < rawNode.length; ++index) {
            const value = rawNode[index];
            const name = `${parentKey}.${index}`;
            let innerNode = convertHyperNode(value, name, conversionState, parentOperator);
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
        // Violet, distinct from the magenta cardinality-misestimate edge highlight. Shares
        // `runtimeHotspotShade` with `deriveNodeDisplay` so the bake and render-time recompute match.
        op.node.nodeColor = isHotspot ? runtimeHotspotShade(relativeExecutionRatio) : undefined;
        // A hotspot's violet tint appears on the node label. Append the CPU-cycles share to the tooltips
        // so that magenta coloring reads as "this is expensive", not just "this is flagged".
        if (isHotspot) {
            const pct = Math.round(relativeExecutionRatio * 100);
            const cpuReason = runtimeHotspotReason(op.time, pct);
            // Each reason goes on its own line so multiple findings on one node stay legible.
            op.node.highlightReason = op.node.highlightReason ? `${op.node.highlightReason}\n${cpuReason}` : cpuReason;
            // Only append to a *highlighted* edge (mismatch / costly), not the plain row-count tooltip
            // that every cardinality edge now carries. Gate on `edgeClass` rather than the (now
            // always-set) `edgeReason`. Kept in sync with `deriveNodeDisplay`.
            if (op.node.edgeClass) {
                op.node.edgeReason = `${op.node.edgeReason}\n${cpuReason}`;
            }
        }
    }
    return totalTime;
}

// Tint memory-hungry operators with an orange heatmap (the memory analog of the violet CPU one), and
// explain that cost in the tooltips. Returns the total peak memory across all operators, so the
// render-time recompute can determine each operator's memory share against the live hotspot threshold.
function colorRelativeMemory(state: ConversionState): number {
    const totalMemory = state.memories.reduce((p, v) => p + v.bytes, 0);
    if (totalMemory <= 0) return totalMemory;
    for (const op of state.memories) {
        const relativeMemoryRatio = op.bytes / totalMemory;
        const isHotspot = relativeMemoryRatio >= DEFAULT_THRESHOLDS.memoryHotspotPercent / 100;
        // Orange, distinct from the violet CPU heatmap and the red costly-scan shade. Keep this in sync
        // with `deriveNodeDisplay` / `memoryHotspotShade` in highlight-rules.ts, which recompute the same
        // tint at render time.
        op.node.memoryColor = isHotspot ? memoryHotspotShade(relativeMemoryRatio) : undefined;
        if (isHotspot) {
            const pct = Math.round(relativeMemoryRatio * 100);
            const memReason = memoryHotspotReason(op.bytes, pct);
            op.node.highlightReason = op.node.highlightReason ? `${op.node.highlightReason}\n${memReason}` : memReason;
            if (op.node.edgeClass) {
                op.node.edgeReason = `${op.node.edgeReason}\n${memReason}`;
            }
        }
    }
    return totalMemory;
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
        memories: [],
        scanProcessed: [],
        metadata: new Map<string, string>(),
    } as ConversionState;
    // In a single pre-pass, recover this plan's internal-IU -> real-column-name map (so stringified
    // expressions — sort/group-by keys, join & filter predicates, … — can name real columns) and the set
    // of IUs referenced by operator logic (so a wide scan/temp's truncated column preview leads with the
    // columns actually used by the rest of the plan). Rebuilt per plan since `convertOptimizerSteps`
    // converts several plans in sequence.
    iuDisplayNames = new Map<string, string>();
    iuAliases = new Map<string, string>();
    referencedIus = new Set<string>();
    directRefsCache = new WeakMap<object, Set<string>>();
    outputIuCache = new WeakMap<object, OutputColumn[]>();
    setOpInputColumns = new WeakMap<object, OutputColumn[]>();
    const mappingLinks: {target: string; source: string}[] = [];
    collectIuInfo(node, iuDisplayNames, referencedIus, mappingLinks);
    // Now that every scan attribute / projected output name is recorded, propagate those display names
    // across `explicit-scan` / `temp` renames: a `target` IU inherits its `source` column's name, so a
    // predicate on a re-projected temp column (e.g. a filter's `SourceRecordId__c = …`) reads the real
    // column name instead of the raw internal IU (`_unified.SourceRe2`). Iterate to a fixpoint so a
    // temp-of-a-temp chain resolves all the way back to the originating column; capped by the link count
    // (each pass resolves at least one new link, or we stop).
    let changed = true;
    let passes = 0;
    while (changed && passes++ < mappingLinks.length) {
        changed = false;
        for (const {target, source} of mappingLinks) {
            const sourceName = iuDisplayNames.get(source);
            if (sourceName !== undefined && !iuDisplayNames.has(target)) {
                iuDisplayNames.set(target, sourceName);
                changed = true;
            }
        }
    }
    // Give each set-op type-unification `map` target (`setCastN = cast(col)` / `= col`) its source column's
    // real name, so it displays `Email_Address__c` / `individual_id__c` instead of the opaque `setCast`. This
    // is a DIRECT per-column identity — the target IS its single source — so it names the column even when the
    // union it feeds stays opaque (a join-key union, or an email union whose result flows through `tolower`,
    // never gets a result name to flood back). Resolved to a fixpoint so a cast-of-a-rename chain settles.
    const renameLinks: {target: string; source: string}[] = [];
    collectMapRenameLinks(node, renameLinks);
    changed = true;
    passes = 0;
    while (changed && passes++ < renameLinks.length) {
        changed = false;
        for (const {target, source} of renameLinks) {
            const sourceName = iuDisplayNames.get(source);
            if (sourceName !== undefined && !iuDisplayNames.has(target)) {
                iuDisplayNames.set(target, sourceName);
                changed = true;
            }
        }
    }
    // Build the undirected "same logical column" graph — the base-name rename links (`mappingLinks`: scan
    // renames, explicit-scan mappings, group-by keys) reused undirected, plus set-op/map `values` links.
    // Two flood passes below walk its connected components: first a backward base-name recovery, then the
    // alias flood-fill. Built once here (after `iuDisplayNames`' rename fixpoint is settled) and shared.
    const aliasLinks: {a: string; b: string}[] = [];
    const aliasSeeds = new Map<string, string>();
    const computedSources = new Map<string, string[]>();
    collectAliasInfo(node, aliasLinks, aliasSeeds, computedSources);
    const adjacency = new Map<string, string[]>();
    const addEdge = (a: string, b: string) => {
        let la = adjacency.get(a);
        if (la === undefined) adjacency.set(a, (la = []));
        la.push(b);
        let lb = adjacency.get(b);
        if (lb === undefined) adjacency.set(b, (lb = []));
        lb.push(a);
    };
    for (const {target, source} of mappingLinks) addEdge(target, source);
    for (const {a, b} of aliasLinks) addEdge(a, b);
    // Enumerate connected components once; both floods below iterate this list. A component only ever
    // contains IUs that are provably the SAME logical column — the graph's edges are column renames,
    // pure `map` passthroughs, and positional set-op `values` links (computed columns like `tolower(x)`
    // or `cast(x)` contribute no edge, so they never join a component). This is what makes both the
    // base-name and alias floods safe to propagate within a component.
    const components: string[][] = [];
    const visited = new Set<string>();
    for (const start of adjacency.keys()) {
        if (visited.has(start)) continue;
        const component: string[] = [];
        const stack = [start];
        visited.add(start);
        while (stack.length > 0) {
            const cur = stack.pop() as string;
            component.push(cur);
            for (const nb of adjacency.get(cur) ?? []) {
                if (!visited.has(nb)) {
                    visited.add(nb);
                    stack.push(nb);
                }
            }
        }
        components.push(component);
    }
    // Backward base-name recovery. Hyper leaves a set-op output column an opaque internal IU (`union5`)
    // whenever it never reaches the top-level projection — most commonly a union column consumed only as a
    // join key, so no result name ever flows down onto it. But every branch feeding that column names a
    // real source column, recorded in `iuDisplayNames` (scan attributes / rename links). Since a component
    // is a single logical column, if its members resolve to exactly ONE base column name we adopt it for
    // the members that have none — `union5`'s four branches are all `Party__c`, so `union5` becomes
    // `Party__c`. This never invents a name; two guards keep it honest:
    //   • >1 distinct base name -> the branches genuinely differ (an email union over `Email_Address__c` /
    //     `EmailAddress__c` / `emailId__c`) -> leave opaque.
    //   • a `veto` for any member that is a genuinely COMPUTED column (const, arithmetic, or a cast whose
    //     source can't be named). Without this, a single-source cast branch — e.g. `cast(individual_id__c)`
    //     feeding a union column whose other branches are all `Party__c` — would carry no base name of its
    //     own and hide the disagreement, so the union (and the cast IU itself) would be mislabeled
    //     `Party__c`. We resolve a single-source cast through `computedSources` so its true identity
    //     (`individual_id__c`) counts toward the agreement check and correctly forces an abstain.
    // Runs before `propagateSetOpNames` so a set op's inputs pick up any recovered name too.
    for (const component of components) {
        const baseNames = new Set<string>();
        let veto = false;
        for (const iu of component) {
            const direct = iuDisplayNames.get(iu);
            if (direct !== undefined) {
                baseNames.add(direct);
                continue;
            }
            const leaves = computedSources.get(iu);
            if (leaves === undefined) continue; // a passthrough / set-op output IU still awaiting a name
            // A single-source computed value (a cast) can be traced to its origin column; anything else
            // (const with no source, or a multi-column expression) is a genuinely new column that must not
            // be folded into a neighbor's identity.
            const leafName = leaves.length === 1 ? iuDisplayNames.get(leaves[0]) : undefined;
            if (leafName !== undefined) baseNames.add(leafName);
            else veto = true;
        }
        if (veto || baseNames.size !== 1) continue;
        const base = baseNames.values().next().value as string;
        for (const iu of component) {
            if (!iuDisplayNames.has(iu)) iuDisplayNames.set(iu, base);
        }
    }
    // With every real column name recovered, push each set operation's output names down onto its inputs'
    // positionally-aligned columns (see `propagateSetOpNames`), so the maps/branches feeding a union-all
    // read with the union's result-column names and the flow is verifiable at a glance. This calls
    // `computeOutputIus` (to learn each input's column order), populating `outputIuCache` with names
    // captured *before* the propagation; discard that cache afterward so the display re-derives every
    // operator's `output columns` using the propagated names.
    propagateSetOpNames(node);
    outputIuCache = new WeakMap<object, OutputColumn[]>();
    // Alias flood-fill (see the `iuAliases` block comment): from each aliased output IU walk to every IU
    // carrying that logical column, recording the alias wherever it differs from the base name. A component
    // represents a single logical column iff its seeds agree on one alias; if two distinctly-aliased
    // outputs got fused into it (a shared upstream IU, an over-linked expression), the component is
    // ambiguous — leave it un-aliased rather than let one seed arbitrarily win and mislabel the other's
    // column (its base name still reads correctly). Within an aliased component, skip IUs whose base name
    // already equals the alias (the base already reads right). Runs after `iuDisplayNames` is fully settled
    // (including the recovery above) so the base-name guard is accurate.
    for (const component of components) {
        const seededAliases = new Set<string>();
        for (const iu of component) {
            const a = aliasSeeds.get(iu);
            if (a !== undefined) seededAliases.add(a);
        }
        if (seededAliases.size !== 1) continue;
        const alias = seededAliases.values().next().value as string;
        for (const iu of component) {
            if (!iuAliases.has(iu) && iuDisplayNames.get(iu) !== alias) iuAliases.set(iu, alias);
        }
    }
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
    const planMemoryTotal = colorRelativeMemory(conversionState);
    const planProcessedTotal = shadeCostlyScans(conversionState);
    setEdgeWidths(conversionState);
    const crosslinks = resolveCrosslinks(conversionState);
    if (pipelines !== undefined) {
        assignPipelineColors(root, conversionState.operatorsById, parsePipelines(pipelines), crosslinks);
    }
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
        planMemoryTotal,
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
