import assert from "node:assert/strict";
import test from "node:test";
import type {TreeNode} from "../../src/tree-description";
import {computeCategoricalInsight, type CategoricalInsightDefinition} from "../../src/insights/categorical";

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

const node = (properties: Record<string, string>): TreeNode => ({
    properties: new Map(Object.entries(properties).map(([key, value]) => [key, {value}])),
});

test("flat definitions end at the first level and sort equal counts alphabetically", () => {
    const flat: CategoricalInsightDefinition = {
        ...definition,
        groupBy: {valueSourceAlternatives: [["kind"]], fallbackValue: "Unknown kind"},
        where: {op: "exists", path: ["other"]},
    };
    const firstZ = node({kind: "z", other: "1"});
    const firstA = node({kind: "a", other: "1"});
    const secondZ = node({kind: "z", other: "2"});
    const secondA = node({kind: "a", other: "2"});
    const root: TreeNode = {children: [firstZ, firstA, secondZ, secondA, node({kind: "excluded"})]};
    // Each matching node contributes to one flat category; there is no second level.
    // Equal non-zero counts sort alphabetically even though z occurs first in the plan.
    assert.deepEqual(computeCategoricalInsight(root, flat), [
        {value: "a", nodes: [firstA, secondA], children: []},
        {value: "z", nodes: [firstZ, secondZ], children: []},
    ]);
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

test("category sources skip nonstrings before trying alternatives or the fallback", () => {
    const flat: CategoricalInsightDefinition = {
        ...definition,
        groupBy: {
            valueSourceAlternatives: [["candidate", "value"], ["table"]],
            fallbackValue: "Unknown table",
        },
    };
    for (const value of [42, true, null, {table: "orders"}, ["orders"]]) {
        const alternative = node({kind: "scan", candidate: JSON.stringify({value}), table: "orders"});
        const fallback = node({kind: "scan", candidate: JSON.stringify({value})});
        const groups = computeCategoricalInsight({children: [alternative, fallback]}, flat);
        assert.deepEqual(groups, [
            {value: "orders", nodes: [alternative], children: []},
            {value: "Unknown table", nodes: [fallback], children: []},
        ]);
    }
    const numeric: TreeNode = {
        properties: new Map([
            ["kind", {value: "scan"}],
            ["candidate", {value: 42}],
        ]),
    };
    const numericText = node({kind: "scan", candidate: '{"value":"42"}'});
    const emptyString = node({kind: "scan", candidate: '{"value":""}'});
    assert.deepEqual(computeCategoricalInsight({children: [numeric, numericText, emptyString]}, flat), [
        {value: "", nodes: [emptyString], children: []},
        {value: "42", nodes: [numericText], children: []},
        {value: "Unknown table", nodes: [numeric], children: []},
    ]);
});
