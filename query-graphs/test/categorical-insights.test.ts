import assert from "node:assert/strict";
import test from "node:test";
import type {TreeNode} from "../src/tree-description";
import {computeCategoricalInsight, type CategoricalInsightDefinition} from "../src/insights/categorical";

const definition: CategoricalInsightDefinition = {
    id: "example",
    title: "Example",
    where: {op: "exists", path: ["kind"]},
    groupBy: {
        valueSourceAlternatives: [["kind"]],
        fallbackValue: "Unknown kind",
        next: {valueSourceAlternatives: [["subtype"]], fallbackValue: "Unknown subtype"},
        nextByValue: {
            scan: {
                valueSourceAlternatives: [["table"], ["debug", "value"]],
                fallbackValue: "Unknown table",
            },
        },
    },
};

const node = (properties: Record<string, string>): TreeNode => ({properties: new Map(Object.entries(properties))});

test("flat definitions end at the first level and sort equal counts alphabetically", () => {
    const flat: CategoricalInsightDefinition = {
        ...definition,
        groupBy: {valueSourceAlternatives: [["kind"]], fallbackValue: "Unknown kind"},
        where: {op: "exists", path: ["other"]},
    };
    const root: TreeNode = {children: [node({kind: "z", other: "1"}), node({kind: "a", other: "1"})]};
    // A one-level definition has no child categories, and equal-sized groups use alphabetical order.
    assert.deepEqual(
        computeCategoricalInsight(root, flat).map(({value, children}) => [value, children.length]),
        [
            ["a", 0],
            ["z", 0],
        ],
    );
});

test("categorical aggregation counts matching occurrences in visible and collapsed subtrees", () => {
    const visible = node({kind: "scan", table: "orders"});
    const collapsed = node({kind: "scan", table: "orders"});
    const root: TreeNode = {children: [visible], collapsedChildren: [collapsed, node({other: "ignored"})]};
    const groups = computeCategoricalInsight(root, definition);

    // Hidden nodes count exactly once; nodes rejected by where do not appear in any category.
    assert.deepEqual(
        groups.map(({value, nodes}) => [value, nodes]),
        [["scan", [visible, collapsed]]],
    );
    // A deeper level partitions the same occurrences as its parent.
    assert.deepEqual(
        groups[0].children.map(({value, nodes}) => [value, nodes]),
        [["orders", [visible, collapsed]]],
    );
});

test("label-specific drilldown uses the first available value source", () => {
    const scan1 = node({kind: "scan", table: "orders", debug: '{"value":"ignored"}'});
    const scan2 = node({kind: "scan", debug: '{"value":"orders"}'});
    const root: TreeNode = {children: [scan1, scan2]};
    const groups = computeCategoricalInsight(root, definition);

    // The scan-specific level overrides the default subtype level; the table field wins over debug.value.
    assert.deepEqual(
        groups[0].children.map(({value, nodes}) => [value, nodes.length]),
        [["orders", 2]],
    );
    assert.deepEqual(groups[0].children[0].nodes, [scan1, scan2]);
});

test("non-special labels use the default drilldown level", () => {
    const join = node({kind: "join", subtype: "inner"});
    const outerJoin = node({kind: "join", subtype: "left-outer"});
    const groups = computeCategoricalInsight({children: [join, outerJoin]}, definition);

    // Join does not have a nextByValue override, so its subtypes use next.
    assert.deepEqual(
        groups[0].children.map(({value}) => value),
        ["inner", "left-outer"],
    );
    assert.deepEqual(
        groups[0].children.flatMap(({nodes}) => nodes),
        [join, outerJoin],
    );
});
