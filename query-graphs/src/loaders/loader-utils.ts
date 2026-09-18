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

// Convert to string. Returns the JSON serialization if not supported.
export function forceToString(d: unknown): string {
    let str = tryToString(d);
    if (str === undefined) {
        str = JSON.stringify(d);
    }
    return str;
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
