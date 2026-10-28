import type {TreeNode} from "../tree-description";

/** A property name followed by optional keys within its serialized JSON value. */
export type PropertyPath = readonly [string, ...string[]];

/** Composable predicates for selecting plan nodes in any insight type. */
export type Predicate =
    | {op: "exists"; path: PropertyPath}
    | {op: "equals"; path: PropertyPath; value: string | number}
    | {op: "any"; operands: readonly Predicate[]}
    | {op: "all"; operands: readonly Predicate[]}
    | {op: "not"; operand: Predicate};

/** Read a path from the loader's property bag, decoding JSON only for nested keys. */
export function readPropertyPath(node: TreeNode, [property, ...keys]: PropertyPath): unknown {
    let value: unknown = node.properties?.get(property);
    if (keys.length === 0) return value;
    if (typeof value !== "string") return undefined;
    try {
        value = JSON.parse(value);
        for (const key of keys) {
            if (typeof value !== "object" || value === null || !Object.hasOwn(value, key)) return undefined;
            value = (value as Record<string, unknown>)[key];
        }
        return value;
    } catch {
        return undefined;
    }
}

/** Evaluate a predicate against a plan node. An empty any/all follows Boolean identity rules. */
export function evaluatePredicate(node: TreeNode, predicate: Predicate): boolean {
    switch (predicate.op) {
        case "exists":
            return readPropertyPath(node, predicate.path) !== undefined;
        case "equals":
            return readPropertyPath(node, predicate.path) === predicate.value;
        case "any":
            return predicate.operands.some((operand) => evaluatePredicate(node, operand));
        case "all":
            return predicate.operands.every((operand) => evaluatePredicate(node, operand));
        case "not":
            return !evaluatePredicate(node, predicate.operand);
    }
}
