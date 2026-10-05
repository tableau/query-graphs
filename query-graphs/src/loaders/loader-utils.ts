import type {PropertyEntry, TreeNode} from "../tree-description";
import {allChildren, visitTreeNodes} from "../tree-description";

// Stricter type for JSON data
type JsonPrimitive = string | number | boolean | null;
export type Json = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
    [x: string]: JsonPrimitive | JsonObject | JsonArray;
}
type JsonArray = Json[];

// Checks if an object has a given key
// In contrast to a raw call, this function
// a) adds the necessary type narrowing, and
// b) calls `hasOwnProperty` over its prototype, thereby making sure no-one overwrote it
export function hasOwnProperty<X, Y extends PropertyKey>(o: X, key: Y): o is X & Record<Y, unknown> {
    return Object.prototype.hasOwnProperty.call(o, key);
}

export function isJsonObject(value: Json | undefined): value is JsonObject {
    return typeof value === "object" && !Array.isArray(value) && value !== null;
}

export function tryGetPropertyPath(d: Json, path: string[]): Json | undefined {
    for (const key of path) {
        if (!isJsonObject(d)) return undefined;
        if (!hasOwnProperty(d, key)) return undefined;
        d = d[key];
    }
    return d;
}

export function hasSubObject<Y extends string>(value: Json, key: Y): value is JsonObject & Record<Y, JsonObject> {
    return isJsonObject(value) && hasOwnProperty(value, key) && isJsonObject(value[key]);
}

// Try to convert to string. Return undefined if not succesful.
export function tryToString(d: unknown): string | undefined {
    if (typeof d === "string") {
        return d;
    } else if (typeof d === "number") {
        return d.toString();
    } else if (typeof d === "boolean") {
        return d.toString();
    } else if (d === null) {
        return "null";
    } else if (d === undefined) {
        return "undefined";
    }
    return undefined;
}

export function tryToNonNullString(value: unknown): string | undefined {
    return value === undefined || value === null ? undefined : tryToString(value);
}

// Convert to string. Returns the JSON serialization if not supported.
export function forceToString(d: unknown): string {
    let str = tryToString(d);
    if (str === undefined) {
        str = JSON.stringify(d);
    }
    return str;
}

export function tryToNumber(value: unknown): number | undefined {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

// Format a number using metric suffixes
export function formatMetric(x: number): string {
    const sizes = ["", "k", "M", "G", "T", "P", "E", "Z", "Y"];
    let idx = 0;
    while (x > 1000 && idx < sizes.length - 1) {
        x /= 1000;
        ++idx;
    }
    return x.toFixed(0) + sizes[idx];
}

// Format a row count using count suffixes (K/M/B/T for thousand, million,
// billion, trillion) rather than the metric `G`. Scaled values below 100 keep
// one decimal (`1.2B`), so large counts stay distinguishable; unscaled values
// keep three significant digits (`57.5`, `0.476`), so small fractions survive.
export function formatCount(x: number): string {
    const sizes = ["", "K", "M", "B", "T"];
    let idx = 0;
    while (Math.abs(x) >= 1000 && idx < sizes.length - 1) {
        x /= 1000;
        ++idx;
    }
    let rounded = idx === 0 ? Number(x.toPrecision(3)) : Math.abs(x) < 100 ? Number(x.toFixed(1)) : Math.round(x);
    // Rounding may carry into the next unit (999,950 → "1000K" → "1M").
    if (Math.abs(rounded) >= 1000 && idx < sizes.length - 1) {
        rounded = Math.sign(rounded);
        ++idx;
    }
    return rounded.toString() + sizes[idx];
}

// Format a byte count in binary units (KiB/MiB/GiB), as memory sizes usually are.
export function formatBytes(bytes: number): string {
    const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    let value = bytes;
    let idx = 0;
    while (Math.abs(value) >= 1024 && idx < units.length - 1) {
        value /= 1024;
        ++idx;
    }
    return `${idx === 0 ? value.toString() : value.toFixed(1)} ${units[idx]}`;
}

// The first argument that is a finite number, if any.
export function firstNumber(...values: unknown[]): number | undefined {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
    }
    return undefined;
}

// Reorder a property map so the listed keys appear first, in the given order,
// followed by the remaining keys in their original insertion order. Keys in
// `order` that are absent from the map are skipped.
export function reorderProperties<V>(properties: Map<string, V>, order: readonly string[]): Map<string, V> {
    const reordered = new Map<string, V>();
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
    return reordered;
}

// Convert a plain string map into property rows.
export function stringMapToProperties(map: Map<string, string>): Map<string, PropertyEntry> {
    const properties = new Map<string, PropertyEntry>();
    for (const [key, value] of map) {
        properties.set(key, {value});
    }
    return properties;
}

// Convert any JSON value into a property row: objects and arrays become groups
// (array items keyed by index), scalars become strings.
export function jsonToPropertyEntry(value: Json): PropertyEntry {
    if (isJsonObject(value)) {
        const nested = new Map<string, PropertyEntry>();
        for (const key of Object.keys(value)) {
            nested.set(key, jsonToPropertyEntry(value[key]));
        }
        return {value: nested};
    }
    if (Array.isArray(value)) {
        const nested = new Map<string, PropertyEntry>();
        value.forEach((item, index) => {
            nested.set(index.toString(), jsonToPropertyEntry(item));
        });
        return {value: nested};
    }
    return {value: forceToString(value)};
}

// Matches attribute names that mention "rows" as a word, across naming styles
// ("Plan Rows", "output-rows", "r_rows", "outputRows"), but not words that
// merely contain the letters ("rowstate", "throws").
const rowAttributePattern = /(?:^|[^a-zA-Z])[Rr]ows(?![a-z])|[a-z]Rows(?![a-z])/;

export function isRowAttribute(name: string): boolean {
    return rowAttributePattern.test(name);
}

// Matches CPU-cycle attributes across naming styles ("cpu-cycles", "CPU Cycles", "cpuCycles").
const cpuCyclesAttributePattern = /cpu[-_ ]?cycles/i;

// Matches index attributes across naming styles ("Index Name", "used-index",
// "available-indexes", "indexRecommendationCandidate", "usedIndex"), but not
// ordinal IDs such as DuckDB's "Table Index" / "CTE Index".
const indexAttributePattern = /(?:^|[^a-zA-Z])[Ii]ndex|[a-z]Index/;
const ordinalIndexPattern = / Index$/;

export function isIndexAttribute(name: string): boolean {
    return indexAttributePattern.test(name) && !ordinalIndexPattern.test(name);
}

// Attributes copied out of nested groups to the top level: row counts and CPU cycles.
function isNestedSurfacedAttribute(name: string): boolean {
    return isRowAttribute(name) || cpuCyclesAttributePattern.test(name);
}

// Attributes that get special treatment at a node's top level: row counts, CPU
// cycles and indexes. Unlike the others, index attributes are never copied out
// of nested groups (e.g. `statistics.index-recommender` stays put).
export function isSurfacedAttribute(name: string): boolean {
    return isNestedSurfacedAttribute(name) || isIndexAttribute(name);
}

// Flatten an index group into scalar rows named by their path
// (`<group>.<key>`, e.g. `used-index.name`), so index details read at a glance.
function flattenIndexGroup(prefix: string, group: Map<string, PropertyEntry>, out: [string, PropertyEntry][]): void {
    for (const [key, entry] of group) {
        const path = `${prefix}.${key}`;
        if (typeof entry.value === "string") out.push([path, entry]);
        else flattenIndexGroup(path, entry.value, out);
    }
}

// Format a numeric scalar row value as a compact count; anything else (groups,
// booleans, already formatted text) is returned unchanged.
function formatRowCount(value: PropertyEntry["value"]): PropertyEntry["value"] {
    if (typeof value !== "string") return value;
    const count = tryToNumber(value);
    return count === undefined ? value : formatCount(count);
}

// Collect surfaced attributes nested anywhere inside property groups, depth-first.
function collectNestedRowAttributes(group: Map<string, PropertyEntry>, found: [string, PropertyEntry][]): void {
    for (const [key, entry] of group) {
        if (isNestedSurfacedAttribute(key)) found.push([key, entry]);
        if (typeof entry.value !== "string") collectNestedRowAttributes(entry.value, found);
    }
}

// Bring a node's row counts and CPU cycles (see `isSurfacedAttribute`) to its
// top level, so they show without opening any group:
// - top-level ones are formatted compactly via `formatCount`;
// - ones nested in groups are copied (formatted) to the top level, right after
//   the last top-level row attribute; the groups themselves are left as is;
// - a top-level index group is also flattened into rows, unless recommended.
// On a name clash, the top-level row wins, then the first nested one found.
// Returns the (possibly reordered) properties.
export function surfaceNodeRowAttributes(properties: Map<string, PropertyEntry>): Map<string, PropertyEntry> {
    const nested: [string, PropertyEntry][] = [];
    let insertAfter: string | undefined;
    for (const [key, entry] of properties) {
        if (isSurfacedAttribute(key)) {
            entry.value = formatRowCount(entry.value);
            insertAfter = key;
            // Recommended groups stay whole, so they read as one suggestion.
            if (typeof entry.value !== "string" && isIndexAttribute(key) && !entry.recommended) {
                flattenIndexGroup(key, entry.value, nested);
            }
        }
        if (typeof entry.value !== "string") collectNestedRowAttributes(entry.value, nested);
    }
    const surfaced = new Map<string, PropertyEntry>();
    for (const [key, entry] of nested) {
        if (!properties.has(key) && !surfaced.has(key)) {
            surfaced.set(key, {...entry, value: formatRowCount(entry.value)});
        }
    }
    if (surfaced.size === 0) return properties;

    const reordered = new Map<string, PropertyEntry>(insertAfter === undefined ? surfaced : []);
    for (const [key, entry] of properties) {
        reordered.set(key, entry);
        if (key === insertAfter) for (const [k, e] of surfaced) reordered.set(k, e);
    }
    return reordered;
}

// Apply `surfaceNodeRowAttributes` to every node, for all plan formats.
export function surfaceRowAttributes(root: TreeNode): void {
    visitTreeNodes(
        root,
        (node) => {
            if (node.properties !== undefined) node.properties = surfaceNodeRowAttributes(node.properties);
        },
        allChildren,
    );
}

// Whether a row carries any emphasis (hotspot, recommendation or informational).
function isEmphasized(entry: PropertyEntry): boolean {
    return entry.highlighted === true || entry.recommended === true || entry.informational === true;
}

// Order rows at every depth: scalars first (in their existing order), then
// groups, with emphasized groups leading and the rest alphabetical (numeric
// keys compare as numbers, so `2` precedes `10`).
export function trailNestedGroups(properties: Map<string, PropertyEntry>): void {
    const groups = [...properties]
        .filter(([, entry]) => typeof entry.value !== "string")
        .sort(
            ([leftKey, left], [rightKey, right]) =>
                Number(isEmphasized(right)) - Number(isEmphasized(left)) ||
                leftKey.localeCompare(rightKey, undefined, {numeric: true}),
        );
    for (const [key, entry] of groups) {
        trailNestedGroups(entry.value as Map<string, PropertyEntry>);
        // Re-inserting moves the entry to the end of the map's iteration order.
        properties.delete(key);
        properties.set(key, entry);
    }
}

// Apply `trailNestedGroups` to every node, for all plan formats.
export function trailPropertyGroups(root: TreeNode): void {
    visitTreeNodes(
        root,
        (node) => {
            if (node.properties !== undefined) trailNestedGroups(node.properties);
        },
        allChildren,
    );
}

// Format every number inside a property group, at any depth, via
// `formatCount` (`2.3B` rather than `2345678901`). Non-numeric values are
// left as they are; nothing is hidden or dropped.
export function formatNumbers(group: Map<string, PropertyEntry>): void {
    for (const entry of group.values()) {
        if (typeof entry.value !== "string") {
            formatNumbers(entry.value);
            continue;
        }
        const value = tryToNumber(entry.value);
        if (value !== undefined) entry.value = formatCount(value);
    }
}
