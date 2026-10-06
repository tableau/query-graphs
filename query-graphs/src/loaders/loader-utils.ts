import type {NumberFormat, PropertyEntry, TreeNode} from "../tree-description";
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

// Format a count using count suffixes (K/M/B/T for thousand, million,
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
    // Rounding may carry into the next unit (1023.96 KiB → "1024.0 KiB" → "1.0 MiB").
    if (idx > 0 && Math.abs(Number(value.toFixed(1))) >= 1024 && idx < units.length - 1) {
        value /= 1024;
        ++idx;
    }
    return `${idx === 0 ? value.toString() : value.toFixed(1)} ${units[idx]}`;
}

// Format a duration given in seconds with three significant digits in the
// largest fitting unit (`8.51µs`, `20.9ms`, `1.5s`, `2.5min`, `1.2h`).
export function formatSeconds(seconds: number): string {
    const units: [string, number][] = [
        ["µs", 1e-6],
        ["ms", 1e-3],
        ["s", 1],
        ["min", 60],
        ["h", 3600],
    ];
    let idx = 0;
    while (idx < units.length - 1 && Math.abs(seconds) >= units[idx + 1][1]) ++idx;
    let rounded = Number((seconds / units[idx][1]).toPrecision(3));
    // Rounding may carry into the next unit (999.6ms → "1000ms" → "1s", 59.96s → "60s" → "1min").
    if (idx < units.length - 1 && Math.abs(rounded) * units[idx][1] >= units[idx + 1][1]) {
        rounded = Number(((rounded * units[idx][1]) / units[idx + 1][1]).toPrecision(3));
        ++idx;
    }
    return `${rounded}${units[idx][0]}`;
}

// Format a number exactly, with thousand separators and every fraction digit.
export function formatExact(x: number): string {
    return x.toLocaleString("en-US", {maximumFractionDigits: 20});
}

export function formatNumber(x: number, format: NumberFormat | undefined): string {
    switch (format) {
        case "rounded":
            return formatCount(x);
        case "exact":
            return formatExact(x);
        case "memory-bytes":
            return formatBytes(x);
        case "time-seconds":
            return formatSeconds(x);
        case undefined:
            return x.toString();
    }
}

// The text shown for a scalar property; groups have no single value.
export function formatPropertyValue(entry: PropertyEntry): string | undefined {
    if (typeof entry.value === "number") return formatNumber(entry.value, entry.numberFormat);
    return typeof entry.value === "string" ? entry.value : undefined;
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
// (array items keyed by index), empty ones the text `{}` or `[]`, numbers stay
// numbers (formatted only when rendered), and the remaining scalars become strings.
export function jsonToPropertyEntry(value: Json): PropertyEntry {
    if (isJsonObject(value) && Object.keys(value).length === 0) return {value: "{}"};
    if (Array.isArray(value) && value.length === 0) return {value: "[]"};
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
    return {value: typeof value === "number" ? value : String(value)};
}

// Read a scalar property as a string; groups have no single value.
export function getScalarProperty(properties: Map<string, PropertyEntry> | undefined, key: string): string | undefined {
    const value = properties?.get(key)?.value;
    return typeof value === "string" ? value : typeof value === "number" ? value.toString() : undefined;
}

// Read a scalar property as a number, if it is one or parses as one.
export function getNumericProperty(properties: Map<string, PropertyEntry> | undefined, key: string): number | undefined {
    const value = properties?.get(key)?.value;
    return value instanceof Map ? undefined : tryToNumber(value);
}

// Follow a path of keys into nested property groups.
export function getPropertyPath(
    properties: Map<string, PropertyEntry> | undefined,
    path: readonly string[],
): PropertyEntry | undefined {
    let entry: PropertyEntry | undefined = undefined;
    let group = properties;
    for (const key of path) {
        entry = group?.get(key);
        group = entry?.value instanceof Map ? entry.value : undefined;
    }
    return entry;
}

// A row count: a top-level property name, or the path to one nested in
// property groups (e.g. `["statistics", "output-rows"]`).
export type RowProperty = string | readonly string[];

export interface SurfaceRowOptions {
    // The plan format's row counts (and similar figures, such as CPU cycles),
    // by their exact names.
    rowProps: readonly RowProperty[];
}

// Show a node's row counts without opening any group: nested ones are copied to the top level under their own
// name, right after the last top-level row count. On a name clash, the
// top-level row wins, then the first listed path. Groups are never surfaced.
// Returns the (possibly reordered) properties.
export function surfaceNodeRowAttributes(
    properties: Map<string, PropertyEntry>,
    {rowProps}: SurfaceRowOptions,
): Map<string, PropertyEntry> {
    const topLevel = new Set<string>();
    const surfaced = new Map<string, PropertyEntry>();
    for (const rowProp of rowProps) {
        const path = typeof rowProp === "string" ? [rowProp] : rowProp;
        const entry = getPropertyPath(properties, path);
        if (entry === undefined || entry.value instanceof Map) continue;
        const name = path[path.length - 1];
        if (path.length === 1) {
            topLevel.add(name);
        } else if (!properties.has(name) && !surfaced.has(name)) {
            surfaced.set(name, {...entry});
        }
    }
    if (surfaced.size === 0) return properties;

    let insertAfter: string | undefined;
    for (const key of properties.keys()) {
        if (topLevel.has(key)) insertAfter = key;
    }
    const reordered = new Map<string, PropertyEntry>(insertAfter === undefined ? surfaced : []);
    for (const [key, entry] of properties) {
        reordered.set(key, entry);
        if (key === insertAfter) for (const [k, e] of surfaced) reordered.set(k, e);
    }
    return reordered;
}

const otherUnits = ["ns", "us", "ms", "kb", "mb", "gb", "kib", "mib", "gib"];

// The lowercase words of a property name, split on separators and camelCase.
function nameWords(name: string): string[] {
    return name.split(/[^a-zA-Z]+|(?<=[a-z])(?=[A-Z])/).map((word) => word.toLowerCase());
}

// Whether a name states a unit we don't format (`memory-mb`, `total_ms`).
function hasOtherUnit(name: string): boolean {
    const words = nameWords(name);
    return otherUnits.some((unit) => words.includes(unit));
}

// Infer a number's display format from the words of its property name:
// counts of rows or cycles are `rounded`, memory and bytes are
// `memory-bytes`, and time, elapsed, clock or seconds are `time-seconds`.
// Names with another unit (`memory-mb`, `total_time_ms`) and other names
// (ids, codes, ratios) get none.
export function inferNumberFormat(name: string): NumberFormat | undefined {
    if (hasOtherUnit(name)) return undefined;
    const words = new Set(nameWords(name));
    if (words.has("rows") || words.has("cycles")) return "rounded";
    if (words.has("memory") || words.has("bytes")) return "memory-bytes";
    if (words.has("time") || words.has("elapsed") || words.has("clock") || words.has("seconds")) return "time-seconds";
    return undefined;
}

// Set the display format of numbers in properties, at any depth, from their
// names via `inferNumberFormat`. A group named for a measure by its last word
// (`processed-rows`, `wall-clock`) passes its format to the numbers inside it
// whose own name implies none; others (`memory-stats`) don't. Neither do
// groups or numbers named with another unit (`wall-clock-ms`). `accepted`
// limits the formats used, e.g. for plans reporting milliseconds.
export function applyPropertyNumberFormats(
    properties: Map<string, PropertyEntry>,
    accepted?: readonly NumberFormat[],
    inherited?: NumberFormat,
): void {
    const accept = (format: NumberFormat | undefined) =>
        format !== undefined && accepted?.includes(format) !== false ? format : undefined;
    for (const [key, entry] of properties) {
        if (entry.value instanceof Map) {
            const groupFormat = hasOtherUnit(key)
                ? undefined
                : (accept(inferNumberFormat(nameWords(key).at(-1) ?? "")) ?? inherited);
            applyPropertyNumberFormats(entry.value, accepted, groupFormat);
        } else if (typeof entry.value === "number") {
            const format = hasOtherUnit(key) ? undefined : (accept(inferNumberFormat(key)) ?? inherited);
            if (format !== undefined) entry.numberFormat = format;
        }
    }
}

// Apply `applyPropertyNumberFormats` to every node of a loaded plan.
export function applyNumberFormats(root: TreeNode, accepted?: readonly NumberFormat[]): void {
    visitTreeNodes(
        root,
        (node) => {
            if (node.properties !== undefined) applyPropertyNumberFormats(node.properties, accepted);
        },
        allChildren,
    );
}

// Apply `surfaceNodeRowAttributes` to every node of a loaded plan.
export function surfaceRowAttributes(root: TreeNode, options: SurfaceRowOptions): void {
    visitTreeNodes(
        root,
        (node) => {
            if (node.properties !== undefined) node.properties = surfaceNodeRowAttributes(node.properties, options);
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
        .filter((row): row is [string, PropertyEntry & {value: Map<string, PropertyEntry>}] => row[1].value instanceof Map)
        .sort(
            ([leftKey, left], [rightKey, right]) =>
                Number(isEmphasized(right)) - Number(isEmphasized(left)) ||
                leftKey.localeCompare(rightKey, undefined, {numeric: true}),
        );
    for (const [key, entry] of groups) {
        trailNestedGroups(entry.value);
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
