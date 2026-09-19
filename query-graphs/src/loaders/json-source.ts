import {parseTree, printParseErrorCode, type Node, type ParseError} from "jsonc-parser";
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

function propertyNode(object: Node | undefined, key: string): Node | undefined {
    if (object?.type !== "object") return undefined;
    return object.children?.findLast((child) => child.children?.[0]?.value === key);
}

function sourceLocation(documentId: string, node: Node | undefined): SourceLocation | undefined {
    return node === undefined ? undefined : {documentId, from: node.offset, to: node.offset + node.length};
}

export function parsePositionedJson(text: string, documentId: string): PositionedJson {
    const errors: ParseError[] = [];
    const root = parseTree(text, errors, {disallowComments: true, allowTrailingComma: false, allowEmptyContent: false});
    if (root === undefined || errors.length > 0) throw parseError(errors);

    const nodes = new WeakMap<JsonObject | Json[], Node>();
    const convert = (node: Node): Json => {
        switch (node.type) {
            case "array": {
                const array = (node.children ?? []).map(convert);
                nodes.set(array, node);
                return array;
            }
            case "object": {
                const object: JsonObject = {};
                nodes.set(object, node);
                for (const property of node.children ?? []) {
                    const key = property.children?.[0]?.value;
                    const value = property.children?.[1];
                    if (typeof key !== "string" || value === undefined) continue;
                    Object.defineProperty(object, key, {
                        value: convert(value),
                        enumerable: true,
                        configurable: true,
                        writable: true,
                    });
                }
                return object;
            }
            case "null":
                return null;
            case "string":
            case "number":
            case "boolean":
                return node.value as string | number | boolean;
            default:
                throw new SyntaxError(`Unexpected JSON node type '${node.type}' at offset ${node.offset}`);
        }
    };

    return {
        value: convert(root),
        source: {
            valueLocation: (value) => sourceLocation(documentId, nodes.get(value)),
            propertyKeyLocation: (object, key) => sourceLocation(documentId, propertyNode(nodes.get(object), key)?.children?.[0]),
            propertyValueLocation: (object, key) => sourceLocation(documentId, propertyNode(nodes.get(object), key)?.children?.[1]),
        },
    };
}
