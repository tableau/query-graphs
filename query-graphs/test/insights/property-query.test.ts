import assert from "node:assert/strict";
import test from "node:test";
import type {TreeNode} from "../../src/tree-description";
import {accessPropertyPath, evaluatePredicate, type Predicate} from "../../src/insights/property-query";

test("property paths read plain properties and nested serialized values", () => {
    const node: TreeNode = {
        properties: new Map([
            ["debug-name", {value: '{"value":"region","rank":3}'}],
            ["empty", {value: ""}],
        ]),
    };
    // A one-segment path returns the stored string; longer paths decode its JSON value.
    assert.equal(accessPropertyPath(node, ["debug-name"]), '{"value":"region","rank":3}');
    assert.equal(accessPropertyPath(node, ["debug-name", "value"]), "region");
    assert.equal(accessPropertyPath(node, ["debug-name", "rank"]), 3);
    // Missing keys, non-object values, and malformed JSON yield no category value.
    assert.equal(accessPropertyPath(node, ["debug-name", "missing"]), undefined);
    assert.equal(accessPropertyPath(node, ["empty", "value"]), undefined);
    assert.equal(accessPropertyPath({properties: new Map([["broken", {value: "{not json"}]])}, ["broken", "value"]), undefined);
    assert.equal(accessPropertyPath(node, ["missing"]), undefined);
});

test("composed predicates select nodes by presence and nested values", () => {
    const node: TreeNode = {
        properties: new Map([
            ["operator", {value: "scan"}],
            ["metadata", {value: '{"rank":3}'}],
            ["empty", {value: ""}],
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
    // An empty string still satisfies exists; all/any/not compose with nested JSON equality.
    assert.equal(evaluatePredicate(node, predicate), true);
    assert.equal(evaluatePredicate({properties: new Map([["operator", {value: "join"}]])}, predicate), false);
    // Empty conjunctions and disjunctions retain their usual Boolean identities.
    assert.equal(evaluatePredicate(node, {op: "all", operands: []}), true);
    assert.equal(evaluatePredicate(node, {op: "any", operands: []}), false);
});
