import type {PropertyEntry} from "../tree-description";
import {numberFormatForProperty, type NumberFormat} from "../number-formats";

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

// Preserve finite input numbers for downstream computation. A loader may opt into
// name-based display formatting only for units its plan format reports reliably.
export function toPropertyEntry(value: unknown, key?: string, acceptedFormats?: readonly NumberFormat[]): PropertyEntry {
    const scalarValue = typeof value === "number" && !Number.isFinite(value) ? String(value) : value;
    const scalar = typeof scalarValue === "number" ? scalarValue : forceToString(scalarValue);
    const numberFormat =
        typeof scalar === "number" && key !== undefined ? numberFormatForProperty(key, acceptedFormats) : undefined;
    return numberFormat === undefined ? {value: scalar} : {value: scalar, numberFormat};
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
