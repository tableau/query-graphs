import assert from "node:assert/strict";
import test from "node:test";
import type {TreeNode} from "../src/tree-description";
import {evaluatePredicate, readPropertyPath, type Predicate} from "../src/insights/predicate";

test("property paths read plain properties and nested serialized values", () => {
    const node: TreeNode = {
        properties: new Map([
            ["debug-name", '{"value":"region","rank":3}'],
            ["empty", ""],
        ]),
    };
    assert.equal(readPropertyPath(node, ["debug-name"]), '{"value":"region","rank":3}');
    assert.equal(readPropertyPath(node, ["debug-name", "value"]), "region");
    assert.equal(readPropertyPath(node, ["debug-name", "rank"]), 3);
    assert.equal(readPropertyPath(node, ["debug-name", "missing"]), undefined);
    assert.equal(readPropertyPath(node, ["empty", "value"]), undefined);
});

test("composed predicates select nodes by presence and nested values", () => {
    const node: TreeNode = {
        properties: new Map([
            ["operator", "scan"],
            ["metadata", '{"rank":3}'],
            ["empty", ""],
        ]),
    };
    const predicate: Predicate = {
        op: "all",
        operands: [
            {op: "exists", path: ["empty"]},
            {op: "equals", path: ["metadata", "rank"], value: 3},
            {
                op: "any",
                operands: [
                    {op: "equals", path: ["operator"], value: "join"},
                    {op: "equals", path: ["operator"], value: "scan"},
                ],
            },
            {op: "not", operand: {op: "exists", path: ["missing"]}},
        ],
    };
    assert.equal(evaluatePredicate(node, predicate), true);
    assert.equal(evaluatePredicate({properties: new Map([["operator", "join"]])}, predicate), false);
});
