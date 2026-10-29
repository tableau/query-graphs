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

test("categorical aggregation counts collapsed occurrences once and partitions each level", () => {
    const scan1 = node({kind: "scan", table: "orders", debug: '{"value":"ignored"}'});
    const scan2 = node({kind: "scan", debug: '{"value":"orders"}'});
    const scan3 = node({kind: "scan"});
    const join = node({kind: "join", subtype: "inner"});
    const root: TreeNode = {children: [scan1, join], collapsedChildren: [scan2, scan3, node({other: "ignored"})]};
    const groups = computeCategoricalInsight(root, definition);

    // The predicate excludes the unrelated node; collapsed scans still contribute to the scan count.
    assert.deepEqual(
        groups.map(({value, nodes}) => [value, nodes.length]),
        [
            ["scan", 3],
            ["join", 1],
        ],
    );
    // Scans use nextByValue instead of the default subtype level. The first usable table source wins.
    assert.deepEqual(
        groups[0].children.map(({value, nodes}) => [value, nodes.length]),
        [
            ["orders", 2],
            ["Unknown table", 1],
        ],
    );
    assert.deepEqual(groups[0].children[0].nodes, [scan1, scan2]);
    // Other kinds continue through the default subtype level.
    assert.deepEqual(
        groups[1].children.map(({value, nodes}) => [value, nodes.length]),
        [["inner", 1]],
    );
    // Every selected occurrence belongs to exactly one child at each configured level.
    for (const group of groups)
        assert.equal(
            group.nodes.length,
            group.children.reduce((count, child) => count + child.nodes.length, 0),
        );
});

test("flat definitions end at the first level and sort equal counts alphabetically", () => {
    const flat: CategoricalInsightDefinition = {
        ...definition,
        groupBy: {valueSourceAlternatives: [["kind"]], fallbackValue: "Unknown kind"},
        where: {op: "exists", path: ["other"]},
    };
    const root: TreeNode = {children: [node({kind: "z", other: "1"}), node({kind: "a", other: "1"}), node({other: "1"})]};
    // A one-level definition has no child categories, and equal-sized groups use alphabetical order.
    assert.deepEqual(
        computeCategoricalInsight(root, flat).map(({value, children}) => [value, children.length]),
        [
            ["a", 0],
            ["Unknown kind", 0],
            ["z", 0],
        ],
    );
});
