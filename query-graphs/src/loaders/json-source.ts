import * as jsonc from "jsonc-parser";
import type {SourceLocation} from "../tree-description";
import type {Json, JsonObject} from "./loader-utils";

export interface JsonSourceLocator {
    propertyLocation(object: JsonObject, key: string): SourceLocation | undefined;
}

export interface PositionedJson {
    value: Json;
    source: JsonSourceLocator;
}

interface PropertyLocation {
    from: number;
    to: number;
}

type JsonContainer = JsonObject | Json[];

function setObjectProperty(object: JsonObject, key: string, value: Json): void {
    // Ordinary assignment gives V8 its fast object-shape path. Only "__proto__" needs the
    // reflective path because assignment would mutate the prototype instead of matching JSON.parse.
    if (key !== "__proto__") {
        object[key] = value;
    } else {
        Object.defineProperty(object, key, {
            value,
            enumerable: true,
            configurable: true,
            writable: true,
        });
    }
}

/**
 * Parses JSON while retaining source ranges.
 *
 * `parsePositionedJson` is roughly 2.5x slower than the builtin `JSON.parse`, but it also keeps
 * source offsets. This performance cost is acceptable, given we can cross-link the tree with the
 * JSON document in return.
 * We only retain source locations for `positionedKeys`. This is necessary since indexing every
 * property would cost nearly five times as much memory.
 */
export function parsePositionedJson(text: string, documentId: string, positionedKeys: ReadonlySet<string>): PositionedJson {
    const errors: jsonc.ParseError[] = [];
    const locations = new WeakMap<JsonObject, Map<string, PropertyLocation>>();
    // Follow jsonc-parser's `parse` implementation: an artificial array root handles every root
    // type uniformly, while a parent stack restores the enclosing container. The parallel location
    // stack extends an indexed container property's range when `visit` reports its closing delimiter.
    const previousParents: JsonContainer[] = [];
    const openContainerPropertyLocations: (PropertyLocation | undefined)[] = [];
    let currentParent: JsonContainer = [];
    let currentProperty: string | undefined;
    let currentPropertyFrom: number | undefined;

    function currentPropertyLocation(to: number): PropertyLocation | undefined {
        return currentPropertyFrom === undefined ? undefined : {from: currentPropertyFrom, to};
    }

    function attachValue(value: Json, location: PropertyLocation | undefined): void {
        if (Array.isArray(currentParent)) {
            currentParent.push(value);
            return;
        }

        // `visit` reports object values only after their property callback.
        // Hence, we can assert that `currentProperty` is not `undefined` here.
        // A runtime assertion here would penalize every valid object value, hence we use a type assertion without a runtime check.
        const property = currentProperty!;
        setObjectProperty(currentParent, property, value);
        if (location === undefined) return;

        // Most plan properties are statistics or other data which shouldn't track source ranges.
        // Allocate the map here lazily, so we avoid this allocation for objects which don't contain
        // any location-tracked properties.
        let objectLocations = locations.get(currentParent);
        if (objectLocations === undefined) {
            objectLocations = new Map();
            locations.set(currentParent, objectLocations);
        }
        objectLocations.set(property, location);
    }

    function beginContainer(value: JsonContainer, to: number): void {
        // The begin callback only covers the opening delimiter. Remember the parent property
        // so the matching end callback can extend its value range across the full container.
        const propertyLocation = currentPropertyLocation(to);
        attachValue(value, propertyLocation);
        previousParents.push(currentParent);
        openContainerPropertyLocations.push(propertyLocation);
        currentParent = value;
        currentProperty = undefined;
        currentPropertyFrom = undefined;
    }

    function endContainer(offset: number, length: number): void {
        const propertyLocation = openContainerPropertyLocations.pop();
        if (propertyLocation !== undefined) propertyLocation.to = offset + length;
        currentParent = previousParents.pop()!;
    }

    jsonc.visit(
        text,
        {
            onObjectBegin: (offset, length) => beginContainer({}, offset + length),
            onObjectProperty: (key, offset) => {
                currentProperty = key;
                currentPropertyFrom = positionedKeys.has(key) ? offset : undefined;
            },
            onObjectEnd: endContainer,
            onArrayBegin: (offset, length) => beginContainer([], offset + length),
            onArrayEnd: endContainer,
            onLiteralValue: (value: Json, offset, length) => attachValue(value, currentPropertyLocation(offset + length)),
            onError: (error, offset, length) => errors.push({error, offset, length}),
        },
        {disallowComments: true, allowTrailingComma: false, allowEmptyContent: false},
    );
    const firstError = errors[0];
    if (firstError !== undefined) {
        throw new SyntaxError(`${jsonc.printParseErrorCode(firstError.error)} at offset ${firstError.offset}`);
    }

    return {
        value: currentParent[0]!,
        source: {
            propertyLocation: (object, key) => {
                const property = locations.get(object)?.get(key);
                return property === undefined ? undefined : {documentId, from: property.from, to: property.to};
            },
        },
    };
}
