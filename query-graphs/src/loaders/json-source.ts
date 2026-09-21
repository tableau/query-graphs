import {printParseErrorCode, visit, type ParseError} from "jsonc-parser";
import type {SourceLocation} from "../tree-description";
import type {Json, JsonObject} from "./loader-utils";

export interface JsonSourceLocator {
    valueLocation(value: JsonObject | Json[]): SourceLocation | undefined;
    propertyKeyLocation(object: JsonObject, key: string): SourceLocation | undefined;
    propertyValueLocation(object: JsonObject, key: string): SourceLocation | undefined;
}

export interface PositionedJson {
    value: Json;
    source: JsonSourceLocator;
}

function parseError(errors: ParseError[]): SyntaxError {
    const first = errors[0];
    if (first === undefined) return new SyntaxError("Invalid JSON");
    return new SyntaxError(`${printParseErrorCode(first.error)} at offset ${first.offset}`);
}

type PropertyLocation = [key: string, keyFrom: number, keyTo: number, valueFrom?: number, valueTo?: number];
type ValueLocation = [from: number, to: number, properties?: PropertyLocation[]];

interface ContainerFrame {
    value: JsonObject | Json[];
    location: ValueLocation;
    pendingProperty?: PropertyLocation;
    parentProperty?: PropertyLocation;
}

function sourceLocation(documentId: string, from?: number, to?: number): SourceLocation | undefined {
    return from === undefined || to === undefined ? undefined : {documentId, from, to};
}

export function parsePositionedJson(text: string, documentId: string): PositionedJson {
    const errors: ParseError[] = [];
    const locations = new WeakMap<JsonObject | Json[], ValueLocation>();
    const stack: ContainerFrame[] = [];
    let root: Json | undefined;

    function addValue(value: Json, from: number, to: number): PropertyLocation | undefined {
        const parent = stack.at(-1);
        if (parent === undefined) {
            root = value;
            return undefined;
        }

        if (Array.isArray(parent.value)) {
            parent.value.push(value);
            return undefined;
        }

        const property = parent.pendingProperty;
        if (property === undefined) return undefined;
        Object.defineProperty(parent.value, property[0], {
            value,
            enumerable: true,
            configurable: true,
            writable: true,
        });
        property[3] = from;
        property[4] = to;
        parent.pendingProperty = undefined;
        return property;
    }

    function beginContainer(value: JsonObject | Json[], offset: number, length: number): void {
        const location: ValueLocation = [offset, offset + length];
        const parentProperty = addValue(value, location[0], location[1]);
        locations.set(value, location);
        stack.push({value, location, parentProperty});
    }

    function endContainer(offset: number, length: number): void {
        const frame = stack.pop();
        if (frame === undefined) return;
        frame.location[1] = offset + length;
        if (frame.parentProperty !== undefined) frame.parentProperty[4] = frame.location[1];
    }

    visit(
        text,
        {
            onObjectBegin: (offset, length) => beginContainer({}, offset, length),
            onObjectProperty: (key, offset, length) => {
                const frame = stack.at(-1);
                if (frame === undefined || Array.isArray(frame.value)) return;
                const property: PropertyLocation = [key, offset, offset + length];
                frame.location[2] ??= [];
                frame.location[2].push(property);
                frame.pendingProperty = property;
            },
            onObjectEnd: endContainer,
            onArrayBegin: (offset, length) => beginContainer([], offset, length),
            onArrayEnd: endContainer,
            onLiteralValue: (value: Json, offset, length) => addValue(value, offset, offset + length),
            onError: (error, offset, length) => errors.push({error, offset, length}),
        },
        {disallowComments: true, allowTrailingComma: false, allowEmptyContent: false},
    );
    if (root === undefined || errors.length > 0) throw parseError(errors);

    function propertyLocation(object: JsonObject, key: string): PropertyLocation | undefined {
        return locations.get(object)?.[2]?.findLast(([propertyKey]) => propertyKey === key);
    }

    return {
        value: root,
        source: {
            valueLocation(value) {
                const location = locations.get(value);
                return sourceLocation(documentId, location?.[0], location?.[1]);
            },
            propertyKeyLocation: (object, key) => {
                const property = propertyLocation(object, key);
                return sourceLocation(documentId, property?.[1], property?.[2]);
            },
            propertyValueLocation: (object, key) => {
                const property = propertyLocation(object, key);
                return sourceLocation(documentId, property?.[3], property?.[4]);
            },
        },
    };
}
