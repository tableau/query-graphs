import * as jsonc from "jsonc-parser";
import type {SourceLocation} from "../tree-description";
import type {Json, JsonObject} from "./loader-utils";

export interface JsonSourceLocator {
    propertyKeyLocation(object: JsonObject, key: string): SourceLocation | undefined;
    propertyValueLocation(object: JsonObject, key: string): SourceLocation | undefined;
}

export interface PositionedJson {
    value: Json;
    source: JsonSourceLocator;
}

interface PropertyLocation {
    keyFrom: number;
    keyTo: number;
    valueFrom?: number;
    valueTo?: number;
}

/**
 * Parses strict JSON while retaining source ranges only for the requested property keys.
 *
 * `visit` is slower than the engine's `JSON.parse`, but produces values and source offsets in
 * one pass. In a property-heavy 50 MiB Node 24 benchmark it was about 2.5 times slower than
 * `JSON.parse`. This performance cost is acceptable, given we can cross-link the tree with the
 * JSON document in return. Restricting the index is essential: indexing every property costs
 * nearly five times as much memory.
 */
export function parsePositionedJson(text: string, documentId: string, positionedKeys: ReadonlySet<string>): PositionedJson {
    const errors: jsonc.ParseError[] = [];
    const locations = new WeakMap<JsonObject, Map<string, PropertyLocation>>();
    // Follow jsonc-parser's `parse` implementation: an artificial array root handles every root
    // type uniformly, while a parent stack restores the enclosing container. The parallel location
    // stack extends an indexed container property's range when `visit` reports its closing delimiter.
    const root: Json[] = [];
    const previousParents: (JsonObject | Json[])[] = [];
    const containerPropertyLocations: (PropertyLocation | undefined)[] = [];
    let currentParent: JsonObject | Json[] = root;
    let currentProperty: string | undefined;
    let currentPropertyLocation: PropertyLocation | undefined;

    function addValue(value: Json, from: number, to: number): PropertyLocation | undefined {
        if (Array.isArray(currentParent)) {
            currentParent.push(value);
            return undefined;
        }

        if (currentProperty === undefined) return undefined;
        // Ordinary assignment gives V8 its fast object-shape path. Only "__proto__" needs the
        // reflective path because assignment would mutate the prototype instead of matching JSON.parse.
        if (currentProperty === "__proto__") {
            Object.defineProperty(currentParent, currentProperty, {
                value,
                enumerable: true,
                configurable: true,
                writable: true,
            });
        } else {
            currentParent[currentProperty] = value;
        }
        if (currentPropertyLocation !== undefined) {
            currentPropertyLocation.valueFrom = from;
            currentPropertyLocation.valueTo = to;
        }
        const propertyLocation = currentPropertyLocation;
        currentProperty = undefined;
        currentPropertyLocation = undefined;
        return propertyLocation;
    }

    function beginContainer(value: JsonObject | Json[], offset: number, length: number): void {
        // The begin callback only covers the opening delimiter. Remember the parent property
        // so the matching end callback can extend its value range across the full container.
        const parentProperty = addValue(value, offset, offset + length);
        previousParents.push(currentParent);
        containerPropertyLocations.push(parentProperty);
        currentParent = value;
    }

    function endContainer(offset: number, length: number): void {
        const parentProperty = containerPropertyLocations.pop();
        if (parentProperty !== undefined) parentProperty.valueTo = offset + length;
        const parent = previousParents.pop();
        if (parent !== undefined) currentParent = parent;
        currentProperty = undefined;
        currentPropertyLocation = undefined;
    }

    jsonc.visit(
        text,
        {
            onObjectBegin: (offset, length) => beginContainer({}, offset, length),
            onObjectProperty: (key, offset, length) => {
                if (Array.isArray(currentParent)) return;
                currentProperty = key;
                if (!positionedKeys.has(key)) {
                    currentPropertyLocation = undefined;
                    return;
                }
                const location = {keyFrom: offset, keyTo: offset + length};
                // Most plan properties are statistics or other unlinked data. Allocate a map only
                // for objects with requested keys; set() also gives duplicate keys last-write-wins
                // positions, matching the value semantics of JSON.parse.
                let objectLocations = locations.get(currentParent);
                if (objectLocations === undefined) {
                    objectLocations = new Map();
                    locations.set(currentParent, objectLocations);
                }
                objectLocations.set(key, location);
                currentPropertyLocation = location;
            },
            onObjectEnd: endContainer,
            onArrayBegin: (offset, length) => beginContainer([], offset, length),
            onArrayEnd: endContainer,
            onLiteralValue: (value: Json, offset, length) => addValue(value, offset, offset + length),
            onError: (error, offset, length) => errors.push({error, offset, length}),
        },
        {disallowComments: true, allowTrailingComma: false, allowEmptyContent: false},
    );
    const firstError = errors[0];
    if (firstError !== undefined) {
        throw new SyntaxError(`${jsonc.printParseErrorCode(firstError.error)} at offset ${firstError.offset}`);
    }
    if (root.length === 0) throw new SyntaxError("Invalid JSON");

    return {
        value: root[0],
        source: {
            propertyKeyLocation: (object, key) => {
                const property = locations.get(object)?.get(key);
                return property === undefined ? undefined : {documentId, from: property.keyFrom, to: property.keyTo};
            },
            propertyValueLocation: (object, key) => {
                const property = locations.get(object)?.get(key);
                return property?.valueFrom === undefined || property.valueTo === undefined
                    ? undefined
                    : {documentId, from: property.valueFrom, to: property.valueTo};
            },
        },
    };
}
