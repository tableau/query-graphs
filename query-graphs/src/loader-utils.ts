import type {TreeNode, Crosslink} from "./tree-description";

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

export function tryGetPropertyPath(d: Json, path: string[]): Json | undefined {
    for (const key of path) {
        if (typeof d !== "object" || d instanceof Array || d === null) return undefined;
        if (!d.hasOwnProperty(key)) return undefined;
        d = d[key];
    }
    return d;
}

export function hasSubOject<X, Y extends PropertyKey>(o: X, key: Y): o is X & Record<Y, Record<string, unknown>> {
    return hasOwnProperty(o, key) && typeof o[key] === "object" && o[key] !== null;
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

// Convert to string. Returns the JSON serialization if not supported.
export function forceToString(d: unknown): string {
    let str = tryToString(d);
    if (str === undefined) {
        str = JSON.stringify(d);
    }
    return str;
}

export function jsonToStringMap(json: string): Map<string, string> {
    let parsedJSON: Json;
    try {
        parsedJSON = JSON.parse(json);
    } catch (err) {
        throw new Error("JSON parse failed with '" + err + "'.", {cause: err});
    }
    if (typeof parsedJSON !== "object" || Array.isArray(parsedJSON) || parsedJSON === null) {
        throw new Error("Expected a JSON object");
    }
    const result = new Map<string, string>();
    for (const key of Object.keys(parsedJSON)) {
        const value = parsedJSON[key];
        const strValue = tryToString(value);
        if (strValue === undefined) {
            throw new Error("Expected a string value, got " + typeof value);
        }
        result.set(key, strValue);
    }
    return result;
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

export function assert(value: boolean, errorMsg = "Assertion violated"): asserts value {
    if (!value) {
        // eslint-disable-next-line no-debugger
        debugger;
        throw new Error(errorMsg);
    }
}

export function assertNotNull<T>(v: T | null | undefined): asserts v is T {
    assert(v !== null, "Unexpected null value");
    assert(v !== undefined, "Unexpected undefined value");
}

// A crosslink whose target is only known by id until the whole tree has been converted
// (e.g. a magic join referencing its builder, or a CTE scan referencing its CTE).
export interface UnresolvedCrosslink {
    source: TreeNode;
    targetId: string;
}

// Resolve all pending crosslinks against a map of id -> node, dropping links whose target
// was never registered (e.g. because the referenced id lives outside the converted subtree).
export function resolveCrosslinks(nodesById: Map<string, TreeNode>, crosslinks: UnresolvedCrosslink[]): Crosslink[] {
    const resolved: Crosslink[] = [];
    for (const link of crosslinks) {
        const target = nodesById.get(link.targetId);
        if (target !== undefined) {
            resolved.push({source: link.source, target});
        }
    }
    return resolved;
}

// Sets the edge widths, relative to the number of output tuples
export function setEdgeWidths(edgeWidths: {node: TreeNode; width: number}[]): void {
    const maxWidth = edgeWidths.reduce((p, v) => (p > v.width ? p : v.width), 0);
    const minWidth = edgeWidths.reduce((p, v) => (p < v.width ? p : v.width), Infinity);
    if (minWidth == maxWidth) return;
    const factor = Math.max(maxWidth - minWidth, minWidth);
    for (const edge of edgeWidths) {
        edge.node.edgeWidth = (edge.width - minWidth) / factor;
    }
}

// Colors nodes by their share of total measured runtime, drawing the eye to the expensive operators
export function colorRelativeExecutionTime(runtimes: {node: TreeNode; time: number}[]): void {
    const totalTime = runtimes.reduce((p, v) => p + v.time, 0);
    for (const op of runtimes) {
        const relativeExecutionRatio = op.time / totalTime;
        const l = (95 + (72 - 95) * relativeExecutionRatio).toFixed(3);
        op.node.nodeColor = relativeExecutionRatio >= 0.05 ? `hsl(309, 84%, ${l}%)` : undefined;
    }
}

// Sets the cardinality edge label ("actual/estimated", or just "estimated" if actual is unknown),
// highlighting the edge when the estimate is off by more than 10x.
export function setCardinalityEdgeLabel(
    node: TreeNode,
    edgeWidths: {node: TreeNode; width: number}[],
    estimatedCard: number,
    actualCard: number | undefined,
): void {
    if (actualCard !== undefined) {
        edgeWidths.push({node, width: actualCard});
        node.edgeLabel = formatMetric(actualCard) + "/" + formatMetric(estimatedCard);
        if (estimatedCard > actualCard * 10 || actualCard > estimatedCard * 10) {
            node.edgeClass = "qg-label-highlighted";
        }
    } else {
        edgeWidths.push({node, width: estimatedCard});
        node.edgeLabel = formatMetric(estimatedCard);
    }
}
